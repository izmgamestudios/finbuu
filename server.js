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
const { createAuth } = require('./auth');
const ECON = require('./economy').build(25); // 25 coins = blue-collar daily employer cost (2026 minimum wage)

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
    { key: 'tpl.petShop', price: 13, sector: 'sector.retail' },
    { key: 'tpl.carDealer', price: 60, sector: 'sector.auto', role: 'carDealer' },
    { key: 'tpl.rentACar', price: 25, sector: 'sector.auto', role: 'rentACar' },
    { key: 'tpl.busCard', price: 4, sector: 'sector.transport', role: 'busCard' }
  ],
  // "Other": players can define their own product/service within these bounds
  custom: { minPrice: 1, maxPrice: 60, sectors: ['sector.food', 'sector.service', 'sector.tech', 'sector.retail', 'sector.health', 'sector.education', 'sector.creative', 'sector.auto', 'sector.transport'] },
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
  busStops: [447, 1180, 2156, 3132],   // world x of bus stops (gaps between buildings, mirrored by the client)
  teams: { max: 8, colors: ['#e63946', '#1d70f5', '#2a9d4b', '#f4a300', '#8e44ad', '#00a8a8', '#ff6fa1', '#4b5563'] },
  quests: [
    { id: 'sell10', metric: 'sales', goal: 10, xp: 10, coins: 30 }, { id: 'sell30', metric: 'sales', goal: 30, xp: 20, coins: 60 },
    { id: 'earn300', metric: 'revenue', goal: 300, xp: 15, coins: 40 }, { id: 'meetNpc', metric: 'met', goal: 2, xp: 10, coins: 20 },
    { id: 'npcSale', metric: 'npcSale', goal: 2, xp: 15, coins: 40 }, { id: 'busRide', metric: 'rides', goal: 1, xp: 10, coins: 15 },
    { id: 'invest', metric: 'invest', goal: 1, xp: 10, coins: 20 }, { id: 'campaign', metric: 'campaign', goal: 1, xp: 20, coins: 50 },
    { id: 'hire', metric: 'hire', goal: 1, xp: 20, coins: 50 }, { id: 'topup', metric: 'topup', goal: 1, xp: 5, coins: 10 },
    { id: 'chat', metric: 'chat', goal: 1, xp: 5, coins: 10, shared: true }
  ],
  badges: ['firstCompany', 'sales10', 'sales100', 'sales1000', 'floor3', 'floor6', 'firstHire', 'marketer', 'secure', 'social',
    'commuter', 'teamPlayer', 'questHero', 'survivor', 'investor', 'tycoon', 'landlord', 'driver', 'pitcher', 'funded', 'grantee'],
  demoDay: { canvasMax: 300, pitchMax: 900, demoCooldown: 30, angelCooldown: 15, offerDays: 3, grantAmount: 2000, grantMinDays: 10, grantMinBlocks: 7, demoMin: 60, angelMin: 45 },
  npcCompanies: [
    { key: 'npc.simit', lotType: 'shop', size: 10, price: 3, sector: 'sector.food' },
    { key: 'npc.busCard', lotType: 'shop', size: 10, price: 4, sector: 'sector.transport', role: 'busCard' },
    { key: 'npc.grocery', lotType: 'shop', size: 50, price: 7, sector: 'sector.retail' },
    { key: 'npc.freelancer', lotType: 'coworking', size: 100, price: 20, sector: 'sector.creative' }
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
const WORLD_MAX_X = 4600; // client street width is ~3800 world units
const SPAWN_X = 120;     // in front of the guide building
const clean = (s, max = 40) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const cParams = c => (c.name ? { company: c.name } : { companyKey: c.nameKey });
const addLog = (st, key, params = {}) => { st.log.unshift({ at: Date.now(), key, params }); st.log.length = Math.min(st.log.length, 30); };
// Compact company view for clients: last 30 days + last 12 months (full history stays on the server for reports)
// Lite company view in every snapshot: only today / last day / this month. History is fetched on demand ('finHistory').
const publicCompany = (c, monthKey) => {
  const f = c.fin || {}, d = f.daily || [];
  const recent = d.slice(-30);
  const { canvas, pitch, ...rest } = c; // heavy texts are fetched on demand ('pitchGet')
  return { ...rest, canvasFilled: canvasFilled(c), pitchWords: (pitch || '').trim().split(/\s+/).filter(Boolean).length, fin: { today: f.today, foundedDay: f.foundedDay, lastDay: d.at(-1) || null, prevCash: d.at(-2)?.cash ?? null,
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
const publicPlayer = p => ({ id: p.id, name: p.name, coins: p.coins, role: p.role, stats: p.stats, x: p.x, dir: p.dir, avatar: p.avatar,
  team: p.team || null, busCard: p.busCard || 0, badges: Object.keys(p.badges || {}), quests: p.quests?.list || [], counters: p.counters || {} });
const snapshot = st => ({ id: st.id, mode: st.mode, day: st.day || 0, calendar: st.day ? R.calendar(st.day) : null,
  players: Object.fromEntries(Object.entries(st.players).map(([id, p]) => [id, publicPlayer(p)])),
  companies: Object.fromEntries(Object.entries(st.companies).map(([id, c]) => [id, publicCompany(c, R.calendar((st.day || 0) + 1).monthKey)])),
  presentation: publicPresentation(st) || null,
  city: cityOf(st), teams: st.teams || {}, tickAt: st.tickAt, serverNow: Date.now(),
  lots: st.lots.map(l => ({ ...l, rent: lotRent(st, l), price: lotPrice(st, l) })), log: st.log, ideas: st.ideas });
const publicEconomy = () => ({ rate: ECON.rate, data: ECON.data, collars: ECON.collars, vehicle: ECON.vehicle, busFare: ECON.busFare,
  busTopups: ECON.busTopups, deliveryKm: ECON.deliveryKm, cities: ECON.cities });
const publicSeed = () => ({ economy: publicEconomy(), startCoins: SEED.startCoins, tickSeconds: SEED.tickSeconds, busStops: SEED.busStops,
  teamColors: SEED.teams.colors, quests: SEED.quests, badges: SEED.badges, salary: SEED.salary, custom: SEED.custom, departments: SEED.departments, marketing: SEED.marketing, itUpgrade: SEED.itUpgrade, npcTalk: { serviceCost: SEED.npcTalk.serviceCost, ids: SEED.npcTalk.ids }, tutorial: SEED.tutorial, templates: SEED.templates, locked: SEED.lockedFeatures,
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
  const base = lotRent(st, lot), n = Math.max(1, lot.companyIds.length);
  const rent = lot.owner === c.id ? 0 : Math.ceil(base / n);   // owners pay no rent, only utilities
  return rent + Math.ceil((base * 0.3) / n);
}
// City-based real estate: daily rent and purchase price of a lot (₺/m² converted to coins)
const cityOf = st => (ECON.cities[st.city] ? st.city : 'istanbul');
const lotRent = (st, lot) => ECON.lotRent(cityOf(st), lot.size);
const lotPrice = (st, lot) => ECON.lotPrice(cityOf(st), lot.size);
const vehicleDaily = c => (c.vehicle?.type === 'rent' ? ECON.vehicle.rentPerDay : c.vehicle?.type === 'own' ? ECON.vehicle.upkeepPerDay : 0);
const roleCompany = (st, role) => Object.values(st.companies).find(x => SEED.templates.find(t => t.key === x.nameKey)?.role === role || SEED.npcCompanies.find(n => n.key === x.nameKey)?.role === role);
// Every sale has a delivery distance (sector) -> fuel with a company vehicle, courier / taxi without one
function addDelivery(st, c, units = 1) {
  const km = (ECON.deliveryKm[c.sector] ?? 2) * units;
  if (!km) return;
  const perKm = c.vehicle ? ECON.vehicle.fuelPerKm : ECON.vehicle.courierPerKm;
  c.fuelAcc = (c.fuelAcc || 0) + km * perKm;
  R.track(c, 'km', km);
}
let currentStreetForDeposit = null; // set right before depositFor() is called (keeps the old signature)
function depositFor(workspace, lot) {
  if (workspace !== 'shop') return WS[workspace].deposit;
  return Math.ceil(lotRent(currentStreetForDeposit, lot) / (lot.companyIds.length + 1)) * 5;
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
function createStreet(id, mode, pin, city) {
  const lots = Array.from({ length: LOTS_PER_STREET }, (_, i) => ({ id: i, ...SEED.lotPattern[i % SEED.lotPattern.length], companyIds: [] }));
  const st = { id, mode, pin: pin || null, city: ECON.cities[city] ? city : 'istanbul', teams: {}, tickAt: Date.now(),
    players: {}, pastPlayers: {}, companies: {}, lots, ideas: [], log: [], archive: [], day: 0, createdAt: Date.now() };
  SEED.npcCompanies.forEach((n, i) => {
    const lot = lots.find(l => l.type === n.lotType && l.size === n.size && l.companyIds.length === 0);
    const cid = 'npc' + i;
    st.companies[cid] = makeCompany({ id: cid, name: null, nameKey: n.key, workspace: n.lotType, lotId: lot.id,
      founders: [], cash: 500, price: n.price, isNpc: true });
    st.companies[cid].sector = n.sector;
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
// ---------- Demo Day: business model canvas, elevator pitch, investor readiness ----------
const CANVAS_KEYS = ['keyPartners', 'keyActivities', 'keyResources', 'valueProps', 'customerRelationships', 'channels', 'customerSegments', 'costStructure', 'revenueStreams'];
const canvasFilled = c => CANVAS_KEYS.filter(k => (c.canvas?.[k] || '').trim().length >= 8).length;
function readiness(st, c) {
  const f = c.fin || {}, month = f.monthly?.[R.calendar((st.day || 0) + 1).monthKey] || {};
  const months = Object.values(f.monthly || {}).sort((a, b) => a.key.localeCompare(b.key));
  const last = months.at(-1)?.revenue || 0, prev = months.at(-2)?.revenue || 0;
  const growth = prev > 0 ? (last - prev) / prev : last > 0 ? 0.5 : 0;
  const parts = {
    canvas: canvasFilled(c) * 4,                                               // 36
    pitch: (c.pitch || '').trim().split(/\s+/).filter(Boolean).length >= 40 ? 10 : 0, // 10
    traction: Math.min(25, Math.round(Math.log2(1 + (month.revenue || 0) + last) * 2.2)) + Math.min(5, Math.round(c.sales / 40)), // 30
    growth: Math.max(0, Math.min(10, Math.round(growth * 20))),                // 10
    team: Math.min(14, c.founders.length * 4 + staffCount(c) * 2)             // 14
  };
  const score = Math.min(100, Object.values(parts).reduce((a, b) => a + b, 0));
  const yearly = Math.max(last, month.revenue || 0) * 12;
  const valuation = Math.max(5000, Math.round(yearly * 3 + Math.max(0, c.cash)));
  return { score, parts, valuation };
}
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
// ---------- Daily quests & badges ----------
// Quests refresh every real calendar day (Europe/Istanbul); 3 per player, picked deterministically.
const todayKey = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/Istanbul' });
const hashStr = s => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0; return h; };
function ensureQuests(st, p) {
  const day = todayKey();
  if (p.quests?.day === day) return p.quests;
  const pool = SEED.quests.filter(q => !q.shared || st.mode !== 'solo');
  const picked = [], h = hashStr(day + p.id);
  for (let i = 0; picked.length < 3 && i < pool.length * 2; i++) { const q = pool[(h + i * 7) % pool.length]; if (!picked.includes(q)) picked.push(q); }
  p.quests = { day, list: picked.map(q => ({ id: q.id, goal: q.goal, progress: 0, done: false, xp: q.xp, coins: q.coins })) };
  return p.quests;
}
function award(st, p, id) {
  if (!p || !SEED.badges.includes(id)) return;
  p.badges ||= {};
  if (p.badges[id]) return;
  p.badges[id] = Date.now();
  addLog(st, 'log.badge', { player: p.name, badgeKey: 'badge.' + id });
  io.to(p.id).emit('badge', { id });
}
function progress(st, p, metric, amount = 1) {
  if (!p) return;
  p.counters ||= {};
  p.counters[metric] = (p.counters[metric] || 0) + amount;
  const n = p.counters[metric];
  if (metric === 'sales') { if (n >= 10) award(st, p, 'sales10'); if (n >= 100) award(st, p, 'sales100'); if (n >= 1000) award(st, p, 'sales1000'); }
  if (metric === 'met' && n >= 5) award(st, p, 'social');
  if (metric === 'rides' && n >= 3) award(st, p, 'commuter');
  for (const q of ensureQuests(st, p).list) {
    const def = SEED.quests.find(d => d.id === q.id);
    if (!def || def.metric !== metric || q.done) continue;
    q.progress = Math.min(q.goal, q.progress + amount);
    if (q.progress >= q.goal) {
      q.done = true;
      p.coins += q.coins; p.stats.xp += q.xp; p.stats.level = levelOf(p.stats.xp);
      p.counters.quests = (p.counters.quests || 0) + 1;
      if (p.counters.quests >= 10) award(st, p, 'questHero');
      io.to(p.id).emit('questDone', { id: q.id, coins: q.coins, xp: q.xp });
    }
  }
}
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
      x: SPAWN_X, dir: 1, avatar: crypto.randomInt(0, 1000), busCard: 0, badges: {}, counters: {}, team: null };
    ensureQuests(st, me);
    st.players[socket.id] = me;
    socket.join(st.id);
    addLog(st, 'log.joined', { player: me.name });
    socket.emit('joined', { roomId: st.id, mode: st.mode, pin: SHARED_MODES.includes(st.mode) ? st.pin : null });
    socket.emit('chatHistory', st.chat || []);
    sync();
  }

  // Solo: private street, only you + NPCs
  socket.on('startSolo', ({ name, city } = {}) => {
    if (street) return;
    const id = 'solo-' + newRoomId();
    rooms[id] = createStreet(id, 'solo', null, city);
    enter(rooms[id], name);
  });

  // Multiplayer: create a private room → share link + 4-digit PIN
  socket.on('createRoom', ({ name, pin, city } = {}) => {
    if (street) return;
    const id = newRoomId();
    rooms[id] = createStreet(id, 'multiplayer', pinOrRandom(pin), city);
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
    progress(street, me, 'campaign'); award(street, me, 'marketer');
    addLog(street, 'log.campaign', { player: me.name, days: SEED.marketing.days, ...cParams(c) });
    sync();
  });

  socket.on('itUpgrade', ({ cid } = {}) => {
    const c = founderOf(cid); if (!c || limited() || !needDept(c, 'it')) return;
    if ((c.security || 0) >= SEED.itUpgrade.maxLevel) return socket.emit('toast', 'toast.maxLevel');
    if (c.cash < SEED.itUpgrade.cost) return socket.emit('toast', 'toast.noCash');
    c.cash -= SEED.itUpgrade.cost; R.track(c, 'expenses', SEED.itUpgrade.cost);
    c.security = (c.security || 0) + 1;
    if (c.security >= SEED.itUpgrade.maxLevel) award(street, me, 'secure');
    addLog(street, 'log.itUpgrade', { player: me.name, level: c.security, ...cParams(c) });
    sync();
  });

  function hireNpc(c, collar = 'blue') {
    if (staffCount(c) >= employeeCap(street, c)) { socket.emit('toast', 'toast.noDesk'); return false; }
    const col = ECON.collars[collar] ? collar : 'blue';
    c.staffMix ||= { blue: c.npcStaff || 0, grey: 0, white: 0 };
    c.staffMix[col]++;
    c.npcStaff = (c.npcStaff || 0) + 1;
    progress(street, me, 'hire'); award(street, me, 'firstHire');
    addLog(street, 'log.hiredNpc', { player: me.name, ...cParams(c) });
    return true;
  }
  socket.on('hireNpc', ({ cid, collar } = {}) => {
    const c = founderOf(cid); if (!c || limited() || !needDept(c, 'hr')) return;
    if (hireNpc(c, collar)) sync();
  });
  socket.on('fireNpc', ({ cid } = {}) => {
    const c = founderOf(cid); if (!c || limited() || !(c.npcStaff > 0)) return;
    c.staffMix ||= { blue: c.npcStaff, grey: 0, white: 0 };
    const col = ['white', 'grey', 'blue'].find(k => c.staffMix[k] > 0);
    if (col) c.staffMix[col]--;
    c.npcStaff -= 1; sync();
  });

  // ---------- Street NPC dialogs (NPCs are cosmetic on the client; the server caps what they can grant) ----------
  socket.on('npcTalk', ({ npcId, kind, cid, collar } = {}) => {
    if (!street || !me || limited()) return;
    const id = Number(npcId), cfg = SEED.npcTalk;
    if (!Number.isInteger(id) || id < 0 || id >= cfg.ids) return;
    const day = street.day || 0;
    me.npcLog ||= {};
    const once = (k, perDay = true) => { const key = `${id}:${k}`; if (me.npcLog[key] != null && (!perDay || me.npcLog[key] === day)) return false; me.npcLog[key] = day; return true; };
    const gain = (xp, knowledge = 0) => { me.stats.xp += xp; me.stats.knowledge = +(me.stats.knowledge + knowledge).toFixed(1); me.stats.level = levelOf(me.stats.xp); };
    if (kind === 'meet') {
      if (!once('meet', false)) return socket.emit('npcResult', { npcId: id, kind, ok: false, key: 'toast.alreadyMet' });
      gain(cfg.meetXp, 0.5); progress(street, me, 'met');
      socket.emit('npcResult', { npcId: id, kind, ok: true, key: 'npcres.met' });
    } else if (kind === 'sell') {
      const c = street.companies[cid];
      if (!c || !(c.founders.includes(me.id) || c.employees.includes(me.id))) return;
      if (!once('sell')) return socket.emit('npcResult', { npcId: id, kind, ok: false, key: 'toast.npcBoughtToday' });
      const value = Math.max(1, Math.round(c.price * WS[c.workspace].salesMult * cfg.dealMult * incomeMult(street, c)));
      c.cash += value; c.sales++; R.track(c, 'revenue', value); R.track(c, 'units', 1); addDelivery(street, c, 1);
      progress(street, me, 'sales'); progress(street, me, 'npcSale'); progress(street, me, 'revenue', value);
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
      if (!hireNpc(c, collar)) { delete me.npcLog[`${id}:hire`]; return; }
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
    progress(street, me, 'chat');
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

  // ---------- Public transport: bus card top-up (at a bus card center) + rides between stops ----------
  socket.on('busTopup', ({ cid, amount } = {}) => {
    const c = street?.companies[cid], amt = Math.floor(Number(amount));
    if (!c || limited() || !ECON.busTopups.includes(amt)) return;
    const role = SEED.templates.find(t => t.key === c.nameKey)?.role || SEED.npcCompanies.find(n => n.key === c.nameKey)?.role;
    if (role !== 'busCard') return;
    if (me.coins < amt) return socket.emit('toast', 'toast.noCoins');
    me.coins -= amt; me.busCard = (me.busCard || 0) + amt;
    c.cash += amt; c.sales++; R.track(c, 'revenue', amt); R.track(c, 'units', 1);
    progress(street, me, 'topup');
    socket.emit('toast', 'toast.topupOk'); sync();
  });
  socket.on('busRide', ({ to } = {}, cb) => {
    const done = r => typeof cb === 'function' && cb(r);
    if (!street || !me || street.mode === 'presentation') return done({ ok: false });
    const stops = SEED.busStops, dest = Number(to);
    const from = stops.findIndex(x => Math.abs(x - me.x) < 80);
    if (from < 0 || !Number.isInteger(dest) || !stops[dest] || dest === from) return done({ ok: false, key: 'toast.notAtStop' });
    if ((me.busCard || 0) < ECON.busFare) return done({ ok: false, key: 'toast.noBusCard' });
    me.busCard -= ECON.busFare;
    me.x = stops[dest];
    if (!posDirty.has(street.id)) posDirty.set(street.id, new Map());
    posDirty.get(street.id).set(me.id, { x: me.x, dir: me.dir });
    progress(street, me, 'rides');
    done({ ok: true, x: me.x });
    sync();
  });

  // ---------- Company vehicle: rent (daily fee) or buy (one-off + upkeep); paid to a dealer / rent-a-car on the street ----------
  socket.on('vehicle', ({ cid, mode } = {}) => {
    const c = founderOf(cid); if (!c || limited()) return;
    const V = ECON.vehicle;
    if (mode === 'buy') {
      if (c.vehicle?.type === 'own') return;
      if (c.cash < V.buyPrice) return socket.emit('toast', 'toast.noCash');
      c.cash -= V.buyPrice; R.track(c, 'expenses', V.buyPrice);
      const dealer = roleCompany(street, 'carDealer');
      if (dealer && dealer !== c) { dealer.cash += V.buyPrice; dealer.sales++; R.track(dealer, 'revenue', V.buyPrice); }
      c.vehicle = { type: 'own', since: street.day || 0 };
    } else if (mode === 'rent') {
      if (c.vehicle) return;
      c.vehicle = { type: 'rent', since: street.day || 0 };
    } else if (mode === 'none') {
      if (c.vehicle?.type === 'own') { const back = Math.round(V.buyPrice * V.resale); c.cash += back; R.track(c, 'revenue', back); }
      c.vehicle = null;
    } else return;
    if (c.vehicle) award(street, me, 'driver');
    addLog(street, 'log.vehicle', { player: me.name, modeKey: 'vehmode.' + mode, ...cParams(c) });
    sync();
  });

  // ---------- Real estate: buy the lot your company rents (sole tenant) or sell it back ----------
  socket.on('buyLot', ({ cid } = {}) => {
    const c = founderOf(cid); if (!c || limited() || c.lotId == null) return;
    const lot = street.lots[c.lotId];
    if (lot.type !== 'shop' || lot.owner || lot.companyIds.length !== 1) return socket.emit('toast', 'toast.cannotBuy');
    const price = lotPrice(street, lot);
    if (c.cash < price) return socket.emit('toast', 'toast.noCash');
    c.cash -= price; R.track(c, 'investment', 0); R.track(c, 'expenses', price);
    lot.owner = c.id; award(street, me, 'landlord');
    addLog(street, 'log.boughtLot', { player: me.name, size: lot.size, ...cParams(c) });
    sync();
  });
  socket.on('sellLot', ({ cid } = {}) => {
    const c = founderOf(cid); if (!c || limited() || c.lotId == null) return;
    const lot = street.lots[c.lotId];
    if (lot.owner !== c.id) return;
    const price = Math.round(lotPrice(street, lot) * 0.9);
    c.cash += price; R.track(c, 'revenue', price); lot.owner = null;
    sync();
  });

  // ---------- Teams (multiplayer: anyone can create; presentation: admin creates, players join) ----------
  socket.on('createTeam', ({ name, color } = {}) => {
    if (!street || !me || street.mode !== 'multiplayer' || limited()) return;
    street.teams ||= {};
    if (Object.keys(street.teams).length >= SEED.teams.max) return socket.emit('toast', 'toast.teamsFull');
    const used = Object.values(street.teams).map(t => t.color);
    const col = SEED.teams.colors.includes(color) && !used.includes(color) ? color : SEED.teams.colors.find(x => !used.includes(x));
    const nm = clean(name, 24); if (!nm || !col) return;
    const id = crypto.randomBytes(3).toString('hex');
    street.teams[id] = { id, name: nm, color: col };
    me.team = id; award(street, me, 'teamPlayer');
    addLog(street, 'log.teamCreated', { player: me.name, team: nm });
    sync();
  });
  socket.on('joinTeam', ({ teamId } = {}) => {
    const tm = street?.teams?.[teamId]; if (!tm || me.team === teamId) return;
    me.team = teamId; award(street, me, 'teamPlayer');
    addLog(street, 'log.teamJoined', { player: me.name, team: tm.name });
    sync();
  });
  socket.on('leaveTeam', () => { if (!me?.team) return; me.team = null; sync(); });

  // ---------- Demo Day ----------
  socket.on('pitchGet', ({ cid } = {}, cb) => {
    const c = street?.companies[cid]; if (!c || typeof cb !== 'function') return;
    cb({ canvas: c.canvas || {}, pitch: c.pitch || '', readiness: readiness(street, c), offer: c.offer || null,
      cooldowns: { demo: c.demoAt != null ? c.demoAt + SEED.demoDay.demoCooldown : 0, angel: c.angelAt != null ? c.angelAt + SEED.demoDay.angelCooldown : 0 }, granted: !!c.granted, day: street.day || 0 });
  });
  socket.on('saveCanvas', ({ cid, canvas, pitch } = {}) => {
    const c = founderOf(cid); if (!c || limited()) return;
    if (canvas && typeof canvas === 'object') { c.canvas ||= {}; for (const k of CANVAS_KEYS) if (typeof canvas[k] === 'string') c.canvas[k] = clean(canvas[k], SEED.demoDay.canvasMax); }
    if (typeof pitch === 'string') c.pitch = clean(pitch, SEED.demoDay.pitchMax);
    socket.emit('toast', 'toast.saved'); sync();
  });
  socket.on('pitchEvent', ({ cid, kind } = {}, cb) => {
    const done = r => typeof cb === 'function' && cb(r);
    const c = founderOf(cid); if (!c || limited()) return done({ ok: false });
    const D = SEED.demoDay, day = street.day || 0, r = readiness(street, c);
    if (kind === 'grant') {
      if (c.granted) return done({ ok: false, key: 'demo.grantUsed', ...r });
      const age = day - (c.fin?.foundedDay ?? day);
      if (age < D.grantMinDays || canvasFilled(c) < D.grantMinBlocks) return done({ ok: false, key: 'demo.grantRejected', need: { days: D.grantMinDays, blocks: D.grantMinBlocks }, age, ...r });
      c.granted = true; c.cash += D.grantAmount; R.track(c, 'investment', D.grantAmount);
      award(street, me, 'grantee'); addLog(street, 'log.grant', { player: me.name, amount: D.grantAmount, ...cParams(c) });
      sync(); return done({ ok: true, key: 'demo.grantOk', amount: D.grantAmount, ...r });
    }
    const isDemo = kind === 'demoday';
    if (kind !== 'demoday' && kind !== 'angel') return done({ ok: false });
    const lastAt = isDemo ? c.demoAt : c.angelAt, cd = isDemo ? D.demoCooldown : D.angelCooldown;
    if (lastAt != null && day < lastAt + cd) return done({ ok: false, key: 'demo.cooldown', days: lastAt + cd - day, ...r });
    if (isDemo) c.demoAt = day; else c.angelAt = day;
    award(street, me, 'pitcher');
    if (r.score < (isDemo ? D.demoMin : D.angelMin)) { sync(); return done({ ok: false, key: 'demo.noOffer', ...r }); }
    // offer: equity 10-20% (demo day) or 5-10% (angel), priced at the readiness-based valuation
    const equity = isDemo ? Math.round(20 - (r.score - D.demoMin) / 4) : Math.round(10 - (r.score - D.angelMin) / 11);
    const amount = Math.round(r.valuation * Math.max(isDemo ? 10 : 5, equity) / 100 * (isDemo ? 1 : 0.6));
    c.offer = { id: crypto.randomBytes(4).toString('hex'), kind, amount, equity: Math.max(isDemo ? 10 : 5, equity), until: day + D.offerDays, valuation: r.valuation };
    sync(); done({ ok: true, key: 'demo.offer', offer: c.offer, ...r });
  });
  socket.on('offerReply', ({ cid, offerId, accept } = {}) => {
    const c = founderOf(cid); if (!c?.offer || c.offer.id !== offerId) return;
    if (accept && (street.day || 0) <= c.offer.until) {
      c.cash += c.offer.amount; c.npcEquity = (c.npcEquity || 0) + c.offer.equity; R.track(c, 'investment', c.offer.amount);
      award(street, me, 'funded'); addLog(street, 'log.funded', { player: me.name, amount: c.offer.amount, equity: c.offer.equity, ...cParams(c) });
    }
    c.offer = null; sync();
  });

  // Latency probe for the in-game status panel
  socket.on('latency', (cb) => typeof cb === 'function' && cb(Date.now()));

  socket.on('startOnline', () => socket.emit('toast', 'toast.onlineLocked'));

  socket.on('found', ({ lotId, workspace, name, templateIdx, custom, ownership } = {}) => {
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
    currentStreetForDeposit = street;
    const buying = ownership === 'buy' && lot && ws === 'shop' && lot.companyIds.length === 0 && !lot.owner;
    const deposit = buying ? lotPrice(street, lot) : depositFor(ws, lot);
    if (me.coins < deposit) return socket.emit('toast', 'toast.noCoins');
    const cid = crypto.randomUUID();
    me.coins -= deposit;
    street.companies[cid] = makeCompany({ id: cid, name: clean(name) || customLabel || null, nameKey: tpl.key, workspace: ws,
      lotId: lot ? lot.id : null, founders: [me.id], cash: deposit, price: tpl.price, isNpc: false });
    street.companies[cid].sector = tpl.sector;
    if (buying) { lot.owner = cid; street.companies[cid].cash = 0; award(street, me, 'landlord'); addLog(street, 'log.boughtLot', { player: me.name, size: lot.size, ...cParams(street.companies[cid]) }); }
    award(street, me, 'firstCompany');
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
    progress(street, me, 'invest'); award(street, me, 'investor');
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
    addDelivery(street, c, 1);
    progress(street, me, 'sales'); progress(street, me, 'revenue', value);
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
      const mix = c.staffMix || { blue: c.npcStaff || 0, grey: 0, white: 0 };
      const npcSalaries = Object.entries(mix).reduce((sum, [k, n]) => sum + n * ECON.collars[k].salary, 0);
      const fuel = Math.round(c.fuelAcc || 0); c.fuelAcc = (c.fuelAcc || 0) - fuel;
      const vehicle = Math.round(vehicleDaily(c));
      if (c.vehicle?.type === 'rent') { const rac = roleCompany(st, 'rentACar'); if (rac && rac !== c) { rac.cash += vehicle; R.track(rac, 'revenue', vehicle); } }
      if (fuel) R.track(c, 'fuel', fuel);
      if (c.lotId != null) {
        const lot = st.lots[c.lotId], owner = lot.owner && lot.owner !== c.id ? st.companies[lot.owner] : null;
        if (owner && lot.type === 'shop') { const r = Math.ceil(lotRent(st, lot) / Math.max(1, lot.companyIds.length)); owner.cash += r; R.track(owner, 'revenue', r); }
      }
      const cost = costPerTick(st, c) + c.employees.length * (SEED.salary + c.benefitCost) + npcSalaries + fuel + vehicle;
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
        const factor = Object.entries(mix).reduce((sum, [k, n]) => sum + n * ECON.collars[k].factor, 0);
        const income = Math.round(factor * c.price * WS[c.workspace].salesMult * c.performance * incomeMult(st, c));
        c.cash += income; R.track(c, 'revenue', income); R.track(c, 'units', c.npcStaff);
        addDelivery(st, c, c.npcStaff);
      }
      if (c.marketing && !marketingActive(st, c)) c.marketing = null;
    }
    R.closeDay(st);
    st.tickAt = Date.now();
    for (const c of Object.values(st.companies)) {
      if (c.crisis && !crisisActive(st, c)) { addLog(st, 'log.crisisOver', cParams(c)); c.crisis = null; c.founders.forEach(pid => award(st, st.players[pid], 'survivor')); }
      const fl = floorsOf(st, c);
      c.founders.forEach(pid => { const p = st.players[pid]; if (!p) return; if (fl >= 3) award(st, p, 'floor3'); if (fl >= 6) award(st, p, 'floor6'); if (c.cash >= 10000) award(st, p, 'tycoon'); });
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
const auth = createAuth({ adminEmail: process.env.ADMIN_EMAIL, bootstrapPassword: ADMIN_TOKEN });
if (!auth.configured) console.warn('ADMIN_EMAIL is not set: admin login is disabled until it is added to .env');
const isLocked = ip => { const f = failedAuth.get(ip); return !!(f && f.until > Date.now()); };
const failAuth = ip => { const f = failedAuth.get(ip); const count = (f?.count || 0) + 1; failedAuth.set(ip, { count, until: count >= 5 ? Date.now() + 15 * 60_000 : 0 }); };
// Admin socket + HTTP API accept only a logged-in session whose password has already been changed
function checkToken(ip, token) {
  if (isLocked(ip)) return 'locked';
  const s = auth.session(token);
  if (s && !s.mustChange) return 'ok';
  if (s?.mustChange) return 'mustChange';
  failAuth(ip);
  return 'unauthorized';
}
// ---------- ADMIN LOGIN (email + password, forced change on first login) ----------
const authApi = express.Router();
authApi.use(express.json({ limit: '4kb' }));
authApi.post('/login', (req, res) => {
  if (isLocked(req.ip)) return res.status(429).json({ error: 'locked' });
  const r = auth.login(req.body?.email, req.body?.password);
  if (!r) { failAuth(req.ip); return res.status(401).json({ error: 'invalid' }); }
  failedAuth.delete(req.ip);
  audit('login', r.mustChange ? 'first login (password change required)' : 'ok');
  res.json(r);
});
authApi.post('/password', (req, res) => {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  const r = auth.changePassword(token, req.body?.newPassword);
  if (r !== 'ok') return res.status(r === 'unauthorized' ? 401 : 400).json({ error: r, min: auth.MIN_PASSWORD });
  audit('passwordChanged', 'admin');
  res.json({ ok: true });
});
authApi.post('/logout', (req, res) => { auth.logout((req.headers.authorization || '').replace(/^Bearer\s+/i, '')); res.json({ ok: true }); });
app.use('/admin/auth', authApi);
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
adminApi.get('/session-report', (req, res) => {
  const st = rooms[clean(req.query.room, 20)];
  if (!st) return res.status(404).json({ error: 'room not found' });
  const rows = Object.values(st.companies).filter(c => !c.isNpc).map(c => ({
    company: c.name || c.nameKey, founders: c.founders.map(id => (st.players[id] || st.pastPlayers?.[id])?.name || '?').join(', '),
    canvas: canvasFilled(c), pitchWords: (c.pitch || '').trim().split(/\s+/).filter(Boolean).length, cash: c.cash, sales: c.sales,
    status: R.analyze(c, st.day || 0).status, readiness: readiness(st, c).score, funded: !!(c.npcEquity || c.offer) }));
  const d = R.sessionData(st, rows);
  if (req.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="session-${st.id}-${Date.now()}.csv"`);
    return res.send(R.sessionCSV(d));
  }
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(R.sessionHTML(d));
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
        presentation: publicPresentation(st) || null, chat: (st.chat || []).slice(-30), city: cityOf(st), teams: st.teams || {},
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

  socket.on('createRoom', ({ mode, pin, city } = {}) => {
    const id = newRoomId(), m = mode === 'presentation' ? 'presentation' : 'multiplayer';
    rooms[id] = createStreet(id, m, pinOrRandom(pin), city);
    if (m === 'presentation') rooms[id].presentation = { spotlight: 'auto', chatLocked: false, actionsLocked: false, muted: {}, poll: null };
    audit('createRoom', `${id} (${m})`); push();
  });
  socket.on('adminCreateTeam', ({ roomId, name } = {}) => {
    const st = room(roomId); if (!st) return;
    st.teams ||= {};
    const used = Object.values(st.teams).map(t => t.color), col = SEED.teams.colors.find(x => !used.includes(x)), nm = clean(name, 24);
    if (!nm || !col || Object.keys(st.teams).length >= SEED.teams.max) return;
    const id = crypto.randomBytes(3).toString('hex');
    st.teams[id] = { id, name: nm, color: col };
    audit('createTeam', `${st.id}: ${nm}`); syncRoom(st); push();
  });
  socket.on('adminDeleteTeam', ({ roomId, teamId } = {}) => {
    const st = room(roomId); if (!st?.teams?.[teamId]) return;
    delete st.teams[teamId];
    Object.values(st.players).forEach(p => { if (p.team === teamId) p.team = null; });
    audit('deleteTeam', `${st.id}: ${teamId}`); syncRoom(st); push();
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
    (st.presentation.pollHistory ||= []).push(...(st.presentation.poll ? [st.presentation.poll] : [])); st.presentation.pollHistory.splice(0, Math.max(0, st.presentation.pollHistory.length - 20));
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
    const fresh = createStreet(st.id, st.mode, st.pin, st.city);
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
