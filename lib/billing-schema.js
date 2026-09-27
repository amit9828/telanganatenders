/** Billing data layer. Native Mongo collections, not Mongoose. */

export const PRICING_COLLECTION = 'pricing_master';
export const PAYMENTS_COLLECTION = 'payments';
export const USERS_COLLECTION = 'users';

export const PLAN_TYPE = {
  UNLIMITED: 'UNLIMITED',
  CUSTOM_BIDS: 'CUSTOM_BIDS',
};

export const ORDER_STATUS = {
  PENDING: 'PENDING',
  SUCCESS: 'SUCCESS',
  FAILED: 'FAILED',
};

export const GST_RATE = 0.18;

export const BID_TIER_FIELDS = [
  { key: 'one', label: 'Rate for Exactly 1 Bid' },
  { key: 'two_to_five', label: 'Rate for 2 to 5 Bids (per bid rate)' },
  { key: 'six_to_eight', label: 'Rate for 6 to 8 Bids (per bid rate)' },
  { key: 'nine_plus', label: 'Rate for 9+ Bids (per bid rate)' },
];

export function bidTierRate(count, tiers = {}) {
  const n = Math.max(1, Math.floor(Number(count) || 1));
  const raw = n === 1 ? tiers.one
    : n <= 5 ? tiers.two_to_five
    : n <= 8 ? tiers.six_to_eight
    : tiers.nine_plus;
  return Math.max(0, Number(raw) || 0);
}

/** Per-bid tier times the count. Falls back to the old single pack price until tiers are saved. */
export function paygBase(item, count) {
  const n = Math.max(1, Math.floor(Number(count) || 1));
  const tiers = item?.bid_tiers || {};
  const hasTier = BID_TIER_FIELDS.some((field) => Number(tiers[field.key]) > 0);
  const rate = hasTier ? bidTierRate(n, tiers) : (Number(item?.base_price) || 0) / 10;
  return Math.round(rate * n * 100) / 100;
}

export function defaultBidTiers(item) {
  const stored = item?.bid_tiers || {};
  const hasStored = BID_TIER_FIELDS.some((field) => stored[field.key] != null && stored[field.key] !== '');
  if (hasStored) {
    return Object.fromEntries(BID_TIER_FIELDS.map((field) => [field.key, Math.max(0, Number(stored[field.key]) || 0)]));
  }
  const legacy = (Number(item?.base_price) || 0) / 10;
  return Object.fromEntries(BID_TIER_FIELDS.map((field) => [field.key, legacy]));
}

/** Checkout-only. Catalog buttons keep base_price. Cashfree is charged total_paise. */
export function gstBreakdown(basePrice) {
  const subtotal = Math.round(Number(basePrice) * 100) / 100;
  const gstAmount = Math.round(subtotal * GST_RATE * 100) / 100;
  const total = Math.round((subtotal + gstAmount) * 100) / 100;
  return {
    subtotal,
    gst_amount: gstAmount,
    total_amount: total,
    total_paise: Math.round(total * 100),
  };
}

export function emptySubscription(now = new Date()) {
  return {
    status: 'none',
    planType: null,
    expires_at: null,
    paywall: false,
    enforced_at: null,
    updated_at: now,
  };
}

export function emptyBillingUserFields(now = new Date()) {
  return {
    subscription: emptySubscription(now),
    bid_balance: 0,
    agreement_signed: false,
  };
}

/**
 * pricing_master document
 * service_key, name, base_price, bid_credits, is_active
 * category groups the MD catalog. individually_purchasable is false for Udyam.
 * plan_type is UNLIMITED or CUSTOM_BIDS when the line grants participate access.
 */
export const PRICING_DEFAULTS = [
  { service_key: 'view_single', name: 'Single tender view', base_price: 10, bid_credits: null, is_active: true, category: 'view', plan_type: null, individually_purchasable: true },
  { service_key: 'view_month', name: 'Monthly view access', base_price: 149, bid_credits: null, is_active: true, category: 'view', plan_type: null, individually_purchasable: true },
  { service_key: 'view_year', name: 'Yearly view access', base_price: 1499, bid_credits: null, is_active: true, category: 'view', plan_type: null, individually_purchasable: true },

  { service_key: 'gem_account', name: 'GeM Account', base_price: 0, bid_credits: null, is_active: true, category: 'registration', plan_type: null, individually_purchasable: true },
  { service_key: 'gst_combo', name: 'GST Combo', base_price: 0, bid_credits: null, is_active: true, category: 'registration', plan_type: null, individually_purchasable: true },
  { service_key: 'esi_epf_combo', name: 'ESI/EPF Combo', base_price: 0, bid_credits: null, is_active: true, category: 'registration', plan_type: null, individually_purchasable: true },
  { service_key: 'udyam', name: 'Udyam', base_price: 0, bid_credits: null, is_active: true, category: 'registration', plan_type: null, individually_purchasable: false },

  { service_key: 'saas_unlimited', name: 'Unlimited Monthly', base_price: 0, bid_credits: null, is_active: true, category: 'saas', plan_type: PLAN_TYPE.UNLIMITED, individually_purchasable: true },
  { service_key: 'custom_bids_10', name: 'Pay-as-you-go 10 bids', base_price: 0, bid_credits: 10, is_active: true, category: 'payg', plan_type: PLAN_TYPE.CUSTOM_BIDS, individually_purchasable: true },

  { service_key: 'track_1m', name: 'Payment tracking 1 month', base_price: 0, bid_credits: null, is_active: true, category: 'payment_tracking', plan_type: null, individually_purchasable: true },
  { service_key: 'track_3m', name: 'Payment tracking 3 months', base_price: 0, bid_credits: null, is_active: true, category: 'payment_tracking', plan_type: null, individually_purchasable: true },
  { service_key: 'track_6m', name: 'Payment tracking 6 months', base_price: 0, bid_credits: null, is_active: true, category: 'payment_tracking', plan_type: null, individually_purchasable: true },
  { service_key: 'track_12m', name: 'Payment tracking 12 months', base_price: 0, bid_credits: null, is_active: true, category: 'payment_tracking', plan_type: null, individually_purchasable: true },

  { service_key: 'vendor_assessment', name: 'Vendor Assessment', base_price: 0, bid_credits: null, is_active: true, category: 'registration', plan_type: null, individually_purchasable: true },
  { service_key: 'oem_panel_approval', name: 'OEM Panel Approval', base_price: 0, bid_credits: null, is_active: true, category: 'registration', plan_type: null, individually_purchasable: true },
  { service_key: 'product_catalogs', name: 'Product Catalogs', base_price: 0, bid_credits: null, is_active: true, category: 'ondemand', plan_type: null, individually_purchasable: true },
  { service_key: 'technical_clarifications', name: 'Technical Clarifications', base_price: 0, bid_credits: null, is_active: true, category: 'ondemand', plan_type: null, individually_purchasable: true },
  { service_key: 'account_recovery', name: 'Account Recovery', base_price: 0, bid_credits: null, is_active: true, category: 'ondemand', plan_type: null, individually_purchasable: true },
  { service_key: 'gem_support', name: 'GeM Support', base_price: 0, bid_credits: null, is_active: true, category: 'ondemand', plan_type: null, individually_purchasable: true },

  { service_key: 'inc_llp', name: 'Company Incorporation (LLP)', base_price: 0, bid_credits: null, is_active: true, category: 'compliance', plan_type: null, individually_purchasable: true },
  { service_key: 'inc_pvt', name: 'Company Incorporation (Private Limited)', base_price: 0, bid_credits: null, is_active: true, category: 'compliance', plan_type: null, individually_purchasable: true },
  { service_key: 'inc_ltd', name: 'Company Incorporation (LTD)', base_price: 0, bid_credits: null, is_active: true, category: 'compliance', plan_type: null, individually_purchasable: true },
  { service_key: 'labor_license', name: 'Labor License', base_price: 0, bid_credits: null, is_active: true, category: 'compliance', plan_type: null, individually_purchasable: true },
  { service_key: 'shop_establishment', name: 'Shop Establishment Registration', base_price: 0, bid_credits: null, is_active: true, category: 'compliance', plan_type: null, individually_purchasable: true },
  { service_key: 'fssai', name: 'FSSAI', base_price: 0, bid_credits: null, is_active: true, category: 'compliance', plan_type: null, individually_purchasable: true },
  { service_key: 'iso_certificate', name: 'ISO Certificate', base_price: 0, bid_credits: null, is_active: true, category: 'compliance', plan_type: null, individually_purchasable: true },
  { service_key: 'iec', name: 'IEC', base_price: 0, bid_credits: null, is_active: true, category: 'compliance', plan_type: null, individually_purchasable: true },
  { service_key: 'dsc', name: 'DSC', base_price: 0, bid_credits: null, is_active: true, category: 'compliance', plan_type: null, individually_purchasable: true },
  { service_key: 'trade_license', name: 'Trade License', base_price: 0, bid_credits: null, is_active: true, category: 'compliance', plan_type: null, individually_purchasable: true },
  { service_key: 'startup_india', name: 'Startup India (DPIIT Recognition)', base_price: 0, bid_credits: null, is_active: true, category: 'compliance', plan_type: null, individually_purchasable: true },
];

export const REGISTRATION_COMBO_KEYS = ['gem_account', 'gst_combo', 'esi_epf_combo'];

export function pricingDoc(row, now = new Date()) {
  return {
    service_key: row.service_key,
    name: row.name,
    base_price: row.base_price,
    bid_credits: row.bid_credits,
    is_active: row.is_active !== false,
    category: row.category,
    plan_type: row.plan_type || null,
    individually_purchasable: row.individually_purchasable !== false,
    created_at: now,
    updated_at: now,
  };
}

/** Inserts missing catalog rows. Does not overwrite prices an MD already saved. */
export async function seedPricingMaster(db, now = new Date()) {
  const col = db.collection(PRICING_COLLECTION);
  let inserted = 0;
  for (const row of PRICING_DEFAULTS) {
    const result = await col.updateOne(
      { service_key: row.service_key },
      { $setOnInsert: pricingDoc(row, now) },
      { upsert: true },
    );
    if (result.upsertedCount) inserted += 1;
  }
  return { inserted, catalog: PRICING_DEFAULTS.length };
}

/**
 * payments document written only after Google auth, before the Cashfree redirect.
 * order_id, email, plan_id, status, subtotal, gst_amount, total_amount
 */
export function pendingOrderDoc({ orderId, email, planId, basePrice, now = new Date() }) {
  const money = gstBreakdown(basePrice);
  return {
    order_id: orderId,
    email: String(email || '').toLowerCase(),
    plan_id: planId,
    status: ORDER_STATUS.PENDING,
    subtotal: money.subtotal,
    gst_amount: money.gst_amount,
    total_amount: money.total_amount,
    created_at: now,
    updated_at: now,
  };
}

export async function ensureBillingIndexes(db) {
  const pricing = db.collection(PRICING_COLLECTION);
  const payments = db.collection(PAYMENTS_COLLECTION);
  await pricing.createIndex({ service_key: 1 }, { unique: true });
  await pricing.createIndex({ category: 1, is_active: 1 });
  await payments.createIndex({ order_id: 1 }, { unique: true });
  await payments.createIndex({ email: 1, created_at: -1 });
  await db.collection(USERS_COLLECTION).createIndex({ 'subscription.planType': 1, bid_balance: 1 });
}
