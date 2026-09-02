// WhatsApp alerting for MD notifications.
//
// Deliberately fail-soft: an alert is a side effect of a business process (a matchmaker
// run, a payment, a dispatch), and a messaging outage must never abort that process or
// surface as a 500. Every path returns a result object; nothing throws.

const REQUEST_TIMEOUT_MS = 10000;

/**
 * Normalises an Indian phone number to the digits-only E.164 form the WhatsApp APIs
 * expect (no '+', no spaces, country code included).
 */
export function normalisePhone(phone) {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return '';
  // Bare 10-digit Indian mobile — prepend the country code.
  if (digits.length === 10) return `91${digits}`;
  // 00-prefixed international dialling.
  if (digits.startsWith('00')) return digits.slice(2);
  return digits;
}

// Twilio and Meta have incompatible auth and body formats, so pick from the endpoint.
function detectProvider(apiUrl) {
  return /twilio\.com/i.test(apiUrl) ? 'twilio' : 'meta';
}

function buildRequest(provider, { apiUrl, apiToken, to, message }) {
  if (provider === 'twilio') {
    // WHATSAPP_API_TOKEN must be "ACCOUNT_SID:AUTH_TOKEN" for Twilio's Basic auth.
    const from = normalisePhone(process.env.WHATSAPP_FROM || '');
    const body = new URLSearchParams({
      To: `whatsapp:+${to}`,
      From: `whatsapp:+${from}`,
      Body: message,
    });
    return {
      url: apiUrl,
      init: {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(apiToken).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      },
    };
  }

  // Meta WhatsApp Cloud API.
  return {
    url: apiUrl,
    init: {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: message },
      }),
    },
  };
}

/**
 * Sends a WhatsApp message. Never throws.
 *
 * Automated client notifications MUST pass `{ whatsapp_verified: true }`. A missing or
 * false flag is treated as unverified and the send is skipped — that is the point of the
 * verification badge on the dashboards. Internal MD alerts omit the flag and still send.
 *
 * @param {string} phone
 * @param {string} message
 * @param {{ whatsapp_verified?: boolean }} [options]
 * @returns {Promise<{sent: boolean, skipped?: boolean, reason?: string, error?: string}>}
 */
export async function sendWhatsAppAlert(phone, message, options = {}) {
  if (Object.prototype.hasOwnProperty.call(options, 'whatsapp_verified') && options.whatsapp_verified !== true) {
    const reason = 'Recipient WhatsApp number is not verified.';
    console.warn(`[whatsapp] skipped: ${reason}`);
    return { sent: false, skipped: true, reason };
  }
  const apiUrl = process.env.WHATSAPP_API_URL;
  const apiToken = process.env.WHATSAPP_API_TOKEN;
  const body = String(message || '').trim();
  const to = normalisePhone(phone);

  // Missing configuration is a deployment state, not a runtime failure — report it as a
  // skip so callers can log it without treating the whole job as broken.
  if (!apiUrl || !apiToken) {
    const reason = 'WHATSAPP_API_URL / WHATSAPP_API_TOKEN are not configured.';
    console.warn(`[whatsapp] skipped: ${reason}`);
    return { sent: false, skipped: true, reason };
  }
  if (!to) {
    console.warn('[whatsapp] skipped: no valid recipient number supplied.');
    return { sent: false, skipped: true, reason: 'No valid recipient number.' };
  }
  if (!body) {
    console.warn('[whatsapp] skipped: empty message body.');
    return { sent: false, skipped: true, reason: 'Empty message body.' };
  }

  const provider = detectProvider(apiUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const { url, init } = buildRequest(provider, { apiUrl, apiToken, to, message: body });
    const res = await fetch(url, { ...init, signal: controller.signal, cache: 'no-store' });

    if (!res.ok) {
      // Read the provider's explanation — "template required", "number not opted in" and
      // similar are the usual causes and are invisible from the status code alone.
      const detail = await res.text().catch(() => '');
      const error = `${provider} API responded ${res.status}: ${detail.slice(0, 300)}`;
      console.error(`[whatsapp] send failed: ${error}`);
      return { sent: false, error };
    }

    console.log(`[whatsapp] alert delivered to ${to} via ${provider}.`);
    return { sent: true };
  } catch (err) {
    const error = err?.name === 'AbortError'
      ? `Request timed out after ${REQUEST_TIMEOUT_MS}ms.`
      : (err?.message || 'Unknown error');
    console.error(`[whatsapp] send failed: ${error}`);
    return { sent: false, error };
  } finally {
    clearTimeout(timer);
  }
}

/** Sends only when the user record is marked WhatsApp-verified. */
export async function sendClientWhatsAppAlert(user, message) {
  const phone = user?.phone || user?.whatsapp_number || '';
  return sendWhatsAppAlert(phone, message, { whatsapp_verified: user?.whatsapp_verified === true });
}

/** Convenience wrapper for alerts addressed to the MD. */
export async function notifyMD(message) {
  return sendWhatsAppAlert(process.env.MD_PHONE_NUMBER, message);
}
