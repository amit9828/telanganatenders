// Document types the AI generator can produce, plus the prompt that drives it.
//
// Kept as data rather than free-form strings in the route so the client dropdown and the
// server validation are guaranteed to agree on the same list — a mismatch would let the
// UI offer a document type the API rejects.

export const DOC_TYPES = [
  {
    id: 'custom_letterhead',
    label: 'Custom Letterhead',
    description: 'Formal letter on the client’s official letterhead.',
    guidance:
      'A professionally worded official letter on company letterhead, suitable for addressing the ' +
      'tendering authority. Keep the body general enough for the officer to reuse, with clearly ' +
      'marked placeholders for any fact not present in the context.',
  },
  {
    id: 'bid_undertaking',
    label: 'Bid Undertaking',
    description: 'Undertaking confirming bid submission and eligibility.',
    guidance:
      'A bid undertaking confirming that the bidder has read the tender, accepts all GeM GTC and ' +
      'bid-specific terms, and undertakes to honour the offer if selected. Reference GFR 2017 only ' +
      'where the supplied Co-Pilot knowledge actually supports a citation.',
  },
  {
    id: 'compliance_declaration',
    label: 'Compliance Declaration',
    description: 'Declaration of statutory and tender compliance.',
    guidance:
      'A compliance declaration covering eligibility, non-blacklisting, GST/MSME status, and ' +
      'clause-level compliance with the tender. Use a short numbered list. Do not invent clause numbers.',
  },
  {
    id: 'package_100x',
    label: '100x Document Package',
    description: 'Full bid document pack (multiple letters in one download).',
    guidance:
      'A covering index page listing the enclosed bid documents for a complete GeM submission pack.',
  },
  {
    id: 'cover_letter',
    label: 'Bid Cover Letter',
    description: 'Formal covering letter submitted with the bid.',
    guidance:
      'A covering letter addressed to the tendering authority, confirming submission of the bid, ' +
      'listing the enclosed documents, and affirming that the bidder accepts all terms and ' +
      'conditions of the tender.',
  },
  {
    id: 'oem_authorization',
    label: 'OEM Authorization Letter',
    description: 'Manufacturer authorisation supporting the bid.',
    guidance:
      'An OEM (Original Equipment Manufacturer) authorisation letter on the manufacturer\'s behalf, ' +
      'authorising the bidder to quote, supply and provide warranty support for the tendered items. ' +
      'Leave the manufacturer\'s name and details as clearly marked placeholders for the client to fill.',
  },
  {
    id: 'rti_inquiry',
    label: 'RTI Inquiry',
    description: 'Right to Information request about a tender.',
    guidance:
      'An application under the Right to Information Act, 2005 addressed to the Public Information ' +
      'Officer of the tendering department, seeking specific information about the tender process. ' +
      'Include the standard statement about the application fee and the 30-day response timeline.',
  },
  {
    id: 'declaration',
    label: 'Bidder Declaration / Undertaking',
    description: 'Self-declaration of eligibility and compliance.',
    guidance:
      'A self-declaration and undertaking confirming that the bidder is not blacklisted or debarred ' +
      'by any government body, that all submitted information is true, and that the bidder complies ' +
      'with the eligibility criteria of the tender.',
  },
  {
    id: 'emd_exemption',
    label: 'EMD Exemption Request',
    description: 'MSME / Udyam-based EMD exemption request.',
    guidance:
      'A request for exemption from the Earnest Money Deposit on the basis of the bidder\'s MSME / ' +
      'Udyam registration, citing the relevant government procurement policy for micro and small ' +
      'enterprises. Reference the bidder\'s Udyam number if it is available in the profile.',
  },
  {
    id: 'technical_compliance',
    label: 'Technical Compliance Statement',
    description: 'Clause-by-clause compliance sheet.',
    guidance:
      'A technical compliance statement laid out as a table with columns for the tender specification, ' +
      'the bidder\'s offered specification, and a compliance status column. Base the rows on the ' +
      'tender details supplied; where specifications are not available, produce clearly marked ' +
      'placeholder rows for the client to complete.',
  },
  {
    id: 'delivery_undertaking',
    label: 'Delivery & Warranty Undertaking',
    description: 'Commitment on delivery schedule and warranty.',
    guidance:
      'An undertaking committing to the delivery schedule and warranty terms required by the tender, ' +
      'including after-sales support arrangements.',
  },
  {
    id: 'bid_withdrawal',
    label: 'Bid Withdrawal Request',
    description: 'Formal request to withdraw a submitted bid.',
    guidance:
      'A formal letter requesting withdrawal of a previously submitted bid, stating the request ' +
      'politely and requesting confirmation and the return of any EMD paid.',
  },
  {
    id: 'scn_reply',
    label: 'GeM Show-Cause Notice Reply',
    description: 'Formal reply to a Show Cause Notice (SCN) issued on GeM.',
    guidance:
      'A formal, respectful reply to a Show Cause Notice (SCN) issued by the buyer/GeM authority, ' +
      'addressing the alleged non-compliance point by point, explaining the circumstances, and ' +
      'requesting that no adverse action (blacklisting, forfeiture of EMD/PBG, or order cancellation) ' +
      'be taken. Reference the specific SCN clause or reason only where it is supplied in the ' +
      'instructions or context — otherwise leave it as a clearly marked placeholder such as ' +
      '[INSERT SCN REFERENCE NUMBER / DATE / REASON]. Close with a request for an opportunity of ' +
      'personal hearing if the matter is not resolved on record.',
  },
];

export function findDocType(id) {
  const key = String(id || '').trim().toLowerCase();
  return DOC_TYPES.find(
    (t) => t.id === key || t.label.toLowerCase() === key
  ) || null;
}

const HTML_CONTRACT = `
OUTPUT FORMAT — follow exactly:
- Output raw HTML only. No markdown code fences, no commentary before or after.
- Do NOT output <html>, <head>, <body>, <style>, <script> or any CSS. Only the document body content.
- Use semantic tags: <h1> for the document title, <h2> for section headings, <p> for
  paragraphs, <br> for line breaks inside a block, <ul>/<li> for lists, <table>/<tr>/<td>
  for tabular content, <strong> for emphasis.
- The output is printed onto pre-printed company letterhead. Do NOT repeat the company
  name, logo, address or contact details as a header block at the top — the letterhead
  already carries them. Start with the date and the recipient block.
- End with a signature block containing clearly marked placeholders, for example:
  <p>Yours faithfully,<br><br><br>_______________________<br><strong>[Authorised Signatory]</strong><br>
  Name: ____________________<br>Designation: ____________________<br>Date: ____________________<br>
  (Company Seal)</p>
- Where a required fact is not present in the supplied context, insert a clearly marked
  placeholder in square brackets such as [INSERT DELIVERY PERIOD]. Never invent facts,
  figures, registration numbers, dates or officer names.
`;

/**
 * Builds the full Gemini prompt for one document.
 *
 * @param {object} args
 * @param {object} args.docType  An entry from DOC_TYPES.
 * @param {object} args.client   Client profile fields.
 * @param {object|null} args.tender  Tender fields, when one was selected.
 * @param {string} [args.instructions] Optional free-text steer from the user.
 */
export const PACKAGE_100X_TYPES = [
  'custom_letterhead',
  'cover_letter',
  'bid_undertaking',
  'compliance_declaration',
];

export function buildDocumentPrompt({ docType, client, tender, instructions, copilotContext }) {
  const line = (label, value) => (value ? `${label}: ${value}` : null);

  const clientBlock = [
    line('Company Name', client?.company_name),
    line('Contact Person', client?.client_name),
    line('Constitution', client?.company_type),
    line('Address', client?.address),
    line('Phone', client?.phone),
    line('Email', client?.email),
    line('GSTIN', client?.gstin),
    line('Udyam / MSME Registration', client?.udyam),
    line('Business Category', client?.service_category),
  ].filter(Boolean).join('\n') || 'No profile details are on record.';

  const tenderBlock = tender
    ? [
        line('Bid / Tender Number', tender.bid_no),
        line('Tender Title', tender.title),
        line('Tendering Department', tender.department),
        line('District', tender.district),
        line('Category', tender.category),
        line('Bid Closing Date', tender.last_date),
        line('EMD Amount', tender.emd_amount),
        line('Supply / Scope Details', tender.supply_details),
      ].filter(Boolean).join('\n') || 'No tender details are on record.'
    : 'No specific tender was selected. Use clearly marked placeholders such as ' +
      '[INSERT TENDER REFERENCE NUMBER] wherever tender-specific facts are required.';

  return `
You are a Senior Tender Documentation Specialist at an Indian government procurement
consultancy. You draft formal bid documents for submission to government departments and
on the Government e-Marketplace (GeM).

DOCUMENT TO PRODUCE: ${docType.label}
${docType.guidance}

BIDDER (our client)
${clientBlock}

TENDER
${tenderBlock}
${instructions ? `\nADDITIONAL INSTRUCTIONS FROM THE USER\n${instructions}\n` : ''}
${copilotContext ? `\nCO-PILOT KNOWLEDGE (prefer these official extracts; do not contradict them)\n${copilotContext}\n` : ''}
WRITING STANDARDS
- Formal Indian business English, as used in government correspondence.
- Precise and complete, but free of padding. No marketing language.
- Use the exact company name, registration numbers and tender references given above.
  Never alter or approximate them.
- Reference Indian procurement conventions (GFR 2017, GeM GTC, MSME procurement policy)
  only where they appear in the Co-Pilot knowledge or tender context. Never invent clause numbers.
${HTML_CONTRACT}
`.trim();
}
