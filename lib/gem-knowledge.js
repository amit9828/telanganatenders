// Source definitions for the GeM Co-Pilot knowledge base.
//
// The sync job pulls from two places:
//   1. REMOTE_SOURCES — live GeM pages/circulars fetched over HTTP.
//   2. SEED_DOCUMENTS — a curated baseline so the Co-Pilot is useful on day one, and
//      still useful if GeM is unreachable or puts a document behind a JS-rendered page.
//
// GeM serves much of its portal behind client-side rendering, so a plain fetch will
// return an empty shell for some URLs. The sync job treats that as a soft failure and
// keeps going rather than aborting the whole run — see `extractReadableText`.

export const REMOTE_SOURCES = [
  {
    id: 'gem-terms-and-conditions',
    title: 'GeM General Terms and Conditions',
    url: 'https://mkp.gem.gov.in/documents/GTC.pdf',
    type: 'pdf',
  },
  {
    id: 'gem-circulars-index',
    title: 'GeM Circulars and Notifications',
    url: 'https://gem.gov.in/resources/circulars',
    type: 'html',
  },
];

// Curated baseline covering the questions officers ask most often. Kept deliberately
// factual and rule-shaped so retrieval returns something quotable.
export const SEED_DOCUMENTS = [
  {
    id: 'seed-vendor-assessment',
    title: 'GeM Vendor Assessment — Fees and Process',
    content: `
Vendor Assessment on GeM.

Vendor Assessment is a mandatory verification carried out for sellers who wish to offer
products in certain categories on the Government e-Marketplace. It is conducted by GeM's
empanelled assessment agencies such as QCI (Quality Council of India) and RITES.

Fee: The standard Vendor Assessment fee is Rs. 11,200 plus applicable GST per assessment.
The fee is non-refundable once the assessment process has been initiated.

Validity: A successful Vendor Assessment is valid for three years from the date of the
assessment report. Sellers must re-apply before expiry to continue offering products in
categories that require assessment.

Exemptions: Sellers holding a valid certification recognised by GeM may be granted an
exemption or a fast-tracked assessment. Micro and Small Enterprises registered on Udyam
may be eligible for concessions announced from time to time.

Process: The seller raises an assessment request from the GeM dashboard, pays the fee,
uploads the required documents, and the agency conducts a desktop and/or physical
verification of manufacturing or supply capability. The outcome is recorded on the
seller's GeM profile.
`,
  },
  {
    id: 'seed-emd-pbg',
    title: 'GeM EMD and Performance Security (PBG)',
    content: `
Earnest Money Deposit (EMD) and Performance Security on GeM.

EMD: The buyer may require an Earnest Money Deposit with the bid. On GeM the EMD is
normally specified as a fixed amount or as a percentage of the estimated bid value, and
is submitted electronically. EMD of unsuccessful bidders is released after the award of
contract. The EMD of the successful bidder is released once the Performance Security is
furnished.

EMD exemption: Sellers registered as Micro and Small Enterprises (MSE) under Udyam, and
Startups recognised by DPIIT, are generally exempt from paying EMD, subject to uploading
valid supporting documents with the bid. The exemption must be claimed at bid submission
time; it cannot be applied retrospectively.

Performance Security / Performance Bank Guarantee (PBG): The successful bidder must
furnish Performance Security, typically between 3% and 10% of the contract value as
specified in the bid document. It may be furnished as a Bank Guarantee, an insurance
surety bond, or through the other instruments permitted in the bid.

Forfeiture: EMD may be forfeited if the bidder withdraws the bid during its validity
period, or if the successful bidder fails to furnish Performance Security or execute the
contract within the stipulated time.
`,
  },
  {
    id: 'seed-make-in-india',
    title: 'Make in India and Local Content Rules on GeM',
    content: `
Public Procurement (Preference to Make in India) Order on GeM.

Classification: Suppliers are classified by local content. Class-I local supplier means
local content of 50% or more. Class-II local supplier means local content of 20% or more
but less than 50%. Non-local supplier means local content below 20%.

Purchase preference: In procurements where the Order applies, Class-I local suppliers
receive purchase preference over Class-II local suppliers and non-local suppliers.
Class-II local suppliers receive preference over non-local suppliers.

Declaration: Bidders must declare the percentage of local content and the location where
value addition takes place. For contracts above the prescribed threshold, the declaration
must be supported by a certificate from a statutory auditor or cost accountant.

False declaration: A false declaration of local content is a breach of the Code of
Integrity and can result in debarment from GeM and other government procurement.
`,
  },
  {
    id: 'seed-bid-participation',
    title: 'GeM Bid Participation, Technical Evaluation and ATC',
    content: `
Participating in a GeM Bid.

Bid types: GeM supports Direct Purchase, L1 Purchase, Bidding, and Reverse Auction. For
Bids, sellers respond to a published bid before the bid end date and time.

Additional Terms and Conditions (ATC): Buyers may attach an ATC document to a bid. The
ATC is binding and can add qualification requirements beyond the standard GeM terms.
Bidders must read the ATC carefully — a bid that does not comply with the ATC will be
rejected at technical evaluation even if the price is lowest.

Technical evaluation: Bids are first evaluated for compliance with the specifications,
eligibility criteria (such as past experience, turnover and OEM authorisation) and the
ATC. Only technically qualified bids proceed to financial comparison.

MSE and Startup relaxations: Bid eligibility conditions relating to prior turnover and
prior experience may be relaxed for MSEs and DPIIT-recognised Startups, subject to their
meeting the quality and technical specifications.

Bid validity: Bids must remain valid for the period stated in the bid document. Bidders
who withdraw or modify their bid during the validity period may face EMD forfeiture and
other action.
`,
  },
  {
    id: 'seed-oem-reseller',
    title: 'GeM OEM Panel, Reseller Authorisation and Catalogue Rules',
    content: `
OEM and Reseller rules on GeM.

OEM Panel: An Original Equipment Manufacturer registers on the OEM Panel and can
authorise resellers to sell its products on GeM. A reseller listing a product must hold a
valid OEM authorisation for that brand and model.

Catalogue accuracy: Product listings must match the actual product specifications.
Uploading a catalogue with incorrect or misleading specifications is a violation and can
lead to product delisting, seller suspension, or debarment.

Brand approval: New brands require approval before products can be listed. Generic or
unbranded products may be listed only in categories where GeM permits them.

Price reasonableness: Sellers must offer GeM prices that are not higher than the prices
offered to other buyers for the same product under similar conditions. Buyers may seek
justification where the price appears unreasonable.
`,
  },
  {
    id: 'seed-payments-timelines',
    title: 'GeM Contract Execution, Delivery and Payment Timelines',
    content: `
Contract execution and payment on GeM.

Delivery period: The delivery period is specified in the contract. Delay attracts
liquidated damages, typically 0.5% of the value of the delayed goods per week of delay,
subject to a ceiling of 10% of the contract value, unless the contract specifies
otherwise.

Consignee acceptance: On delivery, the consignee inspects the goods and records
acceptance or rejection on the GeM portal within the stipulated period. If the consignee
takes no action within the auto-acceptance window defined in the contract, the goods may
be deemed accepted.

Payment: Payment is to be released within 10 days of the generation of the Consignee
Receipt and Acceptance Certificate (CRAC). Delays in payment beyond the stipulated period
may attract interest as provided in the applicable rules.

Invoice: The seller raises the invoice on GeM against the contract. The invoice details
must match the contract and the CRAC for payment to be processed.
`,
  },
  {
    id: 'seed-incident-debarment',
    title: 'GeM Incident Management, Code of Integrity and Debarment',
    content: `
Incidents and debarment on GeM.

Incident management: Buyers and sellers can raise incidents on GeM for issues such as
non-supply, quality failure, specification mismatch, or non-payment. Incidents follow a
defined escalation path and are recorded against the party's GeM profile.

Code of Integrity: All participants must comply with the Code of Integrity, which
prohibits bribery, collusive bidding, misrepresentation of facts, and interference with
the procurement process.

Debarment: Breach of the Code of Integrity, false declarations (including false local
content or MSE claims), repeated non-supply, or supply of substandard goods can result in
suspension or debarment from GeM for a specified period. Debarment on GeM may be extended
to other government procurement platforms.
`,
  },
];

// Strips an HTML document down to readable prose. Deliberately dependency-free: script,
// style and markup are removed, entities decoded, and whitespace collapsed.
export function htmlToText(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&[a-z]+;/gi, ' ');
}
