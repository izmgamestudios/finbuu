// accounts.js — Sprint 31: email + password accounts. The account keeps the player's profile (badges, streak, season, best week, GamFed board)
// across rooms and devices. Passwords: scrypt; sessions: random token, only its SHA-256 is stored; recovery code replaces e-mail reset (no mail server yet).
'use strict';
const crypto = require('crypto'), fs = require('fs'), path = require('path');
const FILE = path.join(__dirname, 'data', 'accounts.json');
const MAX_ACCOUNTS = 20000, SESSION_MS = 30 * 864e5, MAX_SESSIONS = 5;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
let db = { accounts: {}, sessions: {} };
try { const j = JSON.parse(fs.readFileSync(FILE, 'utf8')); if (j?.accounts) db = { accounts: j.accounts, sessions: j.sessions || {} }; } catch { /* first run */ }
let timer = null;
function save(now = false) {
  const write = () => { try { fs.mkdirSync(path.dirname(FILE), { recursive: true, mode: 0o700 }); fs.writeFileSync(FILE, JSON.stringify(db), { mode: 0o600 }); } catch (e) { console.warn('accounts save failed:', e.message); } };
  clearTimeout(timer); if (now) write(); else timer = setTimeout(write, 1500);
}
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const norm = e => String(e || '').trim().toLowerCase();
const byEmail = email => Object.values(db.accounts).find(a => a.email === email);
const DUMMY = { salt: crypto.randomBytes(16).toString('hex'), hash: '' }; DUMMY.hash = hashPw('dummy-password', DUMMY.salt);
const newRecovery = () => crypto.randomBytes(10).toString('hex').match(/.{1,5}/g).join('-').toUpperCase(); // e.g. 3F9A1-B27C0-D44E8-1A6F2 (shown once)

// ---- limiters (in memory): by IP and by e-mail ----
const hits = new Map();
function allow(key, max, windowMs) { const now = Date.now(), h = (hits.get(key) || []).filter(t => now - t < windowMs); if (h.length >= max) { hits.set(key, h); return false; } h.push(now); hits.set(key, h); if (hits.size > 20000) hits.clear(); return true; }
const fail = (key, max = 6, win = 15 * 60e3) => allow('f:' + key, max, win);       // counts a failed attempt; false = locked
const locked = (key, max = 6, win = 15 * 60e3) => { const now = Date.now(); return (hits.get('f:' + key) || []).filter(t => now - t < win).length >= max; };

const publicAcc = a => ({ id: a.id, email: a.email, name: a.name, created: a.created, profile: { ...a.profile, board: undefined } });
function startSession(id) {
  const token = crypto.randomBytes(32).toString('hex'), now = Date.now();
  for (const [h, s] of Object.entries(db.sessions)) if (s.exp < now) delete db.sessions[h];
  const mine = Object.entries(db.sessions).filter(([, s]) => s.id === id).sort((x, y) => x[1].at - y[1].at);
  while (mine.length >= MAX_SESSIONS) delete db.sessions[mine.shift()[0]];
  db.sessions[sha(token)] = { id, at: now, exp: now + SESSION_MS }; return token;
}
function fromToken(token) { const s = db.sessions[sha(token)]; if (!s || s.exp < Date.now()) return null; return db.accounts[s.id] || null; }

function register({ email, password, name }, ip) {
  email = norm(email); password = String(password || '');
  if (!allow('reg:' + ip, 5, 3600e3)) return { ok: false, error: 'rate' };
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'email' };
  if (password.length < 8 || password.length > 100) return { ok: false, error: 'password' };
  if (byEmail(email)) return { ok: false, error: 'exists' };
  if (Object.keys(db.accounts).length >= MAX_ACCOUNTS) return { ok: false, error: 'full' };
  const id = crypto.randomBytes(8).toString('hex'), salt = crypto.randomBytes(16).toString('hex'), rec = newRecovery(), rsalt = crypto.randomBytes(16).toString('hex');
  db.accounts[id] = { id, email, name: String(name || '').replace(/[\u0000-\u001F<>]/g, '').trim().slice(0, 20) || email.split('@')[0].slice(0, 20), salt, hash: hashPw(password, salt), rec: { salt: rsalt, hash: hashPw(rec, rsalt) }, created: Date.now(), profile: { badges: {}, streak: null, season: null, bestWeek: 0, board: null, share: null } };
  save(true); return { ok: true, token: startSession(id), recovery: rec, account: publicAcc(db.accounts[id]) };
}
function login({ email, password }, ip) {
  email = norm(email);
  if (locked('ip:' + ip, 20) || locked('em:' + email)) return { ok: false, error: 'locked' };
  const a = byEmail(email), ref = a || DUMMY, good = eq(hashPw(String(password || ''), ref.salt), ref.hash) && !!a;
  if (!good) { fail('ip:' + ip, 20); fail('em:' + email); return { ok: false, error: 'bad' }; }
  return { ok: true, token: startSession(a.id), account: publicAcc(a) };
}
function logout(token) { delete db.sessions[sha(token)]; save(); }
function reset({ email, recovery, password }, ip) {
  email = norm(email); password = String(password || '');
  if (locked('ip:' + ip, 20) || locked('em:' + email)) return { ok: false, error: 'locked' };
  if (password.length < 8 || password.length > 100) return { ok: false, error: 'password' };
  const a = byEmail(email), ref = a?.rec || DUMMY, good = eq(hashPw(String(recovery || '').trim().toUpperCase(), ref.salt), ref.hash) && !!a;
  if (!good) { fail('ip:' + ip, 20); fail('em:' + email); return { ok: false, error: 'bad' }; }
  const rec = newRecovery(), rsalt = crypto.randomBytes(16).toString('hex'), salt = crypto.randomBytes(16).toString('hex');
  a.salt = salt; a.hash = hashPw(password, salt); a.rec = { salt: rsalt, hash: hashPw(rec, rsalt) };
  for (const [h, s] of Object.entries(db.sessions)) if (s.id === a.id) delete db.sessions[h];   // sign out everywhere
  save(true); return { ok: true, token: startSession(a.id), recovery: rec, account: publicAcc(a) };
}
function remove(token, password, ip) {
  const a = fromToken(token); if (!a) return { ok: false, error: 'auth' };
  if (locked('ip:' + ip, 20) || locked('em:' + a.email)) return { ok: false, error: 'locked' };
  if (!eq(hashPw(String(password || ''), a.salt), a.hash)) { fail('ip:' + ip, 20); fail('em:' + a.email); return { ok: false, error: 'bad' }; }
  for (const [h, s] of Object.entries(db.sessions)) if (s.id === a.id) delete db.sessions[h];
  delete db.accounts[a.id]; save(true); return { ok: true };
}
// profile sync (called by the game server): merge, never lose data
function mergeProfile(id, p) {
  const a = db.accounts[id]; if (!a) return;
  const pr = a.profile;
  for (const [k, v] of Object.entries(p.badges || {})) if (!pr.badges[k]) pr.badges[k] = v;
  if (p.streak && (!pr.streak || p.streak.last > pr.streak.last || (p.streak.last === pr.streak.last && p.streak.n >= pr.streak.n))) pr.streak = { last: p.streak.last, n: p.streak.n, best: Math.max(p.streak.best || 0, pr.streak?.best || 0) };
  else if (pr.streak && p.streak) pr.streak.best = Math.max(pr.streak.best || 0, p.streak.best || 0);
  if (p.season && (!pr.season || p.season.key > pr.season.key || (p.season.key === pr.season.key && p.season.sp >= pr.season.sp))) pr.season = { key: p.season.key, sp: p.season.sp, got: [...new Set([...(p.season.got || []), ...(pr.season?.key === p.season.key ? pr.season.got || [] : [])])] };
  pr.bestWeek = Math.max(pr.bestWeek || 0, p.bestWeek || 0);
  save();
}
const nameOf = id => db.accounts[id]?.name || null;
const profileOf = id => db.accounts[id]?.profile || null;
const setBoard = (id, board, share) => { const a = db.accounts[id]; if (!a) return false; if (board !== undefined) a.profile.board = board; if (share !== undefined) a.profile.share = share; save(); return true; };
module.exports = { nameOf, register, login, logout, reset, remove, fromToken, publicAcc, mergeProfile, profileOf, setBoard, allow, count: () => Object.keys(db.accounts).length };
