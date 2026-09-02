// Pure scoring logic for the Safe GeM Matchmaker.
//
// Kept free of database and network calls so the rules that decide which client sees
// which tender — and when two clients should bid jointly — are unit-testable.
//
// A note on "turnover": the users collection has no turnover field. Rather than invent
// one, financial capacity is derived from the value of contracts a client has actually
// won (`bids.contract_value` where status is 'Won'). That is real, auditable data and is
// the same evidence a buyer would accept as proof of past performance.

import { stateForDistrict } from './regions.js';

// Indian government tenders conventionally set EMD at ~2% of the estimated contract
// value, which lets us size a tender that does not state its value outright.
const EMD_TO_VALUE_MULTIPLIER = 50;

// Score weights. They sum to 100.
const WEIGHTS = { category: 50, district: 20, documents: 15, capacity: 15 };

export const MATCH_THRESHOLD = 45;

const STOP_WORDS = new Set([
  'service', 'services', 'product', 'products', 'supply', 'supplies', 'works', 'work',
  'and', 'the', 'for', 'of', 'to', 'in', 'at', 'on', 'all', 'other', 'general',
  'category', 'categories', 'tender', 'tenders', 'goods', 'items', 'item', 'na',
]);

/**
 * Parses an Indian money expression into rupees.
 * Handles "Rs. 50,00,000", "50 lakhs", "2.5 crore", "₹1,20,000/-".
 */
export function parseIndianAmount(input) {
  const text = String(input ?? '').toLowerCase();
  if (!text.trim()) return null;

  const match = text.match(/(\d[\d,]*\.?\d*)\s*(crore|cr\b|lakh|lac\b|lakhs|lacs)?/);
  if (!match) return null;

  const value = Number(match[1].replace(/,/g, ''));
  if (!Number.isFinite(value) || value <= 0) return null;

  const unit = match[2] || '';
  if (/^cr/.test(unit) || unit === 'crore') return Math.round(value * 10_000_000);
  if (/^la/.test(unit)) return Math.round(value * 100_000);
  return Math.round(value);
}

/** Turnover the tender demands, if it states one. */
export function parseTurnoverRequirement(tender) {
  const text = String(tender?.supply_details || '');
  // Matches "Turnover Req: 50 lakhs", "Turnover Required - Rs 2 crore", "turnover: 500000".
  const match = text.match(/turnover[^:\-\n]*[:\-]\s*([^\n]+)/i);
  if (!match) return null;
  return parseIndianAmount(match[1]);
}

/** Best estimate of the contract value, used to size the opportunity. */
export function estimateTenderValue(tender) {
  const explicit = parseIndianAmount(tender?.estimated_value);
  if (explicit) return explicit;

  const emd = parseIndianAmount(tender?.emd_amount);
  if (emd) return emd * EMD_TO_VALUE_MULTIPLIER;

  return null;
}

/** Splits a client's `service_category` ("Service: Catering,Product: Furniture") into keywords. */
export function parseServiceKeywords(serviceCategory) {
  return String(serviceCategory || '')
    .split(/[,;/|]/)
    .flatMap((part) => part.split(':').pop().split(/\s+/))
    .map((word) => word.trim().toLowerCase().replace(/[^a-z0-9]/g, ''))
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

/** Financial capacity in rupees, evidenced by contracts already won. */
export function clientCapacity(wonBids = []) {
  return wonBids.reduce((total, bid) => total + (parseIndianAmount(bid?.contract_value) || 0), 0);
}

function documentReadiness(client) {
  const docs = client?.documents || {};
  const flags = [
    docs.has_turnover, docs.has_annual_returns, docs.has_msme,
    docs.has_dsc, docs.has_aadhar, docs.has_ifsc,
    client?.has_gst, client?.has_iso, Boolean(client?.gstin), Boolean(client?.udyam),
  ];
  const present = flags.filter(Boolean).length;
  return present / flags.length;
}

/**
 * Scores how well one client fits one tender.
 * @returns {{score:number, categoryHits:string[], reasons:string[], capacityMet:boolean, requiredTurnover:number|null, capacity:number}}
 */
export function scoreMatch(tender, client, capacity = 0) {
  const reasons = [];

  // --- Category fit
  const keywords = parseServiceKeywords(client?.service_category);
  const haystack = [tender?.title, tender?.category, tender?.department, tender?.supply_details]
    .filter(Boolean).join(' ').toLowerCase();
  const categoryHits = [...new Set(keywords.filter((kw) => haystack.includes(kw)))];

  // Saturate at three hits — beyond that the extra signal is noise.
  const categoryScore = keywords.length === 0
    ? 0
    : Math.min(categoryHits.length / 3, 1) * WEIGHTS.category;
  if (categoryHits.length > 0) reasons.push(`Category match on ${categoryHits.join(', ')}`);

  // --- Regional fit. Same district is ideal; same state still counts for most of it.
  const tenderState = stateForDistrict(tender?.district);
  const clientLocation = `${client?.address || ''} ${client?.district || ''}`.toLowerCase();
  let districtScore = 0;
  if (tender?.district && clientLocation.includes(String(tender.district).toLowerCase())) {
    districtScore = WEIGHTS.district;
    reasons.push(`Client operates in ${tender.district}`);
  } else if (tenderState) {
    districtScore = WEIGHTS.district * 0.5;
    reasons.push(`Tender is in ${tenderState === 'TS' ? 'Telangana' : 'Andhra Pradesh'}`);
  }

  // --- Compliance readiness
  const readiness = documentReadiness(client);
  const documentScore = readiness * WEIGHTS.documents;
  if (readiness >= 0.7) reasons.push('Document vault is largely complete');

  // --- Financial capacity
  const requiredTurnover = parseTurnoverRequirement(tender);
  let capacityMet = true;
  let capacityScore = WEIGHTS.capacity;

  if (requiredTurnover) {
    capacityMet = capacity >= requiredTurnover;
    if (capacityMet) {
      reasons.push('Past contract value clears the turnover requirement');
    } else {
      // Partial credit scaled by how close they are — this is what makes a near-miss
      // surface as a JV candidate instead of disappearing.
      capacityScore = Math.min(capacity / requiredTurnover, 1) * WEIGHTS.capacity;
      reasons.push('Turnover requirement not met alone — JV candidate');
    }
  }

  const score = Math.round(categoryScore + districtScore + documentScore + capacityScore);

  return { score, categoryHits, reasons, capacityMet, requiredTurnover, capacity };
}

/**
 * Finds a second client whose combined capacity clears the turnover bar.
 * Prefers the partner with the strongest independent fit for the same tender.
 */
export function findJvPartner(tender, primary, candidates, capacities, requiredTurnover) {
  if (!requiredTurnover) return null;

  const primaryCapacity = capacities.get(primary.email) || 0;
  const shortfall = requiredTurnover - primaryCapacity;
  if (shortfall <= 0) return null;

  const viable = candidates
    .filter((c) => c.email !== primary.email)
    .map((c) => {
      const capacity = capacities.get(c.email) || 0;
      return { client: c, capacity, fit: scoreMatch(tender, c, capacity) };
    })
    // The partner must actually close the gap, and must have some relevant capability —
    // pairing on money alone would produce a JV that cannot deliver.
    .filter((entry) => entry.capacity >= shortfall && entry.fit.categoryHits.length > 0)
    .sort((a, b) => b.fit.score - a.fit.score);

  if (viable.length === 0) return null;

  const best = viable[0];
  return {
    email: best.client.email,
    company_name: best.client.company_name || best.client.client_name || best.client.email,
    capacity: best.capacity,
    combined_capacity: primaryCapacity + best.capacity,
    fit_score: best.fit.score,
    category_hits: best.fit.categoryHits,
  };
}

/**
 * Produces the match records for one day's tenders.
 *
 * Also returns aggregate rejection counts. A run that finds nothing is a normal outcome
 * on a small dataset, and without these counts it is indistinguishable from a broken
 * filter — so the reason is reported alongside the result.
 *
 * @param {object[]} tenders  Open TS/AP tenders.
 * @param {object[]} clients  Approved clients.
 * @param {Map<string,number>} capacities  email -> capacity in rupees.
 * @returns {{matches: object[], diagnostics: object}}
 */
export function buildMatches(tenders, clients, capacities) {
  const matches = [];
  const diagnostics = {
    pairs_evaluated: 0,
    rejected_no_category_overlap: 0,
    rejected_below_threshold: 0,
    rejected_no_jv_partner: 0,
    clients_without_service_category: clients.filter(
      (c) => parseServiceKeywords(c?.service_category).length === 0
    ).length,
  };

  for (const tender of tenders) {
    const tenderId = String(tender._id);
    const estimatedValue = estimateTenderValue(tender);

    for (const client of clients) {
      diagnostics.pairs_evaluated += 1;
      const capacity = capacities.get(client.email) || 0;
      const fit = scoreMatch(tender, client, capacity);

      // A category signal is mandatory. Without it a high score is just geography and
      // paperwork, which would flood the MD with irrelevant matches.
      if (fit.categoryHits.length === 0) {
        diagnostics.rejected_no_category_overlap += 1;
        continue;
      }
      if (fit.score < MATCH_THRESHOLD) {
        diagnostics.rejected_below_threshold += 1;
        continue;
      }

      let matchType = 'DIRECT';
      let jvPartner = null;

      if (!fit.capacityMet) {
        jvPartner = findJvPartner(tender, client, clients, capacities, fit.requiredTurnover);
        // No partner can close the gap, so this is not actionable — skip rather than
        // alert the MD about a bid nobody can legally submit.
        if (!jvPartner) {
          diagnostics.rejected_no_jv_partner += 1;
          continue;
        }
        matchType = 'JV';
      }

      matches.push({
        tender_id: tenderId,
        tender_bid_no: tender.bid_no || null,
        tender_title: tender.title || 'Untitled tender',
        tender_department: tender.department || null,
        tender_district: tender.district || null,
        tender_last_date: tender.last_date || null,
        estimated_value: estimatedValue,
        required_turnover: fit.requiredTurnover,

        client_email: client.email,
        client_company: client.company_name || client.client_name || client.email,
        client_capacity: capacity,

        match_type: matchType,
        confidence: fit.score,
        reasons: fit.reasons,
        category_hits: fit.categoryHits,
        jv_partner: jvPartner,

        status: 'new',
        created_at: new Date(),
      });
    }
  }

  return {
    matches: matches.sort((a, b) => b.confidence - a.confidence),
    diagnostics,
  };
}

/** Plain-English explanation of why a run produced no matches. */
export function explainEmptyRun(diagnostics, { tendersInScope = 0, clientCount = 0 } = {}) {
  if (tendersInScope === 0) return 'No open Telangana or Andhra Pradesh tenders were in scope.';
  if (clientCount === 0) return 'There are no approved clients to match against.';
  if (diagnostics.clients_without_service_category === clientCount) {
    return 'None of the approved clients have a service category on their profile, so nothing could be matched. Ask them to complete onboarding.';
  }
  if (diagnostics.rejected_no_jv_partner > 0 && diagnostics.rejected_no_category_overlap < diagnostics.pairs_evaluated) {
    return `${diagnostics.rejected_no_jv_partner} capable client(s) fell short of the turnover requirement and no joint-venture partner could close the gap.`;
  }
  if (diagnostics.rejected_below_threshold > 0) {
    return `${diagnostics.rejected_below_threshold} pair(s) had a category overlap but scored below the ${MATCH_THRESHOLD}% confidence bar.`;
  }
  return 'No client service category overlapped with any open tender. This is expected when the published tenders are outside your clients\u2019 lines of business.';
}

/** Formats a concise WhatsApp digest for the MD. */
export function formatMatchDigest(matches, { limit = 5 } = {}) {
  if (matches.length === 0) return null;

  const jvCount = matches.filter((m) => m.match_type === 'JV').length;
  const money = (n) => (n ? `Rs ${Number(n).toLocaleString('en-IN')}` : 'value n/a');

  const lines = [
    `*GeM Matchmaker — ${matches.length} new match${matches.length > 1 ? 'es' : ''}*`,
    jvCount > 0 ? `${jvCount} flagged as JV opportunities.` : null,
    '',
  ].filter((line) => line !== null);

  matches.slice(0, limit).forEach((m, i) => {
    lines.push(
      `${i + 1}. ${m.tender_title}` +
      `\n   Client: ${m.client_company}` +
      `\n   ${m.match_type === 'JV' ? `JV with: ${m.jv_partner.company_name}` : 'Direct bid'}` +
      `\n   Est. value: ${money(m.estimated_value)} | Closes: ${m.tender_last_date || 'n/a'}` +
      `\n   Confidence: ${m.confidence}%`
    );
  });

  if (matches.length > limit) lines.push(`\n...and ${matches.length - limit} more on the dashboard.`);

  return lines.join('\n');
}
