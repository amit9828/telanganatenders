// Downloads a document from a government portal, safely.
//
// Lifted out of the tender deep-dive route so the Co-Pilot dossier ingestion can reuse
// exactly the same guards. Government portals are slow, frequently serve an HTML login
// wall with a 200 status, and a URL that reached us out of an AI-extracted PDF is
// attacker-influenced — so nothing here trusts the response.

import { isSafeRemoteUrl } from './tender-links.js';
import { isValidPDFBuffer } from './cloudflare-r2.js';

export const MAX_DOCUMENT_BYTES = 12 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 20000;

/** Distinguishes "this needs a logged-in browser" from "this is simply broken". */
export const FETCH_FAILURE = {
  BLOCKED: 'blocked',
  LOGIN_WALL: 'login_wall',
  TOO_LARGE: 'too_large',
  TIMEOUT: 'timeout',
  NOT_PDF: 'not_pdf',
  HTTP_ERROR: 'http_error',
  NETWORK: 'network',
};

/**
 * Fetches a remote PDF over plain HTTPS.
 *
 * @param {string} url
 * @returns {Promise<{ok: true, buffer: Buffer} | {ok: false, reason: string, error: string}>}
 *   `reason` is a FETCH_FAILURE code so callers can decide whether the local browser
 *   agent is worth trying; `error` is the sentence shown to staff.
 */
export async function fetchRemoteDocument(url) {
  if (!isSafeRemoteUrl(url)) {
    return { ok: false, reason: FETCH_FAILURE.BLOCKED, error: 'Blocked: the link does not point at a public host.' };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        // Several state portals return 403 to a default fetch user-agent.
        'User-Agent': 'Mozilla/5.0 (compatible; TGTendersBot/1.0; +https://www.tgtenders.in)',
        Accept: 'application/pdf,application/octet-stream,*/*',
      },
    });

    if (!response.ok) {
      return {
        ok: false,
        // 401/403 usually means the document is behind the bidder's GeM session, which
        // the local browser agent does hold.
        reason: response.status === 401 || response.status === 403
          ? FETCH_FAILURE.LOGIN_WALL
          : FETCH_FAILURE.HTTP_ERROR,
        error: `The portal returned HTTP ${response.status}.`,
      };
    }

    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_DOCUMENT_BYTES) {
      return {
        ok: false,
        reason: FETCH_FAILURE.TOO_LARGE,
        error: `The document is ${(declaredLength / 1024 / 1024).toFixed(1)}MB, which is too large to read.`,
      };
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length === 0) {
      return { ok: false, reason: FETCH_FAILURE.HTTP_ERROR, error: 'The portal returned an empty document.' };
    }
    if (buffer.length > MAX_DOCUMENT_BYTES) {
      return { ok: false, reason: FETCH_FAILURE.TOO_LARGE, error: 'The document exceeded the size limit while downloading.' };
    }

    if (!isValidPDFBuffer(buffer)) {
      const peek = buffer.subarray(0, 400).toString('latin1').toLowerCase();
      const looksLikeHtml = peek.includes('<html') || peek.includes('<!doctype');
      return {
        ok: false,
        reason: looksLikeHtml ? FETCH_FAILURE.LOGIN_WALL : FETCH_FAILURE.NOT_PDF,
        error: looksLikeHtml
          ? 'The link returned a web page, not a PDF — the portal probably requires a login.'
          : 'The downloaded file is not a readable PDF.',
      };
    }

    return { ok: true, buffer };
  } catch (error) {
    const aborted = error?.name === 'AbortError';
    return {
      ok: false,
      reason: aborted ? FETCH_FAILURE.TIMEOUT : FETCH_FAILURE.NETWORK,
      error: aborted
        ? `The portal did not respond within ${FETCH_TIMEOUT_MS / 1000}s.`
        : `Could not reach the portal: ${error?.message || 'network error'}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Only a login wall is worth re-attempting through the authenticated local browser. */
export function shouldRetryViaLocalAgent(reason) {
  return reason === FETCH_FAILURE.LOGIN_WALL;
}

const LOCAL_AGENT_ORIGIN = String(process.env.GEM_AGENT_ORIGIN || 'http://localhost:4001').replace(/\/+$/, '');
const AGENT_TIMEOUT_MS = 90000;

/**
 * Second attempt through scripts/gem-agent-server.js, which downloads inside the headful
 * Chrome window that already holds the operator's GeM session.
 *
 * Only reachable when the app is running on that same machine. On Vercel this always
 * fails, and the caller records the document as needing a local ingest run.
 */
export async function fetchViaLocalAgent(url) {
  if (process.env.VERCEL) {
    return {
      ok: false,
      reason: FETCH_FAILURE.LOGIN_WALL,
      error: 'This document sits behind a GeM login. Run the ingest from the office computer so the local browser can fetch it.',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AGENT_TIMEOUT_MS);

  try {
    const res = await fetch(`${LOCAL_AGENT_ORIGIN}/api/fetch-document`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });
    const data = await res.json().catch(() => null);

    if (!res.ok || !data?.pdf_base64) {
      return {
        ok: false,
        reason: FETCH_FAILURE.LOGIN_WALL,
        error: data?.error || `The local browser agent could not fetch this document (${res.status}).`,
      };
    }

    const buffer = Buffer.from(data.pdf_base64, 'base64');
    if (!isValidPDFBuffer(buffer)) {
      return { ok: false, reason: FETCH_FAILURE.NOT_PDF, error: 'The local agent returned something that is not a PDF.' };
    }
    return { ok: true, buffer, via: 'local_agent' };
  } catch (error) {
    return {
      ok: false,
      reason: FETCH_FAILURE.LOGIN_WALL,
      error: error?.name === 'AbortError'
        ? 'The local browser agent timed out fetching the document.'
        : 'The local browser agent is not running on this computer, so login-protected documents cannot be fetched.',
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Plain fetch, then the authenticated browser when the portal demands a session. */
export async function fetchDocumentWithFallback(url) {
  const direct = await fetchRemoteDocument(url);
  if (direct.ok || !shouldRetryViaLocalAgent(direct.reason)) return direct;

  const viaAgent = await fetchViaLocalAgent(url);
  if (viaAgent.ok) return viaAgent;

  // Report the original failure, annotated with why the rescue attempt also failed.
  return { ...direct, error: `${direct.error} ${viaAgent.error}` };
}
