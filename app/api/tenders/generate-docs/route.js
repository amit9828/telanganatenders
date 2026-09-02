import { NextResponse } from 'next/server';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getDb } from '@/lib/db';
import { requireDashboardStaff } from '@/lib/staff-auth';
import { findTenderByAnyId } from '@/lib/tender-lookup';
import { sanitizeGeneratedHtml } from '@/lib/html-sanitize';
import { searchCopilotKnowledge } from '@/lib/gem-copilot-knowledge';
import {
  DOC_TYPES,
  PACKAGE_100X_TYPES,
  buildDocumentPrompt,
  findDocType,
} from '@/lib/document-templates';
import { fetchStationeryBuffer, isPubliclyServableUrl } from '@/lib/cloudflare-r2';
import { bufferToDataUrl, wrapWithStationery } from '@/lib/stationery-html';
import { composeLetterheadPdf, loadCompanyLetterhead } from '@/lib/letterhead-compose';

export const runtime = 'nodejs';
export const maxDuration = 60;
export const dynamic = 'force-dynamic';

function htmlToPlain(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/h[1-6]>/gi, '\n\n')
    .replace(/<li>/gi, '• ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

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

async function loadStationerySrc(url, r2Key) {
  if (url && isPubliclyServableUrl(url)) return { src: url, buffer: null, contentType: null };
  const fetched = await fetchStationeryBuffer({ file_url: url, file_r2_key: r2Key });
  if (!fetched?.buffer) return { src: null, buffer: null, contentType: null };
  return {
    src: bufferToDataUrl(fetched.buffer, fetched.contentType),
    buffer: fetched.buffer,
    contentType: fetched.contentType,
  };
}

async function buildPdf({ title, plainText, letterhead }) {
  if (letterhead?.buffer) {
    return composeLetterheadPdf({ plainText, letterhead });
  }
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.TimesRoman);
  const bold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const pageSize = [595.28, 841.89];
  let page = pdf.addPage(pageSize);
  const margin = 54;
  const maxWidth = pageSize[0] - margin * 2;
  const lineHeight = 13;
  let y = pageSize[1] - margin;

  page.drawText(String(title || 'Document').slice(0, 90), {
    x: margin,
    y,
    size: 14,
    font: bold,
    color: rgb(0.04, 0.15, 0.28),
  });
  y -= 24;

  const lines = wrapLines(plainText, 92);
  for (const line of lines) {
    if (y < 70) {
      page = pdf.addPage(pageSize);
      y = pageSize[1] - margin;
    }
    page.drawText(line.slice(0, 120), {
      x: margin,
      y,
      size: 10,
      font,
      color: rgb(0.1, 0.1, 0.12),
      maxWidth,
    });
    y -= lineHeight;
  }

  return Buffer.from(await pdf.save());
}

async function draftOne({ model, docType, client, tender, copilotContext, letterhead, signatureSrc }) {
  const prompt = buildDocumentPrompt({
    docType,
    client,
    tender,
    copilotContext,
    instructions:
      'Format for printing on the selected company letterhead. Do not repeat the company header, ' +
      'address block or logo — those are already on the letterhead. Start with the date and recipient, then the body.',
  });

  const result = await model.generateContent(prompt);
  const unfenced = String(result.response.text() || '')
    .replace(/^\s*```(?:html)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
  const html = sanitizeGeneratedHtml(unfenced);
  if (!html) throw new Error('The AI returned an empty document.');

  const wrapped = wrapWithStationery(html, {
    letterheadSrc: letterhead.kind === 'image' ? letterhead.src : null,
    signatureSrc,
  });
  const pdfBuffer = await buildPdf({
    title: docType.label,
    plainText: htmlToPlain(html),
    letterhead,
  });

  const slug = String(docType.id || 'document').replace(/[^a-z0-9_-]/gi, '-');
  return {
    doc_type: { id: docType.id, label: docType.label },
    html: wrapped,
    text: htmlToPlain(html),
    filename: `${slug}.pdf`,
    mime: 'application/pdf',
    content_base64: pdfBuffer.toString('base64'),
  };
}

export async function GET() {
  return NextResponse.json({
    doc_types: [
      { id: 'custom_letterhead', label: 'Custom Letterhead' },
      { id: 'bid_undertaking', label: 'Bid Undertaking' },
      { id: 'compliance_declaration', label: 'Compliance Declaration' },
      { id: 'package_100x', label: '100x Document Package' },
    ].concat(
      DOC_TYPES
        .filter((t) => !['custom_letterhead', 'bid_undertaking', 'compliance_declaration', 'package_100x'].includes(t.id))
        .map(({ id, label, description }) => ({ id, label, description })),
    ),
  });
}

export async function POST(request) {
  const auth = await requireDashboardStaff(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  if (!process.env.GEMINI_API_KEY) {
    return NextResponse.json({ error: 'GEMINI_API_KEY is not configured on this server.' }, { status: 500 });
  }

  try {
    const body = await request.json().catch(() => null);
    const docTypeId = String(body?.doc_type || '').trim();
    const clientEmail = String(body?.client_email || '').trim().toLowerCase();
    const tenderId = body?.tender_id ? String(body.tender_id).trim() : '';
    const letterheadId = String(body?.letterhead_id || '').trim();
    const format = String(body?.format || 'pdf').toLowerCase();

    if (!letterheadId) {
      return NextResponse.json({
        error: 'Select a company letterhead template before generating.',
      }, { status: 400 });
    }
    if (!clientEmail) {
      return NextResponse.json({ error: 'Select a client so KYC details can be applied.' }, { status: 400 });
    }

    const isPackage = docTypeId === 'package_100x';
    const primaryType = isPackage ? findDocType('cover_letter') : findDocType(docTypeId);
    if (!primaryType && !isPackage) {
      return NextResponse.json(
        { error: `Unknown document type. Choose one of: ${DOC_TYPES.map((t) => t.label).join(', ')}.` },
        { status: 400 },
      );
    }

    const db = await getDb();
    const client = await db.collection('users').findOne(
      { email: clientEmail },
      {
        projection: {
          email: 1, client_name: 1, company_name: 1, company_type: 1, phone: 1,
          address: 1, gstin: 1, udyam: 1, service_category: 1,
          letterhead_url: 1, letterhead_r2_key: 1, signature_url: 1, signature_r2_key: 1,
        },
      },
    );
    if (!client) {
      return NextResponse.json({ error: 'Client profile not found.' }, { status: 404 });
    }

    const tender = tenderId
      ? await findTenderByAnyId(db, tenderId, {
        projection: {
          bid_no: 1, title: 1, department: 1, last_date: 1, district: 1,
          category: 1, emd_amount: 1, supply_details: 1,
        },
      })
      : null;
    if (tenderId && !tender) {
      return NextResponse.json({ error: 'That tender could not be found.' }, { status: 404 });
    }

    const knowledgeQuery = [
      primaryType?.label,
      tender?.title,
      tender?.bid_no,
      'GFR GeM GTC bid undertaking compliance',
    ].filter(Boolean).join(' ');
    const knowledgeDocs = await searchCopilotKnowledge(db, knowledgeQuery, { limit: 4 });
    const copilotContext = knowledgeDocs.length
      ? knowledgeDocs.map((d) => `### ${d.title}\n${String(d.content_text || '').slice(0, 3500)}`).join('\n\n')
      : '';

    let letterhead;
    let signatureSrc = null;
    try {
      letterhead = await loadCompanyLetterhead(db, letterheadId);
    } catch (err) {
      if (err.status) return NextResponse.json({ error: err.message }, { status: err.status });
      throw err;
    }
    signatureSrc = (await loadStationerySrc(client.signature_url, client.signature_r2_key)).src;

    const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    // 🚀 FIX: gemini-1.5-flash is retired; gemini-3.6-flash is what this account's
    // GEMINI_API_KEY is actually entitled to (verified live).
    const model = genAI.getGenerativeModel({ model: 'gemini-3.6-flash' });

    const typesToDraft = isPackage
      ? PACKAGE_100X_TYPES.map(findDocType).filter(Boolean)
      : [primaryType];

    // 🚀 FIX (Timeout Prevention): the 100x package drafts multiple document types —
    // each is an independent Gemini call + PDF render, so run them concurrently
    // instead of one-at-a-time to keep the whole request comfortably inside
    // maxDuration on Vercel.
    const files = await Promise.all(typesToDraft.map((docType) => draftOne({
      model,
      docType,
      client,
      tender,
      copilotContext,
      letterhead,
      signatureSrc,
    })));

    if (format === 'txt' || format === 'text') {
      const combined = files.map((f) => `===== ${f.doc_type.label} =====\n\n${f.text}`).join('\n\n');
      return NextResponse.json({
        success: true,
        knowledge_used: knowledgeDocs.map((d) => d.title),
        files: [{
          filename: `${(isPackage ? 'document-package' : primaryType.id)}.txt`,
          mime: 'text/plain; charset=utf-8',
          content_base64: Buffer.from(combined, 'utf8').toString('base64'),
          text: combined,
        }],
      });
    }

    return NextResponse.json({
      success: true,
      knowledge_used: knowledgeDocs.map((d) => d.title),
      stationery: {
        letterhead: Boolean(letterhead?.buffer),
        letterhead_name: letterhead?.name || null,
        signature: Boolean(signatureSrc),
      },
      files,
    });
  } catch (error) {
    console.error('[tenders/generate-docs] fatal:', error);
    return NextResponse.json({ error: error?.message || 'Document generation failed.' }, { status: 500 });
  }
}
