// market.js — Sprint 26b: wholesale market between player companies. Seller reserves ERP stock, buyer receives it instantly.
// Anti-abuse: price bounds vs the seller's retail price, 10% fee burned, listing/day limits, no self-trade, no revenue counters (race/goal) credit.
'use strict';
const CFG = { on: 1, fee: 0.1, maxListings: 5, maxBuysPerDay: 10, minPct: 0.2, maxPct: 0.8, ttl: 10 };
const RANGES = { on: [0, 1], fee: [0, 0.5], maxListings: [1, 20], maxBuysPerDay: [1, 50], minPct: [0.05, 1], maxPct: [0.1, 1], ttl: [1, 60] };
const MAX_QTY = 200;
function setConfig(patch) { for (const [k, [lo, hi]] of Object.entries(RANGES)) { const v = Number(patch?.[k]); if (patch && patch[k] !== undefined && Number.isFinite(v)) CFG[k] = Math.max(lo, Math.min(hi, v)); } if (CFG.minPct > CFG.maxPct) CFG.minPct = CFG.maxPct; return { ...CFG }; }
const book = st => (st.market ||= { seq: 0, offers: [], log: [] });
// allowed wholesale unit price range for a seller whose retail unit price is `retail`
const bounds = retail => ({ min: Math.max(1, Math.round(retail * CFG.minPct)), max: Math.max(1, Math.round(retail * CFG.maxPct)) });
const fee = total => Math.round(total * CFG.fee);
// removes expired offers and hands each to onRelease (which returns the reserved stock to its seller)
function expire(st, onRelease) {
  const b = book(st), day = st.day || 0;
  b.offers = b.offers.filter(o => { if (o.until > day) return true; onRelease(o); return false; });
}
module.exports = { CFG, RANGES, MAX_QTY, setConfig, book, bounds, fee, expire };
