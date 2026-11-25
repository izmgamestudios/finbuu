// projects.js — Sprint 35: Demo Day project floors. Every project owns one floor of the Demo Day tower.
// Projects are created by the admin (defaults below) or by company founders; everything is validated here and persisted to data/projects.json.
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const BOARDS = require('./boards');
const FILE = path.join(__dirname, 'data', 'projects.json');
const MAX = 12, MAX_FEEDBACK = 40, TOY_N = 10;
const FB_KINDS = ['feedback', 'suggestion', 'question'], EXIT = ['none', 'seeking', 'sold'];

class Bad extends Error {}
const str = (v, n) => String(v ?? '').replace(/[<>]/g, '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, n);
const url = v => { const s = str(v, 200); if (!s) return ''; if (!/^https?:\/\/[^\s]+$/i.test(s)) throw new Bad('Bağlantı http:// veya https:// ile başlamalı'); return s; };
const color = v => (/^#[0-9a-f]{6}$/i.test(String(v)) ? String(v).toLowerCase() : '#5b4a9a');
const newId = () => 'p' + crypto.randomBytes(4).toString('hex');

const DEFAULTS = [
  { id: 'yuvim', name: 'Yuvim', icon: '🏡', color: '#e07a5f', url: 'http://yuvim.com/', tagline: 'Yuvim.com', desc: 'Yuvim projesi. Admin panelindeki "Projeler" sekmesinden açıklamasını, kanvasını ve pitch deck\'ini düzenleyebilirsiniz.' },
  { id: 'ilcedepembehaber', name: 'İlçede Pembe Haber', icon: '📰', color: '#e56b9f', url: 'http://ilcedepembehaber.com/', tagline: 'Yerel haber platformu', desc: 'İlçede Pembe Haber projesi. Açıklama ve içerik admin panelinden düzenlenir.' },
  { id: 'workworld', name: 'Workworld Map', icon: '🗺️', color: '#2a9d8f', url: 'http://workworldmap.ortakofis.org/', tagline: 'Açık kaynak küresel harita', desc: 'Workworld Map projesi: çalışma ve girişim dünyasını harita üzerinde buluşturma fikri. Açıklama admin panelinden düzenlenir.' },
  { id: 'teknodoz-all-in', name: 'Teknodoz All-in', icon: '🧪', color: '#3d5a80', url: 'https://teknodoz-all-in.ortakofis.org/', tagline: 'Teknodoz ekosistemi', desc: 'Teknodoz All-in projesi. Açıklama admin panelinden düzenlenir.' },
  { id: 'sunum', name: 'Sunum', icon: '📽️', color: '#9b5de5', url: 'https://sunum.ortakofis.org/', tagline: 'Sunum aracı', desc: 'Sunum projesi. Açıklama admin panelinden düzenlenir.' },
  { id: 'teknodoz-dijital-analiz', name: 'Teknodoz Dijital Analiz', icon: '📊', color: '#f4a261', url: 'http://teknodoz-dijital-analiz.ortakofis.org/', tagline: 'Dijital analiz', desc: 'Teknodoz Dijital Analiz projesi. Açıklama admin panelinden düzenlenir.' }
];

// one project record, from untrusted input. `prev` keeps server-owned fields (owner, feedback, snapshot)
function normalize(input, prev = null) {
  if (!input || typeof input !== 'object') throw new Bad('Geçersiz proje');
  const name = str(input.name, 40); if (!name) throw new Bad('Proje adı gerekli');
  const exit = input.exit && typeof input.exit === 'object' ? input.exit : {};
  const events = (Array.isArray(input.events) ? input.events : []).slice(0, 8).map(e => ({ title: str(e?.title, 60), when: str(e?.when, 30), url: url(e?.url) })).filter(e => e.title);
  const partners = (Array.isArray(input.partners) ? input.partners : []).slice(0, 10).map(p => ({ name: str(p?.name, 40), role: str(p?.role, 40) })).filter(p => p.name);
  return {
    id: prev?.id || str(input.id, 30).replace(/[^a-z0-9_-]/gi, '').toLowerCase() || newId(),
    name, tagline: str(input.tagline, 80), desc: str(input.desc, 600), url: url(input.url),
    icon: str(input.icon, 8) || '💡', color: color(input.color),
    events, partners, exit: { status: EXIT.includes(exit.status) ? exit.status : 'none', note: str(exit.note, 200) },
    pitch: str(input.pitch, 900),
    board: BOARDS.clean(input.board ?? prev?.board ?? {}),
    owner: prev?.owner || null, feedback: prev?.feedback || [], snap: prev?.snap || null, createdAt: prev?.createdAt || Date.now()
  };
}

function clFb(f) { return f && f.text ? { id: str(f.id, 12) || crypto.randomBytes(3).toString('hex'), kind: FB_KINDS.includes(f.kind) ? f.kind : 'feedback', name: str(f.name, 30) || '—', text: str(f.text, 300), at: Number(f.at) || Date.now() } : null; }
// a stored record: validated like any input, then the server-owned fields are restored
function restore(raw) {
  const p = normalize(raw);
  p.owner = raw.owner && typeof raw.owner === 'object' ? { room: str(raw.owner.room, 20), cid: str(raw.owner.cid, 40), name: str(raw.owner.name, 30) } : null;
  p.feedback = (Array.isArray(raw.feedback) ? raw.feedback : []).slice(-MAX_FEEDBACK).map(clFb).filter(Boolean);
  p.snap = raw.snap && typeof raw.snap === 'object' ? raw.snap : null;
  p.createdAt = Number(raw.createdAt) || Date.now();
  return p;
}
let db = null;
const defaults = () => DEFAULTS.map(d => normalize(d));
try {
  const j = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  if (Array.isArray(j.list)) db = j.list.map(r => { try { return restore(r); } catch { return null; } }).filter(Boolean).slice(0, MAX);
} catch { /* first run */ }
if (!db) db = defaults();

let timer = null;
function save() { clearTimeout(timer); timer = setTimeout(() => { try { fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 }); fs.writeFileSync(FILE, JSON.stringify({ list: db }), { mode: 0o600 }); } catch (e) { console.warn('projects save failed:', e.message); } }, 400); }

const all = () => db;
const get = id => db.find(p => p.id === id) || null;
const byCompany = (room, cid) => db.find(p => p.owner && p.owner.room === room && p.owner.cid === cid) || null;
// what the street needs to draw the tower (id, name, icon, colour, order)
const publicList = () => db.map(p => ({ id: p.id, name: p.name, icon: p.icon, color: p.color }));
const summary = p => ({ id: p.id, name: p.name, icon: p.icon, color: p.color, tagline: p.tagline, url: p.url, owner: p.owner?.name || null, linked: !!p.owner, fb: p.feedback.length, exit: p.exit.status });

function add(input, owner = null) {
  if (db.length >= MAX) throw new Bad('full');
  const p = normalize(input); if (get(p.id)) p.id = newId();
  p.owner = owner; db.push(p); save(); return p;
}
// player edit: only text fields (the board is saved separately and owner/feedback are never touched)
function update(id, input) {
  const i = db.findIndex(p => p.id === id); if (i < 0) throw new Bad('Proje bulunamadı');
  const prev = db[i], merged = { ...prev, ...input, board: input.board ?? prev.board };
  db[i] = normalize(merged, prev); db[i].snap = prev.snap; save(); return db[i];
}
function setBoard(id, board) { const p = get(id); if (!p) return false; p.board = BOARDS.clean(board); save(); return true; }
function remove(id) { const i = db.findIndex(p => p.id === id); if (i < 0) return false; db.splice(i, 1); save(); return true; }
function reorder(ids) {
  if (!Array.isArray(ids)) throw new Bad('Geçersiz sıra');
  const next = ids.map(id => get(String(id))).filter(Boolean);
  if (new Set(next).size !== db.length) throw new Bad('Sıra tüm projeleri içermeli');
  db = next; save();
}
function addFeedback(id, { kind, text, name }) {
  const p = get(id); if (!p) return null;
  const f = clFb({ id: crypto.randomBytes(3).toString('hex'), kind, text, name, at: Date.now() }); if (!f) return null;
  p.feedback.push(f); if (p.feedback.length > MAX_FEEDBACK) p.feedback.splice(0, p.feedback.length - MAX_FEEDBACK); save(); return f;
}
function removeFeedback(id, fid) { const p = get(id); if (!p) return false; const n = p.feedback.length; p.feedback = p.feedback.filter(f => f.id !== fid); if (p.feedback.length !== n) save(); return p.feedback.length !== n; }
function setSnap(id, snap) { const p = get(id); if (p) { p.snap = snap; save(); } }
function reset() { db = defaults(); save(); }

module.exports = { MAX, Bad, all, get, byCompany, publicList, summary, add, update, setBoard, remove, reorder, addFeedback, removeFeedback, setSnap, reset, normalize, FB_KINDS };
