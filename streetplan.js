// streetplan.js — Sprint 34: admin-editable street plan. Which buildings stand on the street, in which order, how wide/tall, what their sign says,
// and brand-new "info" buildings with their own popup content. The server owns the truth (positions feed the bus stops, terminal, spawn point and
// world width); the client receives a resolved description inside the seed and only draws it.
// Layout rule: the START zone (home, guide, plaza, ...) is packed from x=0, the lots follow, the END zone (support buildings, car park, terminal) starts after the last lot.
'use strict';
const fs = require('fs'), path = require('path');
const FILE = path.join(__dirname, 'data', 'street-config.json');
const LOT_W = 200, LOT_GAP = 44, LOTS_GAP = 45, MIN_LOTS_X = 720, END_MARGIN = 90;
// hmode: apt = height follows the number of flats, floors = ground + n floors, h = fixed pixel height
const BUILTIN = {
  home:     { zone: 'start', w: 190, gap: 30, hmode: 'apt' },
  guide:    { zone: 'start', w: 160, gap: 60, hmode: 'floors', floors: 2 },
  plaza:    { zone: 'start', w: 200, gap: 35, hmode: 'floors', floors: 4 },
  oss:      { zone: 'end', w: 380, gap: 10, hmode: 'floors', floors: 3 },
  demoday:  { zone: 'end', w: 360, gap: 40, hmode: 'floors', floors: 3 },
  grants:   { zone: 'end', w: 380, gap: 40, hmode: 'floors', floors: 4 },
  locked:   { zone: 'end', w: 380, gap: 40, hmode: 'h', h: 320 },
  gamfed:   { zone: 'end', w: 400, gap: 40, hmode: 'h', h: 458 },
  parking:  { zone: 'end', w: 380, gap: 40, hmode: 'h', h: 70 },
  terminal: { zone: 'end', w: 380, gap: 40, hmode: 'h', h: 120 }
};
const REQUIRED = ['home', 'guide', 'plaza', 'terminal', 'parking'];          // the game cannot work without these (spawn, apartment, cars, intercity travel)
const DEFAULT_ORDER = { start: ['home', 'guide', 'plaza'], end: ['oss', 'demoday', 'grants', 'locked', 'gamfed', 'parking', 'terminal'] };
const MAX_CUSTOM = 12;

class Bad extends Error {}
const bad = m => { throw new Bad(m); };
const clean = v => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f<>]/g, '').trim();
const str = (v, max, label, req = true) => { const s = clean(v).slice(0, max); if (req && !s) bad(`${label}: boş olamaz`); return s; };
const int = (v, lo, hi, label) => { const n = Math.round(Number(v)); if (!Number.isFinite(n) || n < lo || n > hi) bad(`${label}: ${lo}–${hi} arası sayı olmalı`); return n; };
const bi = (o, max, label, req = true) => { if (typeof o === 'string') o = { tr: o, en: o }; const tr = str(o?.tr, max, `${label} (TR)`, req); return { tr, en: str(o?.en, max, `${label} (EN)`, false) || tr }; };
const color = (v, label) => { const s = clean(v); if (!s) return ''; if (!/^#[0-9a-fA-F]{6}$/.test(s)) bad(`${label}: #rrggbb biçiminde olmalı`); return s.toLowerCase(); };
const url = (v, label) => { const s = clean(v).slice(0, 300); if (!/^https:\/\/[^\s]+$/.test(s)) bad(`${label}: https:// ile başlayan geçerli bir adres olmalı`); return s; };
const idOf = (v, label) => { const s = clean(v).toLowerCase(); if (!/^[a-z0-9][a-z0-9-]{1,23}$/.test(s)) bad(`${label}: 2–24 karakter, küçük harf/rakam/tire`); return s; };

const defaults = () => ({ version: 1, start: [...DEFAULT_ORDER.start], end: [...DEFAULT_ORDER.end], props: {}, custom: {} });

function validate(doc) {
  doc = doc && typeof doc === 'object' ? doc : {};
  const custom = {}, cEntries = Object.entries(doc.custom && typeof doc.custom === 'object' ? doc.custom : {});
  if (cEntries.length > MAX_CUSTOM) bad(`en fazla ${MAX_CUSTOM} yeni bina eklenebilir`);
  for (const [k, v] of cEntries) {
    const id = idOf(k, 'bina kimliği'); if (BUILTIN[id]) bad(`${id}: hazır bina adıyla aynı olamaz`);
    const sections = (Array.isArray(v?.sections) ? v.sections : []).slice(0, 8).map((s, i) => ({ title: bi(s?.title, 60, `${id} bölüm ${i + 1} başlığı`), body: bi(s?.body, 1500, `${id} bölüm ${i + 1} metni`), steps: (Array.isArray(s?.steps) ? s.steps : []).slice(0, 8).map((x, j) => str(x, 200, `${id} bölüm ${i + 1} adım ${j + 1}`)) }));
    custom[id] = { name: bi(v?.name, 40, `${id} adı`), sign: bi(v?.sign, 60, `${id} tabela alt yazısı`, false), icon: str(v?.icon, 4, `${id} simgesi`, false) || '🏢', color: color(v?.color, `${id} rengi`) || '#4f8ff7',
      intro: bi(v?.intro, 600, `${id} giriş`, false), sections, links: (Array.isArray(v?.links) ? v.links : []).slice(0, 8).map((l, i) => ({ label: str(l?.label, 60, `${id} bağlantı ${i + 1} adı`), url: url(l?.url, `${id} bağlantı ${i + 1}`) })) };
  }
  const known = new Set([...Object.keys(BUILTIN), ...Object.keys(custom)]);
  const take = (arr, label) => (Array.isArray(arr) ? arr : []).map(x => clean(x)).filter(x => { if (!known.has(x)) bad(`${label}: bilinmeyen bina (${x})`); return true; });
  const start = take(doc.start, 'sol bölge'), end = take(doc.end, 'sağ bölge'), seen = new Set();
  for (const id of [...start, ...end]) { if (seen.has(id)) bad(`${id}: iki kez yerleştirilmiş`); seen.add(id); }
  for (const id of known) if (!seen.has(id)) (BUILTIN[id]?.zone === 'start' ? start : end).push(id);       // anything unplaced goes to its default side
  const props = {};
  for (const id of known) {
    const p = doc.props?.[id] || {}, base = BUILTIN[id] || { hmode: 'floors', floors: 3, w: 300, gap: 40 }, o = {};
    o.enabled = p.enabled === false ? false : true; if (!o.enabled && REQUIRED.includes(id)) bad(`${id}: bu bina kapatılamaz (oyun onsuz çalışmaz)`);
    o.w = p.w == null ? base.w : int(p.w, 80, 800, `${id} genişliği`); o.gap = p.gap == null ? base.gap : int(p.gap, 0, 400, `${id} boşluğu`);
    if (base.hmode === 'floors') o.floors = p.floors == null ? base.floors : int(p.floors, 1, 9, `${id} kat sayısı`);
    if (base.hmode === 'h') o.h = p.h == null ? base.h : int(p.h, 40, 520, `${id} yüksekliği`);
    if (!BUILTIN[id] && p.floors == null) o.floors = 3;
    const label = p.label ? bi(p.label, 40, `${id} etiketi`, false) : null; if (label && label.tr) o.label = label;
    const ic = clean(p.icon).slice(0, 4); if (ic && BUILTIN[id]) o.icon = ic;
    props[id] = o;
  }
  const activeEnd = end.filter(id => props[id].enabled).reduce((a, id) => a + props[id].w + props[id].gap, 0), activeStart = start.filter(id => props[id].enabled).reduce((a, id) => a + props[id].w + props[id].gap, 0);
  if (activeEnd > 9000) bad('sağ bölgedeki binaların toplam genişliği 9000 pikseli aşamaz'); if (activeStart > 3000) bad('sol bölgedeki binaların toplam genişliği 3000 pikseli aşamaz');
  return { version: 1, start, end, props, custom };
}

let cfg = defaults();
try { cfg = validate(JSON.parse(fs.readFileSync(FILE, 'utf8'))); } catch { cfg = validate(defaults()); }
function save() { try { fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 }); fs.writeFileSync(FILE, JSON.stringify(cfg), { mode: 0o600 }); } catch (e) { console.warn('street config save failed:', e.message); } }
function set(doc) { const next = validate(doc); cfg = next; save(); cache.clear(); return cfg; }
function reset() { cfg = validate(defaults()); try { fs.unlinkSync(FILE); } catch { /* none */ } cache.clear(); return cfg; }
const isCustom = id => !BUILTIN[id];
const spec = id => ({ ...(BUILTIN[id] || { hmode: 'floors' }), ...cfg.props[id] });

// resolved zones: start items have absolute x; end items have dx (relative to the end of the lots)
function resolve() {
  let x = 0; const start = [], end = [];
  for (const id of cfg.start) { const s = spec(id); if (!s.enabled) continue; x += s.gap; start.push({ id, x, w: s.w }); x += s.w; }
  const lotsX = Math.max(MIN_LOTS_X, x + LOTS_GAP);
  let dx = 0; for (const id of cfg.end) { const s = spec(id); if (!s.enabled) continue; dx += s.gap; end.push({ id, dx, w: s.w, gap: s.gap }); dx += s.w; }
  return { start, end, lotsX, endSpan: dx + END_MARGIN };
}
const cache = new Map();
function plan(lotCount = 12) {
  if (cache.has(lotCount)) return cache.get(lotCount);
  const r = resolve(), L = r.lotsX + lotCount * (LOT_W + LOT_GAP), at = id => [...r.start, ...r.end.map(e => ({ ...e, x: L + e.dx }))].find(i => i.id === id);
  const g = at('guide'), pl = at('plaza'), te = at('terminal'), pk = at('parking'), lotX = i => r.lotsX + i * (LOT_W + LOT_GAP);
  const endItems = r.end, gapAfter4 = endItems[3] ? L + endItems[3].dx + endItems[3].w + (endItems[4]?.gap ?? 40) / 2 : L + (endItems.at(-1)?.dx || 0) + 20;
  const out = { lotsX: r.lotsX, L, worldMax: L + r.endSpan, spawnX: Math.round(g.x + g.w / 2 + 10), plazaDoorX: pl.x + pl.w - 52, terminalX: Math.round(te.x + te.w / 2), parkingX: pk.x, lotX,
    busStops: [r.lotsX - 23, lotX(3) - 22, lotX(7) - 22, lotX(11) - 22, Math.round(gapAfter4)] };
  cache.set(lotCount, out); return out;
}
// what the client needs (lot-count independent): zones with ids/sizes/labels
function publicDesc() {
  const r = resolve(), item = (e, zone) => {
    const s = spec(e.id), c = cfg.custom[e.id], base = BUILTIN[e.id];
    return { id: e.id, kind: c ? 'custom' : e.id, zone, ...(zone === 'start' ? { x: e.x } : { dx: e.dx }), w: e.w, hmode: base?.hmode || 'floors', floors: s.floors, h: s.h, label: c ? c.name : (s.label || null), icon: c ? c.icon : (s.icon || null), color: c ? c.color : null,
      ...(c ? { sign: c.sign, intro: c.intro, sections: c.sections, links: c.links } : {}) };
  };
  return { lotsX: r.lotsX, endSpan: r.endSpan, start: r.start.map(e => item(e, 'start')), end: r.end.map(e => item(e, 'end')) };
}
const adminView = () => ({ cfg, defaults: defaults(), builtin: BUILTIN, required: REQUIRED, maxCustom: MAX_CUSTOM });
module.exports = { validate, get: () => cfg, set, reset, plan, publicDesc, adminView, BUILTIN, LOT_W, LOT_GAP, Bad };
