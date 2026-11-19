// server.js
// npm install
// ADMIN_TOKEN=a-long-random-secret npm start
// Game: http://localhost:3000   Admin: http://localhost:3000/admin.html
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');

// Load .env if present (Node >= 20.12 built-in, no dotenv dependency)
try { if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '.env')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const R = require('./reports');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 12) { console.error('ADMIN_TOKEN env (min 12 chars) is required'); process.exit(1); }

const app = express();
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  next();
});
const server = http.createServer(app);
// perMessageDeflate: snapshots are repetitive JSON, compression cuts bandwidth ~5-10x for 30-50 player rooms
const io = new Server(server, { maxHttpBufferSize: 1e6, perMessageDeflate: { threshold: 1024 } });
app.use(express.static(path.join(__dirname, 'public')));
// Vendor libs served from node_modules (pinned via package-lock, no CDN dependency)
app.use('/vendor/i18next', express.static(path.join(__dirname, 'node_modules/i18next/dist/umd')));
app.use('/vendor/chart.js', express.static(path.join(__dirname, 'node_modules/chart.js/dist')));

// ---------- SEED / CONFIG (numbers are admin-editable) ----------
const SEED = {
  startCoins: 1000,
  salary: 25,
  npcEventSeconds: 30,
  tickSeconds: 60, // 1 tick = 1 game day
  maxPlayersPerRoom: 60,
  lotSizes: {
    10: { rent: 20, capacity: 2, maxTenants: 1 },
    50: { rent: 80, capacity: 6, maxTenants: 2 },
    100: { rent: 150, capacity: 12, maxTenants: 3 }
  },
  workspaces: {
    home:      { rent: 0,  electricity: 3, maxEmployees: 1, salesMult: 0.6, deposit: 0,  physical: false, remote: true },
    virtual:   { rent: 5,  electricity: 0, maxEmployees: 0, salesMult: 0.7, deposit: 25, physical: false, remote: true },
    eoffice:   { rent: 10, electricity: 2, maxEmployees: 3, salesMult: 0.8, deposit: 50, physical: false, remote: true },
    coworking: { rent: 15, electricity: 0, maxEmployees: 4, salesMult: 0.9, deposit: 75, physical: true, maxTenants: 6 },
    shop:      { salesMult: 1.0, physical: true }
  },
  benefits: {
    transport: { cost: 8,  perf: 0.10 }, // free for remote workspaces
    insurance: { cost: 10, perf: 0.10 },
    meal:      { cost: 6,  perf: 0.10 }
  },
  progression: { xpPerTick: 5, xpPerClick: 1, knowledgePerClick: 0.5, successCashThreshold: 1000 },
  lotPattern: [
    { type: 'shop', size: 10 }, { type: 'shop', size: 10 }, { type: 'shop', size: 50 },
    { type: 'coworking', size: 100 }, { type: 'shop', size: 50 }, { type: 'shop', size: 100 }
  ],
  tutorial: ['tutorial.welcome', 'tutorial.modes', 'tutorial.s1', 'tutorial.s1b', 'tutorial.s2', 'tutorial.s2b', 'tutorial.s3', 'tutorial.s4', 'tutorial.s5', 'tutorial.s5b', 'tutorial.s6'],
  templates: [
    { key: 'tpl.coffee', price: 5, sector: 'sector.food' },
    { key: 'tpl.phoneRepair', price: 15, sector: 'sector.service' },
    { key: 'tpl.softwareAgency', price: 40, sector: 'sector.tech' },
    { key: 'tpl.bakery', price: 8, sector: 'sector.food' },
    { key: 'tpl.stationery', price: 6, sector: 'sector.retail' },
    { key: 'tpl.barber', price: 12, sector: 'sector.service' },
    { key: 'tpl.florist', price: 9, sector: 'sector.retail' },
    { key: 'tpl.restaurant', price: 18, sector: 'sector.food' },
    { key: 'tpl.bookstore', price: 10, sector: 'sector.retail' },
    { key: 'tpl.gym', price: 22, sector: 'sector.health' },
    { key: 'tpl.pharmacy', price: 14, sector: 'sector.health' },
    { key: 'tpl.tutoring', price: 20, sector: 'sector.education' },
    { key: 'tpl.languageSchool', price: 25, sector: 'sector.education' },
    { key: 'tpl.designStudio', price: 30, sector: 'sector.creative' },
    { key: 'tpl.photoStudio', price: 16, sector: 'sector.creative' },
    { key: 'tpl.gameStudio', price: 45, sector: 'sector.tech' },
    { key: 'tpl.ecommerce', price: 28, sector: 'sector.tech' },
    { key: 'tpl.consulting', price: 35, sector: 'sector.service' },
    { key: 'tpl.bikeRepair', price: 11, sector: 'sector.service' },
    { key: 'tpl.petShop', price: 13, sector: 'sector.retail' }
  ],
  // "Other": players can define their own product/service within these bounds
  custom: { minPrice: 1, maxPrice: 60, sectors: ['sector.food', 'sector.service', 'sector.tech', 'sector.retail', 'sector.health', 'sector.education', 'sector.creative'] },
  // Departments inside a company building. A floor unlocks when the building is tall enough (floor index < floors).
  departments: [
    { key: 'sales', floor: 0 }, { key: 'finance', floor: 0 },
    { key: 'accounting', floor: 1 }, { key: 'marketing', floor: 1 },
    { key: 'hr', floor: 2 }, { key: 'it', floor: 2 },
    { key: 'rnd', floor: 3, locked: true }, { key: 'board', floor: 3, locked: true }
  ],
  marketing: { cost: 100, days: 7, mult: 1.3 },
  itUpgrade: { cost: 150, maxLevel: 3, cyberShield: 0.25 },
  npcStaff: { incomeFactor: 4 },
  npcTalk: { ids: 64, serviceCost: 30, meetXp: 2, serviceXp: 5, serviceKnowledge: 2, dealMult: 2 },
  npcCompanies: [
    { key: 'npc.simit', lotType: 'shop', size: 10, price: 3 },
    { key: 'npc.grocery', lotType: 'shop', size: 50, price: 7 },
    { key: 'npc.freelancer', lotType: 'coworking', size: 100, price: 20 }
  ],
  // Shown blurred/locked in the UI (Premium / upcoming sprints)
  lockedFeatures: ['locked.onlineMode', 'locked.mediaIdeas', 'locked.ideathon', 'locked.hackathon', 'locked.gameJam', 'locked.bootcamp',
    'locked.accelerator', 'locked.center', 'locked.kosgeb', 'locked.tubitak', 'locked.angel',
    'locked.seed', 'locked.seriesA', 'locked.seriesB', 'locked.crowdfunding', 'locked.ipo',
    'locked.apartment', 'locked.skyscraper', 'locked.marketResearch', 'locked.competitor']
};
const NPC_EVENTS = {
  customer: { key: 'event.customer', effect: c => (c.cash += c.price * 20) },
  sponsor:  { key: 'event.sponsor',  effect: c => (c.cash += 300) },
  investor: { key: 'event.investor', effect: c => { c.cash += 500; c.npcEquity += 5; } },
  thief:    { key: 'event.thief',    effect: c => (c.cash -= Math.floor(Math.max(0, c.cash) * 0.15)) },
  scammer:  { key: 'event.scammer',  effect: c => (c.cash -= 120) }
};
// Crises: rarer, hit richer companies harder, can bankrupt anyone (NPCs included).
// days = how long the crisis lasts; incomeMult = passive/click income multiplier while active
const CRISES = {
  concordat:      { key: 'crisis.concordat',      days: 30, incomeMult: 0.5, hit: 0.30, fixed: 0 },   // konkordato
  trustee:        { key: 'crisis.trustee',        days: 60, incomeMult: 0.3, hit: 0.20, fixed: 0, blocksWithdraw: true }, // kayyum
  govPressure:    { key: 'crisis.govPressure',    days: 20, incomeMult: 0.7, hit: 0.25, fixed: 200 },
  politicalAttack:{ key: 'crisis.politicalAttack',days: 15, incomeMult: 0.6, hit: 0.20, fixed: 100 },
  war:            { key: 'crisis.war',            days: 45, incomeMult: 0.4, hit: 0.35, fixed: 300, streetWide: true },
  cyberAttack:    { key: 'crisis.cyberAttack',    days: 10, incomeMult: 0.2, hit: 0.40, fixed: 150 }
};
const CRISIS_CHANCE = 0.15; // share of NPC event rolls that become a crisis
const WS = SEED.workspaces;
const MODES = { solo: { enabled: true }, multiplayer: { enabled: true }, presentation: { enabled: true }, online: { enabled: false } };
const SHARED_MODES = ['multiplayer', 'presentation'];

// ---------- HELPERS ----------
const rooms = {};
const LOTS_PER_STREET = 12;
const WORLD_MAX_X = 4000; // client street width is ~3800 world units
const SPAWN_X = 120;     // in front of the guide building
const clean = (s, max = 40) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const cParams = c => (c.name ? { company: c.name } : { companyKey: c.nameKey });
const addLog = (st, key, params = {}) => { st.log.unshift({ at: Date.now(), key, params }); st.log.length = Math.min(st.log.length, 30); };
// Compact company view for clients: last 30 days + last 12 months (full history stays on the server for reports)
// Lite company view in every snapshot: only today / last day / this month. History is fetched on demand ('finHistory').
const publicCompany = (c, monthKey) => {
  const f = c.fin || {}, d = f.daily || [];
  const recent = d.slice(-30);
  return { ...c, fin: { today: f.today, foundedDay: f.foundedDay, lastDay: d.at(-1) || null, prevCash: d.at(-2)?.cash ?? null,
    month: f.monthly?.[monthKey] || null, bestUnits: recent.reduce((m, x) => Math.max(m, x.units || 0), 0) } };
};
const finHistory = c => {
  const f = c.fin || {};
  return { daily: (f.daily || []).slice(-30), monthly: Object.values(f.monthly || {}).sort((a, b) => a.key.localeCompare(b.key)).slice(-12) };
};
const publicPresentation = st => st.presentation && {
  spotlight: st.presentation.spotlight, chatLocked: st.presentation.chatLocked, actionsLocked: st.presentation.actionsLocked,
  muted: Object.keys(st.presentation.muted || {}),
  poll: st.presentation.poll && { id: st.presentation.poll.id, question: st.presentation.poll.question, open: st.presentation.poll.open,
    options: st.presentation.poll.options.map(o => ({ text: o.text, votes: o.votes })), total: Object.keys(st.presentation.poll.voters).length }
};
const publicPlayer = p => ({ id: p.id, name: p.name, coins: p.coins, role: p.role, stats: p.stats, x: p.x, dir: p.dir, avatar: p.avatar });
const snapshot = st => ({ id: st.id, mode: st.mode, day: st.day || 0, calendar: st.day ? R.calendar(st.day) : null,
  players: Object.fromEntries(Object.entries(st.players).map(([id, p]) => [id, publicPlayer(p)])),
  companies: Object.fromEntries(Object.entries(st.companies).map(([id, c]) => [id, publicCompany(c, R.calendar((st.day || 0) + 1).monthKey)])),
  presentation: publicPresentation(st) || null, lots: st.lots, log: st.log, ideas: st.ideas });
const publicSeed = () => ({ salary: SEED.salary, custom: SEED.custom, departments: SEED.departments, marketing: SEED.marketing, itUpgrade: SEED.itUpgrade, npcTalk: { serviceCost: SEED.npcTalk.serviceCost, ids: SEED.npcTalk.ids }, tutorial: SEED.tutorial, templates: SEED.templates, locked: SEED.lockedFeatures,
  lotSizes: SEED.lotSizes, workspaces: SEED.workspaces, benefits: SEED.benefits, modes: MODES });
const maxTenants = lot => (lot.type === 'coworking' ? WS.coworking.maxTenants : SEED.lotSizes[lot.size].maxTenants);
const newStats = () => ({ xp: 0, knowledge: 0, success: 0, level: 1, performance: 1 });
const levelOf = xp => Math.floor(Math.sqrt(xp / 10)) + 1;
const emptyBenefits = () => ({ transport: false, insurance: false, meal: false });
// Room codes: 6-digit numbers, unique among live rooms
const newRoomId = () => { let id; do id = String(crypto.randomInt(100000, 1000000)); while (rooms[id] || rooms['solo-' + id]); return id; };
// Room PIN: host may choose 4-6 digits; otherwise a random 4-digit PIN
const pinOrRandom = pin => (/^\d{4,6}$/.test(String(pin ?? '').trim()) ? String(pin).trim() : newPin());
const newPin = () => String(crypto.randomInt(1000, 10000)); // 4 digits
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a ?? '')), y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

function activeBenefits(c) {
  return Object.entries(c.benefits || {}).filter(([k, on]) => on && !(k === 'transport' && WS[c.workspace]?.remote)).map(([k]) => k);
}
const performanceOf = c => +(1 + activeBenefits(c).reduce((s, k) => s + SEED.benefits[k].perf, 0)).toFixed(2);
const benefitCostPerEmployee = c => activeBenefits(c).reduce((s, k) => s + SEED.benefits[k].cost, 0);

function costPerTick(st, c) {
  if (c.lotId == null) { const w = WS[c.workspace]; return w.rent + w.electricity; }
  const lot = st.lots[c.lotId];
  if (lot.type === 'coworking') return WS.coworking.rent;
  const base = SEED.lotSizes[lot.size].rent, n = Math.max(1, lot.companyIds.length);
  return Math.ceil(base / n) + Math.ceil((base * 0.3) / n);
}
function depositFor(workspace, lot) {
  if (workspace !== 'shop') return WS[workspace].deposit;
  return Math.ceil(SEED.lotSizes[lot.size].rent / (lot.companyIds.length + 1)) * 5;
}
function employeeCap(st, c) {
  if (c.workspace === 'shop') return SEED.lotSizes[st.lots[c.lotId].size].capacity;
  return WS[c.workspace].maxEmployees;
}
function detachCompany(st, c) {
  if (c.lotId != null) { const lot = st.lots[c.lotId]; lot.companyIds = lot.companyIds.filter(id => id !== c.id); }
  delete st.companies[c.id];
}
function archiveCompany(st, c, status) {
  detachCompany(st, c);
  c.status = status; c.closedDay = st.day || 0;
  st.archive.push(c);
  if (st.archive.length > 200) st.archive.shift();
}
function makeCompany({ id, name, nameKey, workspace, lotId, founders, cash, price, isNpc }) {
  const c = { id, name, nameKey, workspace, lotId, founders, employees: [], investors: {}, cash, price, sales: 0,
    npcEquity: 0, isNpc, benefits: emptyBenefits(), performance: 1, benefitCost: 0, status: 'active' };
  R.ensureFin(c);
  return c;
}
function createStreet(id, mode, pin) {
  const lots = Array.from({ length: LOTS_PER_STREET }, (_, i) => ({ id: i, ...SEED.lotPattern[i % SEED.lotPattern.length], companyIds: [] }));
  const st = { id, mode, pin: pin || null, players: {}, pastPlayers: {}, companies: {}, lots, ideas: [], log: [], archive: [], day: 0, createdAt: Date.now() };
  SEED.npcCompanies.forEach((n, i) => {
    const lot = lots.find(l => l.type === n.lotType && l.size === n.size && l.companyIds.length === 0);
    const cid = 'npc' + i;
    st.companies[cid] = makeCompany({ id: cid, name: null, nameKey: n.key, workspace: n.lotType, lotId: lot.id,
      founders: [], cash: 500, price: n.price, isNpc: true });
    lot.companyIds.push(cid);
  });
  return st;
}
const crisisActive = (st, c) => c.crisis && c.crisis.until > (st.day || 0);
const marketingActive = (st, c) => c.marketing && c.marketing.until > (st.day || 0);
const incomeMult = (st, c) => (crisisActive(st, c) ? CRISES[c.crisis.type].incomeMult : 1) * (marketingActive(st, c) ? SEED.marketing.mult : 1);
// Mirrors the client: building height (floors) follows the lot's total cash. Virtual companies use their own cash.
const floorsFor = cash => Math.max(1, Math.min(6, 1 + Math.floor(Math.log2(Math.max(1, cash) / 250))));
function floorsOf(st, c) {
  if (c.lotId == null) return floorsFor(c.cash);
  return floorsFor(st.lots[c.lotId].companyIds.reduce((sum, id) => sum + (st.companies[id]?.cash || 0), 0));
}
const deptUnlocked = (st, c, key) => { const d = SEED.departments.find(x => x.key === key); return d && !d.locked && d.floor < floorsOf(st, c); };
const staffCount = c => c.employees.length + (c.npcStaff || 0);
function applyCrisis(st, c, type) {
  const cr = CRISES[type];
  const shield = type === 'cyberAttack' ? 1 - (c.security || 0) * SEED.itUpgrade.cyberShield : 1;
  const loss = Math.round((Math.floor(Math.max(0, c.cash) * cr.hit) + cr.fixed) * shield);
  c.cash -= loss;
  R.track(c, 'losses', loss);
  c.crisis = { type, until: (st.day || 0) + cr.days };
  c.crisisCount = (c.crisisCount || 0) + 1;
  addLog(st, 'log.crisis', { crisisKey: cr.key, days: cr.days, ...cParams(c) });
}
// Coalesce state broadcasts: at most one full snapshot per room every SYNC_MS (clicks no longer flood clients)
// Interval grows with room size so 30-50 players do not multiply bandwidth: 5/s small rooms, ~1.25/s crowded rooms.
const syncInterval = st => { const n = Object.keys(st.players).length; return n <= 5 ? 200 : n <= 20 ? 400 : 800; };
const syncTimers = new Map();
const syncRoom = st => {
  if (!st || syncTimers.has(st.id)) return;
  syncTimers.set(st.id, setTimeout(() => { syncTimers.delete(st.id); if (rooms[st.id] === st) io.to(st.id).emit('state', snapshot(st)); }, syncInterval(st)));
};
// Character positions are batched per room (one message per 100 ms instead of one per move per player)
const posDirty = new Map(); // roomId -> Map(playerId -> {x, dir})
setInterval(() => {
  for (const [rid, m] of posDirty) {
    if (rooms[rid] && m.size) io.to(rid).volatile.emit('posBatch', [...m].map(([id, p]) => [id, p.x, p.dir]));
  }
  posDirty.clear();
}, 100);

// ---------- GAME SOCKETS ----------
io.on('connection', socket => {
  let street = null, me = null, lastAction = 0, lastMove = 0, pinFails = 0;
  const limited = () => {
    if (street?.presentation?.actionsLocked) { socket.emit('toast', 'toast.actionsLocked'); return true; }
    const now = Date.now(); if (now - lastAction < 100) return true; lastAction = now; return false;
  };
  const sync = () => syncRoom(street);

  socket.emit('seed', publicSeed());

  function enter(st, name) {
    street = st;
    me = { id: socket.id, name: clean(name, 20) || 'Anon-' + crypto.randomBytes(2).toString('hex'),
      coins: SEED.startCoins, role: 'role.candidate', stats: newStats(),
      x: SPAWN_X, dir: 1, avatar: crypto.randomInt(0, 1000) };
    st.players[socket.id] = me;
    socket.join(st.id);
    addLog(st, 'log.joined', { player: me.name });
    socket.emit('joined', { roomId: st.id, mode: st.mode, pin: SHARED_MODES.includes(st.mode) ? st.pin : null });
    socket.emit('chatHistory', st.chat || []);
    sync();
  }

  // Solo: private street, only you + NPCs
  socket.on('startSolo', ({ name } = {}) => {
    if (street) return;
    const id = 'solo-' + newRoomId();
    rooms[id] = createStreet(id, 'solo');
    enter(rooms[id], name);
  });

  // Multiplayer: create a private room → share link + 4-digit PIN
  socket.on('createRoom', ({ name, pin } = {}) => {
    if (street) return;
    const id = newRoomId();
    rooms[id] = createStreet(id, 'multiplayer', pinOrRandom(pin));
    enter(rooms[id], name);
  });

  socket.on('joinRoom', ({ roomId, pin, name } = {}) => {
    if (street) return;
    if (pinFails >= 5) return socket.emit('toast', 'toast.tooManyTries');
    const st = rooms[clean(roomId, 20)];
    if (!st || !SHARED_MODES.includes(st.mode)) return socket.emit('toast', 'toast.roomNotFound');
    if (!safeEqual(clean(pin, 6), st.pin)) { pinFails++; return socket.emit('toast', 'toast.wrongPin'); }
    if (Object.keys(st.players).length >= SEED.maxPlayersPerRoom) return socket.emit('toast', 'toast.roomFull');
    enter(st, name);
  });

  // Character position: lightweight, volatile broadcast (no full state sync)
  socket.on('move', ({ x, dir } = {}) => {
    if (!street || !me || street.mode === 'presentation') return;
    const now = Date.now();
    if (now - lastMove < 50) return;
    lastMove = now;
    const nx = Number(x);
    if (!Number.isFinite(nx)) return;
    me.x = Math.max(0, Math.min(WORLD_MAX_X, Math.round(nx)));
    me.dir = dir < 0 ? -1 : 1;
    if (!posDirty.has(street.id)) posDirty.set(street.id, new Map());
    posDirty.get(street.id).set(me.id, { x: me.x, dir: me.dir });
  });

  // ---------- Departments (inside the building) ----------
  const founderOf = cid => { const c = street?.companies[cid]; return c && c.founders.includes(me.id) ? c : null; };
  const needDept = (c, key) => { if (deptUnlocked(street, c, key)) return true; socket.emit('toast', 'toast.deptLocked'); return false; };

  socket.on('marketing', ({ cid } = {}) => {
    const c = founderOf(cid); if (!c || limited() || !needDept(c, 'marketing')) return;
    if (marketingActive(street, c)) return socket.emit('toast', 'toast.campaignActive');
    if (c.cash < SEED.marketing.cost) return socket.emit('toast', 'toast.noCash');
    c.cash -= SEED.marketing.cost; R.track(c, 'expenses', SEED.marketing.cost);
    c.marketing = { until: (street.day || 0) + SEED.marketing.days };
    addLog(street, 'log.campaign', { player: me.name, days: SEED.marketing.days, ...cParams(c) });
    sync();
  });

  socket.on('itUpgrade', ({ cid } = {}) => {
    const c = founderOf(cid); if (!c || limited() || !needDept(c, 'it')) return;
    if ((c.security || 0) >= SEED.itUpgrade.maxLevel) return socket.emit('toast', 'toast.maxLevel');
    if (c.cash < SEED.itUpgrade.cost) return socket.emit('toast', 'toast.noCash');
    c.cash -= SEED.itUpgrade.cost; R.track(c, 'expenses', SEED.itUpgrade.cost);
    c.security = (c.security || 0) + 1;
    addLog(street, 'log.itUpgrade', { player: me.name, level: c.security, ...cParams(c) });
    sync();
  });

  function hireNpc(c) {
    if (staffCount(c) >= employeeCap(street, c)) { socket.emit('toast', 'toast.noDesk'); return false; }
    c.npcStaff = (c.npcStaff || 0) + 1;
    addLog(street, 'log.hiredNpc', { player: me.name, ...cParams(c) });
    return true;
  }
  socket.on('hireNpc', ({ cid } = {}) => {
    const c = founderOf(cid); if (!c || limited() || !needDept(c, 'hr')) return;
    if (hireNpc(c)) sync();
  });
  socket.on('fireNpc', ({ cid } = {}) => {
    const c = founderOf(cid); if (!c || limited() || !(c.npcStaff > 0)) return;
    c.npcStaff -= 1; sync();
  });

  // ---------- Street NPC dialogs (NPCs are cosmetic on the client; the server caps what they can grant) ----------
  socket.on('npcTalk', ({ npcId, kind, cid } = {}) => {
    if (!street || !me || limited()) return;
    const id = Number(npcId), cfg = SEED.npcTalk;
    if (!Number.isInteger(id) || id < 0 || id >= cfg.ids) return;
    const day = street.day || 0;
    me.npcLog ||= {};
    const once = (k, perDay = true) => { const key = `${id}:${k}`; if (me.npcLog[key] != null && (!perDay || me.npcLog[key] === day)) return false; me.npcLog[key] = day; return true; };
    const gain = (xp, knowledge = 0) => { me.stats.xp += xp; me.stats.knowledge = +(me.stats.knowledge + knowledge).toFixed(1); me.stats.level = levelOf(me.stats.xp); };
    if (kind === 'meet') {
      if (!once('meet', false)) return socket.emit('npcResult', { npcId: id, kind, ok: false, key: 'toast.alreadyMet' });
      gain(cfg.meetXp, 0.5);
      socket.emit('npcResult', { npcId: id, kind, ok: true, key: 'npcres.met' });
    } else if (kind === 'sell') {
      const c = street.companies[cid];
      if (!c || !(c.founders.includes(me.id) || c.employees.includes(me.id))) return;
      if (!once('sell')) return socket.emit('npcResult', { npcId: id, kind, ok: false, key: 'toast.npcBoughtToday' });
      const value = Math.max(1, Math.round(c.price * WS[c.workspace].salesMult * cfg.dealMult * incomeMult(street, c)));
      c.cash += value; c.sales++; R.track(c, 'revenue', value); R.track(c, 'units', 1);
      gain(SEED.progression.xpPerClick * 2);
      socket.emit('npcResult', { npcId: id, kind, ok: true, key: 'npcres.sold', amount: value });
    } else if (kind === 'service') {
      if (me.coins < cfg.serviceCost) return socket.emit('toast', 'toast.noCoins');
      if (!once('service')) return socket.emit('npcResult', { npcId: id, kind, ok: false, key: 'toast.npcBusy' });
      me.coins -= cfg.serviceCost; gain(cfg.serviceXp, cfg.serviceKnowledge);
      socket.emit('npcResult', { npcId: id, kind, ok: true, key: 'npcres.service', amount: cfg.serviceCost });
    } else if (kind === 'hire') {
      const c = founderOf(cid); if (!c) return;
      if (!once('hire', false)) return socket.emit('npcResult', { npcId: id, kind, ok: false, key: 'toast.npcTaken' });
      if (!hireNpc(c)) { delete me.npcLog[`${id}:hire`]; return; }
      socket.emit('npcResult', { npcId: id, kind, ok: true, key: 'npcres.hired' });
    } else return;
    sync();
  });

  // ---------- Chat (multiplayer & presentation rooms), moderated by admin ----------
  let lastChat = 0;
  socket.on('chat', ({ text } = {}) => {
    if (!street || !me || street.mode === 'solo') return;
    const now = Date.now();
    if (now - lastChat < 1500) return socket.emit('toast', 'toast.slowDown');
    const pr = street.presentation;
    if (pr?.chatLocked) return socket.emit('toast', 'toast.chatLocked');
    if (pr?.muted?.[me.id]) return socket.emit('toast', 'toast.muted');
    const body = clean(text, 200);
    if (!body) return;
    lastChat = now;
    const msg = { id: crypto.randomUUID(), pid: me.id, by: me.name, text: body, at: now };
    street.chat ||= [];
    street.chat.push(msg); if (street.chat.length > 50) street.chat.shift();
    io.to(street.id).emit('chat', msg);
  });
  socket.on('vote', ({ pollId, option } = {}) => {
    const poll = street?.presentation?.poll;
    if (!poll || !poll.open || poll.id !== pollId || poll.voters[me.id] != null) return;
    const i = Number(option);
    if (!Number.isInteger(i) || !poll.options[i]) return;
    poll.voters[me.id] = i; poll.options[i].votes++;
    sync();
  });
  let lastHist = 0;
  socket.on('finHistory', ({ cid } = {}, cb) => {
    if (typeof cb !== 'function') return;
    const c = street?.companies[cid], now = Date.now();
    if (!c || now - lastHist < 250) return cb(null);
    lastHist = now;
    cb(finHistory(c));
  });

  // Latency probe for the in-game status panel
  socket.on('latency', (cb) => typeof cb === 'function' && cb(Date.now()));

  socket.on('startOnline', () => socket.emit('toast', 'toast.onlineLocked'));

  socket.on('found', ({ lotId, workspace, name, templateIdx, custom } = {}) => {
    if (!street || limited()) return;
    const ws = Object.hasOwn(WS, workspace) ? workspace : null;
    if (!ws) return;
    let tpl = SEED.templates[templateIdx] || SEED.templates[0], customLabel = null;
    if (custom && typeof custom === 'object') {
      customLabel = clean(custom.label, 30);
      const price = Math.floor(Number(custom.price));
      const sector = SEED.custom.sectors.includes(custom.sector) ? custom.sector : null;
      if (!customLabel || !sector || !(price >= SEED.custom.minPrice && price <= SEED.custom.maxPrice)) return socket.emit('toast', 'toast.badCustom');
      tpl = { key: 'tpl.custom', price, sector };
    }
    let lot = null;
    if (WS[ws].physical) {
      // 'auto' (wizard / presentation mode): first free lot of that type
      lot = lotId === 'auto' ? street.lots.find(l => l.type === ws && l.companyIds.length < maxTenants(l)) : street.lots[lotId];
      if (!lot || lot.type !== ws || lot.companyIds.length >= maxTenants(lot)) return socket.emit('toast', 'toast.full');
    }
    const deposit = depositFor(ws, lot);
    if (me.coins < deposit) return socket.emit('toast', 'toast.noCoins');
    const cid = crypto.randomUUID();
    me.coins -= deposit;
    street.companies[cid] = makeCompany({ id: cid, name: clean(name) || customLabel || null, nameKey: tpl.key, workspace: ws,
      lotId: lot ? lot.id : null, founders: [me.id], cash: deposit, price: tpl.price, isNpc: false });
    street.companies[cid].sector = tpl.sector;
    if (customLabel) street.companies[cid].product = customLabel;
    if (lot) lot.companyIds.push(cid);
    me.role = 'role.founder';
    addLog(street, 'log.foundedWs', { player: me.name, wsKey: 'ws.' + ws, ...cParams(street.companies[cid]) });
    sync();
  });

  socket.on('setBenefits', ({ cid, benefits } = {}) => {
    const c = street?.companies[cid];
    if (!c || !c.founders.includes(me.id) || typeof benefits !== 'object' || !benefits) return;
    for (const k of Object.keys(SEED.benefits)) c.benefits[k] = !!benefits[k];
    c.performance = performanceOf(c);
    c.benefitCost = benefitCostPerEmployee(c);
    addLog(street, 'log.benefits', { player: me.name, ...cParams(c) });
    sync();
  });

  socket.on('cofound', ({ cid } = {}) => {
    const c = street?.companies[cid];
    if (!c || c.isNpc || c.founders.includes(me.id) || c.founders.length >= 3) return;
    c.founders.push(me.id); me.role = 'role.cofounder';
    addLog(street, 'log.cofounded', { player: me.name, ...cParams(c) });
    sync();
  });

  socket.on('work', ({ cid } = {}) => {
    const c = street?.companies[cid];
    if (!c || c.employees.includes(me.id)) return;
    if (staffCount(c) >= employeeCap(street, c)) return socket.emit('toast', 'toast.noDesk');
    for (const other of Object.values(street.companies)) other.employees = other.employees.filter(id => id !== me.id);
    c.employees.push(me.id); me.role = 'role.employee';
    addLog(street, 'log.hired', { player: me.name, ...cParams(c) });
    sync();
  });

  socket.on('buy', ({ cid } = {}) => {
    const c = street?.companies[cid];
    if (!c || limited() || me.coins < c.price || c.founders.includes(me.id)) return;
    me.coins -= c.price; c.cash += c.price; c.sales++;
    R.track(c, 'revenue', c.price); R.track(c, 'units', 1);
    sync();
  });

  socket.on('invest', ({ cid, amount } = {}) => {
    const c = street?.companies[cid];
    const amt = Math.floor(Number(amount));
    if (!c || !(amt > 0) || amt > me.coins) return;
    me.coins -= amt; c.cash += amt; c.investors[me.id] = (c.investors[me.id] || 0) + amt;
    R.track(c, 'investment', amt);
    addLog(street, 'log.invested', { player: me.name, amount: amt, ...cParams(c) });
    sync();
  });

  socket.on('click', ({ cid } = {}) => {
    const c = street?.companies[cid];
    if (!c || limited() || !(c.founders.includes(me.id) || c.employees.includes(me.id))) return;
    const perf = c.employees.includes(me.id) ? c.performance : 1;
    const levelBonus = 1 + (me.stats.level - 1) * 0.05;
    const value = Math.max(1, Math.round(c.price * WS[c.workspace].salesMult * perf * levelBonus * incomeMult(street, c)));
    c.cash += value; c.sales++;
    R.track(c, 'revenue', value); R.track(c, 'units', 1);
    me.stats.xp += SEED.progression.xpPerClick * perf;
    me.stats.knowledge = +(me.stats.knowledge + SEED.progression.knowledgePerClick).toFixed(1);
    me.stats.level = levelOf(me.stats.xp);
    me.stats.performance = perf;
    sync();
  });

  socket.on('withdraw', ({ cid } = {}) => {
    const c = street?.companies[cid];
    if (!c || !c.founders.includes(me.id) || c.cash <= 0) return;
    if (crisisActive(street, c) && CRISES[c.crisis.type].blocksWithdraw) return socket.emit('toast', 'toast.trusteeBlock');
    const share = Math.floor((c.cash * 0.2) / c.founders.length);
    c.cash -= share; me.coins += share;
    R.track(c, 'dividends', share);
    sync();
  });

  // Ideas: text only. Audio/video is a locked Premium feature (future: Cloudflare R2 storage).
  socket.on('idea', ({ text } = {}) => {
    if (!street || limited()) return;
    const body = clean(text, 500);
    if (!body) return;
    street.ideas.unshift({ id: crypto.randomUUID(), by: me.name, kind: 'text', text: body, at: Date.now() });
    street.ideas.length = Math.min(street.ideas.length, 50);
    addLog(street, 'log.idea', { player: me.name, kindKey: 'kind.text' });
    sync();
  });

  socket.on('disconnect', () => {
    if (!street) return;
    for (const c of Object.values(street.companies)) c.employees = c.employees.filter(id => id !== socket.id);
    street.pastPlayers[socket.id] = me;
    delete street.players[socket.id];
    addLog(street, 'log.left', { player: me?.name });
    if (street.mode === 'solo') { delete rooms[street.id]; return; } // solo streets are disposable
    sync();
  });
});

// ---------- ECONOMY TICK (1 tick = 1 game day) ----------
function economyTick() {
  for (const st of Object.values(rooms)) {
    for (const c of Object.values(st.companies)) {
      c.performance = performanceOf(c);
      c.benefitCost = benefitCostPerEmployee(c);
      const cost = costPerTick(st, c) + c.employees.length * (SEED.salary + c.benefitCost) + (c.npcStaff || 0) * SEED.salary;
      c.cash -= cost;
      R.track(c, 'expenses', cost);
      c.employees.forEach(pid => {
        const p = st.players[pid];
        if (!p) return;
        p.coins += SEED.salary;
        p.stats.xp += SEED.progression.xpPerTick * c.performance;
        p.stats.level = levelOf(p.stats.xp);
        p.stats.performance = c.performance;
      });
      if (c.cash >= SEED.progression.successCashThreshold) c.founders.forEach(pid => st.players[pid] && (st.players[pid].stats.success += 1));
      if (c.isNpc) { const income = Math.round(c.price * 15 * incomeMult(st, c)); c.cash += income; R.track(c, 'revenue', income); }
      if (c.npcStaff > 0) {
        const income = Math.round(c.npcStaff * c.price * WS[c.workspace].salesMult * SEED.npcStaff.incomeFactor * c.performance * incomeMult(st, c));
        c.cash += income; R.track(c, 'revenue', income); R.track(c, 'units', c.npcStaff);
      }
      if (c.marketing && !marketingActive(st, c)) c.marketing = null;
    }
    R.closeDay(st);
    for (const c of Object.values(st.companies)) {
      if (c.crisis && !crisisActive(st, c)) { addLog(st, 'log.crisisOver', cParams(c)); c.crisis = null; }
      if (c.cash < -200) { addLog(st, 'log.bankrupt', cParams(c)); archiveCompany(st, c, 'bankrupt'); }
    }
    syncRoom(st);
  }
}
let tickTimer = null;
const scheduleTick = () => { clearInterval(tickTimer); tickTimer = setInterval(economyTick, SEED.tickSeconds * 1000); };
scheduleTick();

// ---------- NPC BOT EVENTS ----------
function fireNpcEvent(st, type, cid) {
  const list = Object.values(st.companies);
  if (!list.length) return false;
  const isCrisis = CRISES[type] || (!type && Math.random() < CRISIS_CHANCE);
  if (isCrisis) {
    const crType = CRISES[type] ? type : Object.keys(CRISES)[Math.floor(Math.random() * Object.keys(CRISES).length)];
    // Richer companies are more likely targets: pick weighted by positive cash
    const weighted = cid && st.companies[cid] ? [st.companies[cid]] : list;
    const total = weighted.reduce((s, x) => s + Math.max(1, x.cash), 0);
    let r = Math.random() * total, target = weighted[0];
    for (const x of weighted) { r -= Math.max(1, x.cash); if (r <= 0) { target = x; break; } }
    const victims = CRISES[crType].streetWide && !cid ? list : [target];
    victims.forEach(v => applyCrisis(st, v, crType));
    io.to(st.id).emit('npcEvent', { cid: target.id, type: crType });
    syncRoom(st);
    return true;
  }
  const c = (cid && st.companies[cid]) || list[Math.floor(Math.random() * list.length)];
  const types = Object.keys(NPC_EVENTS);
  const evType = NPC_EVENTS[type] ? type : types[Math.floor(Math.random() * types.length)];
  const before = c.cash;
  NPC_EVENTS[evType].effect(c);
  const delta = c.cash - before;
  if (evType === 'investor') R.track(c, 'investment', delta);
  else if (delta >= 0) R.track(c, 'revenue', delta);
  else R.track(c, 'losses', -delta);
  addLog(st, 'log.npc', { eventKey: NPC_EVENTS[evType].key, ...cParams(c) });
  io.to(st.id).emit('npcEvent', { cid: c.id, type: evType });
  syncRoom(st);
  return true;
}
let npcTimer = null;
const scheduleNpc = () => {
  clearInterval(npcTimer);
  npcTimer = setInterval(() => Object.values(rooms).forEach(st => fireNpcEvent(st)), SEED.npcEventSeconds * 1000);
};
scheduleNpc();

// ---------- ADMIN AUTH (shared by socket namespace + HTTP API) ----------
const failedAuth = new Map(); // ip -> { count, until }
function checkToken(ip, token) {
  const f = failedAuth.get(ip);
  if (f && f.until > Date.now()) return 'locked';
  if (safeEqual(token, ADMIN_TOKEN)) { failedAuth.delete(ip); return 'ok'; }
  const count = (f?.count || 0) + 1;
  failedAuth.set(ip, { count, until: count >= 5 ? Date.now() + 15 * 60_000 : 0 });
  return 'unauthorized';
}
const adminLog = [];
const audit = (action, detail) => { adminLog.unshift({ at: Date.now(), action, detail }); adminLog.length = Math.min(adminLog.length, 100); };
const num = (v, min, max) => { const n = Number(v); return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : null; };

// ---------- ADMIN HTTP API: reports + export/import ----------
const adminApi = express.Router();
adminApi.use(express.json({ limit: '50mb' }));
adminApi.use((req, res, next) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const r = checkToken(req.ip, token);
  if (r !== 'ok') return res.status(r === 'locked' ? 429 : 401).json({ error: r });
  next();
});
adminApi.get('/report', (req, res) => {
  const period = ['month', 'quarter', 'year'].includes(req.query.period) ? req.query.period : 'month';
  const roomId = req.query.room ? clean(req.query.room, 20) : undefined;
  const report = R.fullReport(rooms, { roomId, period });
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="report-${period}-${Date.now()}.csv"`);
    return res.send(R.toCSV(report));
  }
  res.json(report);
});
adminApi.get('/export', (req, res) => {
  const data = { version: 1, exportedAt: new Date().toISOString(),
    config: { startCoins: SEED.startCoins, salary: SEED.salary, npcEventSeconds: SEED.npcEventSeconds, tickSeconds: SEED.tickSeconds,
      lotSizes: SEED.lotSizes, workspaces: SEED.workspaces, benefits: SEED.benefits, progression: SEED.progression },
    rooms: Object.fromEntries(Object.values(rooms).map(st => [st.id, { ...st, players: {}, pastPlayers: { ...st.pastPlayers, ...st.players } }])) };
  res.setHeader('Content-Disposition', `attachment; filename="finbuu-export-${Date.now()}.json"`);
  res.json(data);
});
adminApi.post('/import', (req, res) => {
  const data = req.body;
  if (!data || data.version !== 1 || typeof data.rooms !== 'object') return res.status(400).json({ error: 'invalid file' });
  let count = 0;
  for (const [id, st] of Object.entries(data.rooms)) {
    if (!st || !Array.isArray(st.lots) || typeof st.companies !== 'object') continue;
    const rid = clean(id, 20);
    io.in(rid).disconnectSockets(true);
    rooms[rid] = { ...st, id: rid, players: {}, pastPlayers: st.pastPlayers || {}, archive: st.archive || [], ideas: st.ideas || [], log: st.log || [] };
    count++;
  }
  audit('import', `${count} rooms`);
  res.json({ imported: count });
});
app.use('/admin/api', adminApi);

// ---------- ADMIN SOCKET NAMESPACE (live dashboard) ----------
const admin = io.of('/admin');
admin.use((socket, next) => {
  const r = checkToken(socket.handshake.address, socket.handshake.auth?.token);
  r === 'ok' ? next() : next(new Error(r));
});

function overview() {
  return {
    config: { startCoins: SEED.startCoins, salary: SEED.salary, npcEventSeconds: SEED.npcEventSeconds, tickSeconds: SEED.tickSeconds,
      lotSizes: SEED.lotSizes, workspaces: SEED.workspaces, benefits: SEED.benefits, progression: SEED.progression },
    rooms: Object.values(rooms).map(st => {
      const companies = Object.values(st.companies);
      return {
        id: st.id, mode: st.mode, pin: st.pin, day: st.day || 0, calendar: st.day ? R.calendar(st.day) : null, createdAt: st.createdAt,
        players: Object.values(st.players).map(publicPlayer),
        presentation: publicPresentation(st) || null, chat: (st.chat || []).slice(-30),
        companies: companies.map(c => ({ id: c.id, name: c.name, nameKey: c.nameKey, workspace: c.workspace, lotId: c.lotId,
          cash: c.cash, sales: c.sales, price: c.price, founders: c.founders.length, employees: c.employees.length,
          benefits: c.benefits, performance: c.performance, isNpc: c.isNpc, crisis: crisisActive(st, c) ? c.crisis : null })),
        archived: st.archive.length,
        ideas: st.ideas,
        log: st.log.slice(0, 15),
        totals: {
          players: Object.keys(st.players).length, companies: companies.length,
          cash: companies.reduce((s, c) => s + c.cash, 0), coins: Object.values(st.players).reduce((s, p) => s + p.coins, 0),
          sales: companies.reduce((s, c) => s + c.sales, 0)
        }
      };
    }),
    eventTypes: [...Object.keys(NPC_EVENTS), ...Object.keys(CRISES)], audit: adminLog.slice(0, 30),
    uptime: Math.round(process.uptime()), memoryMB: Math.round(process.memoryUsage().rss / 1e6)
  };
}

admin.on('connection', socket => {
  const push = () => socket.emit('overview', overview());
  push();
  const timer = setInterval(push, 3000);
  socket.on('disconnect', () => clearInterval(timer));
  const room = id => rooms[clean(id, 20)];

  socket.on('setConfig', patch => {
    if (typeof patch !== 'object' || !patch) return;
    const set = (obj, key, v, min, max) => { const n = num(v, min, max); if (n !== null) obj[key] = n; };
    set(SEED, 'startCoins', patch.startCoins, 0, 1e6);
    set(SEED, 'salary', patch.salary, 0, 1e4);
    const prevNpc = SEED.npcEventSeconds, prevTick = SEED.tickSeconds;
    set(SEED, 'npcEventSeconds', patch.npcEventSeconds, 5, 3600);
    set(SEED, 'tickSeconds', patch.tickSeconds, 5, 3600);
    if (prevNpc !== SEED.npcEventSeconds) scheduleNpc();
    if (prevTick !== SEED.tickSeconds) scheduleTick();
    for (const size of Object.keys(SEED.lotSizes)) set(SEED.lotSizes[size], 'rent', patch.lotSizes?.[size]?.rent, 0, 1e5);
    for (const ws of ['home', 'virtual', 'eoffice', 'coworking']) {
      set(WS[ws], 'rent', patch.workspaces?.[ws]?.rent, 0, 1e5);
      set(WS[ws], 'deposit', patch.workspaces?.[ws]?.deposit, 0, 1e5);
    }
    for (const b of Object.keys(SEED.benefits)) {
      set(SEED.benefits[b], 'cost', patch.benefits?.[b]?.cost, 0, 1e4);
      set(SEED.benefits[b], 'perf', patch.benefits?.[b]?.perf, 0, 2);
    }
    for (const k of Object.keys(SEED.progression)) set(SEED.progression, k, patch.progression?.[k], 0, 1e6);
    io.emit('seed', publicSeed());
    audit('setConfig', 'economy updated');
    push();
  });

  socket.on('giveCoins', ({ roomId, playerId, amount } = {}) => {
    const st = room(roomId), p = st?.players[playerId], n = num(amount, -1e6, 1e6);
    if (!p || n === null) return;
    p.coins = Math.max(0, p.coins + Math.round(n));
    audit('giveCoins', `${p.name} ${n}`); syncRoom(st); push();
  });

  socket.on('setCompanyCash', ({ roomId, companyId, cash } = {}) => {
    const st = room(roomId), c = st?.companies[companyId], n = num(cash, -1e6, 1e7);
    if (!c || n === null) return;
    c.cash = Math.round(n);
    audit('setCompanyCash', `${c.name || c.nameKey} = ${n}`); syncRoom(st); push();
  });

  socket.on('kickPlayer', ({ roomId, playerId } = {}) => {
    const p = room(roomId)?.players[playerId];
    if (!p) return;
    io.sockets.sockets.get(playerId)?.disconnect(true);
    audit('kickPlayer', p.name); push();
  });

  socket.on('deleteCompany', ({ roomId, companyId } = {}) => {
    const st = room(roomId), c = st?.companies[companyId];
    if (!c) return;
    archiveCompany(st, c, 'closedByAdmin');
    audit('deleteCompany', c.name || c.nameKey); syncRoom(st); push();
  });

  socket.on('deleteIdea', ({ roomId, ideaId } = {}) => {
    const st = room(roomId);
    if (!st) return;
    st.ideas = st.ideas.filter(i => i.id !== ideaId);
    audit('deleteIdea', ideaId); syncRoom(st); push();
  });

  socket.on('triggerEvent', ({ roomId, type, companyId } = {}) => {
    const st = room(roomId);
    if (st && fireNpcEvent(st, type, companyId)) { audit('triggerEvent', `${st.id} ${type}`); push(); }
  });

  socket.on('runTick', ({ days } = {}) => {
    const n = num(days, 1, 3650) || 1;
    for (let i = 0; i < n; i++) economyTick();
    audit('runTick', `${n} day(s)`); push();
  });

  socket.on('createRoom', ({ mode, pin } = {}) => {
    const id = newRoomId(), m = mode === 'presentation' ? 'presentation' : 'multiplayer';
    rooms[id] = createStreet(id, m, pinOrRandom(pin));
    if (m === 'presentation') rooms[id].presentation = { spotlight: 'auto', chatLocked: false, actionsLocked: false, muted: {}, poll: null };
    audit('createRoom', `${id} (${m})`); push();
  });
  const pres = id => { const st = room(id); return st?.presentation ? st : null; };
  socket.on('setSpotlight', ({ roomId, target } = {}) => {
    const st = pres(roomId); if (!st) return;
    const n = Number(target);
    st.presentation.spotlight = target === 'auto' || target === 'plaza' || target == null ? (target ?? null) : Number.isInteger(n) && st.lots[n] ? n : 'auto';
    audit('setSpotlight', `${st.id}: ${st.presentation.spotlight}`); syncRoom(st); push();
  });
  socket.on('lockChat', ({ roomId, locked } = {}) => { const st = pres(roomId); if (!st) return; st.presentation.chatLocked = !!locked; audit('lockChat', `${st.id}: ${!!locked}`); syncRoom(st); push(); });
  socket.on('lockActions', ({ roomId, locked } = {}) => { const st = pres(roomId); if (!st) return; st.presentation.actionsLocked = !!locked; audit('lockActions', `${st.id}: ${!!locked}`); syncRoom(st); push(); });
  socket.on('mutePlayer', ({ roomId, playerId, muted } = {}) => {
    const st = pres(roomId); if (!st || !st.players[playerId]) return;
    if (muted) st.presentation.muted[playerId] = true; else delete st.presentation.muted[playerId];
    audit('mutePlayer', `${st.players[playerId].name}: ${!!muted}`); syncRoom(st); push();
  });
  socket.on('deleteChat', ({ roomId, msgId } = {}) => {
    const st = room(roomId); if (!st?.chat) return;
    st.chat = st.chat.filter(m => m.id !== msgId);
    io.to(st.id).emit('chatDeleted', msgId); audit('deleteChat', msgId); push();
  });
  socket.on('createPoll', ({ roomId, question, options } = {}) => {
    const st = pres(roomId); if (!st) return;
    const q = clean(question, 140), opts = (Array.isArray(options) ? options : []).map(o => clean(o, 60)).filter(Boolean).slice(0, 6);
    if (!q || opts.length < 2) return;
    st.presentation.poll = { id: crypto.randomUUID(), question: q, open: true, options: opts.map(text => ({ text, votes: 0 })), voters: {} };
    audit('createPoll', `${st.id}: ${q}`); syncRoom(st); push();
  });
  socket.on('closePoll', ({ roomId } = {}) => { const st = pres(roomId); if (!st?.presentation.poll) return; st.presentation.poll.open = false; audit('closePoll', st.id); syncRoom(st); push(); });

  socket.on('newPin', ({ roomId } = {}) => {
    const st = room(roomId);
    if (!st || st.mode !== 'multiplayer') return;
    st.pin = newPin();
    audit('newPin', st.id); push();
  });

  socket.on('resetRoom', ({ roomId } = {}) => {
    const st = room(roomId);
    if (!st) return;
    const fresh = createStreet(st.id, st.mode, st.pin);
    if (st.presentation) fresh.presentation = { ...st.presentation, poll: null };
    for (const p of Object.values(st.players)) { p.coins = SEED.startCoins; p.role = 'role.candidate'; p.stats = newStats(); p.history = {}; fresh.players[p.id] = p; }
    rooms[st.id] = fresh;
    syncRoom(fresh);
    audit('resetRoom', st.id); push();
  });

  socket.on('deleteRoom', ({ roomId } = {}) => {
    const st = room(roomId);
    if (!st) return;
    io.in(st.id).disconnectSockets(true);
    delete rooms[st.id];
    audit('deleteRoom', st.id); push();
  });

  socket.on('announce', ({ roomId, text } = {}) => {
    const msg = clean(text, 200);
    if (!msg) return;
    (roomId ? io.to(clean(roomId, 20)) : io).emit('announce', msg);
    audit('announce', `${roomId || 'ALL'}: ${msg}`); push();
  });
});

server.listen(PORT, () => console.log(`Game: http://localhost:${PORT}  Admin: http://localhost:${PORT}/admin.html`));
