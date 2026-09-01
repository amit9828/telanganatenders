// Pure helpers for turning a Gemini response into a safe tender record.
// Kept out of the route file so they carry no Next.js imports and stay unit-testable.

export const EXTRACTION_PROMPT = `
You are an expert Indian government tender analyst. Read the attached tender document
and extract the following fields. Return STRICTLY a single JSON object, nothing else:

{
  "bid_no": "The official Bid / Tender reference number, or 'N/A'",
  "title": "A concise title of the work or item being procured, or 'N/A'",
  "department": "The government department or organisation inviting the bid, or 'N/A'",
  "last_date": "Final submission date in YYYY-MM-DD format, or 'N/A'",
  "district": "District in Telangana or Andhra Pradesh mentioned in the document, or 'N/A'",
  "category": "One of 'Product', 'Service' or 'Works', or 'N/A'",
  "emd_amount": "EMD amount in INR as digits only, or 'N/A'"
}

Rules:
- Use 'N/A' for anything you cannot find. Never guess.
- last_date must be YYYY-MM-DD. Convert any other date format you find.
- emd_amount must contain digits only (no commas, no currency symbol).
- Output raw JSON only. No markdown fences, no commentary.
`;

export const TENDER_CATEGORIES = ['Product', 'Service', 'Works'];

// Gemini regularly wraps its answer in ```json fences or adds a sentence of commentary
// despite the instructions, so isolate the outermost JSON object before parsing.
export function parseAIJson(rawText) {
  const cleaned = String(rawText || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

// Normalise the model output into the exact shape MongoDB should hold, so a
// hallucinated extra key, a literal "N/A", or a stray "₹1,20,000/-" can never reach the
// tenders collection.
export function normaliseExtraction(raw) {
  const text = (value) => {
    const str = String(value ?? '').trim();
    return str && str.toUpperCase() !== 'N/A' ? str : '';
  };

  const isoDate = text(raw?.last_date).match(/\d{4}-\d{2}-\d{2}/);
  const category = text(raw?.category);
  const validCategory = TENDER_CATEGORIES.find((c) => c.toLowerCase() === category.toLowerCase());

  return {
    bid_no: text(raw?.bid_no),
    title: text(raw?.title),
    department: text(raw?.department),
    last_date: isoDate ? isoDate[0] : '',
    district: text(raw?.district),
    category: validCategory || 'Product',
    emd_amount: text(raw?.emd_amount).replace(/[^\d]/g, ''),
  };
}
