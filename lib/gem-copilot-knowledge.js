// GeM Co-Pilot knowledge store — Mongo collection + curated footer/resource targets.
//
// Weekly Sunday sync (cron + optional Playwright harvester) writes documents here and
// mirrors binaries into the Cloudflare R2 prefix `gem_copilot_knowledge/`.
// The Co-Pilot chat route reads this collection FIRST before the vector KB.

export const COPILOT_KNOWLEDGE_COLLECTION = 'gem_copilot_knowledge';
export const COPILOT_R2_PREFIX = 'gem_copilot_knowledge';

/** Footer / resource pages and known PDF anchors on the GeM portal. */
export const COPILOT_FOOTER_SOURCES = [
  {
    id: 'gem-handbook',
    title: 'GeM Handbook',
    category: 'handbook',
    url: 'https://gem.gov.in/resources',
    type: 'html_index',
    match: /handbook/i,
  },
  {
    id: 'gem-circulars-oms',
    title: "GeM OM's / Circulars",
    category: 'circulars',
    url: 'https://gem.gov.in/resources/circulars',
    type: 'html_index',
    match: /circular|o\.?m\.?|office\s*memorandum/i,
  },
  {
    id: 'gem-gtc',
    title: 'GeM General Terms and Conditions',
    category: 'terms',
    url: 'https://mkp.gem.gov.in/documents/GTC.pdf',
    type: 'pdf',
  },
  {
    id: 'gem-policies-manuals',
    title: 'GeM Policies / Manuals',
    category: 'policies',
    url: 'https://gem.gov.in/resources',
    type: 'html_index',
    match: /policy|manual|guideline/i,
  },
  {
    id: 'gem-miscellaneous',
    title: 'GeM Miscellaneous Resources',
    category: 'miscellaneous',
    url: 'https://gem.gov.in/resources',
    type: 'html_index',
    match: /misc|miscellaneous|other\s*document/i,
  },
  {
    id: 'gem-mous',
    title: 'GeM MoUs',
    category: 'mous',
    url: 'https://gem.gov.in/resources',
    type: 'html_index',
    match: /mou|memorandum\s*of\s*understanding/i,
  },
  {
    id: 'gem-gfr',
    title: 'GFR Rules (General Financial Rules)',
    category: 'gfr',
    url: 'https://doe.gov.in/sites/default/files/GFR2017_0.pdf',
    type: 'pdf',
  },
  {
    id: 'gem-faqs',
    title: 'GeM FAQs',
    category: 'faqs',
    url: 'https://gem.gov.in/faqs',
    type: 'html',
  },
  {
    id: 'gem-training',
    title: 'GeM Training Modules',
    category: 'training',
    url: 'https://gem.gov.in/training',
    type: 'html_index',
    match: /train|module|tutorial|webinar/i,
  },
  {
    id: 'bidplus-help',
    title: 'BidPlus / Advanced Search Help',
    category: 'training',
    url: 'https://bidplus.gem.gov.in/advance-search',
    type: 'html',
  },
];

export function slugifyDocId(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/https?:\/\//g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120) || `doc-${Date.now()}`;
}

/**
 * Lightweight lexical retrieval over gem_copilot_knowledge — preferred first pass
 * for Co-Pilot answers so we do not burn live portal fetches.
 */
export async function searchCopilotKnowledge(db, query, { limit = 5 } = {}) {
  const col = db.collection(COPILOT_KNOWLEDGE_COLLECTION);
  const tokens = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 2)
    .slice(0, 12);

  if (!tokens.length) {
    return col.find({})
      .sort({ updated_at: -1 })
      .limit(limit)
      .project({ title: 1, source_url: 1, content_text: 1, category: 1, r2_url: 1 })
      .toArray();
  }

  const or = tokens.flatMap((t) => ([
    { title: { $regex: t, $options: 'i' } },
    { category: { $regex: t, $options: 'i' } },
    { content_text: { $regex: t, $options: 'i' } },
  ]));

  const docs = await col.find({ $or: or })
    .sort({ updated_at: -1 })
    .limit(Math.max(limit * 4, 20))
    .project({ title: 1, source_url: 1, content_text: 1, category: 1, r2_url: 1 })
    .toArray();

  const scored = docs.map((doc) => {
    const hay = `${doc.title || ''} ${doc.category || ''} ${String(doc.content_text || '').slice(0, 4000)}`.toLowerCase();
    let score = 0;
    for (const t of tokens) {
      if (hay.includes(t)) score += 1;
    }
    return { ...doc, score };
  }).filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return scored;
}

export async function upsertCopilotKnowledgeDoc(db, doc) {
  const col = db.collection(COPILOT_KNOWLEDGE_COLLECTION);
  await col.createIndex({ doc_id: 1 }, { unique: true }).catch(() => {});
  await col.createIndex({ category: 1, updated_at: -1 }).catch(() => {});

  const doc_id = doc.doc_id || slugifyDocId(doc.source_url || doc.title);
  const payload = {
    doc_id,
    title: doc.title || doc_id,
    category: doc.category || 'miscellaneous',
    origin: doc.origin || 'scrape',
    uploaded_by: doc.uploaded_by || null,
    original_filename: doc.original_filename || null,
    source_url: doc.source_url || null,
    r2_key: doc.r2_key || null,
    r2_url: doc.r2_url || null,
    content_type: doc.content_type || 'text',
    content_text: String(doc.content_text || '').slice(0, 200000),
    char_count: String(doc.content_text || '').slice(0, 200000).length,
    updated_at: new Date(),
    scraped_at: doc.scraped_at || new Date(),
  };

  await col.updateOne(
    { doc_id },
    { $set: payload, $setOnInsert: { created_at: new Date() } },
    { upsert: true },
  );
  return payload;
}
