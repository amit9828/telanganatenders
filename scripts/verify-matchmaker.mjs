// Sanity check for the Safe GeM Matchmaker scoring, JV pairing and WhatsApp helpers.
// Run: node scripts/verify-matchmaker.mjs
import assert from 'node:assert/strict';
import {
  buildMatches,
  clientCapacity,
  estimateTenderValue,
  explainEmptyRun,
  findJvPartner,
  formatMatchDigest,
  MATCH_THRESHOLD,
  parseIndianAmount,
  parseServiceKeywords,
  parseTurnoverRequirement,
  scoreMatch,
} from '../lib/matchmaking.js';
import { isTelanganaOrAndhra, stateForDistrict } from '../lib/regions.js';
import { normalisePhone, sendWhatsAppAlert } from '../lib/whatsapp.js';

// --- parseIndianAmount: tender documents write money every way imaginable.
assert.equal(parseIndianAmount('450000'), 450000);
assert.equal(parseIndianAmount('Rs. 4,50,000/-'), 450000);
assert.equal(parseIndianAmount('₹1,20,000'), 120000);
assert.equal(parseIndianAmount('50 lakhs'), 5000000);
assert.equal(parseIndianAmount('2.5 crore'), 25000000);
assert.equal(parseIndianAmount('N/A'), null);
assert.equal(parseIndianAmount(''), null);
assert.equal(parseIndianAmount(null), null);
assert.equal(parseIndianAmount('zero'), null);

// --- Turnover requirement is buried in the free-text supply_details block.
assert.equal(parseTurnoverRequirement({ supply_details: 'EMD: 50000\nTurnover Req: 50 lakhs\nDocs: GST' }), 5000000);
assert.equal(parseTurnoverRequirement({ supply_details: 'Turnover Required - Rs 2 crore' }), 20000000);
assert.equal(parseTurnoverRequirement({ supply_details: 'No financial criteria stated.' }), null);
assert.equal(parseTurnoverRequirement({}), null);

// --- Estimated value: explicit field wins, otherwise EMD at the 2% convention.
assert.equal(estimateTenderValue({ estimated_value: '10 lakhs' }), 1000000);
assert.equal(estimateTenderValue({ emd_amount: '20000' }), 1000000);
assert.equal(estimateTenderValue({}), null);

// --- Service keywords: the client profile stores "Service: X,Product: Y".
const keywords = parseServiceKeywords('Service: Catering,Product: Office Furniture');
assert.ok(keywords.includes('catering'), 'should keep catering');
assert.ok(keywords.includes('furniture'), 'should keep furniture');
assert.ok(!keywords.includes('service'), 'should drop the label prefix');
assert.ok(!keywords.includes('product'), 'should drop the label prefix');
assert.deepEqual(parseServiceKeywords(''), []);
assert.deepEqual(parseServiceKeywords(null), []);

// --- Capacity is derived from won contracts, not a self-declared field.
assert.equal(clientCapacity([{ contract_value: '500000' }, { contract_value: '2 lakhs' }]), 700000);
assert.equal(clientCapacity([{ contract_value: 'N/A' }]), 0);
assert.equal(clientCapacity([]), 0);

// --- Regional filter
assert.equal(stateForDistrict('Hyderabad'), 'TS');
assert.equal(stateForDistrict('Guntur'), 'AP');
assert.equal(stateForDistrict('Mumbai'), null);
assert.ok(isTelanganaOrAndhra({ district: 'Warangal' }));
// District missing, but the department names the state.
assert.ok(isTelanganaOrAndhra({ district: '', department: 'Govt of Telangana, Health Dept' }));
assert.ok(!isTelanganaOrAndhra({ district: 'Pune', title: 'Supply of desks', department: 'Maharashtra PWD' }));

// --- Scoring
const cateringTender = {
  _id: 't1',
  title: 'Supply of catering services to district hospital',
  category: 'Service',
  department: 'Health Dept, Telangana',
  district: 'Hyderabad',
  emd_amount: '40000',
  supply_details: 'Turnover Req: 50 lakhs',
};

const strongClient = {
  email: 'a@x.com',
  company_name: 'Alpha Caterers',
  service_category: 'Service: Catering,Service: Hospital Catering',
  address: 'Somajiguda, Hyderabad',
  documents: { has_turnover: true, has_annual_returns: true, has_msme: true, has_dsc: true, has_aadhar: true, has_ifsc: true },
  has_gst: true, gstin: '36ABCDE1234F1Z5', udyam: 'UDYAM-TS-01-0001',
};

const strongFit = scoreMatch(cateringTender, strongClient, 6000000);
assert.ok(strongFit.score >= MATCH_THRESHOLD, `strong fit scored only ${strongFit.score}`);
assert.equal(strongFit.capacityMet, true);
assert.equal(strongFit.requiredTurnover, 5000000);
assert.ok(strongFit.categoryHits.includes('catering'));

// An unrelated client must produce no category signal at all.
const unrelated = { email: 'b@x.com', service_category: 'Product: Cement Blocks', address: 'Hyderabad' };
assert.deepEqual(scoreMatch(cateringTender, unrelated, 9000000).categoryHits, []);

// Capacity shortfall must be reported, not silently passed.
const shortOnMoney = scoreMatch(cateringTender, strongClient, 1000000);
assert.equal(shortOnMoney.capacityMet, false);
assert.ok(shortOnMoney.score < strongFit.score, 'a shortfall must reduce the score');

// --- JV pairing
const partner = {
  email: 'c@x.com',
  company_name: 'Gamma Foods',
  service_category: 'Service: Catering',
  address: 'Warangal',
  documents: { has_turnover: true, has_msme: true },
};
const capacities = new Map([['a@x.com', 1000000], ['c@x.com', 4500000], ['b@x.com', 9000000]]);

const jv = findJvPartner(cateringTender, strongClient, [strongClient, partner, unrelated], capacities, 5000000);
assert.ok(jv, 'a partner that closes the 40 lakh gap should be found');
assert.equal(jv.email, 'c@x.com');
assert.equal(jv.combined_capacity, 5500000);

// The high-capacity client with no relevant capability must never be proposed as a
// partner — a JV that cannot deliver is worse than no match.
const jvNoCapability = findJvPartner(
  cateringTender, strongClient, [strongClient, unrelated], capacities, 5000000
);
assert.equal(jvNoCapability, null, 'money alone must not qualify a JV partner');

// Nobody can close the gap.
assert.equal(
  findJvPartner(cateringTender, strongClient, [strongClient, partner], new Map([['a@x.com', 0], ['c@x.com', 1000]]), 5000000),
  null
);

// No turnover clause means no JV is needed.
assert.equal(findJvPartner(cateringTender, strongClient, [strongClient, partner], capacities, null), null);

// --- buildMatches end to end
const { matches, diagnostics } = buildMatches([cateringTender], [strongClient, partner, unrelated], capacities);
assert.ok(matches.length > 0, 'expected at least one match');
assert.equal(diagnostics.pairs_evaluated, 3);
assert.equal(diagnostics.rejected_no_category_overlap, 1, 'the unrelated client should be counted as rejected');
assert.ok(matches.every((m) => m.category_hits.length > 0), 'every match must have a category signal');
assert.ok(!matches.some((m) => m.client_email === 'b@x.com'), 'the unrelated client must be excluded');
assert.ok(matches.every((m) => m.confidence >= MATCH_THRESHOLD));
// Sorted by confidence, highest first.
for (let i = 1; i < matches.length; i += 1) {
  assert.ok(matches[i - 1].confidence >= matches[i].confidence, 'matches must be sorted by confidence');
}

// Alpha lacks the turnover alone (1,000,000 of 5,000,000) so it must come through as a JV.
const alphaMatch = matches.find((m) => m.client_email === 'a@x.com');
assert.ok(alphaMatch, 'Alpha should still match via JV');
assert.equal(alphaMatch.match_type, 'JV');
assert.equal(alphaMatch.jv_partner.email, 'c@x.com');
assert.equal(alphaMatch.required_turnover, 5000000);
assert.equal(alphaMatch.estimated_value, 2000000);
assert.equal(alphaMatch.status, 'new');

// A tender nobody can service must produce nothing rather than noise.
const noFit = buildMatches(
  [{ _id: 't2', title: 'Construction of a flyover', category: 'Works', district: 'Guntur' }],
  [strongClient],
  capacities
);
assert.deepEqual(noFit.matches, []);
assert.equal(noFit.diagnostics.rejected_no_category_overlap, 1);

// --- explainEmptyRun: an empty result must always come with a readable reason so a
// zero-match run is distinguishable from a broken job.
assert.match(explainEmptyRun(noFit.diagnostics, { tendersInScope: 0, clientCount: 1 }), /No open Telangana/);
assert.match(explainEmptyRun(noFit.diagnostics, { tendersInScope: 1, clientCount: 0 }), /no approved clients/);
assert.match(
  explainEmptyRun({ ...noFit.diagnostics, clients_without_service_category: 1 }, { tendersInScope: 1, clientCount: 1 }),
  /complete onboarding/
);
assert.match(explainEmptyRun(noFit.diagnostics, { tendersInScope: 1, clientCount: 1 }), /lines of business/);
assert.ok(
  explainEmptyRun(
    { pairs_evaluated: 2, rejected_no_category_overlap: 0, rejected_below_threshold: 0, rejected_no_jv_partner: 2, clients_without_service_category: 0 },
    { tendersInScope: 1, clientCount: 2 }
  ).includes('turnover requirement')
);

// --- WhatsApp digest
assert.equal(formatMatchDigest([]), null);
const digest = formatMatchDigest(matches);
assert.ok(digest.includes('GeM Matchmaker'), 'digest should carry a heading');
assert.ok(digest.includes('Alpha Caterers'), 'digest should name the client');
assert.ok(digest.includes('JV'), 'digest should surface JV opportunities');

// --- normalisePhone
assert.equal(normalisePhone('9876543210'), '919876543210');
assert.equal(normalisePhone('+91 98765 43210'), '919876543210');
assert.equal(normalisePhone('0091-9876543210'), '919876543210');
assert.equal(normalisePhone(''), '');
assert.equal(normalisePhone(null), '');

// --- sendWhatsAppAlert must never throw, whatever the state of the environment.
delete process.env.WHATSAPP_API_URL;
delete process.env.WHATSAPP_API_TOKEN;
const unconfigured = await sendWhatsAppAlert('9876543210', 'test');
assert.equal(unconfigured.sent, false);
assert.equal(unconfigured.skipped, true);

process.env.WHATSAPP_API_URL = 'http://127.0.0.1:9/whatsapp'; // discard port: always refuses
process.env.WHATSAPP_API_TOKEN = 'dummy-token';
const noRecipient = await sendWhatsAppAlert('', 'test');
assert.equal(noRecipient.skipped, true);
const emptyBody = await sendWhatsAppAlert('9876543210', '   ');
assert.equal(emptyBody.skipped, true);

const unreachable = await sendWhatsAppAlert('9876543210', 'test');
assert.equal(unreachable.sent, false);
assert.ok(unreachable.error, 'a network failure should be reported, not thrown');

console.log('✅ matchmaker + whatsapp verification passed');
