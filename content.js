// content.js — Sprint 22: admin-editable building content (Open Source tools catalog, Grants, GamFed).
// Committed defaults live in public/data/*.json; admin edits are stored as overrides in data/content/*.json (runtime data, survives deploys).
// Every document is re-validated and re-built field by field on save: only known fields, bounded lengths, https-only links.
'use strict';
const fs = require('fs');
const path = require('path');

const NAMES = ['open-source-tools', 'grants', 'gamfed'];
const DEFAULT_DIR = path.join(__dirname, 'public', 'data');
const OVERRIDE_DIR = path.join(__dirname, 'data', 'content');
const fileOf = (dir, name) => path.join(dir, name + '.json');

class Bad extends Error {}
const bad = (m) => { throw new Bad(m); };
const clean = v => String(v ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
const str = (v, max, label, req = true) => { const s = clean(v).slice(0, max); if (req && !s) bad(`${label}: boş olamaz`); return s; };
const num = (v, lo, hi, label) => { const n = Number(v); if (!Number.isFinite(n) || n < lo || n > hi) bad(`${label}: ${lo}–${hi} arası sayı olmalı`); return n; };
const url = (v, label, req = false) => { const s = clean(v).slice(0, 300); if (!s) { if (req) bad(`${label}: boş olamaz`); return ''; } if (!/^https:\/\/[^\s]+$/.test(s)) bad(`${label}: https:// ile başlayan geçerli adres olmalı`); return s; };
const bi = (o, max, label, reqTr = true) => { if (typeof o === 'string') o = { tr: o, en: o }; const tr = str(o?.tr, max, `${label} (TR)`, reqTr); return { tr, en: str(o?.en, max, `${label} (EN)`, false) || tr }; };
const list = (a, maxItems, label) => { if (!Array.isArray(a)) bad(`${label}: liste olmalı`); if (a.length > maxItems) bad(`${label}: en fazla ${maxItems} öğe`); return a; };
const id = (v, label, max = 40) => { const s = clean(v).toLowerCase(); if (!new RegExp(`^[a-z0-9][a-z0-9-]{1,${max - 1}}$`).test(s)) bad(`${label}: 2–${max} karakter, küçük harf/rakam/tire`); return s; };

const TYPES = ['osi', 'fair-code', 'source-available'];
const GRANT_TYPES = ['grant', 'incentive', 'equity', 'program'];

function validateTools(doc) {
  const def = readDefault('open-source-tools');
  const categories = {};
  const cats = doc?.categories && typeof doc.categories === 'object' ? Object.entries(doc.categories) : [];
  if (!cats.length || cats.length > 20) bad('kategoriler: 1–20 kategori olmalı');
  for (const [k, v] of cats) categories[id(k, 'kategori kimliği', 24)] = str(v, 40, 'kategori adı');
  const seen = new Set(), tools = [];
  for (const t of list(doc?.tools, 200, 'araçlar')) {
    const tid = id(t?.id, 'araç kimliği'); if (seen.has(tid)) bad(`araç kimliği tekrar ediyor: ${tid}`); seen.add(tid);
    const category = clean(t.category); if (!categories[category]) bad(`${tid}: kategori bulunamadı (${category})`);
    const lt = clean(t.licenseType); if (!TYPES.includes(lt)) bad(`${tid}: lisans türü ${TYPES.join(' / ')} olmalı`);
    const g = t.game || {}, e = g.effect || {};
    const stat = clean(e.stat); if (!def.effectStats[stat]) bad(`${tid}: etki türü geçersiz (${stat})`);
    tools.push({
      id: tid, name: str(t.name, 60, `${tid} adı`), category, description: str(t.description, 300, `${tid} açıklaması`),
      license: str(t.license, 40, `${tid} lisansı`), licenseType: lt,
      links: { repo: url(t.links?.repo, `${tid} repo`), website: url(t.links?.website, `${tid} web`), docs: url(t.links?.docs, `${tid} doküman`), community: url(t.links?.community, `${tid} topluluk`), support: url(t.links?.support, `${tid} destek`) },
      howToUse: list(t.howToUse || [], 6, `${tid} kullanım adımları`).map((x, i) => str(x, 200, `${tid} adım ${i + 1}`)),
      game: { tier: num(g.tier, 1, 4, `${tid} tier`), unlockLevel: num(g.unlockLevel, 1, 20, `${tid} açılış seviyesi`), setupCost: num(g.setupCost, 0, 100000, `${tid} kurulum`),
        monthlyHostingCost: num(g.monthlyHostingCost, 0, 10000, `${tid} aylık sunucu`), effect: { stat, value: num(e.value, 0, 1, `${tid} etki değeri`) }, xpReward: num(g.xpReward, 0, 2000, `${tid} XP`) }
    });
  }
  return { version: Math.max(1, Math.floor(Number(doc.version) || def.version || 1)), categories, effectStats: def.effectStats, tools };
}
function validateGrants(doc) {
  const groups = list(doc?.groups, 6, 'gruplar').map(g => ({ id: id(g?.id, 'grup kimliği', 20), icon: str(g?.icon, 4, 'grup simgesi'), name: bi(g?.name, 40, 'grup adı') }));
  if (!groups.length) bad('en az 1 grup olmalı');
  if (new Set(groups.map(g => g.id)).size !== groups.length) bad('grup kimlikleri tekrar ediyor');
  const seen = new Set();
  const programs = list(doc?.programs, 60, 'programlar').map(p => {
    const pid = id(p?.id, 'program kimliği'); if (seen.has(pid)) bad(`program kimliği tekrar ediyor: ${pid}`); seen.add(pid);
    const group = clean(p.group); if (!groups.some(g => g.id === group)) bad(`${pid}: grup bulunamadı (${group})`);
    const type = clean(p.type); if (!GRANT_TYPES.includes(type)) bad(`${pid}: tür ${GRANT_TYPES.join(' / ')} olmalı`);
    const steps = {}; for (const l of ['tr', 'en']) steps[l] = list(p.steps?.[l] || [], 6, `${pid} adımları (${l})`).map((x, i) => str(x, 200, `${pid} adım ${i + 1}`));
    if (!steps.tr.length) bad(`${pid}: en az 1 adım (TR) olmalı`); if (!steps.en.length) steps.en = steps.tr;
    return { id: pid, group, type, name: bi(p.name, 80, `${pid} adı`), what: bi(p.what, 400, `${pid} açıklaması`), who: bi(p.who, 200, `${pid} kime`), steps, game: bi(p.game, 300, `${pid} Finbuu karşılığı`, false), link: url(p.link, `${pid} bağlantı`) };
  });
  return { note: bi(doc?.note, 400, 'uyarı notu'), groups, programs };
}
function validateGamfed(doc) {
  const floors = list(doc?.floors, 10, 'katlar'); if (floors.length !== 10) bad('GamFed binası tam 10 kat olmalı');
  return { title: bi(doc?.title, 80, 'başlık'), intro: bi(doc?.intro, 400, 'giriş'),
    sources: list(doc?.sources || [], 8, 'kaynaklar').map((s, i) => ({ label: str(s?.label, 60, `kaynak ${i + 1} adı`), url: url(s?.url, `kaynak ${i + 1} adresi`, true) })),
    floors: floors.map((f, i) => ({ n: i + 1, icon: str(f?.icon, 4, `kat ${i + 1} simgesi`), title: bi(f?.title, 60, `kat ${i + 1} başlığı`), desc: bi(f?.desc, 500, `kat ${i + 1} açıklaması`), game: bi(f?.game, 300, `kat ${i + 1} Finbuu karşılığı`, false) })) };
}
const VALIDATORS = { 'open-source-tools': validateTools, grants: validateGrants, gamfed: validateGamfed };

function readJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function readDefault(name) { return readJson(fileOf(DEFAULT_DIR, name)); }
// override if present and still valid, else the committed default
function read(name) {
  if (!NAMES.includes(name)) return null;
  const o = readJson(fileOf(OVERRIDE_DIR, name));
  if (o) { try { return VALIDATORS[name](o); } catch { /* corrupt override: fall back */ } }
  return readDefault(name);
}
const isOverridden = name => fs.existsSync(fileOf(OVERRIDE_DIR, name));
// -> { ok:true, doc } | { ok:false, error }
function write(name, doc) {
  if (!NAMES.includes(name)) return { ok: false, error: 'bilinmeyen içerik' };
  let clean_;
  try { clean_ = VALIDATORS[name](doc); } catch (e) { if (e instanceof Bad) return { ok: false, error: e.message }; throw e; }
  try {
    fs.mkdirSync(OVERRIDE_DIR, { recursive: true, mode: 0o700 });
    const tmp = fileOf(OVERRIDE_DIR, name) + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(clean_, null, 1), { mode: 0o600 }); fs.renameSync(tmp, fileOf(OVERRIDE_DIR, name));
  } catch (e) { return { ok: false, error: 'kaydedilemedi: ' + e.message }; }
  return { ok: true, doc: clean_ };
}
function reset(name) { if (!NAMES.includes(name)) return false; try { fs.unlinkSync(fileOf(OVERRIDE_DIR, name)); } catch { /* none */ } return true; }
module.exports = { NAMES, read, readDefault, isOverridden, write, reset, VALIDATORS };
