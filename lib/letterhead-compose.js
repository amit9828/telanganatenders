import { ObjectId } from 'mongodb';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { fetchStationeryBuffer, isPubliclyServableUrl, isValidPDFBuffer } from '@/lib/cloudflare-r2';
import { bufferToDataUrl } from '@/lib/stationery-html';

export const LETTERHEAD_COLLECTION = 'company_letterheads';

const A4 = [595.28, 841.89];

function wrapLines(text, maxChars) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let current = '';
  for (const word of words) {
    if (!word) continue;
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

async function embedImage(pdf, buffer, contentType) {
  const mime = String(contentType || '');
  if (mime.includes('png')) return pdf.embedPng(buffer);
  return pdf.embedJpg(buffer);
}

/**
 * Loads a company letterhead template and returns buffers for PDF overlay + optional HTML src.
 */
export async function loadCompanyLetterhead(db, letterheadId) {
  if (!letterheadId || !ObjectId.isValid(String(letterheadId))) {
    throw Object.assign(new Error('Select a letterhead template before generating.'), { status: 400 });
  }

  const doc = await db.collection(LETTERHEAD_COLLECTION).findOne({ _id: new ObjectId(String(letterheadId)) });
  if (!doc) {
    throw Object.assign(new Error('That letterhead template was not found. Upload one in Letterhead Management.'), { status: 404 });
  }

  const fetched = await fetchStationeryBuffer({ file_url: doc.r2_url, file_r2_key: doc.r2_key });
  if (!fetched?.buffer) {
    throw Object.assign(new Error('The selected letterhead file is missing from storage.'), { status: 404 });
  }

  const isPdf = doc.kind === 'pdf' || isValidPDFBuffer(fetched.buffer);
  let src = null;
  if (!isPdf) {
    if (doc.r2_url && isPubliclyServableUrl(doc.r2_url)) src = doc.r2_url;
    else src = bufferToDataUrl(fetched.buffer, fetched.contentType || doc.content_type);
  }

  return {
    id: String(doc._id),
    name: doc.name,
    kind: isPdf ? 'pdf' : 'image',
    contentType: fetched.contentType || doc.content_type,
    buffer: fetched.buffer,
    src,
  };
}

/**
 * Draw body text over an A4 letterhead (image full-bleed, or PDF first page copied as layout).
 * Header/footer bands are left clear so logos, addresses and footers stay visible.
 */
export async function composeLetterheadPdf({ plainText, letterhead }) {
  const fontSize = 10;
  const lineHeight = 13;
  const left = 54;
  const right = 54;
  const headerBand = 150;
  const footerBand = 88;
  const maxChars = 88;

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const lines = wrapLines(plainText, maxChars);

  const paintBackground = async (page) => {
    const { width, height } = page.getSize();
    if (letterhead.kind === 'image') {
      try {
        const image = await embedImage(pdf, letterhead.buffer, letterhead.contentType);
        page.drawImage(image, { x: 0, y: 0, width, height });
      } catch {
        /* continue without image */
      }
    }
  };

  let templatePage = null;
  if (letterhead.kind === 'pdf') {
    try {
      const srcDoc = await PDFDocument.load(letterhead.buffer);
      if (srcDoc.getPageCount() > 0) {
        [templatePage] = await pdf.copyPages(srcDoc, [0]);
      }
    } catch {
      templatePage = null;
    }
  }

  const addLayoutPage = async () => {
    if (templatePage && pdf.getPageCount() === 0) {
      pdf.addPage(templatePage);
    } else if (templatePage && letterhead.kind === 'pdf') {
      const srcDoc = await PDFDocument.load(letterhead.buffer);
      const [copy] = await pdf.copyPages(srcDoc, [0]);
      pdf.addPage(copy);
    } else {
      const page = pdf.addPage(A4);
      await paintBackground(page);
    }
    return pdf.getPage(pdf.getPageCount() - 1);
  };

  let page = await addLayoutPage();
  let { height } = page.getSize();
  let y = height - headerBand;
  const minY = footerBand;

  for (const line of lines) {
    if (y < minY) {
      page = await addLayoutPage();
      height = page.getSize().height;
      y = height - headerBand;
    }
    page.drawText(line.slice(0, 140), {
      x: left,
      y,
      size: fontSize,
      font,
      color: rgb(0.08, 0.08, 0.1),
      maxWidth: page.getSize().width - left - right,
    });
    y -= lineHeight;
  }

  return Buffer.from(await pdf.save());
}
