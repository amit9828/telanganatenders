// Single place where every AI route decides *which* Gemini model to call.
//
// Before this existed, six routes each hardcoded their own model id, so upgrading the
// reasoning quality of the Co-Pilot meant editing six files and inevitably missing one.
// Worse, model ids expire: this codebase has already been through gemini-1.5-flash →
// gemini-2.5-flash → gemini-3.6-flash, each migration a hunt through the same six files.
//
// Tiers:
//   'pro'   — accuracy-critical work: reading a bid document, deciding which undertakings
//             a tender demands, drafting a legal declaration.
//   'flash' — cheap, high-volume work: bulk extraction, short chat turns.
//
// Pro models have no free tier on the Gemini API. If the key has no billing attached the
// Pro call returns 429, so every Pro request falls back to Flash rather than failing —
// the answer degrades, the page does not break.

import { GoogleGenerativeAI } from '@google/generative-ai';
import { getGeminiApiKey } from './env';

/** Last-resort ids used only when model discovery fails (offline, blocked, etc). */
const FALLBACK_FLASH = 'gemini-3.6-flash';
const FALLBACK_PRO = 'gemini-3.1-pro-preview';

/** Set either of these to pin a model and skip discovery entirely. */
const CONFIGURED_PRO = String(process.env.GEMINI_PRO_MODEL || '').trim();
const CONFIGURED_FLASH = String(process.env.GEMINI_FLASH_MODEL || '').trim();

let discovery = null;

/**
 * Asks the API which models this key can actually call, so a Google model refresh does
 * not silently break every AI feature until someone edits a constant. Resolved once per
 * process and cached; a failure falls back to the pinned ids above.
 *
 * @returns {Promise<{pro: string, flash: string}>}
 */
function discoverModels(apiKey) {
  if (discovery) return discovery;

  discovery = (async () => {
    const pinned = { pro: CONFIGURED_PRO, flash: CONFIGURED_FLASH };
    if (pinned.pro && pinned.flash) return pinned;

    try {
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=${encodeURIComponent(apiKey)}`,
      );
      if (!res.ok) throw new Error(`models.list responded ${res.status}`);
      const data = await res.json();

      const usable = (data.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
        .map((m) => String(m.name || '').replace(/^models\//, ''))
        // Image, audio, embedding and tool-specific variants are not general text models.
        .filter((id) => /^gemini-/.test(id) && !/(image|audio|tts|embedding|customtools|thinking)/i.test(id));

      // Highest version number wins, so a newer release is picked up automatically.
      const best = (kind) => usable
        .filter((id) => id.includes(`-${kind}`) && !id.includes('flash-lite'))
        .map((id) => ({ id, version: Number(id.match(/gemini-(\d+(?:\.\d+)?)/)?.[1] || 0) }))
        .sort((a, b) => b.version - a.version || a.id.length - b.id.length)[0]?.id || null;

      const resolved = {
        pro: pinned.pro || best('pro') || FALLBACK_PRO,
        flash: pinned.flash || best('flash') || FALLBACK_FLASH,
      };
      console.log(`[gemini] using pro=${resolved.pro} flash=${resolved.flash}`);
      return resolved;
    } catch (err) {
      console.warn(`[gemini] model discovery failed (${err?.message || err}); using pinned defaults.`);
      return { pro: pinned.pro || FALLBACK_PRO, flash: pinned.flash || FALLBACK_FLASH };
    }
  })();

  return discovery;
}

export const AI_LIMIT_MESSAGE = 'AI limit reached. Please wait a moment and try again, or fill the form manually.';
const AI_GENERIC_MESSAGE = 'AI request failed. Please try again, or fill the form manually.';

function errorText(error) {
  return String(error?.message || error || '');
}

/** Quota, availability and "model retired" failures are all worth retrying one tier down. */
function isFallbackWorthy(error) {
  return /\b(429|404|503)\b|quota|exceeded|not found|no longer available|overloaded|high demand/i.test(errorText(error));
}

export function isQuotaError(error) {
  return /\b429\b|Too Many Requests|quota|exceeded/i.test(errorText(error));
}

/**
 * Maps a Gemini SDK dump (often a full JSON quota payload) to a short client-safe error.
 * Original details stay in server logs; only this message should reach the UI.
 */
export function publicAiError(error) {
  if (error?.message === AI_LIMIT_MESSAGE || error?.message === AI_GENERIC_MESSAGE) {
    return error;
  }
  if (isQuotaError(error)) {
    const safe = new Error(AI_LIMIT_MESSAGE);
    safe.status = 429;
    return safe;
  }
  const raw = errorText(error);
  const looksLikeDump = /\[GoogleGenerativeAI Error\]|Too Many Requests|\{"error"|\{'@type'/i.test(raw) || raw.length > 180;
  if (looksLikeDump) {
    const safe = new Error(AI_GENERIC_MESSAGE);
    safe.status = Number(error?.status) >= 400 ? Number(error.status) : 500;
    return safe;
  }
  const safe = error instanceof Error ? error : new Error(raw || AI_GENERIC_MESSAGE);
  if (!safe.status) safe.status = Number(error?.status) >= 400 ? Number(error.status) : 500;
  return safe;
}

/**
 * Runs one generation, trying the requested tier first and degrading on quota errors.
 *
 * @param {object}   options
 * @param {Array|string} options.parts  Prompt parts, exactly as generateContent expects.
 * @param {'pro'|'flash'} [options.tier]
 * @param {object}   [options.generationConfig]
 * @returns {Promise<{ text: string, model: string, degraded: boolean }>}
 */
export async function generateContent({ parts, tier = 'pro', generationConfig } = {}) {
  const apiKey = getGeminiApiKey();
  if (!apiKey) {
    const error = new Error('GEMINI_API_KEY is not configured on this server.');
    error.status = 500;
    throw error;
  }

  const models = await discoverModels(apiKey);
  const candidates = tier === 'flash'
    ? [models.flash]
    : [...new Set([models.pro, models.flash])];

  const genAI = new GoogleGenerativeAI(apiKey);
  let lastError = null;

  for (const [index, modelName] of candidates.entries()) {
    try {
      const model = genAI.getGenerativeModel(
        generationConfig ? { model: modelName, generationConfig } : { model: modelName },
      );
      const result = await model.generateContent(parts);
      return {
        text: String(result.response.text() || ''),
        model: modelName,
        degraded: index > 0,
      };
    } catch (error) {
      lastError = error;
      const canRetry = index < candidates.length - 1 && isFallbackWorthy(error);
      console.warn(
        `[gemini] ${modelName} failed: ${error?.message || error}`
        + (canRetry ? ` — falling back to ${candidates[index + 1]}.` : ''),
      );
      if (!canRetry) break;
    }
  }

  throw publicAiError(lastError || new Error('Gemini returned no response.'));
}
