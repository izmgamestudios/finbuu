// boards.js — GamFed boards shared by link (read-only page /b/:id). Stored in data/boards.json; edit needs the secret editKey.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const FILE = path.join(__dirname, 'data', 'boards.json');
const LIM = { title: 80, toy: 300, bmc: 400, slideTitle: 80, slideBody: 600, slides: 12, max: 2000 };
const TOY_N = 10, BMC = ['keyPartners', 'keyActivities', 'keyResources', 'valueProps', 'customerRelationships', 'channels', 'customerSegments', 'costStructure', 'revenueStreams'];
const str = (v, n) => String(v ?? '').slice(0, n).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
function clean(b) {
  if (!b || typeof b !== 'object') return null;
  const toy = Array.from({ length: TOY_N }, (_, i) => str(Array.isArray(b.toy) ? b.toy[i] : '', LIM.toy));
  const bmc = Object.fromEntries(BMC.map(k => [k, str(b.bmc?.[k], LIM.bmc)]));
  const deck = (Array.isArray(b.deck) ? b.deck : []).slice(0, LIM.slides).map(x => ({ id: str(x?.id, 20).replace(/[^a-z0-9_-]/gi, ''), title: str(x?.title, LIM.slideTitle), body: str(x?.body, LIM.slideBody) }));
  return { title: str(b.title, LIM.title), toy, bmc, deck };
}
let db = {};
try { db = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { db = {}; }
let timer = null;
function save() { clearTimeout(timer); timer = setTimeout(() => { try { fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 }); fs.writeFileSync(FILE, JSON.stringify(db), { mode: 0o600 }); } catch (e) { console.warn('boards save failed:', e.message); } }, 500); }
const newId = () => { let id; do id = crypto.randomBytes(6).toString('base64url').toLowerCase().replace(/[^a-z0-9]/g, 'x').slice(0, 8); while (db[id]); return id; };
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
function create(board) {
  const b = clean(board); if (!b) return null;
  const ids = Object.keys(db); if (ids.length >= LIM.max) { ids.sort((x, y) => db[x].at - db[y].at).slice(0, ids.length - LIM.max + 1).forEach(i => delete db[i]); }
  const id = newId(), editKey = crypto.randomBytes(16).toString('hex'); db[id] = { board: b, editKey, at: Date.now(), updated: Date.now() }; save(); return { id, editKey };
}
function update(id, editKey, board) {
  const r = db[id], b = clean(board); if (!r || !b || !safeEq(r.editKey, editKey || '')) return false;
  r.board = b; r.updated = Date.now(); save(); return true;
}
const get = id => (db[id] ? { board: db[id].board, updated: db[id].updated } : null);
// tiny per-IP limiter: `max` writes per hour
const hits = new Map();
function allow(ip, max = 12) { const now = Date.now(), h = (hits.get(ip) || []).filter(t => now - t < 3600e3); if (h.length >= max) { hits.set(ip, h); return false; } h.push(now); hits.set(ip, h); if (hits.size > 5000) hits.clear(); return true; }
module.exports = { clean, create, update, get, allow };
