// auth.js
// Admin authentication: email + password (scrypt), forced password change after the first login, short-lived sessions.
// Bootstrap: until a password is set, the initial password is ADMIN_TOKEN from .env. The admin email comes from ADMIN_EMAIL
// (kept in .env, never in the repository).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const FILE = path.join(DATA_DIR, 'admin.json');
const SESSION_MS = 12 * 60 * 60 * 1000;
const MIN_PASSWORD = 10;

const sessions = new Map(); // token -> { email, exp, mustChange }

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return null; }
}
function save(rec) {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(FILE, JSON.stringify(rec, null, 2), { mode: 0o600 });
}
const hash = (password, salt) => crypto.scryptSync(String(password), salt, 64, { N: 16384, r: 8, p: 1 }).toString('hex');
const eq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

function createAuth({ adminEmail, bootstrapPassword }) {
  const email = String(adminEmail || '').trim().toLowerCase();

  function verify(inputEmail, password) {
    if (!email || !eq(String(inputEmail || '').trim().toLowerCase(), email)) return null;
    const rec = load();
    if (!rec || rec.email !== email) {
      // first run: bootstrap password = ADMIN_TOKEN, must be changed right after login
      return eq(password, bootstrapPassword) ? { mustChange: true } : null;
    }
    return eq(hash(password, rec.salt), rec.hash) ? { mustChange: !!rec.mustChange } : null;
  }
  function login(inputEmail, password) {
    const ok = verify(inputEmail, password);
    if (!ok) return null;
    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { email, exp: Date.now() + SESSION_MS, mustChange: ok.mustChange });
    return { token, mustChange: ok.mustChange };
  }
  function session(token) {
    const s = sessions.get(String(token || ''));
    if (!s) return null;
    if (s.exp < Date.now()) { sessions.delete(token); return null; }
    return s;
  }
  function changePassword(token, newPassword) {
    const s = session(token);
    if (!s) return 'unauthorized';
    const pw = String(newPassword || '');
    if (pw.length < MIN_PASSWORD) return 'tooShort';
    if (eq(pw, bootstrapPassword)) return 'sameAsBootstrap';
    const salt = crypto.randomBytes(16).toString('hex');
    save({ email, salt, hash: hash(pw, salt), mustChange: false, changedAt: new Date().toISOString() });
    // invalidate every other session after a password change
    for (const [k] of sessions) if (k !== token) sessions.delete(k);
    s.mustChange = false;
    return 'ok';
  }
  function logout(token) { sessions.delete(String(token || '')); }
  return { login, session, changePassword, logout, configured: !!email, MIN_PASSWORD };
}

module.exports = { createAuth };
