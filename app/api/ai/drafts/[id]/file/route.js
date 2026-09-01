import { NextResponse } from 'next/server';
import { ObjectId } from 'mongodb';
import { getDb } from '@/lib/db';
import { fetchTenderPDFBuffer, isPubliclyServableUrl, isValidPDFBuffer } from '@/lib/cloudflare-r2';

export const dynamic = 'force-dynamic';

// 🚀 The draft's `pdf_url` points at R2, which is only browsable when a public bucket
// domain (CLOUDFLARE_R2_PUBLIC_URL) is configured. Otherwise it is the private S3 API
// endpoint, and sending the browser there returns a 401 XML body that renders as a
// blank page. This route redirects when the URL really is public and streams the bytes
// with credentials when it isn't, so "View PDF" works either way.
export async function GET(request, { params }) {
  try {
    const { id } = params;
    const db = await getDb();

    const draft = await db.collection('ai_draft_tenders').findOne(
      ObjectId.isValid(id) ? { _id: new ObjectId(id) } : { _id: id }
    );
    if (!draft) return NextResponse.json({ error: 'Draft not found' }, { status: 404 });

    const fileName = draft.pdf_filename || 'draft.pdf';
    const fileUrl = String(draft.pdf_url || '').trim();

    if (fileUrl && isPubliclyServableUrl(fileUrl)) {
      return NextResponse.redirect(fileUrl, 307);
    }

    const streamHeaders = (buffer) => ({
      'Content-Type': 'application/pdf',
      'Content-Length': String(buffer.length),
      'Content-Disposition': `inline; filename="${fileName}"`,
      'Cache-Control': 'private, max-age=0, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    });

    const buffer = await fetchTenderPDFBuffer({
      pdf_url: fileUrl,
      pdf_filename: draft.pdf_filename,
      pdf_r2_key: draft.pdf_r2_key,
    });
    if (buffer && isValidPDFBuffer(buffer)) {
      return new NextResponse(new Uint8Array(buffer), { status: 200, headers: streamHeaders(buffer) });
    }

    // Drafts created by the older single-file analyzer still hold the blob inline.
    if (typeof draft.pdf_base64 === 'string' && draft.pdf_base64.length > 0) {
      const legacy = Buffer.from(draft.pdf_base64.replace(/^data:[^;,]*(;base64)?,/, ''), 'base64');
      if (isValidPDFBuffer(legacy)) {
        return new NextResponse(new Uint8Array(legacy), { status: 200, headers: streamHeaders(legacy) });
      }
    }

    console.error('[ai/drafts/file] no readable source for draft', id, {
      has_pdf_url: Boolean(fileUrl),
      has_pdf_r2_key: Boolean(draft.pdf_r2_key),
    });
    return NextResponse.json(
      { error: 'The PDF for this draft is missing from storage. Please re-upload it.' },
      { status: 404 }
    );
  } catch (error) {
    console.error('[ai/drafts/file] failed:', error);
    return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 });
  }
}
