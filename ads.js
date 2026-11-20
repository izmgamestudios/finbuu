// ads.js — advertising slots: catalog, pricing, creative validation (server side).
// Ads are user-generated content: every creative must be approved by an admin before it goes live,
// images must be public https URLs and text is length-limited and stripped of markup.

// price: coins per game day charged to the owner company; boost: extra sales multiplier while a live ad is shown
const KINDS = {
  billboard: { price: 6, boost: 0.03, count: 4 },
  stop:      { price: 3, boost: 0.02 },            // one per bus stop
  bus:       { price: 8, boost: 0.04, count: 1 },  // livery on the city bus
  wall:      { price: 2, boost: 0.02 },            // one per building (tenants only)
  roof:      { price: 3, boost: 0.02 },            // one per building (tenants only)
  mobile:    { price: 4, boost: 0.01, count: 3 }   // "meta" banners shown to players on phones
};
const MAX_BOOST = 0.15, MAX_SLOTS_PER_COMPANY = 6;
const LIMITS = { title: 40, text: 120, url: 300, fontMin: 10, fontMax: 40 };

// "kind:index" -> { kind, index } or null. Index ranges depend on the room (bus stops, lots).
function parseSlot(id, { busStops = 0, lots = 0 } = {}) {
  const m = /^([a-z]+):(\d{1,3})$/.exec(String(id || '')); if (!m || !Object.hasOwn(KINDS, m[1])) return null;
  const kind = m[1], index = Number(m[2]);
  const max = kind === 'stop' ? busStops : (kind === 'wall' || kind === 'roof') ? lots : KINDS[kind].count;
  return index < max ? { kind, index, id: `${kind}:${index}`, ...KINDS[kind] } : null;
}
function allSlots(ctx) {
  const out = [];
  for (const kind of Object.keys(KINDS)) {
    const n = kind === 'stop' ? ctx.busStops : (kind === 'wall' || kind === 'roof') ? ctx.lots : KINDS[kind].count;
    for (let i = 0; i < n; i++) out.push(parseSlot(`${kind}:${i}`, ctx));
  }
  return out;
}

const stripText = (s, max) => String(s ?? '').replace(/[<>\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const hex = (v, fallback) => (/^#[0-9a-fA-F]{6}$/.test(String(v)) ? String(v).toLowerCase() : fallback);

// Public https image only; no credentials, no IP literals / localhost / internal names (so ads cannot probe private networks)
function safeImageUrl(raw) {
  const s = String(raw ?? '').trim(); if (!s || s.length > LIMITS.url || /\s/.test(s)) return null;
  let u; try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password) return null;
  const h = u.hostname.toLowerCase();
  if (!h.includes('.') || h === 'localhost' || /\.(local|internal|localhost|lan|home|corp)$/.test(h)) return null;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h.includes(':') || h.startsWith('[')) return null;
  return u.href;
}

// Validates and normalizes a creative. Returns { ok, creative } or { ok: false, error }.
function cleanCreative(x) {
  if (!x || typeof x !== 'object') return { ok: false, error: 'bad' };
  const type = x.type === 'image' ? 'image' : 'text';
  const c = {
    type, title: stripText(x.title, LIMITS.title), text: stripText(x.text, LIMITS.text),
    fontSize: Math.max(LIMITS.fontMin, Math.min(LIMITS.fontMax, Math.round(Number(x.fontSize)) || 18)),
    color: hex(x.color, '#ffffff'), bg: hex(x.bg, '#2f6fe4'), align: ['left', 'center', 'right'].includes(x.align) ? x.align : 'center', bold: !!x.bold
  };
  if (type === 'image') {
    const url = safeImageUrl(x.imageUrl); if (!url) return { ok: false, error: 'badUrl' };
    c.imageUrl = url;
  } else if (!c.text && !c.title) return { ok: false, error: 'empty' };
  return { ok: true, creative: c };
}

module.exports = { KINDS, MAX_BOOST, MAX_SLOTS_PER_COMPANY, LIMITS, parseSlot, allSlots, cleanCreative, safeImageUrl };
