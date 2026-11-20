// server.js
// npm install
// ADMIN_TOKEN=a-long-random-secret npm start
// Game: http://localhost:3000   Admin: http://localhost:3000/admin.html
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

// Load .env if present (Node >= 20.12 built-in, no dotenv dependency)
try { if (typeof process.loadEnvFile === 'function') process.loadEnvFile(path.join(__dirname, '.env')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
const R = require('./reports');
const ADS = require('./ads');
const PITCH = require('./pitch');
const CRM = require('./crm');
const PLAN = require('./planner');
const ERP = require('./erp');
const TOOLS = require('./osTools');
const CONTENT = require('./content');
TOOLS.setCatalog(CONTENT.read('open-source-tools'));
const { createAuth } = require('./auth');
const ECON = require('./economy').build(25); // 25 coins = blue-collar daily employer cost (2026 minimum wage)

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;
if (!ADMIN_TOKEN || ADMIN_TOKEN.length < 12) { console.error('ADMIN_TOKEN env (min 12 chars) is required'); process.exit(1); }

const app = express();
app.set('trust proxy', 1); // behind nginx: req.ip = real client (rate limits)
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
// building content (Open Source catalog, Grants, GamFed): admin override first, committed default otherwise
app.get('/data/:name.json', (req, res, next) => { const doc = CONTENT.NAMES.includes(req.params.name) ? CONTENT.read(req.params.name) : null; if (!doc) return next(); res.set('Cache-Control', 'no-cache'); res.json(doc); });
// Sprint 28: GamFed boards shared by link (read-only page /b/:id)
const BOARDS = require('./boards');
const boardApi = express.Router(); boardApi.use(express.json({ limit: '40kb' }));
boardApi.post('/', (req, res) => { if (!BOARDS.allow(req.ip)) return res.status(429).json({ ok: false }); const r = BOARDS.create(req.body?.board); res.status(r ? 200 : 400).json(r ? { ok: true, ...r } : { ok: false }); });
boardApi.put('/:id', (req, res) => { if (!BOARDS.allow(req.ip)) return res.status(429).json({ ok: false }); const ok = /^[a-z0-9]{8}$/.test(req.params.id) && BOARDS.update(req.params.id, String(req.body?.editKey || ''), req.body?.board); res.status(ok ? 200 : 403).json({ ok: !!ok }); });
boardApi.get('/:id', (req, res) => { const b = /^[a-z0-9]{8}$/.test(req.params.id) ? BOARDS.get(req.params.id) : null; if (!b) return res.status(404).json({ ok: false }); res.set('Cache-Control', 'no-cache'); res.json({ ok: true, ...b }); });
app.use('/api/boards', boardApi);
// Sprint 31: accounts (email + password). Sessions are bearer tokens kept in the browser's localStorage.
const ACC = require('./accounts');
const accApi = express.Router(); accApi.use(express.json({ limit: '4kb' }));
const bearer = req => String(req.headers.authorization || '').replace(/^Bearer /, '');
const answer = (res, r) => res.status(r.ok ? 200 : (r.error === 'rate' || r.error === 'locked' ? 429 : r.error === 'auth' ? 401 : 400)).json(r);
accApi.post('/register', (req, res) => answer(res, ACC.register(req.body || {}, req.ip)));
accApi.post('/login', (req, res) => answer(res, ACC.login(req.body || {}, req.ip)));
accApi.post('/reset', (req, res) => answer(res, ACC.reset(req.body || {}, req.ip)));
accApi.post('/logout', (req, res) => { ACC.logout(bearer(req)); res.json({ ok: true }); });
accApi.post('/delete', (req, res) => answer(res, ACC.remove(bearer(req), req.body?.password, req.ip)));
accApi.get('/me', (req, res) => { const a = ACC.fromToken(bearer(req)); if (!a) return res.status(401).json({ ok: false }); res.json({ ok: true, account: ACC.publicAcc(a), board: a.profile.board, share: a.profile.share }); });
accApi.put('/board', express.json({ limit: '40kb' }), (req, res) => { const a = ACC.fromToken(bearer(req)); if (!a) return res.status(401).json({ ok: false }); const b = BOARDS.clean(req.body?.board); const sh = req.body?.share; ACC.setBoard(a.id, b, sh && typeof sh.id === 'string' && /^[a-z0-9]{8}$/.test(sh.id) && typeof sh.editKey === 'string' ? { id: sh.id, editKey: sh.editKey.slice(0, 40) } : null); res.json({ ok: true }); });
app.use('/api/account', accApi);
app.get('/b/:id', (req, res) => res.sendFile(path.join(__dirname, 'public', 'board.html')));
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
  busStops: [697, 1430, 2406, 3382, 5298],   // world x of bus stops (gaps between buildings, mirrored by the client)
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
    'commuter', 'teamPlayer', 'teamGoal', 'streak7', 'seasonStar', 'trader', 'partner', 'exit', 'questHero', 'survivor', 'investor', 'tycoon', 'landlord', 'driver', 'pitcher', 'funded', 'grantee', 'hobbyist', 'scholar', 'closer', 'stockMaster', 'stackPro'],
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
    'locked.apartment', 'locked.skyscraper', 'locked.marketResearch', 'locked.competitor',
    'locked.voiceChat', 'locked.videoMeeting']
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
const WORLD_MAX_X = 6650; // client street width (incl. car park and bus terminal at the end)
const SPAWN_X = 370;     // in front of the guide building
const clean = (s, max = 40) => String(s ?? '').replace(/[<>]/g, '').trim().slice(0, max);
const cParams = c => (c.name ? { company: c.name } : { companyKey: c.nameKey });
const addLog = (st, key, params = {}) => { st.log.unshift({ at: Date.now(), day: st.day || 0, key, params }); st.log.length = Math.min(st.log.length, 80); };
// Compact company view for clients: last 30 days + last 12 months (full history stays on the server for reports)
// Lite company view in every snapshot: only today / last day / this month. History is fetched on demand ('finHistory').
const publicCompany = (c, monthKey) => {
  const f = c.fin || {}, d = f.daily || [];
  const recent = d.slice(-30);
  const { canvas, pitch, crm, plan, erp, ...rest } = c; // heavy data is fetched on demand ('pitchGet', 'crmGet')
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
  team: p.team || null, busCard: p.busCard || 0, badges: Object.keys(p.badges || {}), quests: p.quests?.list || [], counters: p.counters || {}, streak: p.streak?.n || 0, bestStreak: p.streak?.best || 0, season: p.season?.key === todayKey().slice(0, 7) ? p.season.sp : 0, chest: !!p.quests?.chest && p.quests.day === todayKey(), life: publicLife(p), loc: p.loc?.cid || null, afk: !!p.afk, drive: p.drive?.cid || null });
const snapshot = st => ({ id: st.id, mode: st.mode, day: st.day || 0, calendar: st.day ? R.calendar(st.day) : null,
  players: Object.fromEntries(Object.entries(st.players).map(([id, p]) => [id, publicPlayer(p)])),
  companies: Object.fromEntries(Object.entries(st.companies).map(([id, c]) => [id, { ...publicCompany(c, R.calendar((st.day || 0) + 1).monthKey), bills: utilityBills(st, c), vehicleValue: vehicleValue(st, c) }])),
  presentation: publicPresentation(st) || null,
  flats: (st.flats || []).map(f => ({ id: f.id, name: f.name, open: !!f.open })), classroom: st.classroom?.on ? { title: st.classroom.title, assignments: st.classroom.assignments } : null,
  city: cityOf(st), teams: st.teams || {}, tickAt: st.tickAt, speed: st.speed || 1, ownerId: st.ownerId || null, ads: publicAds(st), serverNow: Date.now(), goal: publicGoal(st), event: EVT.active(st) ? { id: st.event.id, until: st.event.until, tone: EVT.EVENTS[st.event.id].tone, income: EVT.EVENTS[st.event.id].income, bills: EVT.EVENTS[st.event.id].bills } : null, week: { n: Math.floor((st.day || 0) / 7) + 1, left: 7 - ((st.day || 0) % 7), scores: weekScores(st).slice(0, 5), last: st.lastWeek || null },
  lots: st.lots.map(l => ({ ...l, rent: lotRent(st, l), price: lotPrice(st, l) })), log: st.log, ideas: st.ideas });
// ---------- PREMIUM FLAGS (Sprint 16): admin switches Premium features on/off globally; persisted in data/premium.json ----------
// 'live' features change gameplay now; 'soon' features are only listed (voice/video arrive in Sprints 18-19) and cannot be switched on yet.
const PREMIUM_FEATURES = [
  { key: 'cities', live: true }, { key: 'voiceChat', live: false }, { key: 'videoMeeting', live: false }, { key: 'mediaIdeas', live: false }, { key: 'onlineMode', live: false }];
const PREMIUM_FILE = path.join(__dirname, 'data', 'premium.json');
const PREMIUM = Object.fromEntries(PREMIUM_FEATURES.map(f => [f.key, false]));
for (const c of ECON.cityMap) c.baseStatus = c.status;
function applyPremium() { for (const c of ECON.cityMap) if (c.baseStatus === 'premium') c.status = PREMIUM.cities ? 'open' : 'premium'; }
function loadPremium() {
  try { const d = JSON.parse(fs.readFileSync(PREMIUM_FILE, 'utf8')); for (const f of PREMIUM_FEATURES) if (f.live && d[f.key] === true) PREMIUM[f.key] = true; } catch { /* first run */ }
  applyPremium();
}
function savePremium() { try { fs.mkdirSync(path.dirname(PREMIUM_FILE), { recursive: true, mode: 0o700 }); fs.writeFileSync(PREMIUM_FILE, JSON.stringify(PREMIUM), { mode: 0o600 }); } catch (e) { console.warn('premium save failed:', e.message); } }
loadPremium();

// ---------- TOOLS BALANCE CONFIG (Sprint 21c): admin can tune the open-source tools economy; persisted in data/tools-config.json ----------
const TOOLS_CFG_FILE = path.join(__dirname, 'data', 'tools-config.json');
try { TOOLS.setConfig(JSON.parse(fs.readFileSync(TOOLS_CFG_FILE, 'utf8'))); } catch { /* defaults */ }
function saveToolsCfg() { try { fs.mkdirSync(path.dirname(TOOLS_CFG_FILE), { recursive: true, mode: 0o700 }); fs.writeFileSync(TOOLS_CFG_FILE, JSON.stringify(TOOLS.CFG), { mode: 0o600 }); } catch (e) { console.warn('tools config save failed:', e.message); } }

// ---------- BALANCE CONFIG (Sprint 25): price elasticity, level-up reward, weekly race; admin-tunable, persisted in data/balance-config.json ----------
const BAL = require('./balance');
const EVT = require('./events');
const GOALS = require('./goals');
const MKT = require('./market');
const MKT_FILE = path.join(__dirname, 'data', 'market-config.json');
try { MKT.setConfig(JSON.parse(fs.readFileSync(MKT_FILE, 'utf8'))); } catch { /* defaults */ }
function saveMarketCfg() { try { fs.mkdirSync(path.dirname(MKT_FILE), { recursive: true, mode: 0o700 }); fs.writeFileSync(MKT_FILE, JSON.stringify(MKT.CFG), { mode: 0o600 }); } catch (e) { console.warn('market config save failed:', e.message); } }
const EVT_FILE = path.join(__dirname, 'data', 'events-config.json');
try { EVT.setConfig(JSON.parse(fs.readFileSync(EVT_FILE, 'utf8'))); } catch { /* defaults */ }
function saveEventsCfg() { try { fs.mkdirSync(path.dirname(EVT_FILE), { recursive: true, mode: 0o700 }); fs.writeFileSync(EVT_FILE, JSON.stringify(EVT.state()), { mode: 0o600 }); } catch (e) { console.warn('events config save failed:', e.message); } }
const BAL_FILE = path.join(__dirname, 'data', 'balance-config.json');
try { BAL.setConfig(JSON.parse(fs.readFileSync(BAL_FILE, 'utf8'))); } catch { /* defaults */ }
function saveBalanceCfg() { try { fs.mkdirSync(path.dirname(BAL_FILE), { recursive: true, mode: 0o700 }); fs.writeFileSync(BAL_FILE, JSON.stringify(BAL.CFG), { mode: 0o600 }); } catch (e) { console.warn('balance config save failed:', e.message); } }

const publicEconomy = () => ({ rate: ECON.rate, data: ECON.data, collars: ECON.collars, vehicle: ECON.vehicle, busFare: ECON.busFare,
  busTopups: ECON.busTopups, deliveryKm: ECON.deliveryKm, cities: ECON.cities, cityMap: ECON.cityMap, intercity: ECON.intercity, life: ECON.life, tax: ECON.tax });
const publicAdConfig = () => ({ kinds: ADS.KINDS, maxBoost: ADS.MAX_BOOST, maxSlots: ADS.MAX_SLOTS_PER_COMPANY, limits: ADS.LIMITS });
const publicSeed = () => ({ economy: publicEconomy(), startCoins: SEED.startCoins, tickSeconds: SEED.tickSeconds, busStops: SEED.busStops,
  teamColors: SEED.teams.colors, quests: SEED.quests, badges: SEED.badges, salary: SEED.salary, custom: SEED.custom, departments: SEED.departments, marketing: SEED.marketing, itUpgrade: SEED.itUpgrade, npcTalk: { serviceCost: SEED.npcTalk.serviceCost, ids: SEED.npcTalk.ids }, tutorial: SEED.tutorial, templates: SEED.templates, locked: SEED.lockedFeatures,
  lotSizes: SEED.lotSizes, workspaces: SEED.workspaces, benefits: SEED.benefits, modes: MODES, ads: publicAdConfig(), premium: PREMIUM, taxi: { ...TAXI, pxPerKm: PX_PER_KM } });
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

// ---------- Advertising (Sprint 9) ----------
// A slot is claimed by a company (or by the admin). Every creative is moderated: it goes live only after admin approval.
const adCtx = st => ({ busStops: SEED.busStops.length, lots: st.lots.length });
const adSlot = (st, id) => ADS.parseSlot(id, adCtx(st));
const adState = (st, id) => (st.ads[id] ||= { owner: null, live: null, pending: null, rejected: null });
const ownedSlots = (st, cid) => Object.entries(st.ads).filter(([, a]) => a.owner === cid).map(([id]) => id);
// Live ads of a company raise its sales a little (capped); reach grows with how many places show it
function adBoost(st, c) {
  if (c.isNpc || !st.ads) return 0;
  let b = 0;
  for (const [id, a] of Object.entries(st.ads)) { if (a.owner !== c.id || !a.live) continue; const s = adSlot(st, id); if (s) b += s.boost; }
  return Math.min(ADS.MAX_BOOST, b) * (1 + TOOLS.effectOf(c, 'brandReach'));   // brand tools amplify paid ads
}
const publicAds = st => Object.fromEntries(Object.entries(st.ads).filter(([, a]) => a.owner).map(([id, a]) => [id,
  { owner: a.owner, live: a.live, pending: !!a.pending, rejected: a.rejected || null }]));
// Daily rent for every claimed slot; slots of closed companies are freed
function billAds(st) {
  for (const [id, a] of Object.entries(st.ads)) {
    if (!a.owner || a.owner === 'admin') continue;
    const c = st.companies[a.owner], s = adSlot(st, id);
    if (!c || c.status !== 'active' || !s) { delete st.ads[id]; continue; }
    c.cash -= s.price; R.track(c, 'expenses', s.price); R.track(c, 'advertising', s.price);
  }
}

// ---------- Taxes, accounting and shop utility bills (Sprint 8b) ----------
const ACC_LEVELS = ['none', 'basic', 'pro'];
const accountantOf = c => ECON.tax.accountant[ACC_LEVELS.includes(c.accountant) ? c.accountant : 'none'];
// Progressive income tax on a yearly profit (coins); brackets are real ₺ amounts converted with the game rate
function incomeTaxCoins(profitCoins) {
  const rate = ECON.rate, tl = Math.max(0, profitCoins) * rate; let tax = 0, lower = 0;
  for (const b of ECON.tax.brackets) { const upper = b.limit ?? Infinity; if (tl > lower) tax += (Math.min(tl, upper) - lower) * b.rate; lower = upper; }
  return tax / rate;
}
const UTILITIES = ['electricity', 'water', 'gas', 'internet'];
const UTIL_SHARE = { electricity: 0.45, water: 0.10, gas: 0.25, internet: 0.20 };   // split of the old "30% of rent" utility lump
const utilOn = c => ({ electricity: true, water: true, gas: true, internet: true, ...(c.utilities || {}) });
const isWinter = month => month >= 11 || month <= 3;
// Per-day bills of a shop: each utility = fixed subscription (60%) + variable use (40%, grows with headcount); gas is seasonal
function utilityBills(st, c) {
  const out = { electricity: 0, water: 0, gas: 0, internet: 0, total: 0 };
  if (c.lotId == null || c.isNpc) return out;
  const lot = st.lots[c.lotId]; if (lot.type !== 'shop') return out;
  const budget = (lotRent(st, lot) * 0.3) / Math.max(1, lot.companyIds.length), on = utilOn(c);
  const month = R.calendar((st.day || 0) + 1).month, heads = c.founders.length + c.employees.length + (c.npcStaff || 0), activity = Math.min(2, 0.6 + 0.2 * heads);
  let sum = 0;
  for (const k of UTILITIES) {
    if (!on[k]) continue;
    const share = budget * UTIL_SHARE[k], season = k === 'gas' ? (isWinter(month) ? 1.8 : 0.3) : 1;
    out[k] = Math.round((share * 0.6 + share * 0.4 * activity) * season * 100) / 100; sum += out[k];
  }
  out.total = sum > 0 ? Math.max(1, Math.ceil(sum)) : 0;
  return out;
}
// Switching a utility off saves money but hurts business (no power: almost nothing sells; no internet: -15%; ...)
function utilMult(st, c) {
  if (c.lotId == null || c.isNpc || st.lots[c.lotId].type !== 'shop') return 1;
  const on = utilOn(c), winter = isWinter(R.calendar((st.day || 0) + 1).month);
  return (on.electricity ? 1 : 0.4) * (on.internet ? 1 : 0.85) * (on.water ? 1 : 0.95) * (on.gas || !winter ? 1 : 0.9);
}
function costPerTick(st, c) {
  if (c.lotId == null) { const w = WS[c.workspace]; return w.rent + w.electricity; }
  const lot = st.lots[c.lotId];
  if (lot.type === 'coworking') return WS.coworking.rent;
  const base = lotRent(st, lot), n = Math.max(1, lot.companyIds.length);
  const rent = lot.owner === c.id ? 0 : Math.ceil(base / n);   // owners pay no rent, only utilities
  return c.isNpc ? rent + Math.ceil((base * 0.3) / n) : rent;
}
// City-based real estate: daily rent and purchase price of a lot (₺/m² converted to coins)
const cityOf = st => (ECON.cities[st.city] ? st.city : 'istanbul');
// ---------- Intercity travel (Sprint 11b): rooms of the same world are the streets of different cities ----------
const terminalX = st => 720 + 244 * st.lots.length + 2530 + 190;           // centre of the bus terminal (mirrors the client layout)
const cityMeta = key => ECON.cityMap.find(c => c.key === key);
const findCityRoom = (worldId, city) => Object.values(rooms).find(r => r.worldId === worldId && r.city === city);
function distanceKm(a, b) { // great-circle distance x road factor
  const A = cityMeta(a), B = cityMeta(b), rad = d => (d * Math.PI) / 180, R_EARTH = 6371;
  const dLat = rad(B.lat - A.lat), dLon = rad(B.lon - A.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(A.lat)) * Math.cos(rad(B.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(2 * R_EARTH * Math.asin(Math.sqrt(h)) * ECON.intercity.roadFactor);
}
// Real seconds a trip takes: game hours converted with the room's day length and speed
function tripSeconds(st, km, mode) {
  const I = ECON.intercity, hours = km / (mode === 'car' ? I.carKmh : I.busKmh) + (mode === 'car' ? 0 : I.stopHours);
  return Math.max(5, Math.min(90, Math.round((hours * (SEED.tickSeconds / 24)) / (st.speed || 1))));
}
// The sister room for a city: created on first visit, clock copied from the home street
function ensureCityRoom(home, city) {
  let st = findCityRoom(home.worldId, city); if (st) return st;
  const id = `${home.worldId}-${city}`;
  st = createStreet(id, home.mode, home.pin, city); st.worldId = home.worldId;
  st.day = home.day || 0; st.tickAt = home.tickAt; st.speed = home.speed || 1; rooms[id] = st;
  return st;
}
const lotRent = (st, lot) => ECON.lotRent(cityOf(st), lot.size);
const lotPrice = (st, lot) => ECON.lotPrice(cityOf(st), lot.size);
// ---------- AFK / offline (Sprint 13b) ----------
// While every member of a company is AFK or offline (up to 30 game days), the company still sells a little on its own:
// 6 "clicks" a day at half value. Players get a summary of what happened while they were away.
const IDLE_CLICKS = 6, IDLE_EFF = 0.5, IDLE_MAX_DAYS = 30;
function awayBaseline(st, p) {
  return { day: st.day || 0, coins: p.coins, idle: 0, cash: Object.fromEntries(Object.values(st.companies).filter(c => c.founders.includes(p.id)).map(c => [c.id, c.cash])) };
}
function awaySummary(st, p) {
  const a = p.away; if (!a) return null;
  const days = (st.day || 0) - a.day, idle = Math.round(a.idle || 0);
  if (days < 1 && !idle) return null;
  const companies = Object.values(st.companies).filter(c => c.founders.includes(p.id) && a.cash[c.id] != null)
    .map(c => ({ id: c.id, name: c.name || null, nameKey: c.name ? null : c.nameKey, delta: Math.round(c.cash - a.cash[c.id]) }));
  return { days, idle, coins: Math.round(p.coins - a.coins), companies };
}
function idleTick(st) {
  for (const c of Object.values(st.companies)) {
    if (c.isNpc || c.status !== 'active' || !WS[c.workspace]) continue;
    const members = [...c.founders, ...c.employees];
    if (members.some(id => st.players[id] && !st.players[id].afk)) continue;               // someone is actively playing
    const who = members.map(id => st.players[id] || st.pastPlayers[id]).find(p => p && (p.afk || (p.offlineSince != null && (st.day || 0) - p.offlineSince <= IDLE_MAX_DAYS)));
    if (!who) continue;
    const perf = c.employees.includes(who.id) ? c.performance : 1;
    const value = Math.max(1, Math.round(unitPrice(c) * WS[c.workspace].salesMult * perf * (1 + (who.stats.level - 1) * 0.05) * incomeMult(st, c) * lifeMult(who) * knowBonus(who) * IDLE_CLICKS * IDLE_EFF));
    c.cash += value; c.sales += IDLE_CLICKS; R.track(c, 'revenue', value); R.track(c, 'units', IDLE_CLICKS); addDelivery(st, c, IDLE_CLICKS);
    if (who.away) who.away.idle = (who.away.idle || 0) + value;
  }
}
// Player ids are socket ids: when a player comes back on a new socket, every reference in the whole world is renamed
// ---------- Apartment (Sprint 23b): every player of a room gets one flat (= one floor of the home building) ----------
// st.flats = [{ id: playerId, name, open }] in order of arrival; `open` = door open to visitors. Persisted with the room.
function ensureFlat(st, p) {
  st.flats ||= []; let f = st.flats.find(x => x.id === p.id);
  if (!f) { f = { id: p.id, name: p.name, open: true }; st.flats.push(f); } else f.name = p.name;
  return f;
}
const flatCid = ownerId => 'home:' + ownerId;
function remapPlayerId(worldId, oldId, newId) {
  for (const r of Object.values(rooms)) {
    if (r.worldId !== worldId) continue;
    const swap = arr => (Array.isArray(arr) ? arr.map(x => (x === oldId ? newId : x)) : arr);
    for (const c of [...Object.values(r.companies), ...(r.archive || [])]) {
      c.founders = swap(c.founders); c.employees = swap(c.employees);
      if (c.investors && Object.hasOwn(c.investors, oldId)) { c.investors[newId] = c.investors[oldId]; delete c.investors[oldId]; }
      if (c.partners && Object.hasOwn(c.partners, oldId)) { c.partners[newId] = c.partners[oldId]; delete c.partners[oldId]; }
      if (c.pOffers) c.pOffers.forEach(o => { if (o.to === oldId) o.to = newId; });
    }
    if (r.ownerId === oldId) r.ownerId = newId;
    for (const f of r.flats || []) if (f.id === oldId) f.id = newId;
    if (r.presentation?.muted && r.presentation.muted[oldId]) { r.presentation.muted[newId] = true; delete r.presentation.muted[oldId]; }
    delete r.pastPlayers[oldId];
  }
}
// Solo worlds are kept for a day after the player leaves if there is something to come back to (a company); empty ones vanish at once
const SOLO_TTL_MS = 24 * 3600 * 1000;
function parkWorld(worldId) {
  const mine = Object.entries(rooms).filter(([, r]) => r.worldId === worldId && r.mode === 'solo'); if (!mine.length) return;
  const progress = mine.some(([, r]) => Object.values(r.companies).some(c => !c.isNpc));
  for (const [id, r] of mine) { if (progress) r.dormantAt = Date.now(); else delete rooms[id]; }
}
setInterval(() => { const now = Date.now(); for (const [id, r] of Object.entries(rooms)) if (r.dormantAt && now - r.dormantAt > SOLO_TTL_MS) delete rooms[id]; }, 60000);

// ---------- Personal life (Sprint 12): home, personal bills, spending, hobbies, self-development ----------
// Happiness and health decay a little every game day; money spent on life keeps them up. Good shape = a small income bonus, bad shape = a malus.
const LIFE = ECON.life, HOUSING = Object.keys(LIFE.housing), UTIL_KEYS = Object.keys(LIFE.utilitiesPerDay);
const newLife = () => ({ happiness: 60, health: 80, housing: 'family', utilities: { electricity: true, water: true, gas: true, internet: true },
  hobbies: {}, courses: 0, certs: [], unpaid: 0, billAcc: 0, today: { day: -1, done: {} }, cooldowns: {} });
const ensureLife = p => (p.life ||= newLife());
const clampLife = L => { L.happiness = Math.max(0, Math.min(100, L.happiness)); L.health = Math.max(0, Math.min(100, L.health)); };
const lifeToday = (st, L) => { if (L.today.day !== (st.day || 0)) L.today = { day: st.day || 0, done: {} }; return L.today; };
const cityRentFactor = st => (ECON.cities[cityOf(st)]?.rentM2 || 850) / ECON.cities.istanbul.rentM2;   // personal rent follows the city's rent level
const hobbyLevel = pts => Math.floor(Math.sqrt(pts || 0));
const lifeMult = p => {
  const L = p?.life; if (!L) return 1;
  let m = 1; m *= L.happiness >= 70 ? 1.03 : L.happiness < 30 ? 0.9 : 1; m *= L.health >= 70 ? 1.02 : L.health < 30 ? 0.9 : 1;
  return m * (1 + 0.02 * Math.min(3, L.certs.length));
};
const knowBonus = p => 1 + Math.min(0.15, (p?.stats?.knowledge || 0) * 0.0005);
// Once per game day for every player in the street: bills, decay, comfort
function lifeTick(st, p) {
  const L = ensureLife(p), month = R.calendar((st.day || 0) + 1).month;
  let due = LIFE.housing[L.housing].perDay * cityRentFactor(st);
  // every flat has its own meters (Sprint 23b); living with family shares the bills (50 %)
  const share = L.housing === 'family' ? 0.5 : 1;
  for (const k of UTIL_KEYS) if (L.utilities[k]) due += LIFE.utilitiesPerDay[k] * share * (k === 'gas' ? (isWinter(month) ? 1.8 : 0.3) : 1);
  L.billAcc = Math.min(L.billAcc + due, due * 10);
  const pay = Math.floor(L.billAcc);
  if (pay > 0) {
    if (p.coins >= pay) { p.coins -= pay; L.billAcc -= pay; L.unpaid = 0; }
    else { L.unpaid++; L.happiness -= 5; if (L.unpaid >= 3) { L.housing = 'family'; L.unpaid = 0; L.billAcc = 0; addLog(st, 'log.evicted', { player: p.name }); } }
  }
  L.happiness += LIFE.housing[L.housing].comfort - 1.2; L.health -= 0.4;
  {
    if (!L.utilities.electricity) L.happiness -= 2;
    if (!L.utilities.internet) L.happiness -= 1;
    if (!L.utilities.water) L.health -= 2;
    if (!L.utilities.gas && isWinter(month)) L.health -= 1.5;
  }
  clampLife(L);
}
const publicLife = p => { const L = p.life; return L ? { happiness: Math.round(L.happiness), health: Math.round(L.health), housing: L.housing, utilities: L.utilities, hobbies: L.hobbies, courses: L.courses,
  certs: L.certs.length, today: L.today, cooldowns: L.cooldowns, unpaid: L.unpaid } : null; };

// ---------- Company vehicles (Sprint 10): gallery models (new / used), timed rentals, parking ----------
const VM = id => ECON.vehicle.models[id] || null;
const vehModel = v => VM(v?.model) || ECON.vehicle.models.sedan_new;
const parkFee = v => (v?.park === 'lot' ? ECON.vehicle.parkingPerDay : 0);
const vehicleDaily = c => !c.vehicle ? 0 : (c.vehicle.type === 'rent' ? ECON.vehicle.rentPerDay : vehModel(c.vehicle).upkeepPerDay) + parkFee(c.vehicle);
const vehicleFuelPerKm = c => (c.vehicle ? vehModel(c.vehicle).fuelPerKm : ECON.vehicle.courierPerKm);
const vehicleBoost = c => (c.vehicle ? vehModel(c.vehicle).boost || 0 : 0);
// Resale value of an owned car: what was paid, minus ~1% per game month down to a floor (new cars start higher than used ones)
const vehicleValue = (st, c) => {
  const v = c.vehicle; if (v?.type !== 'own') return 0;
  const m = vehModel(v), months = Math.max(0, ((st.day || 0) - (v.since || 0)) / 30);
  return Math.round(v.paid * Math.max(0.4, m.resaleBase - 0.01 * months) * (0.55 + 0.45 * ((v.cond ?? 100) / 100)));
};

// ---------- Driving (Sprint 24): the company car can be driven along the street; fuel (km of range) and condition (wear / age) are real ----------
const TAXI = { base: 1, perKm: 0.45, minFare: 2, night: 1.5, maxTries: 3, offers: [100, 85, 70, 55], accept: { 100: 1, 85: 0.8, 70: 0.45, 55: 0.15 }, cooldownMs: 15000, dealMs: 60000 };
const PX_PER_KM = 400, WEAR_PER_KM = 0.25, AGE_PER_DAY = { new: 0.05, used: 0.08 }, MIN_COND_TO_DRIVE = 5, MAX_STEP_PX = 260, BOARD_RANGE_PX = 170;
const TANK_KM = { sedan: 450, van: 380 };
function ensureVeh(st, c) {
  const v = c.vehicle; if (!v) return null; const m = vehModel(v);
  if (v.tank == null) v.tank = TANK_KM[m.body] || 420;
  if (v.fuel == null) v.fuel = v.tank;
  if (v.cond == null) v.cond = m.cond === 'new' ? 100 : 72;
  if (v.odo == null) v.odo = m.km || 0;
  if (!v.by) { const f = st.players[c.founders[0]] || st.pastPlayers?.[c.founders[0]]; v.by = { id: c.founders[0] || null, name: f?.name || c.name || '?' }; }
  return v;
}
// where the car stands (mirrors the client): its own x when parked on the street, in the car park, or at the company door
function carX(st, c) {
  const v = c.vehicle; if (!v) return null;
  if (v.park === 'street' && v.x != null) return v.x;
  if (v.park === 'lot') { const i = Math.max(0, Object.values(st.companies).filter(o => o.vehicle?.park === 'lot').indexOf(c)); return 720 + 244 * st.lots.length + 2110 + 40 + Math.min(5, i) * 60; }
  if (c.lotId == null) return 475 + 200 - 52;
  const lot = st.lots[c.lotId], k = Math.max(0, lot.companyIds.filter(id => { const o = st.companies[id]; return o?.vehicle && o.vehicle.park !== 'lot' && o.vehicle.park !== 'street'; }).indexOf(c.id));
  return 720 + 244 * c.lotId + 200 - 52 - Math.min(1, k) * 78;
}

// ---------- Taxi (Sprint 24b): hail a taxi, haggle over the fare, ride anywhere along the street ----------
const gameMinutesOf = st => { const p = Math.max(0, Math.min(1, (Date.now() - (st.tickAt || Date.now())) / (SEED.tickSeconds * 1000 / (st.speed || 1)))); return p * 1440; };
const isNightMin = m => m < 360 || m >= 1320;               // 22:00-06:00 costs more
const taxiFare = (st, fromX, toX) => Math.max(TAXI.minFare, Math.round((TAXI.base + (Math.abs(toX - fromX) / PX_PER_KM) * TAXI.perKm) * (isNightMin(gameMinutesOf(st)) ? TAXI.night : 1)));
const driverOf = (st, cid) => Object.values(st.players).find(p => p.drive?.cid === cid) || null;
const roleCompany = (st, role) => Object.values(st.companies).find(x => SEED.templates.find(t => t.key === x.nameKey)?.role === role || SEED.npcCompanies.find(n => n.key === x.nameKey)?.role === role);
// Every sale has a delivery distance (sector) -> fuel with a company vehicle, courier / taxi without one
function addDelivery(st, c, units = 1) {
  const km = (ECON.deliveryKm[c.sector] ?? 2) * units;
  if (!km) return;
  const perKm = vehicleFuelPerKm(c);
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
// ---------- Products / services (up to 8 per company, each with its own price and discount) ----------
const MAX_PRODUCTS = 8, MAX_DISCOUNT = 90;
const newPid = () => crypto.randomBytes(3).toString('hex');
const priceOk = p => Number.isInteger(p) && p >= SEED.custom.minPrice && p <= SEED.custom.maxPrice;
const discountOf = d => Math.max(0, Math.min(MAX_DISCOUNT, Math.floor(Number(d)) || 0));
function ensureProducts(c) {
  if (!c.products?.length) c.products = [{ id: 'p0', name: c.product || null, nameKey: c.nameKey || null, price: c.price, discount: 0 }];
  return c.products;
}
// Price the customer actually pays for one product (list price minus its discount)
const unitPrice = (c, pid) => { const ps = ensureProducts(c), p = ps.find(x => x.id === pid) || ps[0]; return Math.max(1, Math.round(p.price * (1 - (p.discount || 0) / 100))); };
// Sprint 17c: apply the ERP stock multiplier to a sale of `units` items; tracks revenue lost to missing stock
function stockAdjust(c, pid, units, value) {
  const ps = ensureProducts(c), id = ps.find(x => x.id === pid)?.id || ps[0].id, mult = ERP.consume(c, id, units), out = Math.max(1, Math.round(value * mult));
  if (mult < 1) ERP.book(c).lost += Math.round(value * ERP.IN_STOCK_BONUS - out);
  return out;
}
// Passive (staff) sales: average net price, plus demand: discounts raise volume (elasticity 1.5), each extra product widens the market (+5%)
function portfolio(c) {
  const ps = ensureProducts(c), n = ps.length;
  const price = ps.reduce((s, p) => s + p.price * (1 - (p.discount || 0) / 100), 0) / n;
  const avgDisc = ps.reduce((s, p) => s + (p.discount || 0), 0) / n / 100;
  return { price, demand: (1 + 1.5 * avgDisc) * (1 + 0.05 * (n - 1)) };
}
function makeCompany({ id, name, nameKey, workspace, lotId, founders, cash, price, isNpc }) {
  const c = { id, name, nameKey, workspace, lotId, founders, employees: [], investors: {}, cash, price, sales: 0,
    npcEquity: 0, isNpc, benefits: emptyBenefits(), performance: 1, benefitCost: 0, status: 'active' };
  ensureProducts(c);
  R.ensureFin(c);
  return c;
}
function createStreet(id, mode, pin, city) {
  const lots = Array.from({ length: LOTS_PER_STREET }, (_, i) => ({ id: i, ...SEED.lotPattern[i % SEED.lotPattern.length], companyIds: [] }));
  const st = { id, mode, pin: pin || null, city: ECON.cities[city] ? city : 'istanbul', teams: {}, tickAt: Date.now(), speed: 1, ownerId: null,
    players: {}, pastPlayers: {}, companies: {}, lots, ideas: [], log: [], archive: [], ads: {}, day: 0, createdAt: Date.now(), worldId: id };
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
// employees get the productivity tools bonus (Sprint 21a); founders sell at base performance
const perfFor = (c, who) => (c.employees.includes(who.id) ? c.performance * (1 + TOOLS.effectOf(c, 'employeeProductivity')) : 1);
// Sprint 25: price elasticity — the company's average unit price vs the typical price of its sector (template price, else sector reference)
function priceMult(c) {
  if (!BAL.CFG.elasticity || c.isNpc) return 1;
  const ps = c.products?.length ? c.products : [{ price: c.price, discount: 0 }];
  const avg = ps.reduce((a, p) => a + (p.price || 0) * (1 - (p.discount || 0) / 100), 0) / ps.length;
  return BAL.demandMult(avg, BAL.refPrice(SEED.templates.find(t => t.key === c.nameKey)?.price, c.sector));
}
const incomeMult = (st, c) => priceMult(c) * EVT.incomeMult(st, c) * (1 + TOOLS.effectOf(c, 'conversionRate')) * (1 + 0.5 * TOOLS.effectOf(c, 'brandReach')) * (TOOLS.effectOf(c, 'onlineSalesChannel') ? 1 + TOOLS.CFG.onlineBoost : 1) * (1 + adBoost(st, c)) * (1 + vehicleBoost(c)) * utilMult(st, c) * (crisisActive(st, c) ? CRISES[c.crisis.type].incomeMult : 1) * (marketingActive(st, c) ? 1 + (SEED.marketing.mult - 1) * (c.marketing.k || 1) : 1);
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
  const score = Math.min(100, Object.values(parts).reduce((a, b) => a + b, 0) + Math.round(TOOLS.effectOf(c, 'marketResearch') * 50));
  const yearly = Math.max(last, month.revenue || 0) * 12;
  const valuation = Math.max(5000, Math.round(yearly * 3 + Math.max(0, c.cash)));
  return { score, parts, valuation };
}
function applyCrisis(st, c, type) {
  const cr = CRISES[type];
  const shield = type === 'cyberAttack' ? Math.max(0.2, 1 - (c.security || 0) * SEED.itUpgrade.cyberShield - TOOLS.effectOf(c, 'securityLevel')) : 1;
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
// Sprint 27: real-day streak (kept on the player record, so it survives as long as the room/token does), daily chest, monthly season points
const SEASON_MS = [[100, 1], [250, 2], [500, 4]];
const dayBefore = key => new Date(Date.parse(key + 'T12:00:00Z') - 864e5).toISOString().slice(0, 10);
function rollStreak(p, day) {
  const prev = p.streak?.last;
  if (prev === day) return;
  const n = prev && prev === dayBefore(day) ? (p.streak.n || 0) + 1 : 1;
  p.streak = { last: day, n, best: Math.max(n, p.streak?.best || 0) };
  const coins = Math.round(Math.min(n, 7) * BAL.CFG.streakCoin);
  if (coins && p.id) { p.coins += coins; io.to(p.id).emit('streak', { n, coins }); }
  if (n >= 7) award(null, p, 'streak7');
}
function addSeason(p, sp) {
  const key = todayKey().slice(0, 7);
  if (p.season?.key !== key) p.season = { key, sp: 0, got: [] };
  const before = p.season.sp; p.season.sp += sp;
  for (const [need, k] of SEASON_MS) if (before < need && p.season.sp >= need && !p.season.got.includes(need)) {
    p.season.got.push(need); const coins = Math.round(BAL.CFG.seasonReward * k); p.coins += coins; io.to(p.id).emit('seasonMilestone', { sp: need, coins });
    if (need >= 500) award(null, p, 'seasonStar');
  }
}
function ensureQuests(st, p) {
  const day = todayKey();
  if (p.quests?.day === day) return p.quests;
  rollStreak(p, day);
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
  if (st) addLog(st, 'log.badge', { player: p.name, badgeKey: 'badge.' + id });
  io.to(p.id).emit('badge', { id });
}
// Sprint 25: level-up reward = levelCoins x new level (personal coins); checked after progress events and every tick
function checkLevel(p) {
  if (!p?.stats) return;
  p.rewardedLevel ??= p.stats.level; // existing players are not back-paid
  while (p.rewardedLevel < p.stats.level) {
    p.rewardedLevel++;
    const coins = Math.round(BAL.CFG.levelCoins * p.rewardedLevel);
    p.coins += coins; io.to(p.id).emit('levelUp', { level: p.rewardedLevel, coins });
  }
}
// Sprint 30: classroom mode — the room owner (teacher) sets assignments; students' progress = counter delta since the assignment was created
const CLASS_METRICS = ['sales', 'revenue', 'hire', 'invest', 'campaign', 'met', 'rides', 'taxiRides', 'quests', 'trades', 'topup', 'npcSale'];
const classProgress = (a, p) => Math.max(0, Math.round((p.counters?.[a.metric] || 0) - (a.base?.[p.id] || 0)));
function classCheck(st, p) {
  for (const a of st.classroom?.assignments || []) {
    p.classDone ||= {}; if (p.classDone[a.id] != null) continue;
    if (a.until != null && (st.day || 0) >= a.until) continue;
    if (classProgress(a, p) < a.goal) continue;
    p.classDone[a.id] = st.day || 0;
    if (a.reward) { p.coins += a.reward; }
    p.stats.xp += 5; p.stats.level = levelOf(p.stats.xp);
    io.to(p.id).emit('classDone', { title: a.title, reward: a.reward || 0 });
  }
}
function progress(st, p, metric, amount = 1) {
  if (!p) return;
  checkLevel(p);
  p.counters ||= {};
  p.counters[metric] = (p.counters[metric] || 0) + amount;
  const n = p.counters[metric];
  if (st.classroom?.on) classCheck(st, p);
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
      addSeason(p, 10);
      const qs = ensureQuests(st, p);
      if (!qs.chest && qs.list.every(x => x.done)) { qs.chest = true; p.coins += Math.round(BAL.CFG.chestCoins); addSeason(p, 25); io.to(p.id).emit('chest', { coins: Math.round(BAL.CFG.chestCoins), sp: 25 }); }
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
// Positions inside buildings (company interiors) are batched the same way: [id, companyId, floor, x, dir]
const innerDirty = new Map(); // roomId -> Map(playerId -> loc)
setInterval(() => {
  for (const [rid, m] of innerDirty) if (rooms[rid] && m.size) io.to(rid).volatile.emit('innerBatch', [...m].map(([id, l]) => [id, l.cid, l.floor, l.x, l.dir]));
  innerDirty.clear();
}, 100);

// Sprint 31: bind a logged-in account to a player: profile (badges, streak, season, best week) follows the account across rooms
function hydrateFromAccount(p, accountId) {
  const prof = ACC.profileOf(accountId); if (!prof) return;
  p.accountId = accountId;
  p.badges = { ...prof.badges, ...(p.badges || {}) };
  if (prof.streak && p.streak) {
    const ps = p.streak, as = prof.streak, best = Math.max(ps.best || 0, as.best || 0);
    if (as.last === ps.last) p.streak = { last: ps.last, n: Math.max(ps.n, as.n), best };
    else if (as.last === dayBefore(ps.last) && ps.n <= 1) { const n = as.n + 1; p.streak = { last: ps.last, n, best: Math.max(best, n) }; }   // played yesterday on the account, today is the next day
    else p.streak = as.last > ps.last ? { ...as, best } : { ...ps, best };
  } else if (prof.streak) p.streak = { ...prof.streak };
  if (prof.season && (!p.season || prof.season.key >= p.season.key)) p.season = { key: prof.season.key, sp: Math.max(prof.season.sp, p.season?.key === prof.season.key ? p.season.sp : 0), got: [...new Set([...(prof.season.got || []), ...(p.season?.key === prof.season.key ? p.season.got || [] : [])])] };
  p.bestWeek = Math.max(p.bestWeek || 0, prof.bestWeek || 0);
}
const syncToAccount = p => { if (p?.accountId) ACC.mergeProfile(p.accountId, { badges: p.badges, streak: p.streak, season: p.season, bestWeek: p.bestWeek }); };

// ---------- GAME SOCKETS ----------
io.on('connection', socket => {
  let street = null, me = null, lastAction = 0, lastMove = 0, pinFails = 0;
  const limited = () => {
    if (street?.presentation?.actionsLocked) { socket.emit('toast', 'toast.actionsLocked'); return true; }
    const now = Date.now(); if (now - lastAction < 100) return true; lastAction = now; return false;
  };
  const sync = () => syncRoom(street);

  socket.emit('seed', publicSeed());
  socket.on('authSession', ({ token } = {}, cb) => {
    const a = typeof token === 'string' && token.length === 64 ? ACC.fromToken(token) : null;
    socket.data.accountId = a?.id || null;
    if (a && me) { hydrateFromAccount(me, a.id); ensureQuests(street, me); profileSignal(); }
    if (typeof cb === 'function') cb(a ? { ok: true, account: ACC.publicAcc(a) } : { ok: false });
  });
  const profileSignal = () => { if (street) syncRoom(street); };

  let traveling = null, myWorld = null; // traveling: { timer } while on the road (the player is in no room)
  function arrive(st) {
    street = st; myWorld = st.worldId; me.x = terminalX(st); me.dir = 1; me.counters ||= {};
    delete st.pastPlayers[socket.id]; ensureQuests(st, me);
    st.players[socket.id] = me; ensureFlat(st, me);
    if (!st.ownerId || !st.players[st.ownerId]) st.ownerId = socket.id;
    socket.join(st.id);
    addLog(st, 'log.arrivedCity', { player: me.name });
    socket.emit('joined', { roomId: st.id, mode: st.mode, pin: SHARED_MODES.includes(st.mode) ? st.pin : null, city: st.city, travel: true, token: me.resumeToken });
    socket.emit('chatHistory', st.chat || []);
    traveling = null; sync();
  }
  function enter(st, name) {
    street = st; myWorld = st.worldId;
    me = { id: socket.id, name: clean(name, 20) || (socket.data.accountId && ACC.nameOf(socket.data.accountId)) || 'Anon-' + crypto.randomBytes(2).toString('hex'),
      coins: SEED.startCoins, role: 'role.candidate', stats: newStats(),
      x: SPAWN_X, dir: 1, avatar: crypto.randomInt(0, 1000), busCard: 0, badges: {}, counters: {}, team: null, life: newLife(), resumeToken: crypto.randomBytes(16).toString('hex') };
    if (socket.data.accountId) hydrateFromAccount(me, socket.data.accountId);
    ensureQuests(st, me);
    st.players[socket.id] = me; ensureFlat(st, me);
    if (!st.ownerId || !st.players[st.ownerId]) st.ownerId = socket.id;
    socket.join(st.id);
    addLog(st, 'log.joined', { player: me.name });
    socket.emit('joined', { roomId: st.id, mode: st.mode, pin: SHARED_MODES.includes(st.mode) ? st.pin : null, city: st.city, token: me.resumeToken });
    socket.emit('chatHistory', st.chat || []);
    sync();
  }

  // Solo: private street, only you + NPCs
  const cityLocked = city => { const m = ECON.cityMap.find(x => x.key === city); return !!m && m.status !== 'open'; };
  socket.on('startSolo', ({ name, city } = {}) => {
    if (street) return;
    if (cityLocked(city)) return socket.emit('toast', 'toast.cityLocked');
    const id = 'solo-' + newRoomId();
    rooms[id] = createStreet(id, 'solo', null, city);
    enter(rooms[id], name);
  });

  // Multiplayer: create a private room → share link + 4-digit PIN
  socket.on('createRoom', ({ name, pin, city, listed } = {}) => {
    if (street) return;
    if (cityLocked(city)) return socket.emit('toast', 'toast.cityLocked');
    const id = newRoomId();
    rooms[id] = createStreet(id, 'multiplayer', pinOrRandom(pin), city); rooms[id].listed = listed !== false;
    enter(rooms[id], name);
  });

  // Open rooms: multiplayer / presentation rooms that are listed; the PIN is never revealed, only needed to join
  let lastList = 0, lastListRes = { rooms: [] };
  socket.on('listRooms', (_, cb) => {
    if (typeof cb !== 'function') return;
    const now = Date.now(); if (now - lastList < 1000) return cb(lastListRes); lastList = now;   // too fast: answer with the previous list
    cb(lastListRes = { rooms: Object.values(rooms).filter(r => SHARED_MODES.includes(r.mode) && r.worldId === r.id && r.listed !== false).slice(0, 30)
      .map(r => ({ id: r.id, mode: r.mode, players: Object.keys(r.players).length, max: SEED.maxPlayersPerRoom, city: r.city, day: r.day || 0 })) });
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

  // leave the car where it stands (street parking) and tell the client why
  function stopDriving(reason) {
    if (!me?.drive || !street) return; const c = street.companies[me.drive.cid]; me.drive = null;
    if (c?.vehicle) { c.vehicle.x = me.x; c.vehicle.park = 'street'; }
    socket.emit('driveStop', { reason }); sync();
  }
  socket.on('drive', ({ cid, on } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r);
    if (!street || !me || street.mode === 'presentation' || limited()) return reply({ ok: false });
    if (on === false) { if (me.drive) stopDriving('park'); return reply({ ok: true }); }
    const c = street.companies[cid]; if (!c || !c.vehicle || !c.founders.includes(me.id) || me.drive || me.loc || traveling) return reply({ ok: false });
    const v = ensureVeh(street, c);
    if (driverOf(street, cid)) return reply({ ok: false, key: 'toast.carBusy' });
    if (v.cond < MIN_COND_TO_DRIVE) return reply({ ok: false, key: 'toast.carBroken' });
    if (v.fuel < 1) return reply({ ok: false, key: 'toast.noFuel' });
    const cx = carX(street, c); if (Math.abs((me.x ?? 0) - cx) > BOARD_RANGE_PX) return reply({ ok: false, key: 'toast.carFar' });
    me.drive = { cid }; me.x = Math.round(cx); sync(); reply({ ok: true, x: me.x });
  });

  // ---- Taxi: quote -> offer (haggle) -> go ----
  const taxiTarget = to => { const x = Math.round(Number(to)); return Number.isFinite(x) && x >= 0 && x <= WORLD_MAX_X ? x : null; };
  socket.on('taxiQuote', ({ to } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r), x = taxiTarget(to);
    if (!street || !me || street.mode === 'presentation' || me.drive || x == null || Math.abs(x - me.x) < 150) return reply({ ok: false, key: 'toast.taxiTooClose' });
    if (me.taxiCool && Date.now() < me.taxiCool) return reply({ ok: false, key: 'toast.taxiBusy' });
    me.taxi = { to: x, fare: taxiFare(street, me.x, x), tries: 0, counter: null, at: Date.now() }; me.taxiDeal = null;
    reply({ ok: true, fare: me.taxi.fare, night: isNightMin(gameMinutesOf(street)), km: Math.round(Math.abs(x - me.x) / PX_PER_KM * 10) / 10 });
  });
  socket.on('taxiOffer', ({ pct } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r), tx = me?.taxi;
    if (!street || !me || !tx || limited() || !TAXI.offers.includes(Number(pct))) return reply({ ok: false });
    pct = Number(pct); const price = Math.max(1, Math.round(tx.fare * pct / 100));
    if (Math.random() < TAXI.accept[pct] * (tx.mood ??= 0.85 + Math.random() * 0.3)) { me.taxiDeal = { to: tx.to, price, exp: Date.now() + TAXI.dealMs }; return reply({ ok: true, accepted: true, price }); }
    tx.tries++;
    if (tx.tries >= TAXI.maxTries) { me.taxi = null; me.taxiCool = Date.now() + TAXI.cooldownMs; return reply({ ok: true, refused: true }); }
    tx.counter = Math.max(1, Math.round(tx.fare * (pct + (100 - pct) * 0.55) / 100)); reply({ ok: true, accepted: false, counter: tx.counter, tries: tx.tries });
  });
  socket.on('taxiAccept', (_, cb) => {
    const reply = r => typeof cb === 'function' && cb(r), tx = me?.taxi;
    if (!tx?.counter || limited()) return reply({ ok: false });
    me.taxiDeal = { to: tx.to, price: tx.counter, exp: Date.now() + TAXI.dealMs }; reply({ ok: true, price: tx.counter });
  });
  socket.on('taxiGo', (_, cb) => {
    const reply = r => typeof cb === 'function' && cb(r), d = me?.taxiDeal;
    if (!street || !me || !d || Date.now() > d.exp || me.drive || limited()) return reply({ ok: false, key: 'toast.taxiExpired' });
    if (me.coins < d.price) return reply({ ok: false, key: 'toast.noCoins' });
    me.coins -= d.price; me.x = d.to; me.taxiDeal = null; me.taxi = null;
    if (!posDirty.has(street.id)) posDirty.set(street.id, new Map()); posDirty.get(street.id).set(me.id, { x: me.x, dir: me.dir });
    progress(street, me, 'taxiRides'); reply({ ok: true, x: me.x, price: d.price }); sync();
  });
  // Sprint 32b: the Guide can teleport you to a building (free, short cooldown); walking and taxi use the normal systems
  socket.on('guideTeleport', ({ x } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r), nx = taxiTarget(x);
    if (!street || !me || street.mode === 'presentation' || me.drive || nx == null) return reply({ ok: false });
    const wait = Math.ceil(((me.tpAt || 0) + 20000 - Date.now()) / 1000); if (wait > 0) return reply({ ok: false, key: 'gt.cooldown', params: { n: wait } });
    me.tpAt = Date.now(); me.x = nx; me.taxi = null; me.taxiDeal = null;
    if (!posDirty.has(street.id)) posDirty.set(street.id, new Map()); posDirty.get(street.id).set(me.id, { x: me.x, dir: me.dir });
    reply({ ok: true, x: me.x });
  });
  socket.on('taxiCancel', () => { if (me) { me.taxi = null; me.taxiDeal = null; } });

  // Character position: lightweight, volatile broadcast (no full state sync)
  socket.on('move', ({ x, dir } = {}) => {
    if (!street || !me || street.mode === 'presentation') return;
    const now = Date.now();
    if (now - lastMove < 50) return;
    lastMove = now;
    const nx = Number(x);
    if (!Number.isFinite(nx)) return;
    if (me.drive) {   // driving: authoritative fuel burn and wear from the distance covered
      const dc = street.companies[me.drive.cid], v = dc?.vehicle && ensureVeh(street, dc);
      if (!v) me.drive = null;
      else {
        const step = Math.min(Math.abs(nx - me.x), MAX_STEP_PX), km = step / PX_PER_KM;
        v.fuel = Math.max(0, v.fuel - km); v.odo += km; v.cond = Math.max(0, v.cond - km * WEAR_PER_KM);
        if (v.fuel <= 0 || v.cond <= 0) { me.x = Math.max(0, Math.min(WORLD_MAX_X, Math.round(me.x + Math.sign(nx - me.x) * step))); stopDriving(v.fuel <= 0 ? 'fuel' : 'broken'); return; }
        me.x = Math.max(0, Math.min(WORLD_MAX_X, Math.round(me.x + Math.sign(nx - me.x) * step))); me.dir = dir < 0 ? -1 : 1;
        if (!posDirty.has(street.id)) posDirty.set(street.id, new Map()); posDirty.get(street.id).set(me.id, { x: me.x, dir: me.dir });
        if (now - (me.driveInfoAt || 0) > 400) { me.driveInfoAt = now; socket.emit('driveInfo', { fuel: +v.fuel.toFixed(2), cond: +v.cond.toFixed(2), odo: +v.odo.toFixed(1), tank: v.tank }); }
        return;
      }
    }
    me.x = Math.max(0, Math.min(WORLD_MAX_X, Math.round(nx)));
    me.dir = dir < 0 ? -1 : 1;
    if (!posDirty.has(street.id)) posDirty.set(street.id, new Map());
    posDirty.get(street.id).set(me.id, { x: me.x, dir: me.dir });
  });

  // ---------- Departments (inside the building) ----------
  const founderOf = cid => { const c = street?.companies[cid]; return c && c.founders.includes(me.id) ? c : null; };
  const needDept = (c, key) => { if (deptUnlocked(street, c, key)) return true; socket.emit('toast', 'toast.deptLocked'); return false; };

  socket.on('marketing', ({ cid, budget } = {}) => {
    const c = founderOf(cid); if (!c || limited() || !needDept(c, 'marketing')) return;
    if (marketingActive(street, c)) return socket.emit('toast', 'toast.campaignActive');
    const pct = budget == null ? 50 : Math.max(10, Math.min(100, Math.floor(Number(budget)) || 50)), k = pct / 50; // 50% = standard campaign
    const cost = Math.round(SEED.marketing.cost * k);
    if (c.cash < cost) return socket.emit('toast', 'toast.noCash');
    c.cash -= cost; R.track(c, 'expenses', cost);
    c.marketing = { until: (street.day || 0) + SEED.marketing.days, k };
    progress(street, me, 'campaign'); award(street, me, 'marketer');
    addLog(street, 'log.campaign', { player: me.name, days: SEED.marketing.days, ...cParams(c) });
    sync();
  });

  // Add (no pid) or edit (pid) a product / service. Only founders; at most MAX_PRODUCTS.
  socket.on('productSave', ({ cid, pid, name, price, discount } = {}) => {
    const c = founderOf(cid); if (!c || limited()) return;
    const ps = ensureProducts(c), cur = pid ? ps.find(p => p.id === pid) : null;
    if (pid && !cur) return;
    const pp = price == null ? cur?.price : Math.round(Number(price));
    if (!priceOk(pp)) return socket.emit('toast', 'toast.badCustom');
    const dd = discount == null ? (cur?.discount || 0) : discountOf(discount);
    if (cur) {
      if (name != null) { const nm = clean(name, 30); if (nm) cur.name = nm; }
      cur.price = pp; cur.discount = dd;
      addLog(street, 'log.productEdited', { player: me.name, product: cur.name || '—', ...cParams(c) });
    } else {
      const nm = clean(name, 30);
      if (!nm) return socket.emit('toast', 'toast.badCustom');
      if (ps.length >= MAX_PRODUCTS) return socket.emit('toast', 'toast.maxProducts');
      ps.push({ id: newPid(), name: nm, nameKey: null, price: pp, discount: dd });
      addLog(street, 'log.productAdded', { player: me.name, product: nm, ...cParams(c) });
    }
    c.price = ps[0].price; if (ps[0].name) c.product = ps[0].name;
    sync();
  });
  socket.on('productRemove', ({ cid, pid } = {}) => {
    const c = founderOf(cid); if (!c || limited()) return;
    const ps = ensureProducts(c);
    if (ps.length <= 1) return socket.emit('toast', 'toast.lastProduct');
    const i = ps.findIndex(p => p.id === pid); if (i < 0) return;
    const [gone] = ps.splice(i, 1);
    c.price = ps[0].price; c.product = ps[0].name || null; if (i === 0) c.nameKey = ps[0].nameKey || c.nameKey;
    addLog(street, 'log.productRemoved', { player: me.name, product: gone.name || '—', ...cParams(c) });
    sync();
  });

  // ----- Home (personal life) -----
  const lifeReady = () => !!street && !!me && ['solo', 'multiplayer'].includes(street.mode);
  // shared by spending / hobbies / courses: pays from the player's pocket, applies effects, answers with the deltas
  const applyLife = (id, kind, eff, cost) => {
    const L = ensureLife(me); me.coins -= cost; L.happiness += eff.h || 0; L.health += eff.hp || 0; clampLife(L);
    if (eff.k) me.stats.knowledge = +(me.stats.knowledge + eff.k).toFixed(1);
    if (eff.xp) { me.stats.xp += eff.xp; me.stats.level = levelOf(me.stats.xp); }
    socket.emit('homeResult', { id, kind, cost, h: eff.h || 0, hp: eff.hp || 0, k: eff.k || 0, xp: eff.xp || 0 });
  };
  socket.on('homeSpend', ({ item } = {}) => {
    if (!lifeReady() || limited() || !Object.hasOwn(LIFE.spend, item)) return;
    const s = LIFE.spend[item], L = ensureLife(me), td = lifeToday(street, L);
    if (td.done[item]) return socket.emit('toast', 'toast.homeToday');
    if (s.cooldown && (street.day || 0) < (L.cooldowns[item] ?? -1e9) + s.cooldown) return socket.emit('toast', 'toast.homeCooldown');
    if (me.coins < s.cost) return socket.emit('toast', 'toast.noCoins');
    td.done[item] = 1; if (s.cooldown) L.cooldowns[item] = street.day || 0;
    applyLife(item, 'spend', s, s.cost); sync();
  });
  socket.on('hobby', ({ id } = {}) => {
    if (!lifeReady() || limited() || !Object.hasOwn(LIFE.hobbies, id)) return;
    const h = LIFE.hobbies[id], L = ensureLife(me), td = lifeToday(street, L), key = 'hobby:' + id;
    if (td.done[key]) return socket.emit('toast', 'toast.homeToday');
    if (me.coins < h.cost) return socket.emit('toast', 'toast.noCoins');
    td.done[key] = 1; const lvl = hobbyLevel(L.hobbies[id] || 0);
    L.hobbies[id] = (L.hobbies[id] || 0) + 1;                     // sessions; level = floor(sqrt(sessions))
    applyLife(id, 'hobby', { ...h, h: h.h + Math.min(4, lvl * 0.5) }, h.cost);
    if (hobbyLevel(L.hobbies[id]) >= 5) award(street, me, 'hobbyist');
    sync();
  });
  socket.on('learn', ({ id } = {}) => {
    if (!lifeReady() || limited() || !Object.hasOwn(LIFE.courses, id)) return;
    const c = LIFE.courses[id], L = ensureLife(me), td = lifeToday(street, L), key = 'course:' + id;
    if (td.done[key]) return socket.emit('toast', 'toast.homeToday');
    if (c.cooldown && (street.day || 0) < (L.cooldowns[key] ?? -1e9) + c.cooldown) return socket.emit('toast', 'toast.homeCooldown');
    if (c.cert && L.certs.length >= 3) return socket.emit('toast', 'toast.certMax');
    if (me.coins < c.cost) return socket.emit('toast', 'toast.noCoins');
    td.done[key] = 1; if (c.cooldown) L.cooldowns[key] = street.day || 0;
    if (c.cert) L.certs.push(street.day || 0);
    L.courses++; applyLife(id, 'course', c, c.cost);
    if (L.courses >= 5) award(street, me, 'scholar');
    sync();
  });
  // Housing: family (free) / rented studio / rented flat. Moving into a rented home costs one month's rent as a deposit.
  socket.on('housing', ({ tier } = {}) => {
    if (!lifeReady() || limited() || !HOUSING.includes(tier)) return;
    const L = ensureLife(me); if (L.housing === tier) return;
    const deposit = Math.round(LIFE.housing[tier].deposit * cityRentFactor(street));
    if (tier !== 'family' && L.housing === 'family' && me.coins < deposit) return socket.emit('toast', 'toast.noCoins');
    if (tier !== 'family' && L.housing === 'family') me.coins -= deposit;
    L.housing = tier; L.unpaid = 0; L.billAcc = 0;
    addLog(street, 'log.moved', { player: me.name, tierKey: 'home.housing.' + tier }); sync();
  });
  socket.on('homeUtility', ({ key, on } = {}) => {
    if (!lifeReady() || limited() || !UTIL_KEYS.includes(key) || typeof on !== 'boolean') return;
    ensureLife(me).utilities[key] = on; sync();
  });

  // Advertising: rent a slot, submit a creative (needs admin approval), release the slot
  socket.on('adRent', ({ cid, slot } = {}) => {
    const c = founderOf(cid); if (!c || limited() || c.isNpc) return;
    const s = adSlot(street, slot); if (!s) return;
    if (adState(street, s.id).owner) return socket.emit('toast', 'toast.adTaken');
    if ((s.kind === 'wall' || s.kind === 'roof') && c.lotId !== s.index) return socket.emit('toast', 'toast.adNotYourBuilding');
    if (ownedSlots(street, c.id).length >= ADS.MAX_SLOTS_PER_COMPANY) return socket.emit('toast', 'toast.adMaxSlots');
    if (c.cash < s.price) return socket.emit('toast', 'toast.noCash');
    adState(street, s.id).owner = c.id;
    addLog(street, 'log.adRented', { player: me.name, kindKey: 'ad.kind.' + s.kind, ...cParams(c) });
    sync();
  });
  socket.on('adRelease', ({ cid, slot } = {}) => {
    const c = founderOf(cid); if (!c || limited()) return;
    const s = adSlot(street, slot), a = s && street.ads[s.id]; if (!a || a.owner !== c.id) return;
    delete street.ads[s.id]; sync();
  });
  let lastAdSubmit = 0;
  socket.on('adSubmit', ({ cid, slot, creative } = {}) => {
    const c = founderOf(cid); if (!c || limited()) return;
    const s = adSlot(street, slot), a = s && street.ads[s.id]; if (!a || a.owner !== c.id) return;
    if (Date.now() - lastAdSubmit < 3000) return socket.emit('toast', 'toast.slowDown');
    const r = ADS.cleanCreative(creative);
    if (!r.ok) return socket.emit('toast', r.error === 'badUrl' ? 'toast.adBadUrl' : 'toast.adEmpty');
    lastAdSubmit = Date.now();
    a.pending = { ...r.creative, at: Date.now() }; a.rejected = null;
    addLog(street, 'log.adSubmitted', { player: me.name, kindKey: 'ad.kind.' + s.kind, ...cParams(c) });
    socket.emit('toast', 'toast.adSent'); sync();
  });

  // Accountant level (none / basic / pro): monthly fee vs. tax penalty or saving
  socket.on('setAccountant', ({ cid, level } = {}) => {
    const c = founderOf(cid); if (!c || limited() || !needDept(c, 'accounting')) return;
    if (!ACC_LEVELS.includes(level) || c.accountant === level) return;
    c.accountant = level; addLog(street, 'log.accountant', { player: me.name, level, ...cParams(c) }); sync();
  });
  // Shop utility bills on/off (electricity, water, gas, internet)
  socket.on('setUtilities', ({ cid, utilities } = {}) => {
    const c = founderOf(cid); if (!c || limited() || c.lotId == null || street.lots[c.lotId].type !== 'shop' || !utilities || typeof utilities !== 'object') return;
    const next = utilOn(c); for (const k of UTILITIES) if (typeof utilities[k] === 'boolean') next[k] = utilities[k];
    c.utilities = next; addLog(street, 'log.utilities', { player: me.name, ...cParams(c) }); sync();
  });

  // ---- Sprint 17a: Mini SaaS CRM + KPI (IT department) ----
  const retentionOf = c => TOOLS.effectOf(c, 'customerRetention'), dormantDaysOf = c => CRM.DORMANT_DAYS + Math.round(retentionOf(c) * 60);
  const crmCo = cid => { const c = street?.companies[cid]; return c && !c.isNpc && (c.founders.includes(me?.id) || c.employees.includes(me?.id)) && deptUnlocked(street, c, 'it') ? c : null; };
  socket.on('crmGet', ({ cid } = {}, cb) => {
    const c = crmCo(cid); if (!c || typeof cb !== 'function') return;
    const day = street.day || 0;
    cb({ day, cost: CRM.FOLLOW_COST, cooldown: CRM.FOLLOW_COOLDOWN_DAYS, kpi: CRM.kpis(c, day, dormantDaysOf(c)),
      customers: CRM.book(c).customers.map(x => ({ id: x.id, name: x.name, persona: x.persona, orders: x.orders, spent: x.spent, last: x.last, stage: CRM.stageOf(x, day, dormantDaysOf(c)), chance: Math.round(CRM.winChance(x, day, retentionOf(c), dormantDaysOf(c)) * 100), ready: CRM.canFollow(x, day) }))
        .sort((a, b) => b.spent - a.spent).slice(0, CRM.CAP) });
  });
  socket.on('crmFollow', ({ cid, id } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r);
    const c = crmCo(cid); if (!c || limited()) return reply({ ok: false });
    const cu = CRM.book(c).customers.find(x => x.id === id), day = street.day || 0; if (!cu) return reply({ ok: false });
    if (!CRM.canFollow(cu, day)) return reply({ ok: false, key: 'toast.crmCooldown' });
    if (c.cash < CRM.FOLLOW_COST) return reply({ ok: false, key: 'toast.noCash' });
    const chance = CRM.winChance(cu, day, retentionOf(c), dormantDaysOf(c));
    c.cash -= CRM.FOLLOW_COST; R.track(c, 'expenses', CRM.FOLLOW_COST); cu.followAt = day;
    const won = crypto.randomInt(0, 1000) < chance * 1000; let revenue = 0;
    if (won) {
      const perf = perfFor(c, me);
      revenue = Math.max(1, Math.round(unitPrice(c) * WS[c.workspace].salesMult * perf * incomeMult(street, c) * 3));
      revenue = stockAdjust(c, null, 2, revenue);
      c.cash += revenue; c.sales += 2; R.track(c, 'revenue', revenue); R.track(c, 'units', 2); addDelivery(street, c, 2);
      progress(street, me, 'sales', 2); progress(street, me, 'revenue', revenue); CRM.record(c, day, { id: cu.id, amount: revenue });
    }
    me.stats.xp += (won ? 2 : 1) * (1 + TOOLS.effectOf(c, 'xpGain')); me.stats.level = levelOf(me.stats.xp);
    sync(); reply({ ok: true, won, revenue });
  });

  // ---- Sprint 17b: Mini SaaS planner (tasks, Gantt, calendar) ----
  const planReply = (c, extra = {}) => ({ ok: true, day: street.day || 0, max: PLAN.MAX_TASKS, maxDur: PLAN.MAX_DUR, maxAhead: PLAN.MAX_AHEAD, tasks: PLAN.view(c, street.day || 0), ...extra });
  socket.on('planGet', ({ cid } = {}, cb) => { const c = crmCo(cid); if (c && typeof cb === 'function') cb(planReply(c)); });
  socket.on('planAdd', ({ cid, name, start, dur } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r), c = crmCo(cid); if (!c || limited()) return reply({ ok: false });
    const r = PLAN.add(c, street.day || 0, { name, start, dur }); if (!r.ok) return reply(r);
    reply(planReply(c));
  });
  socket.on('planDone', ({ cid, id } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r), c = crmCo(cid); if (!c || limited()) return reply({ ok: false });
    const r = PLAN.complete(c, street.day || 0, Number(id)); if (!r.ok) return reply(r);
    me.stats.xp += r.xp; me.stats.knowledge = +(me.stats.knowledge + r.k).toFixed(1); me.stats.level = levelOf(me.stats.xp);
    progress(street, me, 'tasks'); sync(); reply(planReply(c, { onTime: r.onTime, xp: r.xp }));
  });
  socket.on('planDel', ({ cid, id } = {}, cb) => {
    const c = crmCo(cid); if (!c || limited()) return typeof cb === 'function' && cb({ ok: false });
    PLAN.remove(c, Number(id)); if (typeof cb === 'function') cb(planReply(c));
  });

  // ---- Sprint 17c: Mini SaaS ERP (stock / capacity, supply orders) ----
  const erpReply = (c, extra = {}) => { const b = ERP.book(c), ps = ensureProducts(c);
    return { ok: true, day: street.day || 0, service: ERP.isService(c), initial: ERP.INITIAL_STOCK, lost: Math.round(b.lost), streak: b.okDays, goal: ERP.STREAK_GOAL, maxQty: ERP.MAX_QTY, lead: ERP.leadDays(c), outMult: ERP.OUT_MULT,
      products: ps.map(p => ({ id: p.id, name: p.name || null, nameKey: p.nameKey || null, stock: ERP.stockOf(c, p.id), unitCost: Math.max(1, Math.round(unitPrice(c, p.id) * ERP.UNIT_COST_PCT)) })),
      orders: b.orders.map(o => ({ ...o })), ...extra }; };
  socket.on('erpGet', ({ cid } = {}, cb) => { const c = crmCo(cid); if (c && typeof cb === 'function') cb(erpReply(c)); });
  socket.on('erpOrder', ({ cid, pid, qty } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r), c = crmCo(cid); if (!c || limited()) return reply({ ok: false });
    const ps = ensureProducts(c), prod = ps.find(x => x.id === pid); if (!prod) return reply({ ok: false, key: 'toast.erpBad' });
    const r = ERP.order(c, street.day || 0, prod.id, qty, unitPrice(c, prod.id)); if (!r.ok) return reply(r);
    if (c.cash < r.cost) return reply({ ok: false, key: 'toast.noCash' });
    c.cash -= r.cost; R.track(c, 'expenses', r.cost); ERP.place(c, r.order);
    const label = prod.name || (prod.nameKey ? prod.nameKey.split('.').pop() : 'x');
    PLAN.add(c, street.day || 0, { name: `📦 ${label} x${r.order.qty}`, start: street.day || 0, dur: r.order.due - (street.day || 0) });
    sync(); reply(erpReply(c));
  });

  // ---- Sprint 29b: world overview (all cities of the player's world: companies, home, team, staff) ----
  socket.on('worldOverview', (_, cb) => {
    if (typeof cb !== 'function' || !me) return;
    const out = {}, myTeam = me.team;
    for (const r of Object.values(rooms)) {
      if (r.worldId !== (street?.worldId ?? myWorld)) continue;
      const cos = Object.values(r.companies).filter(c => !c.isNpc && c.status === 'active' && (c.founders.includes(me.id) || c.employees.includes(me.id)));
      const humans = Object.values(r.players).filter(p => !p.isNpc);
      const team = myTeam && r.teams?.[myTeam] ? { name: r.teams[myTeam].name, members: [...Object.values(r.players), ...Object.values(r.pastPlayers)].filter(p => p?.team === myTeam).length } : null;
      out[r.city] = { current: r === street, day: r.day || 0, players: humans.length, home: (r.flats || []).some(f => f.id === me.id), team,
        companies: cos.map(c => ({ id: c.id, name: c.name || null, nameKey: c.nameKey || null, cash: Math.round(c.cash), sales: c.sales || 0, owner: c.founders.includes(me.id), staff: c.employees.length + (c.npcStaff || 0), partners: Object.keys(c.partners || {}).length })) };
    }
    cb({ ok: true, city: street?.city || null, cities: out });
  });
  // ---- Sprint 30: classroom (education) mode ----
  const isTeacher = () => !!street && street.ownerId === me?.id && ['multiplayer'].includes(street.mode);
  const classPublic = st => (st.classroom?.on ? { on: true, title: st.classroom.title, assignments: st.classroom.assignments.map(a => ({ ...a })) } : { on: false });
  socket.on('classGet', (_, cb) => { if (typeof cb === 'function' && street) cb({ ok: true, available: !!BAL.CFG.classOn && street.mode === 'multiplayer', teacher: isTeacher(), classroom: classPublic(street), metrics: CLASS_METRICS, day: street.day || 0 }); });
  socket.on('classSet', ({ title, assignments } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r);
    if (!isTeacher() || !BAL.CFG.classOn || limited()) return reply({ ok: false, key: 'class.notTeacher' });
    const list = Array.isArray(assignments) ? assignments.slice(0, 10) : [], prev = street.classroom?.assignments || [], day = street.day || 0, humans = Object.values(street.players).filter(p => !p.isNpc);
    const out = [];
    for (const a of list) {
      const metric = String(a?.metric || ''), goal = Math.floor(Number(a?.goal)), reward = Math.max(0, Math.min(500, Math.floor(Number(a?.reward) || 0))), t = clean(a?.title, 60);
      if (!CLASS_METRICS.includes(metric) || !(goal >= 1 && goal <= 1000000) || !t) return reply({ ok: false, key: 'class.badAssignment' });
      const until = a?.days ? day + Math.max(1, Math.min(365, Math.floor(Number(a.days)))) : (a?.until != null && a.until > day ? Math.floor(Number(a.until)) : null);
      const old = prev.find(x => x.id === a?.id && x.metric === metric);   // keep baselines of unchanged assignments
      out.push(old ? { ...old, title: t, goal, reward, until } : { id: crypto.randomBytes(3).toString('hex'), title: t, metric, goal, reward, until, base: Object.fromEntries(humans.map(p => [p.id, p.counters?.[metric] || 0])), created: day });
    }
    street.classroom = { on: true, title: clean(title, 60) || 'Class', assignments: out, startedDay: street.classroom?.startedDay ?? day };
    addLog(street, 'log.classUpdated', { player: me.name }); audit('class', `${street.id}: ${out.length} assignments`); sync(); reply({ ok: true, classroom: classPublic(street) });
  });
  socket.on('classOff', (_, cb) => { if (!isTeacher()) return typeof cb === 'function' && cb({ ok: false }); street.classroom = null; sync(); if (typeof cb === 'function') cb({ ok: true }); });
  socket.on('classReport', (_, cb) => {
    if (typeof cb !== 'function' || !isTeacher()) return typeof cb === 'function' && cb({ ok: false, key: 'class.notTeacher' });
    const cl = street.classroom, day = street.day || 0, all = [...Object.values(street.players), ...Object.values(street.pastPlayers || {})].filter(p => p && !p.isNpc && p.id !== street.ownerId);
    const seen = new Set(), students = all.filter(p => (seen.has(p.id) ? false : seen.add(p.id)));
    const rows = students.map(p => {
      const cos = Object.values(street.companies).filter(c => !c.isNpc && c.founders.includes(p.id));
      return { id: p.id, name: p.name, online: !!street.players[p.id], level: p.stats?.level || 1, xp: Math.round(p.stats?.xp || 0), coins: Math.round(p.coins), companies: cos.length, cash: Math.round(cos.reduce((a, c) => a + c.cash, 0)), staff: cos.reduce((a, c) => a + c.employees.length + (c.npcStaff || 0), 0),
        sales: p.counters?.sales || 0, revenue: Math.round(p.counters?.revenue || 0), quests: p.counters?.quests || 0, badges: Object.keys(p.badges || {}).length,
        assignments: (cl?.assignments || []).map(a => ({ progress: classProgress(a, p), goal: a.goal, done: p.classDone?.[a.id] != null })) };
    });
    cb({ ok: true, day, title: cl?.title || '', assignments: (cl?.assignments || []).map(a => ({ title: a.title, goal: a.goal, metric: a.metric, until: a.until })), rows });
  });

  // ---- Sprint 29a: player partnerships (offer / accept / buy back) ----
  const pfair = (c, pct) => Math.round(readiness(street, c).valuation * pct / 100);
  socket.on('partnerOffer', ({ cid, to, pct, amount } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r), c = founderOf(cid);
    if (!c || limited() || !BAL.CFG.partnerOn || c.isNpc || c.status !== 'active') return reply({ ok: false, key: 'partner.off' });
    const target = street.players[to], p = Math.floor(Number(pct)), amt = Math.floor(Number(amount));
    if (!target || c.founders.includes(to) || to === me.id) return reply({ ok: false, key: 'partner.badTarget' });
    if (!(p >= 1 && p <= BAL.CFG.partnerMaxPct)) return reply({ ok: false, key: 'partner.badPct' });
    if (!(amt >= 10 && amt <= 20000)) return reply({ ok: false, key: 'partner.badAmount' });
    if (outsidePct(c) + p > BAL.CFG.partnerMaxPct) return reply({ ok: false, key: 'partner.capReached', params: { max: BAL.CFG.partnerMaxPct } });
    if (!c.partners?.[to] && Object.keys(c.partners || {}).length >= 3) return reply({ ok: false, key: 'partner.tooMany' });
    c.pOffers ||= []; if (c.pOffers.some(o => o.to === to)) return reply({ ok: false, key: 'partner.pending' });
    if (c.pOffers.length >= 5) return reply({ ok: false, key: 'partner.pending' });
    const o = { id: crypto.randomBytes(4).toString('hex'), to, toName: target.name, from: me.name, pct: p, amount: amt, fair: pfair(c, p), until: (street.day || 0) + 3 };
    c.pOffers.push(o); io.to(to).emit('partnerOffer', { company: c.name || null, companyKey: c.nameKey || null, from: me.name, pct: p, amount: amt });
    sync(); reply({ ok: true });
  });
  socket.on('partnerAnswer', ({ cid, id, accept } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r), c = street?.companies[cid], o = c?.pOffers?.find(x => x.id === id);
    if (!o || o.to !== me.id || limited()) return reply({ ok: false, key: 'partner.gone' });
    c.pOffers = c.pOffers.filter(x => x !== o);
    if (!accept) { sync(); return reply({ ok: true, declined: true }); }
    if (c.status !== 'active' || !BAL.CFG.partnerOn) return reply({ ok: false, key: 'partner.gone' });
    if (me.coins < o.amount) return reply({ ok: false, key: 'toast.noCoins' });
    if (outsidePct(c) + o.pct > BAL.CFG.partnerMaxPct) return reply({ ok: false, key: 'partner.capReached', params: { max: BAL.CFG.partnerMaxPct } });
    me.coins -= o.amount; c.cash += o.amount; R.track(c, 'investment', o.amount);
    c.partners ||= {}; c.partners[me.id] = (c.partners[me.id] || 0) + o.pct;
    progress(street, me, 'invest'); award(street, me, 'investor'); award(street, me, 'partner');
    c.founders.forEach(f => award(street, street.players[f], 'partner'));
    addLog(street, 'log.partnerJoined', { player: me.name, pct: o.pct, amount: o.amount, ...cParams(c) });
    audit('partner', `${street.id}: ${me.id}->${c.id} ${o.pct}% for ${o.amount}`);
    sync(); reply({ ok: true, accepted: true });
  });
  socket.on('partnerBuyback', ({ cid, pid } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r), c = founderOf(cid), pct = c?.partners?.[pid];
    if (!c || !pct || limited()) return reply({ ok: false });
    const price = pfair(c, pct); if (c.cash < price) return reply({ ok: false, key: 'toast.noCash' });
    const pl = street.players[pid] || street.pastPlayers[pid]; if (!pl) return reply({ ok: false });
    c.cash -= price; R.track(c, 'expenses', price); pl.coins += price; delete c.partners[pid];
    io.to(pid).emit('partnerBoughtOut', { amount: price, ...cParams(c) });
    addLog(street, 'log.partnerBoughtOut', { player: pl.name, pct, amount: price, ...cParams(c) });
    sync(); reply({ ok: true, price });
  });

  // ---- Sprint 29b: company sale (exit): offer = goodwill (recent profit x multiple) + cash, split between founders, partners and NPC investors ----
  const EXIT_MIN_AGE = 30, EXIT_COOLDOWN = 30;
  const exitQuote = c => {
    const profit30 = Math.max(0, Math.round((c.fin?.daily || []).slice(-30).reduce((a, d) => a + (d.revenue || 0) - (d.expenses || 0), 0)));
    const score = readiness(street, c).score, goodwill = Math.round(profit30 * (BAL.CFG.exitMonths + score / 20)), cash = Math.max(0, Math.round(c.cash));
    return { profit30, score, goodwill, cash, total: goodwill + cash };
  };
  const exitSplit = (c, total) => { const npc = Math.round(total * (c.npcEquity || 0) / 100), partners = Object.entries(c.partners || {}).map(([pid, pct]) => ({ pid, pct, amount: Math.round(total * pct / 100) })), rest = total - npc - partners.reduce((a, p) => a + p.amount, 0); return { npc, partners, founders: Math.max(0, rest) }; };
  socket.on('exitGet', ({ cid } = {}, cb) => {
    const c = founderOf(cid); if (!c || typeof cb !== 'function') return;
    const age = (street.day || 0) - (c.fin?.foundedDay ?? (street.day || 0)), wait = Math.max(0, (me.exitAt ?? -1e9) + EXIT_COOLDOWN - (street.day || 0)), q = exitQuote(c);
    cb({ ok: true, on: !!BAL.CFG.exitOn, age, minAge: EXIT_MIN_AGE, wait, ...q, split: exitSplit(c, q.total), offer: c.exitOffer && c.exitOffer.until > (street.day || 0) ? c.exitOffer : null, partnersCount: Object.keys(c.partners || {}).length, npcEquity: c.npcEquity || 0 });
  });
  socket.on('exitRequest', ({ cid } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r), c = founderOf(cid); if (!c || limited() || c.isNpc || c.status !== 'active' || !BAL.CFG.exitOn) return reply({ ok: false, key: 'exit.off' });
    const day = street.day || 0, age = day - (c.fin?.foundedDay ?? day);
    if (age < EXIT_MIN_AGE) return reply({ ok: false, key: 'exit.tooYoung', params: { n: EXIT_MIN_AGE - age } });
    if (me.exitAt != null && day < me.exitAt + EXIT_COOLDOWN) return reply({ ok: false, key: 'exit.cooldown', params: { n: me.exitAt + EXIT_COOLDOWN - day } });
    const q = exitQuote(c); if (q.total < 100) return reply({ ok: false, key: 'exit.noValue' });
    c.exitOffer = { id: crypto.randomBytes(4).toString('hex'), until: day + 3, ...q }; reply({ ok: true, offer: c.exitOffer, split: exitSplit(c, q.total) });
  });
  socket.on('exitAnswer', ({ cid, accept } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r), c = founderOf(cid), o = c?.exitOffer; if (!c || !o || limited()) return reply({ ok: false, key: 'exit.gone' });
    c.exitOffer = null; if (!accept) return reply({ ok: true, declined: true });
    const day = street.day || 0; if (o.until <= day || c.status !== 'active') return reply({ ok: false, key: 'exit.gone' });
    const q = exitQuote(c), total = Math.min(q.total, Math.round(o.total * 1.15)), sp = exitSplit(c, total), each = Math.floor(sp.founders / Math.max(1, c.founders.length));
    for (const f of c.founders) { const fp = street.players[f] || street.pastPlayers[f]; if (!fp) continue; fp.coins += each; fp.exitAt = day; fp.counters ||= {}; fp.counters.exits = (fp.counters.exits || 0) + 1; award(street, fp, 'exit'); io.to(f).emit('exitDone', { total, each, ...cParams(c) }); }
    for (const p of sp.partners) { const pl = street.players[p.pid] || street.pastPlayers[p.pid]; if (pl) { pl.coins += p.amount; io.to(p.pid).emit('exitPartner', { amount: p.amount, ...cParams(c) }); } }
    addLog(street, 'log.companySold', { player: me.name, amount: total, ...cParams(c) }); audit('exit', `${street.id}: ${c.id} sold for ${total}`);
    c.cash = 0; archiveCompany(street, c, 'sold'); sync(); reply({ ok: true, sold: true, total, each });
  });

  // ---- Sprint 26b: wholesale market (player companies sell surplus ERP stock to each other) ----
  const mktCo = cid => { const c = street?.companies[cid]; return c && !c.isNpc && c.status === 'active' && c.founders.includes(me?.id) && !ERP.isService(c) ? c : null; };
  const mktView = () => {
    const b = MKT.book(street), mine = new Set(Object.values(street.companies).filter(c => c.founders.includes(me?.id)).map(c => c.id));
    return { ok: true, day: street.day || 0, cfg: { fee: MKT.CFG.fee, maxListings: MKT.CFG.maxListings, maxBuysPerDay: MKT.CFG.maxBuysPerDay, ttl: MKT.CFG.ttl },
      offers: b.offers.map(o => { const c = street.companies[o.cid], ps = c ? ensureProducts(c) : [], p = ps.find(x => x.id === o.pid); return { id: o.id, cid: o.cid, seller: c?.name || null, sellerKey: c?.nameKey || null, name: p?.name || null, nameKey: p?.nameKey || null, qty: o.qty, price: o.price, until: o.until, mine: mine.has(o.cid) }; }),
      log: b.log.slice(0, 12),
      mine: Object.values(street.companies).filter(c => mktCo(c.id)).map(c => ({ cid: c.id, products: ensureProducts(c).map(p => ({ id: p.id, name: p.name || null, nameKey: p.nameKey || null, stock: ERP.stockOf(c, p.id), retail: unitPrice(c, p.id), ...(() => { const bd = MKT.bounds(unitPrice(c, p.id)); return { min: bd.min, max: bd.max }; })() })) })) };
  };
  socket.on('marketGet', (_, cb) => { if (typeof cb === 'function') cb(MKT.CFG.on ? mktView() : { ok: false, key: 'market.off' }); });
  socket.on('marketList', ({ cid, pid, qty, price } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r), c = mktCo(cid); if (!c || limited() || !MKT.CFG.on) return reply({ ok: false, key: 'market.off' });
    const prod = ensureProducts(c).find(x => x.id === pid), q = Math.floor(Number(qty)), pr = Math.floor(Number(price)); if (!prod) return reply({ ok: false, key: 'toast.erpBad' });
    if (!(q >= 1 && q <= MKT.MAX_QTY)) return reply({ ok: false, key: 'market.badQty' });
    const bd = MKT.bounds(unitPrice(c, prod.id)); if (!(pr >= bd.min && pr <= bd.max)) return reply({ ok: false, key: 'market.badPrice', params: bd });
    const b = MKT.book(street); if (b.offers.filter(o => o.cid === c.id).length >= MKT.CFG.maxListings) return reply({ ok: false, key: 'market.tooMany' });
    if (ERP.stockOf(c, prod.id) < q) return reply({ ok: false, key: 'market.noStock' });
    ERP.book(c).stock[prod.id] = ERP.stockOf(c, prod.id) - q;
    b.offers.push({ id: ++b.seq, cid: c.id, pid: prod.id, qty: q, price: pr, until: (street.day || 0) + MKT.CFG.ttl });
    sync(); reply(mktView());
  });
  socket.on('marketCancel', ({ id } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r), b = MKT.book(street), o = b.offers.find(x => x.id === id), c = o && mktCo(o.cid); if (!c) return reply({ ok: false });
    b.offers = b.offers.filter(x => x !== o); ERP.book(c).stock[o.pid] = ERP.stockOf(c, o.pid) + o.qty; sync(); reply(mktView());
  });
  socket.on('marketBuy', ({ id, cid, pid, qty } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r), buyer = mktCo(cid), b = MKT.book(street), o = b.offers.find(x => x.id === id);
    if (!buyer || !o || limited() || !MKT.CFG.on) return reply({ ok: false, key: 'market.gone' });
    const seller = street.companies[o.cid], prod = ensureProducts(buyer).find(x => x.id === pid), q = Math.floor(Number(qty)) || o.qty;
    if (!seller || !prod) return reply({ ok: false, key: 'market.gone' });
    if (seller.id === buyer.id || seller.founders.some(f => buyer.founders.includes(f))) return reply({ ok: false, key: 'market.self' });
    if (!(q >= 1 && q <= o.qty)) return reply({ ok: false, key: 'market.badQty' });
    const day = street.day || 0; buyer.market = buyer.market?.day === day ? buyer.market : { day, buys: 0 };
    if (buyer.market.buys >= MKT.CFG.maxBuysPerDay) return reply({ ok: false, key: 'market.dayLimit' });
    const total = q * o.price; if (buyer.cash < total) return reply({ ok: false, key: 'toast.noCash' });
    const fee = MKT.fee(total), net = total - fee;
    buyer.cash -= total; R.track(buyer, 'expenses', total); buyer.market.buys++;
    seller.cash += net; R.track(seller, 'revenue', net);
    ERP.book(buyer).stock[prod.id] = ERP.stockOf(buyer, prod.id) + q;
    o.qty -= q; if (o.qty <= 0) b.offers = b.offers.filter(x => x !== o);
    b.log.unshift({ day, buyer: buyer.name || null, buyerKey: buyer.nameKey || null, seller: seller.name || null, sellerKey: seller.nameKey || null, qty: q, total }); b.log.length = Math.min(b.log.length, 30);
    seller.founders.forEach(f => { const sp = street.players[f]; if (sp) { progress(street, sp, 'trades'); if ((sp.counters.trades || 0) >= 5) award(street, sp, 'trader'); io.to(f).emit('marketSold', { qty: q, coins: net, buyer: buyer.name || null, buyerKey: buyer.nameKey || null }); } });
    progress(street, me, 'trades'); if ((me.counters.trades || 0) >= 5) award(street, me, 'trader');
    audit('market', `${street.id}: ${buyer.id}<-${seller.id} ${q}x${o.price}`);
    sync(); reply({ ...mktView(), bought: { qty: q, total } });
  });

  // ---- Sprint 21a: open-source tools installed on a company (founders only) ----
  const toolCo = cid => { const c = street?.companies[cid]; return c && !c.isNpc && c.status === 'active' && c.founders.includes(me?.id) ? c : null; };
  const toolsReply = (c, extra = {}) => ({ ok: true, day: street.day || 0, scale: TOOLS.CFG.setupScale, max: TOOLS.MAX_TOOLS, wired: [...TOOLS.WIRED], cash: Math.round(c.cash), monthly: TOOLS.hostingMonthly(c), effects: TOOLS.effects(c),
    installed: TOOLS.book(c).map(x => ({ id: x.id, day: x.day, suspended: !!x.suspended })), level: founderLevel(c), ...extra });
  const founderLevel = c => Math.max(1, ...c.founders.map(f => street.players[f]?.stats.level || 1));
  socket.on('toolsGet', ({ cid } = {}, cb) => { const c = toolCo(cid); if (c && typeof cb === 'function') cb(toolsReply(c)); });
  socket.on('toolInstall', ({ cid, id } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r), c = toolCo(cid); if (!c || limited() || typeof id !== 'string') return reply({ ok: false });
    const chk = TOOLS.checkInstall(c, id, founderLevel(c)); if (!chk.ok) return reply(chk);
    c.cash -= chk.cost; R.track(c, 'expenses', chk.cost); TOOLS.place(c, id, street.day || 0);
    const xp = Math.round(chk.tool.game.xpReward / TOOLS.XP_DIV); me.stats.xp += xp; me.stats.level = levelOf(me.stats.xp);
    if (TOOLS.categories(c).size >= 5) award(street, me, 'stackPro');
    progress(street, me, 'tools'); addLog(street, 'log.toolInstalled', { player: me.name, tool: chk.tool.name, ...cParams(c) });
    sync(); reply(toolsReply(c, { xp }));
  });
  socket.on('toolRemove', ({ cid, id } = {}, cb) => {
    const c = toolCo(cid); if (!c || limited() || typeof id !== 'string') return typeof cb === 'function' && cb({ ok: false });
    TOOLS.remove(c, id); sync(); if (typeof cb === 'function') cb(toolsReply(c));
  });
  socket.on('toolReactivate', ({ cid, id } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r), c = toolCo(cid); if (!c || limited() || typeof id !== 'string') return reply({ ok: false });
    const r = TOOLS.reactivate(c, id); if (!r.ok) return reply(r);
    R.track(c, 'expenses', r.cost); sync(); reply(toolsReply(c));
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
      const value = Math.max(1, Math.round(unitPrice(c) * WS[c.workspace].salesMult * cfg.dealMult * incomeMult(street, c) * lifeMult(me) * knowBonus(me)));
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
  // Intercity travel: pay the fare (bus) or the fuel (company car), spend real time on the road, arrive at the other city's terminal
  socket.on('travel', ({ to, mode, cid } = {}) => {
    if (!street || !me || traveling || limited()) return;
    if (!['solo', 'multiplayer'].includes(street.mode)) return;
    const dest = cityMeta(to);
    if (!dest || dest.status !== 'open' || !ECON.cities[to] || to === street.city) return socket.emit('toast', 'toast.cityLocked');
    if (Math.abs((me.x ?? 0) - terminalX(street)) > 280) return socket.emit('toast', 'toast.notAtTerminal');
    const km = distanceKm(street.city, to), by = mode === 'car' ? 'car' : 'bus';
    let fare = 0, car = null;
    if (by === 'bus') {
      fare = Math.max(1, Math.round(km * ECON.intercity.busPerKm));
      if (me.coins < fare) return socket.emit('toast', 'toast.noCoins');
    } else {
      car = founderOf(cid); if (!car?.vehicle) return socket.emit('toast', 'toast.noVehicle');
      fare = Math.max(1, Math.round(km * vehModel(car.vehicle).fuelPerKm * 2)); // fuel there; the way back is paid on the next trip
      if (car.cash < fare) return socket.emit('toast', 'toast.noCash');
    }
    const seconds = tripSeconds(street, km, by), from = street, target = ensureCityRoom(from, to);
    if (by === 'bus') me.coins -= fare; else { car.cash -= fare; R.track(car, 'expenses', fare); R.track(car, 'fuel', fare); }
    // leave the street like a disconnect would (jobs end), but keep solo streets alive: the player's companies keep running
    for (const c of Object.values(from.companies)) c.employees = c.employees.filter(id => id !== socket.id);
    stopDriving('park'); me.loc = null; me.pitch = null; from.pastPlayers[socket.id] = me; delete from.players[socket.id];
    if (from.ownerId === socket.id) from.ownerId = Object.keys(from.players)[0] || null;
    addLog(from, 'log.leftCity', { player: me.name });
    socket.leave(from.id); syncRoom(from); street = null;
    socket.emit('travelStart', { from: from.city, to, mode: by, seconds, km, fare });
    traveling = { timer: setTimeout(() => arrive(target), seconds * 1000) };
  });
  socket.on('disconnect', () => { if (traveling) { clearTimeout(traveling.timer); traveling = null; if (me && me.offlineSince == null) me.offlineSince = Math.min(...Object.values(rooms).filter(r => r.worldId === myWorld).map(r => r.day || 0)); parkWorld(myWorld); } });
  // ----- Sales roleplay: a 3-round conversation with a customer; the server scores every answer -----
  let lastPitch = 0;
  const pitchStep = (pt, last) => socket.emit('pitchStep', { persona: pt.persona, mood: PITCH.PERSONAS[pt.persona].mood, round: pt.round, total: PITCH.ROUNDS, interest: pt.interest, options: pt.options, last: last || null,
    product: pt.product, productKey: pt.productKey, price: pt.price });
  const shuffle = a => { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const j = crypto.randomInt(0, i + 1); [x[i], x[j]] = [x[j], x[i]]; } return x; };
  socket.on('pitchStart', ({ cid, pid } = {}) => {
    if (!street || !me || limited() || !['solo', 'multiplayer'].includes(street.mode)) return;
    const c = street.companies[cid]; if (!c || c.isNpc || !(c.founders.includes(me.id) || c.employees.includes(me.id))) return;
    if (Date.now() - lastPitch < 12000) return socket.emit('toast', 'toast.pitchCooldown');
    const personas = Object.keys(PITCH.PERSONAS), persona = personas[crypto.randomInt(0, personas.length)];
    const prod = ensureProducts(c).find(p => p.id === pid) || ensureProducts(c)[0];
    me.pitch = { cid, pid: prod.id, persona, round: 0, interest: PITCH.startInterest(persona, { level: me.stats.level, knowledge: me.stats.knowledge, discount: prod.discount || 0, bonus: Math.round(TOOLS.effectOf(c, 'conversionRate') * 50) }),
      options: shuffle([1, 2, 3]), product: prod.name || null, productKey: prod.nameKey || null, price: unitPrice(c, prod.id) };
    pitchStep(me.pitch);
  });
  socket.on('pitchAnswer', ({ o } = {}) => {
    const pt = me?.pitch; if (!street || !pt || limited()) return;
    const idx = Number(o); if (!pt.options.includes(idx)) return;
    const quality = PITCH.qualityOf(pt.persona, pt.round, idx), delta = PITCH.SCORE[quality];
    pt.interest = Math.max(0, Math.min(100, pt.interest + delta)); pt.round++;
    if (pt.round < PITCH.ROUNDS && pt.interest > 0) { pt.options = shuffle([1, 2, 3]); return pitchStep(pt, { delta, quality }); }
    // the conversation is over: pay out
    const c = street.companies[pt.cid]; me.pitch = null; lastPitch = Date.now();
    const outcome = pt.interest <= 0 ? 'lost' : PITCH.outcomeOf(pt.interest), R_ = PITCH.REWARD[outcome];
    let revenue = 0;
    if (c && c.status === 'active') {
      const perf = perfFor(c, me), levelBonus = 1 + (me.stats.level - 1) * 0.05;
      const click = Math.max(1, Math.round(unitPrice(c, pt.pid) * WS[c.workspace].salesMult * perf * levelBonus * incomeMult(street, c) * lifeMult(me) * knowBonus(me)));
      revenue = Math.round(click * R_.mult);
      if (revenue > 0 && R_.units > 0) revenue = stockAdjust(c, pt.pid, R_.units, revenue);
      if (revenue > 0) { c.cash += revenue; c.sales += R_.units; R.track(c, 'revenue', revenue); R.track(c, 'units', R_.units); addDelivery(street, c, R_.units); progress(street, me, 'sales', R_.units); progress(street, me, 'revenue', revenue); }
    }
    if (c && c.status === 'active') CRM.record(c, street.day || 0, { name: CRM.randomName(n => crypto.randomInt(0, n)), persona: pt.persona, amount: revenue });
    me.stats.xp += R_.xp * SEED.progression.xpPerClick * (1 + (c ? TOOLS.effectOf(c, 'xpGain') : 0)); me.stats.knowledge = +(me.stats.knowledge + R_.k).toFixed(1); me.stats.level = levelOf(me.stats.xp);
    if (outcome === 'big') { progress(street, me, 'bigDeals'); if ((me.counters.bigDeals || 0) >= 3) award(street, me, 'closer'); }
    socket.emit('pitchResult', { outcome, interest: pt.interest, revenue, xp: R_.xp, last: { delta, quality }, persona: pt.persona, units: R_.units });
    sync();
  });
  socket.on('pitchCancel', () => { if (me?.pitch) { me.pitch = null; lastPitch = Date.now(); } });
  // ----- AFK: the client reports inactivity; coming back shows a summary -----
  socket.on('afk', ({ on } = {}) => {
    if (!street || !me || street.mode === 'presentation') return;
    const flag = !!on; if (!!me.afk === flag) return;
    if (flag) { me.afk = true; me.away = awayBaseline(street, me); }
    else { me.afk = false; const sum = awaySummary(street, me); me.away = null; if (sum) socket.emit('awaySummary', sum); }
    sync();
  });
  // ----- Resume: come back as the same player (new socket) with the secret token issued at the first join -----
  socket.on('resume', ({ roomId, token } = {}) => {
    if (street || traveling) return;
    if (pinFails >= 5) return socket.emit('toast', 'toast.tooManyTries');
    const st = rooms[clean(roomId, 40)], tok = String(token || '');
    const found = st && tok.length === 32 && Object.entries(st.pastPlayers).find(([, p]) => p?.resumeToken && safeEqual(p.resumeToken, tok));
    if (!found) { pinFails++; return socket.emit('toast', 'toast.resumeFailed'); }
    if (Object.values(st.players).some(p => p.resumeToken === tok)) return socket.emit('toast', 'toast.alreadyOnline');
    if (Object.keys(st.players).length >= SEED.maxPlayersPerRoom) return socket.emit('toast', 'toast.roomFull');
    const [oldId, p] = found;
    remapPlayerId(st.worldId, oldId, socket.id);
    me = p; me.id = socket.id; me.afk = false; me.loc = null; delete me.offlineSince;
    street = st; myWorld = st.worldId;
    for (const r of Object.values(rooms)) if (r.worldId === st.worldId) delete r.dormantAt;
    st.players[socket.id] = me; ensureFlat(st, me); if (!st.ownerId || !st.players[st.ownerId]) st.ownerId = socket.id;
    socket.join(st.id); addLog(st, 'log.rejoined', { player: me.name });
    ensureQuests(st, me); socket.emit('joined', { roomId: st.id, mode: st.mode, pin: SHARED_MODES.includes(st.mode) ? st.pin : null, city: st.city, token: me.resumeToken, resumed: true });
    socket.emit('chatHistory', st.chat || []);
    const sum = awaySummary(st, me); me.away = null; if (sum) socket.emit('awaySummary', sum);
    sync();
  });
  // ----- Presence inside buildings -----
  socket.on('enterBuilding', ({ cid } = {}) => {
    if (!street || !me || !street.companies[cid] || street.mode === 'presentation') return;
    me.loc = { cid, floor: 0, x: 380, dir: 1 }; sync();
  });
  // ---- Sprint 23b: apartment flats: visit friends, open/close your door ----
  socket.on('enterFlat', ({ owner } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r);
    if (!street || !me || street.mode === 'presentation' || typeof owner !== 'string') return reply({ ok: false });
    const f = (street.flats || []).find(x => x.id === owner); if (!f) return reply({ ok: false });
    if (owner !== me.id && !f.open) return reply({ ok: false, key: 'toast.flatClosed' });
    me.loc = { cid: flatCid(owner), floor: 0, x: 380, dir: 1 };
    if (owner !== me.id && street.players[owner]) io.to(owner).emit('flatGuest', { name: me.name });
    sync(); reply({ ok: true });
  });
  socket.on('setFlatDoor', ({ open } = {}, cb) => {
    if (!street || !me) return; const f = (street.flats || []).find(x => x.id === me.id); if (!f) return;
    f.open = !!open;
    if (!f.open) for (const p of Object.values(street.players)) if (p.id !== me.id && p.loc?.cid === flatCid(me.id)) { p.loc = null; io.to(p.id).emit('flatClosed', { name: me.name }); }
    sync(); if (typeof cb === 'function') cb({ ok: true, open: f.open });
  });

  socket.on('leaveBuilding', () => { if (!street || !me?.loc) return; me.loc = null; sync(); });
  let lastInner = 0;
  socket.on('innerMove', ({ floor, x, dir } = {}) => {
    if (!street || !me?.loc) return;
    const now = Date.now(); if (now - lastInner < 50) return; lastInner = now;
    const fl = Math.round(Number(floor)), nx = Number(x); if (!Number.isFinite(nx) || !Number.isFinite(fl)) return;
    me.loc.floor = Math.max(0, Math.min(3, fl)); me.loc.x = Math.max(0, Math.min(960, Math.round(nx))); me.loc.dir = dir < 0 ? -1 : 1;
    if (!innerDirty.has(street.id)) innerDirty.set(street.id, new Map());
    innerDirty.get(street.id).set(me.id, { cid: me.loc.cid, floor: me.loc.floor, x: me.loc.x, dir: me.loc.dir });
  });
  // ----- Team: call a teammate to you (they get a prompt with your position) -----
  let lastCall = 0;
  socket.on('teamCall', ({ to } = {}) => {
    if (!street || !me || !me.team) return;
    const t = street.players[String(to)]; if (!t || t.id === me.id || t.team !== me.team) return socket.emit('toast', 'toast.notTeammate');
    const now = Date.now(); if (now - lastCall < 15000) return socket.emit('toast', 'toast.slowDown'); lastCall = now;
    io.to(t.id).emit('teamCall', { from: me.id, name: me.name, x: me.x, cid: me.loc?.cid || null });
    socket.emit('toast', 'toast.callSent');
  });
  socket.on('setSpeed', ({ speed } = {}) => {
    if (!street || !me || street.mode === 'presentation') return;
    if (street.ownerId !== me.id) return socket.emit('toast', 'toast.ownerOnly');
    if (!setRoomSpeed(street, speed)) return;
    addLog(street, 'log.speed', { player: me.name, speed: street.speed });
    sync();
  });
  const TALK_RANGE = 320; // world px (about one building width): who counts as "next to each other"
  const EMOJIS = ['👍', '👏', '😀', '😂', '❤️', '🔥', '🎉', '🤝', '🙏', '😮'];
  let lastEmoji = 0;
  socket.on('emoji', ({ e } = {}) => {
    if (!street || !me || street.mode !== 'multiplayer') return;
    const now = Date.now();
    if (now - lastEmoji < 800 || !EMOJIS.includes(e)) return;
    lastEmoji = now;
    io.to(street.id).volatile.emit('emoji', { pid: me.id, e });
  });
  socket.on('chat', ({ text, to } = {}) => {
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
    if (to != null && street.mode === 'multiplayer') {
      const target = street.players[String(to)];
      if (!target || target.id === me.id) return;
      if (Math.abs((target.x ?? 0) - (me.x ?? 0)) > TALK_RANGE) return socket.emit('toast', 'toast.tooFar');
      msg.to = target.id; msg.toName = target.name;
    }
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

  // ---------- Company vehicle: buy from the gallery (new / used), rent for N days, extend, park (door / car park), sell ----------
  socket.on('vehicle', ({ cid, mode, model, days, where } = {}) => {
    const c = founderOf(cid); if (!c || limited()) return;
    const V = ECON.vehicle, day = street.day || 0;
    if (mode === 'buy') {
      const m = VM(model); if (!m) return;
      if (c.vehicle) return socket.emit('toast', 'toast.hasVehicle');
      if (c.cash < m.price) return socket.emit('toast', 'toast.noCash');
      c.cash -= m.price; R.track(c, 'expenses', m.price);
      const dealer = roleCompany(street, 'carDealer');
      if (dealer && dealer !== c) { dealer.cash += m.price; dealer.sales++; R.track(dealer, 'revenue', m.price); }
      c.vehicle = { type: 'own', model, paid: m.price, since: day, park: 'door', by: { id: me.id, name: me.name } }; ensureVeh(street, c);
    } else if (mode === 'rent') {
      const d = Number(days); if (!V.rentDays.includes(d)) return;
      if (c.vehicle) return socket.emit('toast', 'toast.hasVehicle');
      c.vehicle = { type: 'rent', model: 'sedan_new', since: day, until: day + d, days: d, park: 'door', by: { id: me.id, name: me.name } }; ensureVeh(street, c);
    } else if (mode === 'extend') {
      const d = Number(days); if (!V.rentDays.includes(d) || c.vehicle?.type !== 'rent') return;
      if (c.vehicle.until - day + d > 60) return socket.emit('toast', 'toast.rentMax');
      c.vehicle.until += d; c.vehicle.days += d;
    } else if (mode === 'refuel' || mode === 'service') {
      const v = c.vehicle && ensureVeh(street, c); if (!v) return;
      if (driverOf(street, cid)) return socket.emit('toast', 'toast.carInUse');
      const m = vehModel(v);
      if (mode === 'refuel') {
        const need = v.tank - v.fuel; if (need < 1) return socket.emit('toast', 'toast.tankFull');
        const cost = Math.max(1, Math.round(need * m.fuelPerKm)); if (c.cash < cost) return socket.emit('toast', 'toast.noCash');
        c.cash -= cost; R.track(c, 'fuel', cost); R.track(c, 'expenses', cost); v.fuel = v.tank;
      } else {
        if (v.cond >= 98) return socket.emit('toast', 'toast.carFine');
        const cost = Math.max(1, Math.round((100 - v.cond) * m.price * 0.0002)); if (c.cash < cost) return socket.emit('toast', 'toast.noCash');
        c.cash -= cost; R.track(c, 'expenses', cost); v.cond = 100;
      }
    } else if (mode === 'park') {
      if (!c.vehicle || !['door', 'lot'].includes(where)) return;
      if (driverOf(street, cid)) return socket.emit('toast', 'toast.carInUse');
      c.vehicle.park = where; c.vehicle.x = null;
    } else if (mode === 'none') {
      { const dr = driverOf(street, cid); if (dr) { dr.drive = null; io.to(dr.id).emit('driveStop', { reason: 'sold' }); } }
      if (c.vehicle?.type === 'own') { const back = vehicleValue(street, c); c.cash += back; R.track(c, 'revenue', back); }
      c.vehicle = null;
    } else return;
    if (c.vehicle && mode !== 'park') award(street, me, 'driver');
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

  socket.on('found', ({ lotId, workspace, name, templateIdx, custom, ownership, products, discount } = {}) => {
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
    if (customLabel) { street.companies[cid].product = customLabel; ensureProducts(street.companies[cid])[0].name = customLabel; }
    { // detailed wizard: primary discount + extra products / services
      const nc = street.companies[cid], ps = ensureProducts(nc);
      ps[0].discount = discountOf(discount);
      for (const x of Array.isArray(products) ? products.slice(0, MAX_PRODUCTS - 1) : []) {
        const pn = clean(x?.name, 30), pp = Math.round(Number(x?.price));
        if (pn && priceOk(pp)) ps.push({ id: newPid(), name: pn, nameKey: null, price: pp, discount: discountOf(x.discount) });
      }
    }
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

  socket.on('buy', ({ cid, pid } = {}) => {
    const c = street?.companies[cid];
    if (!c) return;
    const price = unitPrice(c, pid);
    if (limited() || me.coins < price || c.founders.includes(me.id)) return;
    me.coins -= price; c.cash += price; c.sales++;
    R.track(c, 'revenue', price); R.track(c, 'units', 1);
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

  socket.on('click', ({ cid, pid } = {}) => {
    const c = street?.companies[cid];
    if (!c || limited() || !(c.founders.includes(me.id) || c.employees.includes(me.id))) return;
    const perf = perfFor(c, me);
    const levelBonus = 1 + (me.stats.level - 1) * 0.05;
    let value = Math.max(1, Math.round(unitPrice(c, pid) * WS[c.workspace].salesMult * perf * levelBonus * incomeMult(street, c) * lifeMult(me) * knowBonus(me)));
    value = stockAdjust(c, pid, 1, value);
    c.cash += value; c.sales++;
    R.track(c, 'revenue', value); R.track(c, 'units', 1);
    addDelivery(street, c, 1);
    progress(street, me, 'sales'); progress(street, me, 'revenue', value);
    if (Math.random() < CRM.AUTO_CHANCE) { const known = CRM.book(c).customers; const ex = known.length && Math.random() < 0.4 ? known[crypto.randomInt(0, known.length)] : null; CRM.record(c, street.day || 0, { id: ex?.id ?? null, name: CRM.randomName(n => crypto.randomInt(0, n)), persona: ex ? null : ['friendly', 'impatient', 'thrifty', 'skeptical'][crypto.randomInt(0, 4)], amount: value }); }
    me.stats.xp += SEED.progression.xpPerClick * perf * (1 + TOOLS.effectOf(c, 'xpGain'));
    me.stats.knowledge = +(me.stats.knowledge + SEED.progression.knowledgePerClick).toFixed(1);
    me.stats.level = levelOf(me.stats.xp);
    me.stats.performance = perf;
    sync();
  });

  socket.on('withdraw', ({ cid, amount } = {}) => {
    const c = street?.companies[cid];
    if (!c || !c.founders.includes(me.id) || c.cash <= 0) return;
    if (crisisActive(street, c) && CRISES[c.crisis.type].blocksWithdraw) return socket.emit('toast', 'toast.trusteeBlock');
    // Without an amount: the classic 20% split. With an amount (slider / manual): any whole number up to the company's cash.
    const asked = Math.floor(Number(amount));
    const share = amount == null ? Math.floor((c.cash * 0.2) / c.founders.length) : Math.min(c.cash, asked);
    if (!(share > 0)) return;
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
    if (me) { if (me.drive) { const dc = street?.companies[me.drive.cid]; if (dc?.vehicle) { dc.vehicle.x = me.x; dc.vehicle.park = 'street'; } me.drive = null; } me.loc = null; me.pitch = null; if (!me.afk) me.away = awayBaseline(street, me); me.afk = false; me.offlineSince = street.day || 0; }
    syncToAccount(me);
    street.pastPlayers[socket.id] = me;
    delete street.players[socket.id];
    if (street.ownerId === socket.id) street.ownerId = Object.keys(street.players)[0] || null;
    addLog(street, 'log.left', { player: me?.name });
    if (street.mode === 'solo') return parkWorld(street.worldId); // solo worlds are kept for a day when there is a company to come back to
    sync();
  });
});

// ---------- GAME SPEED (per room) ----------
const SPEEDS = [0.5, 1, 2, 3];
// Changing speed mid-day rescales tickAt so the clock does not jump
function setRoomSpeed(st, speed) {
  const next = SPEEDS.includes(Number(speed)) ? Number(speed) : null; if (!next) return false;
  const prev = st.speed || 1, now = Date.now();
  const p = Math.min(1, Math.max(0, (now - st.tickAt) / (SEED.tickSeconds * 1000 / prev)));
  st.tickAt = Math.round(now - p * (SEED.tickSeconds * 1000 / next));
  st.speed = next; return true;
}

// Yearly income tax on each player company's net profit of the year (11 closed months + today)
function payIncomeTax(st) {
  const year = Math.floor(((st.day || 0)) / 360) + 1;
  for (const c of Object.values(st.companies)) {
    if (c.isNpc || c.status !== 'active') continue;
    const f = R.ensureFin(c), net = x => (x.revenue || 0) - (x.expenses || 0) + (x.tax || 0) - (x.losses || 0); // income tax itself is not deductible
    const base = Object.values(f.monthly).filter(m => m.year === year).reduce((s, m) => s + net(m), 0) + net(f.today);
    const gross = incomeTaxCoins(base), tax = Math.round(gross * accountantOf(c).mult);
    c.lastTax = { year, base: Math.max(0, Math.round(base)), tax };
    if (tax <= 0) continue;
    c.cash -= tax; R.track(c, 'expenses', tax); R.track(c, 'tax', tax);
    addLog(st, 'log.incomeTax', { year, amount: tax, ...cParams(c) });
  }
}

// ---------- ECONOMY TICK (1 tick = 1 game day) ----------
// Sprint 26 (weekly race): every 7 days players are ranked by revenue earned that week. Multiplayer: top-3 get coins; solo: bonus for beating own best week
const weekScores = st => Object.values(st.players).filter(p => !p.isNpc).map(p => ({ id: p.id, name: p.name, score: Math.max(0, Math.round((p.counters?.revenue || 0) - (p.weekBase || 0))) })).sort((a, b) => b.score - a.score);
function weekSettle(st) {
  if (!st.day || st.day % 7 !== 0) return;
  const n = st.day / 7, rank = weekScores(st), multi = rank.length > 1, prizes = [BAL.CFG.raceFirst, BAL.CFG.raceSecond, BAL.CFG.raceThird];
  rank.forEach((r, i) => {
    const p = st.players[r.id]; if (!p) return;
    let coins = 0;
    if (multi) { if (r.score > 0 && i < 3) coins = Math.round(prizes[i]); }
    else if (r.score > (p.bestWeek || 0) && r.score > 0) coins = Math.round(BAL.CFG.raceFirst / 2);
    p.bestWeek = Math.max(p.bestWeek || 0, r.score);
    if (coins) p.coins += coins;
    io.to(p.id).emit('weekEnd', { week: n, rank: i + 1, of: rank.length, score: r.score, coins, solo: !multi });
  });
  st.lastWeek = { week: n, rank: rank.slice(0, 5) };
  const ev = EVT.roll(st);
  if (ev) { if (st.event) st.lastEventId = st.event.id; st.event = ev; addLog(st, 'log.marketEvent', { eventKey: 'event.' + ev.id }); io.to(st.id).emit('marketEvent', { id: ev.id, until: ev.until, tone: EVT.EVENTS[ev.id].tone }); }
  for (const p of Object.values(st.players)) p.weekBase = p.counters?.revenue || 0;
}
// Sprint 26a: monthly shared goal. Settled at day % 30 === 0, then the next goal starts
function goalSettle(st) {
  if (!BAL.CFG.goalOn) { st.goal = null; return; }
  const g = st.goal;
  if (g && (st.day || 0) >= g.endDay) {
    const prog = GOALS.progress(st, g), ok = prog >= g.target, big = prog >= g.target * 1.5, cs = GOALS.contrib(st, g);
    for (const p of Object.values(st.players)) {
      if (p.isNpc) continue;
      const mine = cs[p.id] || 0, eligible = ok && mine >= g.perPlayer * GOALS.MIN_SHARE, coins = eligible ? Math.round(BAL.CFG.goalReward * (big ? 1.5 : 1)) : 0;
      if (coins) { p.coins += coins; p.counters ||= {}; p.counters.teamGoals = (p.counters.teamGoals || 0) + 1; award(st, p, 'teamGoal'); }
      io.to(p.id).emit('goalEnd', { n: g.n, type: g.type, ok, progress: prog, target: g.target, mine, coins, big });
    }
    addLog(st, ok ? 'log.goalMet' : 'log.goalMissed', { n: g.n, goalKey: 'goal.' + g.type });
    st.goal = null;
  }
  if (!st.goal) GOALS.start(st, BAL.CFG.goalDifficulty);
}
const publicGoal = st => {
  if (!BAL.CFG.goalOn) return null;
  if (!st.goal) GOALS.start(st, BAL.CFG.goalDifficulty);
  const g = st.goal, cs = GOALS.contrib(st, g);
  return { n: g.n, type: g.type, target: g.target, perPlayer: g.perPlayer, progress: Object.values(cs).reduce((a, b) => a + b, 0), left: Math.max(0, g.endDay - (st.day || 0)), minShare: GOALS.MIN_SHARE, contrib: cs };
};
// Sprint 26b: expired wholesale offers return their reserved stock to the seller
function marketTick(st) {
  if (!st.market?.offers?.length) return;
  MKT.expire(st, o => { const c = st.companies[o.cid]; if (c) { const b = ERP.book(c); b.stock[o.pid] = ERP.stockOf(c, o.pid) + o.qty; } });
}
// Sprint 29a: player partners hold equity in a company (cap on outside equity); every 30 days they receive their share of the last 30 days' profit
const partnerPct = c => Object.values(c.partners || {}).reduce((a, b) => a + b, 0);
const outsidePct = c => partnerPct(c) + (c.npcEquity || 0);
function partnerTick(st) {
  const day = st.day || 0;
  for (const c of Object.values(st.companies)) {
    if (c.pOffers?.length) c.pOffers = c.pOffers.filter(o => o.until > day);
    if (c.isNpc || !c.partners || !Object.keys(c.partners).length || day % 30 !== 0) continue;
    const profit = (c.fin?.daily || []).slice(-30).reduce((a, d) => a + (d.revenue || 0) - (d.expenses || 0), 0);
    if (profit <= 0) { addLog(st, 'log.partnerNoPayout', cParams(c)); continue; }
    const budget = Math.max(0, c.cash) * 0.5; let paid = 0;
    for (const [pid, pct] of Object.entries(c.partners)) {
      const amt = Math.min(Math.floor(profit * pct / 100), Math.floor(budget - paid)); if (amt <= 0) continue;
      const pl = st.players[pid] || st.pastPlayers[pid]; if (!pl) continue;
      pl.coins += amt; paid += amt; c.cash -= amt; R.track(c, 'expenses', amt);
      pl.counters ||= {}; pl.counters.dividends = (pl.counters.dividends || 0) + amt;
      io.to(pid).emit('dividend', { amount: amt, ...cParams(c) });
    }
    if (paid) addLog(st, 'log.partnerPayout', { amount: paid, ...cParams(c) });
  }
}
function economyTick(only) {
  for (const st of only ? [only] : Object.values(rooms)) {
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
      const opx = 1 - TOOLS.effectOf(c, 'operatingCostReduction');
      const rentPart = costPerTick(st, c) * opx, payroll = c.employees.length * (SEED.salary + c.benefitCost) + npcSalaries;
      let ub = { total: 0 }, stamp = 0, acctFee = 0;
      if (!c.isNpc) {
        ub = utilityBills(st, c); if (opx < 1) ub = { ...ub, total: ub.total * opx }; { const bm = EVT.billMult(st); if (bm !== 1) ub = { ...ub, total: ub.total * bm }; }
        // fractional taxes / fees accumulate and are charged in whole coins (same trick as fuel)
        c.stampAcc = (c.stampAcc || 0) + rentPart * ECON.tax.stampContract + payroll * ECON.tax.stampPayroll;
        stamp = Math.floor(c.stampAcc); c.stampAcc -= stamp;
        c.acctAcc = (c.acctAcc || 0) + accountantOf(c).feeDaily;
        acctFee = Math.floor(c.acctAcc); c.acctAcc -= acctFee;
      }
      let repair = 0;
      if (c.vehicle && !c.isNpc) {
        { const v = ensureVeh(st, c); v.cond = Math.max(0, v.cond - AGE_PER_DAY[vehModel(v).cond === 'new' ? 'new' : 'used']); }
        // street parking can get a car scratched / hit; a paid car park cannot
        if (c.vehicle.park !== 'lot' && Math.random() < ECON.vehicle.damage.chancePerDay) {
          const base = c.vehicle.type === 'own' ? vehicleValue(st, c) : Math.round(ECON.vehicle.models.sedan_new.price * 0.5);
          repair = Math.max(1, Math.round(base * ECON.vehicle.damage.share)); c.vehicle.cond = Math.max(0, (c.vehicle.cond ?? 100) - 6); addLog(st, 'log.carDamaged', { amount: repair, ...cParams(c) });
        }
        if (c.vehicle.type === 'rent' && c.vehicle.until != null && (st.day || 0) + 1 >= c.vehicle.until) { { const dr = driverOf(st, c.id); if (dr) { dr.drive = null; io.to(dr.id).emit('driveStop', { reason: 'sold' }); } } c.vehicle = null; addLog(st, 'log.rentEnded', cParams(c)); }
      }
      const cost = rentPart + ub.total + payroll + fuel + vehicle + stamp + acctFee + repair;
      c.cash -= cost;
      R.track(c, 'expenses', cost); R.track(c, 'utilities', ub.total); R.track(c, 'stampTax', stamp); R.track(c, 'accounting', acctFee);
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
        const pf = portfolio(c);
        const income = Math.round(factor * pf.price * pf.demand * WS[c.workspace].salesMult * c.performance * incomeMult(st, c));
        c.cash += income; R.track(c, 'revenue', income); R.track(c, 'units', c.npcStaff);
        addDelivery(st, c, c.npcStaff);
      }
      if (c.marketing && !marketingActive(st, c)) c.marketing = null;
    }
    idleTick(st);
    for (const p of Object.values(st.players)) lifeTick(st, p);
    billAds(st);
    if (((st.day || 0) + 1) % 360 === 0) payIncomeTax(st);
    if (((st.day || 0) + 1) % 30 === 0) for (const c of Object.values(st.companies)) if (!c.isNpc && c.tools?.length) {
      const r = TOOLS.chargeMonth(c); if (r.paid) R.track(c, 'expenses', r.paid);
      if (r.suspended.length) addLog(st, 'log.toolsSuspended', { n: r.suspended.length, ...cParams(c) });
    }
    R.closeDay(st);
    for (const p of Object.values(st.players)) { checkLevel(p); syncToAccount(p); }
    partnerTick(st);
    weekSettle(st);
    goalSettle(st);
    marketTick(st);
    st.tickAt = Date.now();
    for (const c of Object.values(st.companies)) {
      if (c.crisis && !crisisActive(st, c)) { addLog(st, 'log.crisisOver', cParams(c)); c.crisis = null; c.founders.forEach(pid => award(st, st.players[pid], 'survivor')); }
      const fl = floorsOf(st, c);
      c.founders.forEach(pid => { const p = st.players[pid]; if (!p) return; if (fl >= 3) award(st, p, 'floor3'); if (fl >= 6) award(st, p, 'floor6'); if (c.cash >= 10000) award(st, p, 'tycoon'); });
      if (!c.isNpc && c.erp) { const r = ERP.tick(c, st.day || 0, ensureProducts(c).map(x => x.id)); if (r.streakReached) c.founders.forEach(pid => award(st, st.players[pid], 'stockMaster')); }
      if (c.cash < -200) { addLog(st, 'log.bankrupt', cParams(c)); archiveCompany(st, c, 'bankrupt'); }
    }
    syncRoom(st);
  }
}
let tickTimer = null;
// Each room advances on its own clock: a day lasts tickSeconds / speed
const scheduleTick = () => { clearInterval(tickTimer); tickTimer = setInterval(() => {
  const now = Date.now();
  for (const st of Object.values(rooms)) if (now - (st.tickAt || 0) >= SEED.tickSeconds * 1000 / (st.speed || 1)) economyTick(st);
}, 1000); };
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
    const rid = clean(id, 40);
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
        archived: st.archive.length, adsPending: Object.values(st.ads || {}).filter(a => a.pending).length,
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
  const room = id => rooms[clean(id, 40)];

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
  // ----- Advertising moderation -----
  const adList = st => ADS.allSlots(adCtx(st)).map(s => { const a = st.ads[s.id] || {}, c = st.companies[a.owner];
    return { id: s.id, kind: s.kind, price: s.price, owner: a.owner || null, ownerName: a.owner === 'admin' ? 'Admin' : c ? (c.name || c.nameKey) : null, ownerNameKey: !c?.name && c ? c.nameKey : null,
      live: a.live || null, pending: a.pending || null, rejected: a.rejected || null }; });
  socket.on('adminGetPremium', (_, cb) => { if (typeof cb === 'function') cb({ features: PREMIUM_FEATURES.map(f => ({ ...f, on: !!PREMIUM[f.key] })), cities: ECON.cityMap.filter(c => c.baseStatus === 'premium').map(c => c.name) }); });
  socket.on('adminSetPremium', ({ feature, on } = {}, cb) => {
    const f = PREMIUM_FEATURES.find(x => x.key === feature);
    if (!f || !f.live || typeof on !== 'boolean') return typeof cb === 'function' && cb({ ok: false });
    PREMIUM[feature] = on; applyPremium(); savePremium();
    audit('premium', `${feature}: ${on ? 'on' : 'off'}`);
    io.emit('seed', publicSeed()); push();
    if (typeof cb === 'function') cb({ ok: true, on });
  });
  socket.on('adminGetToolsCfg', (_, cb) => { if (typeof cb === 'function') cb({ cfg: { ...TOOLS.CFG }, ranges: TOOLS.RANGES }); });
  socket.on('adminSetToolsCfg', (patch, cb) => {
    if (typeof patch !== 'object' || !patch) return typeof cb === 'function' && cb({ ok: false });
    const cfg = TOOLS.setConfig(patch); saveToolsCfg(); audit('toolsConfig', JSON.stringify(cfg));
    if (typeof cb === 'function') cb({ ok: true, cfg });
  });
  socket.on('adminGetEventsCfg', (_, cb) => { if (typeof cb === 'function') cb({ cfg: EVT.state(), ranges: EVT.RANGES, events: Object.fromEntries(Object.entries(EVT.EVENTS).map(([k, v]) => [k, { days: v.days, tone: v.tone, income: v.income, bills: v.bills }])) }); });
  socket.on('adminSetEventsCfg', (patch, cb) => {
    if (typeof patch !== 'object' || !patch) return typeof cb === 'function' && cb({ ok: false });
    const cfg = EVT.setConfig(patch); saveEventsCfg(); audit('eventsConfig', JSON.stringify(cfg));
    if (typeof cb === 'function') cb({ ok: true, cfg });
  });
  socket.on('adminStartEvent', ({ roomId, id } = {}, cb) => {
    if (!EVT.EVENTS[id]) return typeof cb === 'function' && cb({ ok: false });
    const targets = roomId ? [rooms[roomId]].filter(Boolean) : Object.values(rooms); let n = 0;
    for (const st of targets) {
      if (st.event) st.lastEventId = st.event.id;
      st.event = { id, start: st.day || 0, until: (st.day || 0) + EVT.EVENTS[id].days };
      addLog(st, 'log.marketEvent', { eventKey: 'event.' + id }); io.to(st.id).emit('marketEvent', { id, until: st.event.until, tone: EVT.EVENTS[id].tone }); syncRoom(st); n++;
    }
    audit('eventStart', `${roomId || 'all'}:${id}`);
    if (typeof cb === 'function') cb({ ok: true, rooms: n });
  });
  socket.on('adminGetMarketCfg', (_, cb) => { if (typeof cb === 'function') cb({ cfg: { ...MKT.CFG }, ranges: MKT.RANGES }); });
  socket.on('adminSetMarketCfg', (patch, cb) => {
    if (typeof patch !== 'object' || !patch) return typeof cb === 'function' && cb({ ok: false });
    const cfg = MKT.setConfig(patch); saveMarketCfg(); audit('marketConfig', JSON.stringify(cfg));
    if (typeof cb === 'function') cb({ ok: true, cfg });
  });
  socket.on('adminGetBalanceCfg', (_, cb) => { if (typeof cb === 'function') cb({ cfg: { ...BAL.CFG }, ranges: BAL.RANGES }); });
  socket.on('adminSetBalanceCfg', (patch, cb) => {
    if (typeof patch !== 'object' || !patch) return typeof cb === 'function' && cb({ ok: false });
    const cfg = BAL.setConfig(patch); saveBalanceCfg(); audit('balanceConfig', JSON.stringify(cfg));
    if (typeof cb === 'function') cb({ ok: true, cfg });
  });
  // ---- Sprint 22: building content CRUD (documents are validated field by field in content.js) ----
  socket.on('adminContentGet', ({ name } = {}, cb) => { if (typeof cb !== 'function') return; const doc = CONTENT.read(String(name)); cb(doc ? { ok: true, doc, overridden: CONTENT.isOverridden(name), def: name === 'open-source-tools' ? { effectStats: CONTENT.readDefault(name).effectStats } : undefined } : { ok: false }); });
  socket.on('adminContentSet', ({ name, doc } = {}, cb) => {
    const reply = r => typeof cb === 'function' && cb(r); if (typeof name !== 'string' || typeof doc !== 'object' || !doc) return reply({ ok: false, error: 'geçersiz istek' });
    const r = CONTENT.write(name, doc); if (!r.ok) return reply(r);
    if (name === 'open-source-tools') TOOLS.setCatalog(r.doc);
    audit('content', `${name} güncellendi`); io.emit('contentUpdated', { name }); reply({ ok: true, doc: r.doc });
  });
  socket.on('adminContentReset', ({ name } = {}, cb) => {
    if (!CONTENT.reset(String(name))) return typeof cb === 'function' && cb({ ok: false });
    if (name === 'open-source-tools') TOOLS.setCatalog(CONTENT.readDefault(name));
    audit('content', `${name} varsayılana döndü`); io.emit('contentUpdated', { name }); if (typeof cb === 'function') cb({ ok: true, doc: CONTENT.read(name) });
  });
  socket.on('adminListAds', ({ roomId } = {}, cb) => { const st = room(roomId); if (st && typeof cb === 'function') cb({ slots: adList(st) }); });
  socket.on('adminAdDecision', ({ roomId, slot, approve, reason } = {}) => {
    const st = room(roomId), s = st && adSlot(st, slot), a = s && st.ads[s.id]; if (!a?.pending) return;
    const c = st.companies[a.owner];
    if (approve) { a.live = { ...a.pending }; a.pending = null; a.rejected = null; if (c) addLog(st, 'log.adApproved', { kindKey: 'ad.kind.' + s.kind, ...cParams(c) }); }
    else { a.pending = null; a.rejected = clean(reason, 80) || 'rejected'; if (c) addLog(st, 'log.adRejected', { kindKey: 'ad.kind.' + s.kind, ...cParams(c) }); }
    audit(approve ? 'adApprove' : 'adReject', `${st.id}: ${s.id}`); syncRoom(st); push();
  });
  // Admin places an ad directly (house ads, real-world promotions): no approval needed
  socket.on('adminAdSet', ({ roomId, slot, creative } = {}) => {
    const st = room(roomId), s = st && adSlot(st, slot); if (!s) return;
    const r = ADS.cleanCreative(creative); if (!r.ok) return socket.emit('toast', 'toast.adBadUrl');
    const a = adState(st, s.id); if (a.owner && a.owner !== 'admin') return socket.emit('toast', 'toast.adTaken');
    a.owner = 'admin'; a.live = { ...r.creative, at: Date.now() }; a.pending = null; a.rejected = null;
    audit('adSet', `${st.id}: ${s.id}`); syncRoom(st); push();
  });
  socket.on('adminAdClear', ({ roomId, slot } = {}) => {
    const st = room(roomId), s = st && adSlot(st, slot); if (!s || !st.ads[s.id]) return;
    delete st.ads[s.id]; audit('adClear', `${st.id}: ${s.id}`); syncRoom(st); push();
  });
  socket.on('adminSetSpeed', ({ roomId, speed } = {}) => {
    const st = room(roomId); if (!st || !setRoomSpeed(st, speed)) return;
    audit('setSpeed', `${st.id}: ${st.speed}x`); syncRoom(st); push();
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

// ---------- PERSISTENCE: rooms survive a server restart (data/rooms.json; swap for a database later) ----------
// Everyone online at save time is stored as "offline": after a restart players come back with their resume token.
const DATA_DIR = path.join(__dirname, 'data'), ROOMS_FILE = path.join(DATA_DIR, 'rooms.json'), ROOMS_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
function saveRooms() {
  try {
    const out = {};
    for (const [id, st] of Object.entries(rooms)) out[id] = { ...st, players: {}, pastPlayers: { ...st.pastPlayers, ...st.players } };
    fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
    const tmp = ROOMS_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, savedAt: Date.now(), rooms: out }), { mode: 0o600 });
    fs.renameSync(tmp, ROOMS_FILE);
    return Object.keys(out).length;
  } catch (e) { console.warn('rooms save failed:', e.message); return -1; }
}
function loadRooms() {
  let data; try { data = JSON.parse(fs.readFileSync(ROOMS_FILE, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') console.warn('rooms load failed:', e.message); return 0; }
  if (!data || data.version !== 1 || typeof data.rooms !== 'object' || Date.now() - (data.savedAt || 0) > ROOMS_MAX_AGE_MS) return 0;
  let n = 0;
  for (const [id, st] of Object.entries(data.rooms).slice(0, 300)) {
    if (!st || !Array.isArray(st.lots) || typeof st.companies !== 'object' || rooms[id]) continue;
    const rid = clean(id, 40);
    rooms[rid] = { ...st, id: rid, players: {}, pastPlayers: st.pastPlayers || {}, archive: st.archive || [], ideas: st.ideas || [], log: st.log || [], ads: st.ads || {}, worldId: st.worldId || rid, tickAt: Date.now() };
    rooms[rid].flats ||= Object.entries(rooms[rid].pastPlayers).filter(([, p]) => p).map(([pid, p]) => ({ id: pid, name: p.name, open: true }));
    for (const p of Object.values(rooms[rid].pastPlayers)) { if (p) { p.loc = null; p.afk = false; if (p.offlineSince == null) p.offlineSince = st.day || 0; if (!p.away) p.away = awayBaseline(rooms[rid], p); } }
    n++;
  }
  return n;
}
const restored = loadRooms(); if (restored) console.log(`Restored ${restored} room(s) from ${ROOMS_FILE}`);
setInterval(saveRooms, 60000);
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => { const n = saveRooms(); console.log(`Saved ${n} room(s) on ${sig}`); process.exit(0); });

server.listen(PORT, () => console.log(`Game: http://localhost:${PORT}  Admin: http://localhost:${PORT}/admin.html`));
