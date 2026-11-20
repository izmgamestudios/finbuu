// public/js/app.js
// Finbuu client: scenes (street <-> zoom <-> company interior), input (keys, click, joystick), advisor (OK / Next / Auto),
// HUD, status overlay (FPS / ping / sync), leaderboard layer, NPC dialogs with ID cards, department panels,
// founding wizard, chat + polls, presentation (watch-only) mode. The server stays authoritative for every action.
import { layout, draw, createNpcs, createTraffic, worldWidth, WORLD_H, GROUND, MAX_FLOORS, drawPerson, lookFor, teamLook } from './world.js';
import { paintAd, AD_SIZE } from './ads.js';
import { renderTrMap } from './trmap.js';
import { suggestions, companyActions, employeeCap, maxTenants, staffOf, floorsFor, floorsOfCompany, deptOpen } from './advisor.js';
import { drawInterior, staffLooks, IW, IH, FH, FLOORS, ELEV, floorBase, roomOf, roomCenter, DEPT_ICON, HOME_ROOMS, HOME_FLOORS } from './interior.js';

const { i18next, io, Chart } = window;
const $ = id => document.getElementById(id);
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
const cv = $('cv'), ctx = cv.getContext('2d'), stage = $('stage');
const touch = matchMedia('(pointer: coarse)').matches;
const SPEED = 170, RUN_MULT = 1.75, MOVE_SEND_MS = 100, AUTO_MS = 1500, NPC_COUNT = 7, NPC_PRESENTATION = 4, NPC_LOW = 3;
const INNER_PAD_TOP = 70, INNER_PAD_BOTTOM = 80;
const ZOOM_IN_MS = 520, ZOOM_OUT_MS = 420, FADE_MS = 260, TOUR_MS = 7000;

// ---------- state ----------
let seed = null, state = null, joined = null, buildings = layout(null), spawned = false;
const view = { w: 0, h: 0, s: 1, ty: 0, camX: 0, dpr: 1 };
const player = { x: 120, dir: 1, phase: 0, moving: false, target: null, onArrive: null, targetId: null };
const others = new Map(); // id -> { x, tx, dir, phase, moving }
const bubbles = new Map(); // playerId -> { text | emoji, until } (speech bubbles over heads)
const TALK_RANGE = 320, TALK_NEAR = 150;
const EMOJIS = ['👍', '👏', '😀', '😂', '❤️', '🔥', '🎉', '🤝', '🙏', '😮']; // must match the server allow-list
const npcs = createNpcs(NPC_COUNT);
const traffic = createTraffic();
let ride = null, nearStop = null, clockOffset = 0, lastDay = null;
const keys = new Set();
const joy = { axis: 0, id: null, run: false };
let near = null, nearNpc = null, nearPlayer = null, plan = null, auto = false, advIdx = 0, ranked = [], modalOpen = false, modalOnClose = null;
let lastSent = { x: -1, at: 0 };
const met = new Set(loadJSON('met', []));
const votedPolls = new Set();
const histCache = new Map(); // cid -> { at, data }
// scene: street | zoomIn | interior | zoomOut
const scene = { name: 'street', t0: 0, b: null, cid: null, kind: null }; // kind: 'company' | 'home' while inside a building
const inner = { x: 120, floor: 0, dir: 1, moving: false, phase: 0, target: null, onArrive: null };
const iview = { w: 0, h: 0, s: 1, camX: 0, camY: 0, dpr: 1 };
// perf / status
const perf = { fps: 60, frameMs: 0, ping: null, syncTimes: [], stateKB: 0, stateCount: 0, quality: 'auto', low: false, lowSince: 0, highSince: 0 };
let showStatus = loadJSON('status', true), boardOpen = false, focusOverride = null, tour = { idx: 0, at: 0 };

// Money: the game runs in coins; Turkish players see real ₺ (1 coin calibrated to the 2026 minimum-wage employer cost)
// only these params are money (coins); counts like n / max / level stay numbers
const MONEY_KEYS = new Set(['amount', 'price', 'cash', 'cost', 'salary', 'profit', 'dep', 'fare', 'balance', 'rent', 'buy', 'fuel', 'sale']);
const RATE = () => seed?.economy?.rate || 1;
const isTR = () => (i18next.language || '').startsWith('tr');
function money(n, compact = false) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (!isTR()) { const a = Math.abs(n); const v = compact && a >= 10000 ? (a / 1000).toFixed(1) + 'k' : Math.round(a).toLocaleString('en'); return (n < 0 ? '−' : '') + v + 'c'; }
  const v = n * RATE();
  return new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0, notation: compact && Math.abs(v) >= 100000 ? 'compact' : 'standard' }).format(v);
}
const tl = v => new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY', maximumFractionDigits: 0 }).format(v); // raw real ₺ (reference data)
const t = (k, o) => {
  if (!i18next.isInitialized) return k;
  let p = o;
  if (o) { p = { ...o }; for (const [key, v] of Object.entries(o)) if (MONEY_KEYS.has(key) && typeof v === 'number') p[key] = money(v); }
  return i18next.t(k, { interpolation: { escapeValue: false }, ...p });
};
const resolve = p => { const out = { ...p }; for (const [k, v] of Object.entries(p || {})) if (k.endsWith('Key')) out[k.slice(0, -3)] = t(v); return out; };
const companyName = c => c.name || t(c.nameKey);
const myId = () => socket.id;
const me = () => state?.players?.[myId()];
const fmt = n => money(n, true); // every fmt() in this file is a money value
const sectorOf = c => c?.sector || seed?.templates.find(tp => tp.key === c?.nameKey)?.sector;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wWidth = () => worldWidth(state?.lots.length || 12);
const isPres = () => joined?.mode === 'presentation';
const isMember = c => c && (c.founders.includes(myId()) || c.employees.includes(myId()));
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function loadJSON(k, d) { try { const v = localStorage.getItem('finbuu.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } }
function saveJSON(k, v) { try { localStorage.setItem('finbuu.' + k, JSON.stringify(v)); } catch { /* private mode */ } }

function toast(msg) {
  const tEl = $('toast'); tEl.textContent = msg; tEl.style.display = 'block';
  clearTimeout(toast.timer); toast.timer = setTimeout(() => (tEl.style.display = 'none'), 3000);
}

// ---------- i18n ----------
async function loadLang(lng) {
  if (!i18next.hasResourceBundle(lng, 'translation')) i18next.addResourceBundle(lng, 'translation', await fetch(`/locales/${lng}.json`).then(r => r.json()));
  await i18next.changeLanguage(lng);
  saveJSON('lang', lng);
  document.documentElement.lang = lng;
  document.title = t('ui.title') + ' · ' + t('ui.slogan');
  document.querySelectorAll('[data-i18n]').forEach(e => (e.textContent = t(e.dataset.i18n)));
  document.querySelectorAll('[data-i18n-ph]').forEach(e => (e.placeholder = t(e.dataset.i18nPh)));
  $('recAudio').textContent = '☁🔒 ' + t('ui.recAudio');
  $('recVideo').textContent = '☁🔒 ' + t('ui.recVideo');
  updateControls(); renderSeed(); renderRoomBar(); render(); updateAutoBtn(); applyTheme(); updateSpeedBtn();
  document.querySelectorAll('#side .card > h3.fold').forEach(h => (h.title = t('ui.collapse')));
}
function renderSeed() {
  if (!seed || !i18next.isInitialized) return;
  realSig = ''; renderRealData();
  $('tut').replaceChildren(...seed.tutorial.map(k => el('li', t(k))));
  $('locked').replaceChildren(...seed.locked.map(k => { const s = el('span', '☁🔒 ' + t(k), 'locked'); s.onclick = () => toast(t('ui.premiumAlert', { feature: t(k) })); return s; }));
}

// ---------- Navigation ----------
const openDrawer = v => { $('drawer').classList.toggle('open', v); $('scrim').classList.toggle('show', v); };
$('menuBtn').onclick = () => openDrawer(true);

// ---------- Theme: system / light / dark ----------
const THEMES = ['system', 'light', 'dark'], THEME_ICON = { system: '🌓', light: '☀️', dark: '🌙' };
let themeMode = (() => { try { const v = localStorage.getItem('finbuu.theme'); return THEMES.includes(v) ? v : 'system'; } catch { return 'system'; } })();
function applyTheme() {
  const root = document.documentElement;
  if (themeMode === 'system') root.removeAttribute('data-theme'); else root.dataset.theme = themeMode;
  const dark = themeMode === 'dark' || (themeMode === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#171a22' : '#f4f6fb');
  const b = $('themeBtn'); b.textContent = THEME_ICON[themeMode];
  b.title = b.ariaLabel = t('ui.theme' + themeMode[0].toUpperCase() + themeMode.slice(1));
}
$('themeBtn').onclick = () => { themeMode = THEMES[(THEMES.indexOf(themeMode) + 1) % 3]; try { localStorage.setItem('finbuu.theme', themeMode); } catch {} applyTheme(); };
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => themeMode === 'system' && applyTheme());

// ---------- Collapsible panels (state remembered in the browser) ----------
const ui = { ...(() => { try { return JSON.parse(localStorage.getItem('finbuu.ui') || '{}'); } catch { return {}; } })() };
const saveUi = () => { try { localStorage.setItem('finbuu.ui', JSON.stringify(ui)); } catch {} };
function applyUi() {
  document.body.classList.toggle('noSide', !!ui.noSide);
  document.body.classList.toggle('noHud', !!ui.noHud);
  document.body.classList.toggle('noAdv', !!ui.noAdv);
  document.querySelectorAll('#side .card[data-panel]').forEach(c => c.classList.toggle('collapsed', !!ui.cards?.[c.dataset.panel]));
  $('hudBtn').textContent = ui.noHud ? '▸' : '▾';
}
document.querySelectorAll('#side .card[data-panel] > h3').forEach(h => {
  h.classList.add('fold'); h.tabIndex = 0; h.title = t('ui.collapse');
  const toggle = () => { const k = h.parentElement.dataset.panel; (ui.cards ||= {})[k] = !ui.cards[k]; saveUi(); applyUi(); };
  h.onclick = toggle; h.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } };
});
$('sideBtn').onclick = () => { ui.noSide = !ui.noSide; saveUi(); applyUi(); setTimeout(() => dispatchEvent(new Event('resize')), 50); };
$('hudBtn').onclick = () => { ui.noHud = !ui.noHud; saveUi(); applyUi(); };
renderEmojiBar(); applyUi();
$('closeDrawer').onclick = $('scrim').onclick = () => openDrawer(false);
$('openModes').onclick = () => { openDrawer(false); showModes(); };
$('openIdeas').onclick = () => { openDrawer(false); showTab('ideas'); };
$('openGuide').onclick = () => { openDrawer(false); showTab('guide'); };
$('toggleStatus').onclick = () => { showStatus = !showStatus; saveJSON('status', showStatus); $('status').hidden = !showStatus; };
$('quality').value = perf.quality;
$('quality').onchange = e => { perf.quality = e.target.value; perf.low = perf.quality === 'low'; resize(); };
function showTab(tab) {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  $('side').classList.toggle('open', tab !== 'street');
  document.querySelectorAll('#side .card').forEach(c => c.classList.toggle('active', c.dataset.panel === tab));
  if (tab === 'finance') renderFinance(true);
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => (b.dataset.tab === 'menu' ? openDrawer(true) : showTab(b.dataset.tab)));
$('lang').onchange = e => loadLang(e.target.value);
$('recAudio').onclick = $('recVideo').onclick = () => toast(t('ui.premiumAlert', { feature: t('locked.mediaIdeas') }));
$('boardBtn').onclick = () => toggleBoard();

// ---------- Socket ----------
const socket = io({ transports: ['websocket', 'polling'] });
socket.on('seed', s => {
  seed = s; renderSeed();
  if (!joined && modalOpen && $('modalBody').dataset.modes) showModes(); // seed (cities) arrived after the mode screen opened
});
socket.on('state', s => {
  const now = performance.now();
  perf.syncTimes.push(now); if (perf.syncTimes.length > 10) perf.syncTimes.shift();
  if (perf.stateCount++ % 5 === 0) perf.stateKB = JSON.stringify(s).length / 1024;
  clockOffset = (s.serverNow || Date.now()) - Date.now();
  if (lastDay != null && s.day > lastDay) morningRush(s);
  lastDay = s.day;
  state = s;
  buildings = layout(state);
  npcs.setWidth(wWidth());
  const mine = s.players[myId()];
  if (mine && !spawned) { player.x = mine.x ?? 120; spawned = true; }
  for (const [id, p] of Object.entries(s.players)) {
    if (id === myId()) continue;
    if (!others.has(id)) others.set(id, { x: p.x ?? 120, tx: p.x ?? 120, dir: p.dir || 1, phase: 0, moving: false });
  }
  for (const id of others.keys()) if (!s.players[id]) others.delete(id);
  if (scene.cid && !state.companies[scene.cid] && scene.name !== 'street') exitCompany(true);
  render();
});
socket.on('posBatch', list => { for (const [id, x, dir] of list) { const o = others.get(id); if (o) { o.tx = x; o.dir = dir; } } });
socket.on('toast', k => toast(t(k)));
socket.on('announce', msg => toast(`${t('ui.announce')}: ${msg}`));
socket.on('npcEvent', ({ cid, type }) => {
  const c = state?.companies[cid]; if (!c) return;
  const b = buildingOf(c.lotId == null ? { kind: 'plaza' } : { kind: 'lot', lotId: c.lotId });
  const emoji = { customer: '🛍', sponsor: '📣', investor: '💼', thief: '🦹', scammer: '🎭' }[type] || '⚠️';
  if (b && !perf.low) npcs.spawnVisitor(b.x + b.w / 2, emoji);
});
socket.on('npcResult', r => {
  if (r.kind === 'meet' && (r.ok || r.key === 'toast.alreadyMet')) { met.add(r.npcId); saveJSON('met', [...met]); }
  toast((r.ok ? '✓ ' : '') + t(r.key, { amount: r.amount }));
  if (modalOpen && $('modalBody').dataset.npc == String(r.npcId)) { const w = npcs.walkers.find(x => x.id === r.npcId); if (w) openNpc(w); }
});
socket.on('joined', info => {
  if (info.travel) { spawned = false; others.clear(); bubbles.clear(); lastDay = null; exitCompany(true); cancelPlan(); setAuto(false); $('travelOverlay').hidden = true; }
  joined = info;
  if (info.mode !== 'solo') history.replaceState(null, '', `?room=${encodeURIComponent(info.roomId)}`);
  closeModal(); renderRoomBar(); updateControls();
  $('advisor').hidden = false;
  $('chatCard').hidden = info.mode === 'solo';
  if (isPres()) { showTab(matchMedia('(max-width:820px)').matches ? 'street' : 'chat'); setAuto(false); }
  setTimeout(() => ($('hint').style.display = 'none'), 10000);
});
socket.on('badge', ({ id }) => { toast(`🏅 ${t('badge.unlocked')}: ${t('badge.' + id)}`); profSig = ''; });
socket.on('questDone', q => { toast(`✅ ${t('quest.' + q.id, { goal: '' })} · +${money(q.coins)} · +${q.xp} XP`); profSig = ''; });
socket.on('chatHistory', list => { $('chatList').replaceChildren(); list.forEach(addChat); });
socket.on('chat', m => { addChat(m); bubbles.set(m.pid, { text: m.text, until: performance.now() + 2500 + Math.min(4500, m.text.length * 90) }); });
socket.on('emoji', ({ pid, e }) => bubbles.set(pid, { emoji: e, until: performance.now() + 3000 }));
socket.on('chatDeleted', id => document.querySelector(`#chatList li[data-id="${CSS.escape(id)}"]`)?.remove());
socket.on('disconnect', () => {
  joined = null; state = null; spawned = false; others.clear(); bubbles.clear(); setAuto(false); exitCompany(true);
  $('advisor').hidden = true; renderRoomBar(); render();
});
setInterval(() => { const t0 = performance.now(); socket.timeout(4000).emit('latency', err => { perf.ping = err ? null : Math.round(performance.now() - t0); }); }, 2000);

function renderRoomBar() {
  const show = joined && joined.mode !== 'solo';
  $('roomBar').style.display = show ? 'flex' : 'none';
  if (show) $('roomInfo').textContent = (isPres() ? '🎤 ' + t('ui.presentationMode') + ' · ' : '') + t('ui.roomInfo', { room: joined.roomId, pin: joined.pin });
}
$('copyLink').onclick = async () => {
  const link = `${location.origin}/?room=${encodeURIComponent(joined.roomId)}`;
  try { await navigator.clipboard.writeText(link); toast(t('ui.copied')); } catch { prompt(t('ui.copyLink'), link); }
};

// ---------- Türkiye map: choose the city of a room ----------
function openCityMap(current, onPick) {
  const ov = $('mapOverlay'), cities = seed.economy.cityMap, info = seed.economy.cities;
  let picked = current;
  const render = () => {
    const card = el('div', null, 'card mapCard');
    const head = el('div', null, 'mmHead'); head.append(el('h3', '🗺 ' + t('map.pickTitle')), btn('✕', () => (ov.hidden = true)));
    const status = el('p', null, 'mapStatus');
    const say = c => {
      if (c.status !== 'open') status.textContent = `🔒 ${c.name} · ${t(c.status === 'premium' ? 'map.premium' : 'map.soon')}`;
      else status.textContent = `🏙 ${c.name} · ${t('city.rent', { m2: info[c.key].rentM2 })}${info[c.key].est ? ' *' : ''}`;
    };
    say(cities.find(c => c.key === picked) || cities[0]);
    const svg = renderTrMap(cities, { selected: picked, onPick: c => { say(c); if (c.status === 'open') { picked = c.key; render(); } } });
    const legend = el('div', null, 'mapLegend'); legend.append(el('span', '● ' + t('map.open')), el('span', '🔒 ' + t('map.premium')), el('span', '🔒 ' + t('map.soon')));
    card.append(head, svg, status, legend, btn('✓ ' + t('map.choose'), () => { ov.hidden = true; onPick(picked); }, { primary: true }));
    ov.replaceChildren(card);
  };
  render(); ov.hidden = false;
}
$('mapOverlay').onclick = e => { if (e.target === $('mapOverlay')) $('mapOverlay').hidden = true; };

// ---------- Mode selection ----------
function showModes() {
  if (joined) return toast(t('ui.roomInfo', { room: joined.roomId, pin: joined.pin || '—' }));
  const urlRoom = new URLSearchParams(location.search).get('room') || '';
  const digits = (input, max) => { input.inputMode = 'numeric'; input.maxLength = max; input.pattern = '[0-9]*'; input.oninput = () => (input.value = input.value.replace(/\D/g, '').slice(0, max)); };
  openModal(body => {
    body.dataset.modes = '1';
    body.append(el('h3', t('ui.modeTitle')));
    const name = el('input'); name.placeholder = t('ui.namePh'); name.maxLength = 20; body.append(name);
    const city = el('select'); city.setAttribute('aria-label', t('city.label'));
    Object.entries(seed?.economy?.cities || {}).forEach(([k, c]) => city.append(new Option(`🏙 ${c.name} · ${t('city.rent', { m2: c.rentM2 })}${c.est ? ' *' : ''}`, k)));
    city.value = loadJSON('city', 'istanbul'); city.onchange = () => saveJSON('city', city.value);
    const mapB = btn('🗺 ' + t('map.pickBtn'), () => openCityMap(city.value, k => { city.value = k; saveJSON('city', k); }));
    body.append(el('small', t('city.hint'), 'muted'), city, mapB);
    const solo = el('div', null, 'mode');
    solo.append(el('b', t('ui.solo')), el('p', t('ui.soloDesc')));
    const soloBtn = el('button', t('ui.startSolo'), 'primary');
    soloBtn.onclick = () => socket.emit('startSolo', { name: name.value, city: city.value });
    if (!urlRoom) soloBtn.dataset.default = '1';
    solo.append(soloBtn); body.append(solo);

    const multi = el('div', null, 'mode');
    multi.append(el('b', t('ui.multi')), el('p', t('ui.multiDesc')));
    const newPin = el('input'); newPin.placeholder = t('ui.newPinPh'); digits(newPin, 6);
    const create = el('button', t('ui.createRoom'));
    create.onclick = () => {
      const pin = newPin.value.trim();
      if (pin && !/^\d{4,6}$/.test(pin)) return toast(t('toast.badPin'));
      socket.emit('createRoom', { name: name.value, pin, city: city.value });
    };
    multi.append(newPin, create); body.append(multi);

    const join = el('div', null, 'mode');
    join.append(el('b', t('ui.joinTitle')), el('p', t('ui.joinDesc')));
    const rid = el('input'); rid.placeholder = t('ui.roomIdPh'); rid.value = urlRoom; digits(rid, 6);
    const pin = el('input'); pin.placeholder = t('ui.pinPh'); digits(pin, 6);
    const joinBtn = el('button', t('ui.joinRoom'), urlRoom ? 'primary' : '');
    joinBtn.onclick = () => socket.emit('joinRoom', { roomId: rid.value.trim(), pin: pin.value.trim(), name: name.value });
    if (urlRoom) joinBtn.dataset.default = '1';
    join.append(rid, pin, joinBtn); body.append(join);

    const online = el('div', null, 'mode disabled');
    online.append(el('b', '☁🔒 ' + t('ui.online')), el('p', t('ui.onlineDesc')));
    online.onclick = () => socket.emit('startOnline');
    body.append(online);
    setTimeout(() => (urlRoom ? pin : name).focus(), 50);
  }, { closable: false });
}

// ---------- View / camera ----------
function resize() {
  const r = stage.getBoundingClientRect();
  view.dpr = iview.dpr = Math.min(window.devicePixelRatio || 1, perf.low ? 1 : 1.5);
  view.w = iview.w = r.width; view.h = iview.h = r.height;
  view.s = Math.min(view.h / WORLD_H, view.w / 480);
  view.ty = view.h - WORLD_H * view.s;
  // leave room for HUD (top) and the floor bar (bottom) so the ground floor is never hidden
  iview.s = view.w < 600 ? view.w / 500 : Math.min(view.w / IW, view.h / (IH + INNER_PAD_TOP + INNER_PAD_BOTTOM));
  cv.width = Math.round(view.w * view.dpr); cv.height = Math.round(view.h * view.dpr);
}
new ResizeObserver(resize).observe(stage);
const toWorld = (clientX, clientY) => {
  const r = cv.getBoundingClientRect();
  return { x: (clientX - r.left) / view.s + view.camX, y: (clientY - r.top - view.ty) / view.s };
};
const toInner = (clientX, clientY) => {
  const r = cv.getBoundingClientRect();
  return { x: (clientX - r.left) / iview.s + iview.camX, y: (clientY - r.top) / iview.s + iview.camY };
};
const buildingAt = (x, y) => buildings.find(b => x >= b.x && x <= b.x + b.w && y >= GROUND - b.h && y <= GROUND + 30);
const buildingOf = target => buildings.find(b => (target.kind === 'plaza' ? b.kind === 'plaza' : target.kind === 'demoday' ? b.kind === 'demoday' : b.kind === 'lot' && b.lot.id === target.lotId));
const buildingOfCompany = c => buildingOf(c.lotId == null ? { kind: 'plaza' } : { kind: 'lot', lotId: c.lotId });

function updateControls() {
  const inside = scene.name === 'interior';
  $('joy').hidden = !touch || isPres();
  $('hint').textContent = isPres() ? t('ui.presHint') : t(touch ? 'ui.moveHintTouch' : 'ui.moveHint');
  $('actBtn').textContent = inside ? '⬆ ' + t('ui.open') : '⬆ ' + t('ui.enter');
  $('innerBar').hidden = !inside;
  $('advisor').hidden = !joined || scene.name !== 'street';
  $('advChip').hidden = $('advisor').hidden;
  const mapOk = !!joined && scene.name === 'street' && !isPres(); $('mapBtn').hidden = !mapOk; if (!mapOk && minimapOpen) toggleMinimap(false);
}

// ---------- Input: keyboard ----------
const runKey = () => keys.has('shift');
const KEYMAP = { a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right' };
const typing = e => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  if (modalOpen) {
    if (k === 'escape' || ((k === 's' || k === 'arrowdown') && !typing(e))) { if (modalClosable) { e.preventDefault(); closeModal(); } return; }
    if (k === 'enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
      const def = $('modalBody').querySelector('[data-default]'); if (def) { e.preventDefault(); def.click(); }
    }
    return;
  }
  if (typing(e)) return;
  if (k === 'shift') { keys.add('shift'); return; }
  if (k === 'f3') { e.preventDefault(); $('toggleStatus').click(); return; }
  if (k === 'm' && state) { e.preventDefault(); toggleMinimap(); return; }
  if ((k === ' ' || k === 'control') && state) { e.preventDefault(); toggleBoard(); return; }
  if (boardOpen) { if (k === 'escape') toggleBoard(false); return; }
  if (!state) return;
  if (scene.name === 'interior') return innerKey(e, k);
  if (scene.name !== 'street') return;
  if (k === 'enter') { acceptSuggestion(); e.preventDefault(); return; }
  if (k === 'n') { nextSuggestion(); return; }
  if (k === 't' && (nearPlayer || nearNpc)) { e.preventDefault(); talkNearest(); return; }
  if (isPres() || ride) return; // watch-only / riding: no walking
  if (KEYMAP[k]) { keys.add(KEYMAP[k]); manualInput(); e.preventDefault(); }
  if (['w', 'arrowup', 'e'].includes(k)) {
    e.preventDefault();
    if (nearNpc) openNpc(nearNpc); else if (nearStop != null && (!near || k === 'e')) openStop(nearStop); else if (near) openBuilding(near);
  }
});
addEventListener('keyup', e => { const kk = e.key.toLowerCase(); if (kk === 'shift') { keys.delete('shift'); return; } const k = KEYMAP[kk]; if (k) keys.delete(k); });
addEventListener('blur', () => keys.clear());

function innerKey(e, k) {
  if (KEYMAP[k]) { keys.add(KEYMAP[k]); e.preventDefault(); return; }
  if (k === 'w' || k === 'arrowup') { e.preventDefault(); changeFloor(1); }
  else if (k === 's' || k === 'arrowdown') { e.preventDefault(); if (inner.floor === 0) exitCompany(); else changeFloor(-1); }
  else if (k === 'escape') exitCompany();
  else if (k === 'e' || k === 'enter') { e.preventDefault(); openDeptHere(); }
}

// ---------- Input: mouse / tap ----------
cv.addEventListener('pointerdown', e => {
  if (!state) return showModes();
  if (boardOpen) return toggleBoard(false);
  if (scene.name === 'interior') return innerTap(e);
  if (scene.name !== 'street') return;
  const p = toWorld(e.clientX, e.clientY), b = buildingAt(p.x, p.y);
  if (isPres()) { if (b) openBuilding(b); return; }
  const n = npcs.at(p.x, p.y);
  manualInput();
  if (n) walkTo(n.x - 18 * Math.sign(n.x - player.x || 1), () => openNpc(n), null);
  else if (b) walkTo(b.x + b.w / 2, () => openBuilding(b), b.id);
  else walkTo(p.x, null, null);
});
cv.addEventListener('pointermove', e => {
  if (touch) return;
  if (scene.name === 'interior') { const p = toInner(e.clientX, e.clientY); cv.style.cursor = floorAtY(p.y) != null ? 'pointer' : 'default'; return; }
  const p = toWorld(e.clientX, e.clientY);
  cv.style.cursor = buildingAt(p.x, p.y) || npcs.at(p.x, p.y) ? 'pointer' : 'default';
});
function walkTo(x, onArrive, targetId) {
  player.target = clamp(x, 10, wWidth() - 10); player.onArrive = onArrive; player.targetId = targetId;
  if (near && targetId === near.id && onArrive) { player.target = null; player.targetId = null; onArrive(); }
}

// ---------- Input: joystick + buttons (mobile) ----------
const joyEl = $('joy'), knob = $('knob');
joyEl.addEventListener('pointerdown', e => { joy.id = e.pointerId; joyEl.setPointerCapture(e.pointerId); moveJoy(e); manualInput(); });
joyEl.addEventListener('pointermove', e => { if (e.pointerId === joy.id) moveJoy(e); });
const endJoy = e => { if (e.pointerId !== joy.id) return; joy.id = null; joy.axis = 0; joy.run = false; knob.style.transform = ''; knob.classList.remove('run'); };
joyEl.addEventListener('pointerup', endJoy); joyEl.addEventListener('pointercancel', endJoy);
function moveJoy(e) {
  // notch 1 (|dx| up to 40): walk, speed follows the pull. notch 2 (|dx| > 56): run.
  const r = joyEl.getBoundingClientRect(), dx = clamp(e.clientX - (r.left + r.width / 2), -66, 66), a = Math.abs(dx);
  joy.run = a > 56;
  joy.axis = a < 6 ? 0 : Math.sign(dx) * Math.min(a, 40) / 40;
  knob.style.transform = `translateX(${dx}px)`;
  knob.classList.toggle('run', joy.run);
}
$('actBtn').onclick = () => {
  if (scene.name === 'interior') return openDeptHere();
  if (nearNpc) openNpc(nearNpc); else if (nearStop != null) openStop(nearStop); else if (near) openBuilding(near);
};
$('floorUp').onclick = () => changeFloor(1);
$('floorDown').onclick = () => (inner.floor === 0 ? exitCompany() : changeFloor(-1));
$('exitBtn').onclick = () => exitCompany();

function manualInput() { if (plan) cancelPlan(); if (auto) setAuto(false); }

// ---------- Advisor: OK / Next / Auto ----------
function currentSuggestion() { return ranked.length ? ranked[advIdx % ranked.length] : null; }
function renderAdvisor() {
  ranked = suggestions({ state, seed, myId: myId(), name: companyName });
  const s = plan || currentSuggestion();
  $('advLabel').textContent = s ? (plan ? '🚶 ' : '💡 ') + t(s.labelKey, resolve(s.params)) : t('adv.none');
  $('advReason').textContent = s ? t(s.reasonKey, resolve(s.params)) : '';
  $('advOk').disabled = !s; $('advNext').disabled = $('advPrev').disabled = ranked.length < 2 || !!plan;
  $('advCount').textContent = ranked.length > 1 && !plan ? `${(advIdx % ranked.length) + 1}/${ranked.length}` : '';
}
function acceptSuggestion() { const s = auto ? ranked.find(x => !x.action.ev.startsWith('__')) : currentSuggestion(); if (s) startPlan(s); }
function prevSuggestion() { advIdx = (advIdx - 1 + Math.max(1, ranked.length)) % Math.max(1, ranked.length); renderAdvisor(); }
function nextSuggestion() { advIdx = (advIdx + 1) % Math.max(1, ranked.length); renderAdvisor(); }
function startPlan(s) {
  const b = buildingOf(s.target); if (!b) return;
  plan = s; renderAdvisor();
  if (isPres()) { focusOverride = { b, until: performance.now() + 6000 }; return executePlan(); } // no walking in watch-only mode
  walkTo(b.x + b.w / 2, () => executePlan(), b.id);
}
function executePlan() {
  const s = plan; plan = null; player.targetId = null;
  if (!s) return;
  if (s.action.ev === '__demo') { advIdx = 0; renderAdvisor(); return openDemoDay(s.action.payload.cid, 'canvas'); }
  socket.emit(s.action.ev, s.action.payload);
  if (s.action.ev !== 'click') toast('✓ ' + t(s.labelKey, resolve(s.params)));
  advIdx = 0; renderAdvisor();
}
function cancelPlan() { if (plan) setTimeout(renderAdvisor); plan = null; player.target = null; player.onArrive = null; player.targetId = null; }
function setAuto(v) { auto = v; updateAutoBtn(); if (v && !plan) acceptSuggestion(); }
function updateAutoBtn() { $('advAuto').textContent = t(auto ? 'ui.autoOn' : 'ui.auto'); $('advAuto').classList.toggle('on', auto); }
$('advOk').onclick = acceptSuggestion;
$('advNext').onclick = nextSuggestion;
$('advPrev').onclick = prevSuggestion;
$('advMin').onclick = $('advChip').onclick = () => { ui.noAdv = !ui.noAdv; saveUi(); applyUi(); };
$('advAuto').onclick = () => setAuto(!auto);
setInterval(() => { if (auto && state && !plan && !modalOpen && scene.name === 'street') acceptSuggestion(); }, AUTO_MS);

// ---------- Scenes: street <-> company interior ----------
const ease = p => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
function enterCompany(c) {
  const b = buildingOfCompany(c); if (!b || isPres()) return;
  closeModal(); cancelPlan(); setAuto(false); keys.clear();
  Object.assign(scene, { name: 'zoomIn', t0: performance.now(), b, cid: c.id, kind: 'company' });
  Object.assign(inner, { x: ELEV.x - 60, floor: 0, dir: -1, target: null, onArrive: null });
  $('innerTitle').textContent = `🏢 ${companyName(c)}`;
  updateControls();
}
function exitCompany(instant) {
  if (scene.name === 'street') return;
  keys.clear(); closeModal();
  if (instant) Object.assign(scene, { name: 'street', b: null, cid: null, kind: null });
  else Object.assign(scene, { name: 'zoomOut', t0: performance.now() });
  updateControls();
}
const company = () => state?.companies[scene.cid];
function enterHome() {
  const b = buildings.find(x => x.kind === 'home'); if (!b || isPres() || !joined) return;
  closeModal(); cancelPlan(); setAuto(false); keys.clear();
  Object.assign(scene, { name: 'zoomIn', t0: performance.now(), b, cid: null, kind: 'home' });
  Object.assign(inner, { x: ELEV.x - 60, floor: 0, dir: -1, target: null, onArrive: null });
  $('innerTitle').textContent = '🏠 ' + t('home.title');
  updateControls();
}
const floorsUnlocked = c => Math.min(FLOORS - 1, floorsOfCompany(state, c)); // last floor is premium
const unlocked = (c, f) => f < floorsUnlocked(c);
function changeFloor(d) {
  if (scene.kind === 'home') { const f = inner.floor + d; if (f < 0 || f >= HOME_FLOORS) return; inner.floor = f; inner.x = clamp(inner.x, 20, IW - 20); inner.target = null; return; }
  const c = company(); if (!c) return;
  const f = inner.floor + d;
  if (f < 0 || f >= FLOORS) return;
  if (!unlocked(c, f)) return toast(f === FLOORS - 1 ? t('dept.premium') : t('dept.unlockAt', { cash: 250 * 2 ** f }));
  inner.floor = f; inner.x = clamp(inner.x, 20, IW - 20); inner.target = null;
}
const floorAtY = y => { for (let f = 0; f < FLOORS; f++) if (y <= floorBase(f) && y >= floorBase(f) - FH) return f; return null; };
function innerTap(e) {
  if (scene.kind === 'home') {
    const p = toInner(e.clientX, e.clientY), f = floorAtY(p.y); if (f == null || f >= HOME_FLOORS) return;
    inner.floor = f; const d = roomOf(HOME_ROOMS, p.x, f);
    if (!d) { inner.target = clamp(p.x, 20, IW - 20); inner.onArrive = null; return; }
    inner.target = roomCenter(p.x < ELEV.x ? 0 : 1); inner.onArrive = () => openHomeRoom(d.key); return;
  }
  const c = company(); if (!c) return;
  const p = toInner(e.clientX, e.clientY), f = floorAtY(p.y);
  if (f == null) return;
  if (f !== inner.floor) { if (!unlocked(c, f)) return toast(t('dept.unlockAt', { cash: 250 * 2 ** f })); inner.floor = f; }
  const d = roomOf(seed.departments, p.x, f);
  if (!d) { inner.target = clamp(p.x, 20, IW - 20); inner.onArrive = null; return; }
  const side = p.x < ELEV.x ? 0 : 1;
  inner.target = roomCenter(side); inner.onArrive = () => openDept(c, d);
}
function openDeptHere() {
  if (scene.kind === 'home') { const d = roomOf(HOME_ROOMS, inner.x, inner.floor); return d ? openHomeRoom(d.key) : toast(t('home.useStairs')); }
  const c = company(); if (!c) return;
  const d = roomOf(seed.departments, inner.x, inner.floor);
  if (d) openDept(c, d); else toast(t('ui.useElevator'));
}

// ---------- Game speed (room owner / admin): 0.5x 1x 2x 3x ----------
const SPEEDS = [0.5, 1, 2, 3];
function updateSpeedBtn() {
  const b = $('speedBtn'), sp = state?.speed || 1, owner = !!state && state.ownerId === myId() && !isPres();
  b.hidden = !state; b.textContent = '⏱ ' + sp + 'x';
  b.disabled = !owner; b.title = owner ? t('ui.speedHint') : t('ui.speedOwner');
  b.classList.toggle('fast', sp > 1); b.classList.toggle('slow', sp < 1);
}
$('speedBtn').onclick = () => { if (!state) return; const i = SPEEDS.indexOf(state.speed || 1); socket.emit('setSpeed', { speed: SPEEDS[(i + 1) % SPEEDS.length] }); };

// ---------- Game clock (analog), day / night, morning shuttles ----------
// One game day = tickSeconds of real time; the clock runs 06:00 -> 06:00 so a new day starts in the morning.
function gameMinutes() {
  if (!state?.tickAt || !seed) return 9 * 60;
  const p = clamp((Date.now() + clockOffset - state.tickAt) / (seed.tickSeconds * 1000 / (state.speed || 1)), 0, 1);
  return (360 + p * 1440) % 1440;
}
function nightFactor(min) { const h = min / 60; return h >= 20 || h < 5 ? 1 : h >= 18 ? (h - 18) / 2 : h < 7 ? 1 - (h - 5) / 2 : 0; }
const clockCv = $('clock'), cctx = clockCv.getContext('2d');
function drawClock() {
  const min = gameMinutes(), h = Math.floor(min / 60), m = Math.floor(min % 60), W = clockCv.width, r = W / 2 - 4;
  cctx.setTransform(1, 0, 0, 1, 0, 0); cctx.clearRect(0, 0, W, W); cctx.translate(W / 2, W / 2);
  cctx.fillStyle = nightFactor(min) > 0.5 ? '#1f2a44' : '#ffffff'; cctx.beginPath(); cctx.arc(0, 0, r, 0, Math.PI * 2); cctx.fill();
  cctx.strokeStyle = '#9aa3b5'; cctx.lineWidth = 3; cctx.stroke();
  for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; cctx.fillStyle = '#9aa3b5'; cctx.fillRect(Math.sin(a) * (r - 7) - 1.5, -Math.cos(a) * (r - 7) - 1.5, 3, 3); }
  const hand = (angle, len, width, color) => { cctx.strokeStyle = color; cctx.lineWidth = width; cctx.lineCap = 'round'; cctx.beginPath(); cctx.moveTo(0, 0); cctx.lineTo(Math.sin(angle) * len, -Math.cos(angle) * len); cctx.stroke(); };
  hand(((h % 12) + m / 60) / 12 * Math.PI * 2, r * 0.5, 5, nightFactor(min) > 0.5 ? '#ffe2a0' : '#2b2f3a');
  hand((m / 60) * Math.PI * 2, r * 0.78, 3, '#2f6fe4');
  cctx.fillStyle = '#e34948'; cctx.beginPath(); cctx.arc(0, 0, 3.5, 0, Math.PI * 2); cctx.fill();
  const txt = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  $('clockTxt').textContent = state ? txt : '';
  $('clockBox').title = t('clock.title', { time: txt });
}
setInterval(drawClock, 500);
// New game day = morning rush: shuttles / company cars drop staff in front of visible companies
function morningRush(s) {
  const viewW = view.w / view.s;
  for (const b of buildings) {
    if (b.kind !== 'lot' || b.x + b.w < view.camX || b.x > view.camX + viewW) continue;
    const list = b.lot.companyIds.map(id => s.companies[id]).filter(Boolean);
    const looks = list.flatMap(c => [...c.employees.map(id => lookFor(s.players[id]?.avatar ?? 1)), ...Array.from({ length: Math.min(3, c.npcStaff || 0) }, (_, k) => lookFor(300 + k))]);
    if (!looks.length) continue;
    const car = list.some(c => c.vehicle);
    traffic.dropoff(b.x + b.w / 2, looks, car ? 'car' : 'shuttle', '#3fa36b', view.camX);
  }
}
// ---------- Bus: stops, card balance, rides ----------
const stopName = i => t('bus.stop', { n: i + 1 });
function openStop(i) {
  const p = me(); if (!p) return;
  const fare = seed.economy.busFare, center = Object.values(state.companies).find(c => roleOf(c) === 'busCard');
  openModal(body => {
    body.append(el('h3', `🚏 ${stopName(i)}`), el('p', t('bus.info', { balance: p.busCard || 0, fare }), 'muted'));
    if ((p.busCard || 0) < fare) {
      body.append(el('p', t('bus.noBalance')));
      if (center) body.append(btn('💳 ' + t('bus.goTopup', { company: companyName(center) }), () => { closeModal(); const b = buildingOfCompany(center); if (b) walkTo(b.x + b.w / 2, () => openBuilding(b), b.id); }, { primary: true, isDefault: true }));
      return;
    }
    const grid = el('div', null, 'choices'), next = (i + 1) % seed.busStops.length;
    seed.busStops.forEach((x, k) => { if (k !== i) grid.append(btn(`🚌 ${stopName(k)}`, () => takeBus(i, k), { primary: k === next, isDefault: k === next })); });
    body.append(grid);
  });
}
function takeBus(from, to) {
  closeModal();
  socket.timeout(4000).emit('busRide', { to }, (err, r) => {
    if (err || !r?.ok) return toast(t(r?.key || 'toast.notAtStop'));
    const fromX = player.x, toX = r.x;
    ride = { fromX, toX, t0: performance.now(), dur: clamp(Math.abs(toX - fromX) / 0.5, 1800, 5000), dir: Math.sign(toX - fromX) || 1, text: stopName(to) };
  });
}
function updateRide(now) {
  if (!ride) return false;
  const p = clamp((now - ride.t0) / ride.dur, 0, 1);
  player.x = ride.fromX + (ride.toX - ride.fromX) * ease(p); player.dir = ride.dir; player.moving = false;
  ride.x = player.x;
  if (p >= 1) { player.x = ride.toX; lastSent = { x: player.x, at: now }; ride = null; toast('🚏 ' + t('bus.arrived')); }
  return true;
}
const roleOf = c => seed?.templates.find(tp => tp.key === c.nameKey)?.role || (c.nameKey === 'npc.busCard' ? 'busCard' : null);

// ---------- Game loop ----------
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  const t0 = performance.now();
  if (scene.name === 'interior') { updateInner(dt); renderInterior(now); }
  else { updatePlayer(dt, now); updateStreet(dt); renderStreet(now); }
  if (minimapOpen) { drawMinimap(); if (now - (frame.mmAt || 0) > 800) { frame.mmAt = now; renderMinimapList(); } }
  perf.frameMs = perf.frameMs * 0.9 + (performance.now() - t0) * 0.1;
  if (dt > 0) perf.fps = perf.fps * 0.92 + (1 / dt) * 0.08;
  adaptQuality(now);
  requestAnimationFrame(frame);
}
function updateStreet(dt) {
  for (const o of others.values()) {
    const d = o.tx - o.x; o.moving = Math.abs(d) > 1;
    if (o.moving) { o.x += clamp(d, -SPEED * dt * 1.3, SPEED * dt * 1.3); o.phase += dt * 16; } else o.x = o.tx;
  }
  npcs.update(dt, npcLimit());
  traffic.update(dt, view.camX, view.w / view.s, wWidth(), seed?.busStops || [], perf.low ? 1 : isPres() ? 2 : 3);
}
const npcLimit = () => (perf.low ? NPC_LOW : isPres() ? NPC_PRESENTATION : NPC_COUNT);
function cameraTarget(now) {
  const viewWorldW = view.w / view.s;
  let x = player.x;
  if (isPres()) {
    const sp = state?.presentation?.spotlight;
    if (focusOverride && focusOverride.until > now) x = focusOverride.b.x + focusOverride.b.w / 2;
    else if (sp === 'plaza') x = buildingOf({ kind: 'plaza' })?.x + 100;
    else if (Number.isInteger(sp)) { const b = buildingOf({ kind: 'lot', lotId: sp }); if (b) x = b.x + b.w / 2; }
    else if (sp === 'auto') {
      const list = buildings.filter(b => b.kind === 'plaza' || (b.kind === 'lot' && b.lot.companyIds.length));
      if (now - tour.at > TOUR_MS) { tour.idx = (tour.idx + 1) % Math.max(1, list.length); tour.at = now; }
      const b = list[tour.idx % Math.max(1, list.length)]; if (b) x = b.x + b.w / 2;
    }
  }
  return clamp(x - viewWorldW / 2, 0, Math.max(0, wWidth() - viewWorldW));
}
function renderStreet(now) {
  view.camX += (cameraTarget(now) - view.camX) * Math.min(1, 0.1);
  if (!view.w) return;
  let v = view, white = 0;
  if (scene.name === 'zoomIn' || scene.name === 'zoomOut') {
    const dur = scene.name === 'zoomIn' ? ZOOM_IN_MS : ZOOM_OUT_MS;
    const p = clamp((now - scene.t0) / dur, 0, 1), k = ease(scene.name === 'zoomIn' ? p : 1 - p);
    const b = scene.b, bx = b.x + b.w / 2, by = GROUND - Math.min(b.h, 260) / 2;
    const s2 = view.s * (1 + 2.2 * k);
    v = { ...view, s: s2, camX: view.camX + (bx - view.w / 2 / s2 - view.camX) * k, ty: view.ty + (view.h / 2 - by * s2 - view.ty) * k };
    white = scene.name === 'zoomIn' ? clamp((p - 0.55) / 0.45, 0, 1) : clamp(1 - p / 0.45, 0, 1);
    if (p >= 1) {
      if (scene.name === 'zoomIn') { scene.name = 'interior'; scene.t0 = now; updateControls(); }
      else { Object.assign(scene, { name: 'street', b: null, cid: null, kind: null }); updateControls(); }
    }
  }
  draw(ctx, {
    state, ads: state?.ads || {}, view: v, time: now, bubbles, myId: myId(), player, others: isPres() ? new Map() : others, npcs, buildings,
    near: isPres() ? null : near, nearNpc: isPres() ? null : nearNpc, targetId: player.targetId, met, low: perf.low, npcLimit: npcLimit(), hideMe: isPres(),
    ranks: boardOpen ? lotRanks() : null, traffic, busStops: seed?.busStops, night: nightFactor(gameMinutes()), riding: ride,
    nearStop: isPres() ? null : nearStop, stopHint: touch ? null : `E 🚏 ${t('bus.board')}`, money,
    t, name: companyName, sector: sectorOf, maxTenants: lot => maxTenants(seed, lot),
    tenants: lot => lot.companyIds.map(id => state.companies[id]).filter(Boolean),
    trend: list => list.reduce((s, c) => s + (c.fin?.lastDay && c.fin.prevCash != null ? c.fin.lastDay.cash - c.fin.prevCash : 0), 0),
    keyHint: touch || isPres() ? null : nearNpc ? `E 💬 ${t('npc.talk')}` : nearStop != null && !near ? `E 🚏 ${t('bus.board')}` : `W ⬆ ${t('ui.enter')}`
  });
  if (white > 0) { ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0); ctx.fillStyle = `rgba(255,255,255,${white})`; ctx.fillRect(0, 0, view.w, view.h); }
}
function updatePlayer(dt, now) {
  if (scene.name !== 'street' || isPres()) { near = nearNpc = nearStop = nearPlayer = null; $('actBtn').hidden = true; $('talkBtn').hidden = true; return; }
  if (updateRide(now)) { near = nearNpc = nearStop = nearPlayer = null; $('talkBtn').hidden = true; return; }
  let axis = 0;
  if (keys.has('left')) axis -= 1;
  if (keys.has('right')) axis += 1;
  if (joy.axis) axis = joy.axis;
  const spd = SPEED * ((runKey() || joy.run) && axis ? RUN_MULT : 1);
  let vx = axis * spd;
  if (axis) { player.target = null; player.onArrive = null; }
  else if (player.target != null) {
    const d = player.target - player.x;
    if (Math.abs(d) < 4) { player.target = null; const cb = player.onArrive; player.onArrive = null; if (cb) cb(); }
    else vx = Math.sign(d) * SPEED;
  }
  player.x = clamp(player.x + vx * dt, 10, wWidth() - 10);
  player.moving = vx !== 0;
  if (vx) { player.dir = Math.sign(vx); player.phase += dt * 16 * (Math.abs(vx) > SPEED * 1.2 ? 1.6 : 1); }
  near = state ? buildings.find(b => b.kind !== 'locked' && player.x >= b.x && player.x <= b.x + b.w) || null : null;
  nearNpc = state && !player.moving ? npcs.nearest(player.x) : null;
  nearPlayer = state && !player.moving && joined?.mode === 'multiplayer' ? nearestPlayer() : null;
  const si = (seed?.busStops || []).findIndex(x => Math.abs(x - player.x) < 30);
  nearStop = state && si >= 0 ? si : null;
  $('actBtn').hidden = !(touch && (near || nearNpc || nearStop != null));
  const canTalk = nearPlayer || nearNpc;
  $('talkBtn').hidden = !(touch && canTalk);
  if (!$('talkBtn').hidden) $('talkBtn').textContent = '💬 ' + t('ui.talk');
  if (state && Math.abs(player.x - lastSent.x) > 1 && now - lastSent.at > MOVE_SEND_MS) {
    lastSent = { x: player.x, at: now };
    socket.emit('move', { x: Math.round(player.x), dir: player.dir });
  }
}
function updateInner(dt) {
  let axis = 0;
  if (keys.has('left')) axis -= 1;
  if (keys.has('right')) axis += 1;
  if (joy.axis) axis = joy.axis;
  const spd = SPEED * ((runKey() || joy.run) && axis ? RUN_MULT : 1);
  let vx = axis * spd;
  if (axis) { inner.target = null; inner.onArrive = null; }
  else if (inner.target != null) {
    const d = inner.target - inner.x;
    if (Math.abs(d) < 4) { inner.target = null; const cb = inner.onArrive; inner.onArrive = null; if (cb) cb(); }
    else vx = Math.sign(d) * SPEED;
  }
  inner.x = clamp(inner.x + vx * dt, 20, IW - 20);
  inner.moving = vx !== 0;
  if (vx) { inner.dir = Math.sign(vx); inner.phase += dt * 16 * (Math.abs(vx) > SPEED * 1.2 ? 1.6 : 1); }
  $('actBtn').hidden = !touch;
}
function renderInterior(now) {
  const home = scene.kind === 'home', c = home ? null : company(); if ((!home && !c) || !iview.w) return;
  const vw = iview.w / iview.s, vh = iview.h / iview.s;
  const tx = vw >= IW ? (IW - vw) / 2 : clamp(inner.x - vw / 2, 0, IW - vw);
  const padB = INNER_PAD_BOTTOM / iview.s, padT = INNER_PAD_TOP / iview.s;
  const ty = vh >= IH + padB + padT ? IH + padB - vh : clamp(floorBase(inner.floor) + padB - vh * 0.85, -padT, IH + padB - vh);
  iview.camX += (tx - iview.camX) * 0.15; iview.camY += (ty - iview.camY) * 0.15;
  if (now - scene.t0 < 30) { iview.camX = tx; iview.camY = ty; }
  const p = me();
  if (home) drawInterior(ctx, { view: iview, time: now, theme: 'home', floors: HOME_FLOORS, depts: HOME_ROOMS, t, unlocked: () => true, threshold: () => 0, goods: [], staff: [],
    player: inner, myName: p?.name, myLook: lookFor(p?.avatar ?? 0), highlight: roomOf(HOME_ROOMS, inner.x, inner.floor)?.key, security: 0, trend: 0 });
  else {
  const lotCash = c.lotId == null ? c.cash : state.lots[c.lotId].companyIds.reduce((s, id) => s + (state.companies[id]?.cash || 0), 0);
  drawInterior(ctx, {
    view: iview, time: now, company: c, depts: seed.departments, t,
    unlocked: f => unlocked(c, f), threshold: f => 250 * 2 ** f,
    goods: ['#f2b84b', '#e57d5c', '#4f8ff7', '#5cc08a'], staff: staffLooks(state, c),
    player: inner, myName: p?.name, myLook: lookFor(p?.avatar ?? 0),
    highlight: roomOf(seed.departments, inner.x, inner.floor)?.key,
    campaign: c.marketing && c.marketing.until > (state.day || 0), campaignText: t('dept.campaignOn'),
    security: c.security || 0, trend: lotCash
  });
  }
  const fade = clamp(1 - (now - scene.t0) / FADE_MS, 0, 1);
  if (fade > 0) { ctx.setTransform(iview.dpr, 0, 0, iview.dpr, 0, 0); ctx.fillStyle = `rgba(255,255,255,${fade})`; ctx.fillRect(0, 0, iview.w, iview.h); }
}

// ---------- Adaptive quality + status overlay ----------
function adaptQuality(now) {
  if (perf.quality !== 'auto') return;
  if (perf.fps < 40) { perf.highSince = 0; perf.lowSince ||= now; if (!perf.low && now - perf.lowSince > 3000) { perf.low = true; resize(); } }
  else if (perf.fps > 56) { perf.lowSince = 0; perf.highSince ||= now; if (perf.low && now - perf.highSince > 8000) { perf.low = false; resize(); } }
}
function renderStatus() {
  const st = $('status'); st.hidden = !showStatus;
  if (!showStatus) return;
  const ts = perf.syncTimes, rate = ts.length > 1 ? ((ts.length - 1) * 1000) / (ts.at(-1) - ts[0]) : 0;
  const cls = (v, warn, bad, inv) => (v == null ? '' : inv ? (v < bad ? 'bad' : v < warn ? 'warn' : '') : v > bad ? 'bad' : v > warn ? 'warn' : '');
  const span = (text, c) => { const s = el('span', text); if (c) s.className = c; return s; };
  const players = state ? Object.keys(state.players).length : 0;
  if (matchMedia('(max-width:820px)').matches) return st.replaceChildren(
    span(`FPS ${Math.round(perf.fps)}`, cls(perf.fps, 50, 30, true)), ' · ', span(`${perf.ping == null ? '—' : perf.ping + 'ms'}`, cls(perf.ping, 120, 300)), ` · 👥 ${players}`);
  st.replaceChildren(
    span(`FPS ${Math.round(perf.fps)}`, cls(perf.fps, 50, 30, true)), ' · ',
    span(`${perf.frameMs.toFixed(1)} ms`, cls(perf.frameMs, 10, 20)), ' · ',
    span(`Ping ${perf.ping == null ? '—' : perf.ping + ' ms'}`, cls(perf.ping, 120, 300)), ' · ',
    `👥 ${players} · NPC ${npcLimit()} · Sync ${rate.toFixed(1)}/s · ${perf.stateKB.toFixed(1)} KB · `,
    span(perf.low ? t('ui.qLow') : t('ui.qHigh'), perf.low ? 'warn' : '')
  );
}
setInterval(renderStatus, 500);

// ---------- HUD (top bars) ----------
function myCompanies() {
  if (!state) return [];
  return Object.values(state.companies).filter(isMember);
}
function finOf(list) {
  const sum = { cash: 0, todayRev: 0, dayExp: 0, monthRev: 0, monthExp: 0, units: 0, todayUnits: 0, bestUnits: 1, employees: 0, cap: 0 };
  for (const c of list) {
    const f = c.fin || {}, last = f.lastDay, m = f.month, td = f.today || {};
    sum.cash += c.cash; sum.todayRev += td.revenue || 0;
    sum.dayExp += last ? last.expenses + last.losses : 0;
    sum.monthRev += (m?.revenue || 0) + (td.revenue || 0);
    sum.monthExp += (m?.expenses || 0) + (m?.losses || 0) + (td.expenses || 0) + (td.losses || 0);
    sum.units += c.sales || 0; sum.todayUnits += td.units || 0;
    sum.bestUnits = Math.max(sum.bestUnits, f.bestUnits || 0, td.units || 0);
    sum.employees += staffOf(c); sum.cap += employeeCap(seed, state, c);
  }
  return sum;
}
function chip(icon, label, value, pct, color, onClick) {
  const c = el(onClick ? 'button' : 'div', null, 'chip');
  if (onClick) c.onclick = onClick;
  const k = el('div', null, 'k'); k.append(el('span', `${icon} ${label}`)); c.append(k);
  const v = el('div', null, 'v'); if (typeof value === 'string') v.textContent = value; else v.append(...value); c.append(v);
  if (pct != null) { const b = el('div', null, 'bar'), i = el('i'); i.style.width = `${clamp(pct, 0, 1) * 100}%`; if (color) i.style.background = color; b.append(i); c.append(b); }
  return c;
}
const signed = (n, cls) => { const v = Math.abs(n) < 0.5 ? 0 : n; return el('span', (v >= 0 ? '+' : '') + fmt(v), cls || (v >= 0 ? 'pos' : 'neg')); };
let hudSig = '';
function renderHud() {
  const p = me(), hud = $('hud');
  if (!p) { hudSig = ''; return hud.replaceChildren(); }
  const owned = Object.values(state.companies).filter(c => c.founders.includes(myId()));
  const f = finOf(myCompanies()), fo = finOf(owned);
  const floors = floorsFor(fo.cash), next = 250 * 2 ** floors, prev = floors > 1 ? 250 * 2 ** (floors - 1) : 0;
  const s = p.stats, nextXp = 10 * s.level ** 2, prevXp = 10 * (s.level - 1) ** 2;
  const rank = myRank();
  const sig = [p.coins, fo.cash, f.units, f.todayUnits, f.employees, f.cap, f.todayRev, f.dayExp, f.monthRev, f.monthExp, Math.round(s.xp), rank, i18next.language].join('|');
  if (sig === hudSig) return;
  hudSig = sig;
  hud.replaceChildren(
    chip('💰', t('hud.coins'), fmt(p.coins), p.coins / 2000),
    chip('🏦', t('hud.cash'), owned.length ? fmt(fo.cash) : '—', owned.length ? (floors >= MAX_FLOORS ? 1 : (fo.cash - prev) / (next - prev)) : 0, fo.cash < 0 ? 'var(--bad)' : null),
    chip('🛒', t('hud.customers'), f.units ? `${f.units} · ${t('hud.today')} ${f.todayUnits}` : '—', f.todayUnits / f.bestUnits),
    chip('👷', t('hud.employees'), f.cap ? `${f.employees}/${f.cap}` : '—', f.cap ? f.employees / f.cap : 0),
    chip('📈', t('hud.today'), [signed(f.todayRev), el('span', ' / '), signed(-f.dayExp)]),
    chip('📅', t('hud.month'), [signed(f.monthRev - f.monthExp)]),
    chip('⭐', `${t('ui.level')} ${s.level}`, `${Math.round(s.xp)} XP`, (s.xp - prevXp) / Math.max(1, nextXp - prevXp)),
    chip('🏆', t('board.short'), rank ? `#${rank}` : '—', null, null, () => toggleBoard())
  );
}

// ---------- Leaderboard layer (Space / Ctrl) ----------
function boardRows() {
  if (!state) return [];
  return Object.values(state.companies).map(c => {
    const f = finOf([c]);
    return { c, cash: c.cash, month: f.monthRev - f.monthExp, sales: c.sales || 0, staff: staffOf(c), floors: floorsOfCompany(state, c),
      owners: c.isNpc ? 'NPC' : c.founders.map(id => state.players[id]?.name || '—').join(', ') };
  });
}
function sortedRows() { let k = $('boardSort').value || 'cash'; if (k === 'teams') k = 'cash'; return boardRows().sort((a, b) => b[k] - a[k]); }
function teamRows() {
  const rows = boardRows();
  return Object.values(state?.teams || {}).map(tm => {
    const ids = Object.values(state.players).filter(p => p.team === tm.id).map(p => p.id);
    const mine = rows.filter(r => r.c.founders.some(id => ids.includes(id)));
    return { tm, members: ids.length, cash: mine.reduce((s, r) => s + r.cash, 0), month: mine.reduce((s, r) => s + r.month, 0), sales: mine.reduce((s, r) => s + r.sales, 0), companies: mine.length };
  }).sort((a, b) => b.cash - a.cash);
}
function myRank() { const rows = sortedRows(); const i = rows.findIndex(r => r.c.founders.includes(myId())); return i >= 0 ? i + 1 : null; }
function lotRanks() {
  const m = new Map();
  sortedRows().forEach((r, i) => { if (r.c.lotId != null && !m.has(r.c.lotId)) m.set(r.c.lotId, i + 1); });
  return m;
}
function toggleBoard(v = !boardOpen) { boardOpen = v; $('board').hidden = !v; if (v) renderBoard(); }
function renderBoard() {
  if (!boardOpen) return;
  if ($('boardSort').value === 'teams') {
    const head = el('tr'); ['#', t('team.title'), '👥', '🏢', '💰', '📅', '🛒'].forEach(h => head.append(el('th', h)));
    const thead = el('thead'); thead.append(head); const tbody = el('tbody');
    teamRows().forEach((r, i) => {
      const tr = el('tr'); const nameTd = el('td'); const dot = el('i', null, 'dot'); dot.style.background = r.tm.color; nameTd.append(dot, ' ' + r.tm.name);
      if (me()?.team === r.tm.id) tr.className = 'mine';
      tr.append(el('td', ['🥇', '🥈', '🥉'][i] || String(i + 1)), nameTd, el('td', String(r.members)), el('td', String(r.companies)), el('td', fmt(r.cash)), el('td', (r.month >= 0 ? '+' : '') + fmt(r.month)), el('td', String(r.sales)));
      tbody.append(tr);
    });
    if (!tbody.children.length) { const tr = el('tr'); const td = el('td', t('team.none')); td.colSpan = 7; tr.append(td); tbody.append(tr); }
    return $('boardTable').replaceChildren(thead, tbody);
  }
  const head = el('tr');
  ['#', t('board.company'), t('board.owner'), '🏢', '💰', '📅', '🛒', '👷'].forEach(h => head.append(el('th', h)));
  const thead = el('thead'); thead.append(head);
  const tbody = el('tbody');
  sortedRows().forEach((r, i) => {
    const tr = el('tr'); if (r.c.founders.includes(myId())) tr.className = 'mine';
    const medal = ['🥇', '🥈', '🥉'][i];
    const rankTd = el('td'); if (medal) rankTd.append(el('span', medal, 'medal')); else rankTd.textContent = String(i + 1);
    tr.append(rankTd, el('td', `${r.c.crisis && r.c.crisis.until > (state.day || 0) ? '⚠️ ' : ''}${companyName(r.c)}`), el('td', r.owners),
      el('td', String(r.floors)), el('td', fmt(r.cash)), el('td', (r.month >= 0 ? '+' : '') + fmt(r.month)), el('td', String(r.sales)), el('td', String(r.staff)));
    tr.onclick = () => {
      toggleBoard(false);
      const b = buildingOfCompany(r.c); if (!b) return;
      if (isPres()) focusOverride = { b, until: performance.now() + 10000 };
      else walkTo(b.x + b.w / 2, null, b.id);
    };
    tbody.append(tr);
  });
  $('boardTable').replaceChildren(thead, tbody);
}
$('boardSort').onchange = () => { renderBoard(); hudSig = ''; renderHud(); };
$('boardClose').onclick = () => toggleBoard(false);

// ---------- Finance history (on demand) + finance panel ----------
function getHistory(cid, cb, maxAge = 3000) {
  const h = histCache.get(cid), now = performance.now();
  if (h && now - h.at < maxAge) return cb(h.data);
  if (h?.pending) return;
  histCache.set(cid, { ...(h || {}), pending: true, at: h?.at || 0 });
  socket.timeout(4000).emit('finHistory', { cid }, (err, data) => {
    const entry = { at: performance.now(), data: data || h?.data || { daily: [], monthly: [] } };
    histCache.set(cid, entry); cb(entry.data);
  });
}
const charts = {};
let finSel = null, finLast = 0;
function chartOpts(legend) {
  const grid = css('--line'), ink = css('--muted');
  return { responsive: true, maintainAspectRatio: false, animation: false, interaction: { mode: 'index', intersect: false },
    plugins: { legend: { display: legend, position: 'bottom', labels: { boxWidth: 10, boxHeight: 10, color: ink, font: { size: 11 } } },
      tooltip: { callbacks: { label: c => `${c.dataset.label}: ${fmt(c.parsed.y)}` } } },
    scales: { x: { grid: { display: false }, ticks: { color: ink, font: { size: 10 }, maxTicksLimit: 7 } },
      y: { beginAtZero: true, suggestedMax: 10, grid: { color: grid }, border: { display: false }, ticks: { color: ink, font: { size: 10 }, callback: v => fmt(v), maxTicksLimit: 5 } } } };
}
function upsertChart(id, type, labels, datasets, legend) {
  if (!Chart) return;
  const ch = charts[id];
  if (ch) { ch.data.labels = labels; ch.data.datasets.forEach((d, i) => (d.data = datasets[i].data)); ch.update('none'); return; }
  charts[id] = new Chart($(id), { type, data: { labels, datasets }, options: chartOpts(legend) });
}
const kpi = (label, value, color) => { const d = el('div', null, 'kpi'); const s = el('span'); if (color) { const sw = el('i', null, 'sw'); sw.style.background = color; s.append(sw); } s.append(label); d.append(s, el('b', value)); return d; };
const panelVisible = name => { const card = document.querySelector(`#side .card[data-panel="${name}"]`); return card && card.offsetParent !== null && (!matchMedia('(max-width:820px)').matches || $('side').classList.contains('open')); };
function renderFinance(force) {
  const now = performance.now();
  clearTimeout(renderFinance.timer);
  if (!force && now - finLast < 1000) { renderFinance.timer = setTimeout(() => renderFinance(true), 1050); return; }
  finLast = now;
  const list = myCompanies(), sel = $('finCompany');
  const ids = list.map(c => c.id).join();
  if (sel.dataset.ids !== ids || sel.dataset.lang !== i18next.language) {
    sel.replaceChildren(...list.map(c => new Option(`${companyName(c)} · ${t('ws.' + c.workspace)}`, c.id)));
    sel.dataset.ids = ids; sel.dataset.lang = i18next.language;
    if (!list.some(c => c.id === finSel)) finSel = list[0]?.id || null;
    sel.value = finSel || '';
  }
  sel.hidden = list.length < 2;
  const c = state?.companies[finSel];
  $('finEmpty').textContent = c ? '' : t('ui.finEmpty');
  $('finBody').hidden = !c;
  if (!c) return;
  const f = finOf([c]), rev = css('--series-1'), exp = css('--series-2');
  $('kpiNow').replaceChildren(kpi(t('fin.cash'), fmt(c.cash)), kpi(t('fin.revenueToday'), fmt(f.todayRev), rev), kpi(t('fin.expenseDay'), fmt(f.dayExp), exp));
  $('kpiMonth').replaceChildren(kpi(t('fin.revenue'), fmt(f.monthRev), rev), kpi(t('fin.expense'), fmt(f.monthExp), exp), kpi(t('fin.profit'), (f.monthRev - f.monthExp >= 0 ? '+' : '') + fmt(f.monthRev - f.monthExp)));
  if (!panelVisible('finance')) return; // charts only when someone is looking (saves CPU and bandwidth)
  getHistory(c.id, h => drawFinanceCharts(c, h));
}
function drawFinanceCharts(c, h) {
  const rev = css('--series-1'), exp = css('--series-2');
  const daily = h.daily.slice(-30);
  document.querySelectorAll('#finBody figure').forEach(fg => { fg.classList.toggle('empty', !daily.length); fg.dataset.empty = t('fin.noHistory'); });
  const dayLbl = daily.map(d => `${t('fin.dayShort')}${d.day}`);
  upsertChart('chCash', 'line', [...dayLbl, t('hud.today')], [{ label: t('fin.cash'), data: [...daily.map(d => d.cash), c.cash], borderColor: rev, backgroundColor: rev, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25 }], false);
  const last14 = daily.slice(-14);
  upsertChart('chDaily', 'bar', last14.map(d => `${t('fin.dayShort')}${d.day}`), [
    { label: t('fin.revenue'), data: last14.map(d => d.revenue), backgroundColor: rev, borderRadius: 4, maxBarThickness: 12 },
    { label: t('fin.expense'), data: last14.map(d => d.expenses + d.losses), backgroundColor: exp, borderRadius: 4, maxBarThickness: 12 }], true);
  const months = h.monthly.slice(-6);
  upsertChart('chMonthly', 'bar', months.map(m => t('fin.monthShort', { y: m.year, m: m.month })), [
    { label: t('fin.revenue'), data: months.map(m => m.revenue), backgroundColor: rev, borderRadius: 4, maxBarThickness: 16 },
    { label: t('fin.expense'), data: months.map(m => m.expenses + m.losses), backgroundColor: exp, borderRadius: 4, maxBarThickness: 16 }], true);
  $('finTable').replaceChildren(pnlTable(months));
}
// ---------- Taxes, accountant and shop bills (Accounting department) ----------
const TAX = () => seed.economy.tax;
function incomeTaxCoins(profit) {
  const rate = seed.economy.rate, tl = Math.max(0, profit) * rate; let tax = 0, lower = 0;
  for (const b of TAX().brackets) { const upper = b.limit ?? Infinity; if (tl > lower) tax += (Math.min(tl, upper) - lower) * b.rate; lower = upper; }
  return tax / rate;
}
const accOf = c => TAX().accountant[c.accountant || 'none'];
const estNote = () => (TAX().est ? ' *' : '');
// Expected year-end income tax from the months of this year so far (+ today); filled in when history arrives
function taxEstimate(c, monthly) {
  const out = document.getElementById('taxEst'); if (!out) return;
  const year = Math.floor((state.day || 0) / 360) + 1, net = x => (x.revenue || 0) - (x.expenses || 0) + (x.tax || 0) - (x.losses || 0);
  const base = monthly.filter(m => m.year === year).reduce((s, m) => s + net(m), 0) + net(c.fin?.today || {});
  const tax = Math.round(incomeTaxCoins(base) * accOf(c).mult), left = 360 - ((state.day || 0) % 360);
  out.textContent = t('acc.taxEst', { tax: money(tax), base: money(Math.max(0, Math.round(base))), days: left }) + estNote();
}
function taxPanel(box, c, founder) {
  box.append(el('h4', t('acc.taxTitle')));
  const last = c.fin?.lastDay || {}, other = Math.max(0, (finOf([c]).dayExp || 0) - (last.utilities || 0) - (last.stampTax || 0) - (last.accounting || 0));
  const k = el('div', null, 'mini');
  k.append(kpi(t('acc.stamp'), fmt(last.stampTax || 0)), kpi(t('acc.accounting'), fmt(last.accounting || 0)), kpi(t('acc.utilities'), fmt(last.utilities || 0)), kpi(t('acc.other'), fmt(other)));
  box.append(el('small', t('acc.breakdown'), 'muted'), k);
  const est = el('p'); est.id = 'taxEst'; est.textContent = '…'; box.append(est);
  if (c.lastTax) box.append(el('small', t('acc.lastTax', { year: c.lastTax.year, base: money(c.lastTax.base), tax: money(c.lastTax.tax) }), 'muted'));
  box.append(el('h4', t('acc.accountantTitle')));
  const row = el('div', null, 'others'), cur = c.accountant || 'none';
  ['none', 'basic', 'pro'].forEach(l => {
    const a = TAX().accountant[l], monthly = Math.round(a.feeDaily * 30), pct = Math.round((a.mult - 1) * 100);
    const label = `${t('acc.acc.' + l)} · ${l === 'none' ? t('acc.free') : t('acc.perMonth', { fee: money(monthly) })} · ${pct > 0 ? '+' : ''}${pct}% ${t('acc.taxWord')}`;
    const b = btn(label, () => { if (founder) socket.emit('setAccountant', { cid: c.id, level: l }); }); b.disabled = !founder; if (l === cur) b.className = 'sel'; row.append(b);
  });
  box.append(row, el('small', t('acc.accountantNote') + estNote(), 'muted'));
}
// Shop bills: each utility is optional; switching one off saves money but hurts sales
const UTIL_ICON = { electricity: '⚡', water: '💧', gas: '🔥', internet: '🌐' };
function billsPanel(box, c, founder) {
  box.append(el('h4', t('acc.billsTitle')));
  const on = { electricity: true, water: true, gas: true, internet: true, ...(c.utilities || {}) }, bills = c.bills || {};
  const list = el('div', null, 'prodList');
  Object.keys(UTIL_ICON).forEach(k => {
    const row = el('div', null, 'prodRow'), label = el('div', null, 'prodName');
    label.append(el('b', `${UTIL_ICON[k]} ${t('acc.util.' + k)}`), el('span', on[k] ? t('acc.billDay', { amount: money(bills[k] || 0) }) : t('acc.utilOff.' + k), 'prodPrice'));
    const sw = btn(on[k] ? t('acc.on') : t('acc.off'), () => socket.emit('setUtilities', { cid: c.id, utilities: { [k]: !on[k] } })); sw.disabled = !founder; if (on[k]) sw.className = 'sel';
    row.append(label, sw); list.append(row);
  });
  box.append(list, el('small', t('acc.billsNote'), 'muted'));
}
function pnlTable(months) {
  const frag = document.createDocumentFragment();
  const head = el('tr'); [t('fin.period'), t('fin.revenue'), t('fin.expense'), t('fin.profit'), t('fin.cash')].forEach(x => head.append(el('th', x)));
  frag.append(head);
  months.forEach(m => {
    const tr = el('tr');
    [t('fin.monthShort', { y: m.year, m: m.month }), fmt(m.revenue), fmt(m.expenses + m.losses), fmt(m.revenue - m.expenses - m.losses), fmt(m.closingCash)].forEach(v => tr.append(el('td', v)));
    frag.append(tr);
  });
  return frag;
}
$('finCompany').onchange = e => { finSel = e.target.value; Object.values(charts).forEach(ch => ch.destroy()); for (const k in charts) delete charts[k]; renderFinance(true); };

// ---------- Chat + polls ----------
// Turkish suffix harmony for names: Ahmet'ten Ayşe'ye (digits / odd endings fall back to an arrow)
const TR_VOWELS = 'aıoueiöü', TR_BACK = 'aıou', TR_HARD = 'çfhkpsşt';
function trSuffix(name, kind) {
  const n = String(name).trim(), last = n.slice(-1).toLowerCase();
  const v = [...n.toLowerCase()].reverse().find(ch => TR_VOWELS.includes(ch));
  if (!v || /\d/.test(last)) return null;
  const back = TR_BACK.includes(v), vowelEnd = TR_VOWELS.includes(last);
  if (kind === 'from') return `${n}'${TR_HARD.includes(last) ? 't' : 'd'}${back ? 'a' : 'e'}n`;
  return `${n}'${vowelEnd ? 'y' : ''}${back ? 'a' : 'e'}`;
}
function chatLabel(m) {
  if (!m.to) return m.by + ':';
  if (isTR()) { const f = trSuffix(m.by, 'from'), d = trSuffix(m.toName, 'to'); if (f && d) return `${f} ${d} mesaj:`; }
  return t('ui.fromTo', { from: m.by, to: m.toName }) + ':';
}
function addChat(m) {
  const li = el('li', null, m.to ? 'dm' : ''); li.dataset.id = m.id;
  li.append(el('b', chatLabel(m)), document.createTextNode(' ' + m.text));
  const list = $('chatList'); list.append(li);
  while (list.children.length > 60) list.firstChild.remove();
  list.scrollTop = list.scrollHeight;
}
function sysChat(text) { const li = el('li', text, 'sys'); $('chatList').append(li); $('chatList').scrollTop = 1e9; }
function sendChat() {
  const input = $('chatInput'), text = input.value.trim();
  if (!text || !state) return;
  input.value = '';
  if (text.startsWith('/')) return runCommand(text);
  socket.emit('chat', { text });
}
// Text commands: play the whole game from the chat box (watch-only mode friendly)
function runCommand(text) {
  const [cmd, ...args] = text.slice(1).trim().split(/\s+/), c = Object.values(state.companies).find(isMember);
  const need = () => { if (!c) { sysChat(t('cmd.noCompany')); return false; } return true; };
  switch (cmd.toLowerCase()) {
    case 'sat': case 'sell': if (need()) socket.emit('click', { cid: c.id }); break;
    case 'yatir': case 'invest': if (need()) socket.emit('invest', { cid: c.id, amount: Math.max(1, Math.floor(Number(args[0]) || 100)) }); break;
    case 'cek': case 'withdraw': if (need()) socket.emit('withdraw', args[0] ? { cid: c.id, amount: Math.max(1, Math.floor(Number(args[0]) / (isTR() ? RATE() : 1)) || 1) } : { cid: c.id }); break;
    case 'kur': case 'found': openWizard(); break;
    case 'oneri': case 'ok': acceptSuggestion(); break;
    case 'sira': case 'top': toggleBoard(true); break;
    default: sysChat(t('cmd.help'));
  }
}
// ---------- Talk to a nearby player (shows in the room chat as "A'dan B'ye mesaj") ----------
function nearestPlayer() {
  let best = null, d = TALK_NEAR;
  for (const [id, o] of others) { const dd = Math.abs(o.x - player.x); if (dd < d && state?.players[id]) { d = dd; best = id; } }
  return best;
}
function sendEmoji(e) { if (state && joined?.mode === 'multiplayer') socket.emit('emoji', { e }); }
function renderEmojiBar() {
  const bar = $('emojiBar'); bar.replaceChildren();
  EMOJIS.forEach(e => { const b = el('button', e, 'emojiBtn'); b.type = 'button'; b.onclick = () => sendEmoji(e); bar.append(b); });
}
function openTalkPlayer(id) {
  const p = state?.players[id]; if (!p) return;
  const o = others.get(id);
  if (!o || Math.abs(o.x - player.x) > TALK_RANGE) return toast(t('toast.tooFar'));
  openModal(body => {
    body.append(el('h3', '💬 ' + t('ui.talkTo', { name: p.name })));
    const input = el('input'); input.maxLength = 200; input.placeholder = t('ui.talkPh'); input.autocomplete = 'off';
    const send = () => { const text = input.value.trim(); if (!text) return; socket.emit('chat', { text, to: id }); input.value = ''; closeModal(); };
    input.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); send(); } };
    body.append(input, btn('➤ ' + t('ui.talkSend'), send, { primary: true, isDefault: true }));
    const row = el('div', null, 'emojiBar'); EMOJIS.forEach(e => { const b = el('button', e, 'emojiBtn'); b.type = 'button'; b.onclick = () => { sendEmoji(e); }; row.append(b); });
    body.append(row);
    setTimeout(() => input.focus(), 30);
  });
}
function talkNearest() { if (nearPlayer) openTalkPlayer(nearPlayer); else if (nearNpc) openNpc(nearNpc); }
$('talkBtn').onclick = talkNearest;
$('chatSend').onclick = sendChat;
$('chatInput').onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); sendChat(); } };
$('wizardBtn').onclick = () => openWizard();
let pollSig = '';
function renderPoll() {
  const poll = state?.presentation?.poll, box = $('pollBox');
  const sig = poll ? `${poll.id}|${poll.open}|${poll.total}|${votedPolls.has(poll.id)}|${i18next.language}` : '';
  if (sig === pollSig) return;
  pollSig = sig;
  if (!poll) return box.replaceChildren();
  const wrap = el('div', null, 'poll');
  wrap.append(el('b', '📊 ' + poll.question));
  const voted = votedPolls.has(poll.id) || !poll.open;
  poll.options.forEach((o, i) => {
    const pct = poll.total ? Math.round((o.votes / poll.total) * 100) : 0;
    const b = el('button'); const fill = el('i', null, 'fill'); fill.style.width = voted ? `${pct}%` : '0';
    b.append(fill, el('span', voted ? `${o.text} · ${pct}% (${o.votes})` : o.text));
    b.disabled = voted;
    b.onclick = () => { socket.emit('vote', { pollId: poll.id, option: i }); votedPolls.add(poll.id); pollSig = ''; renderPoll(); };
    wrap.append(b);
  });
  wrap.append(el('small', poll.open ? t('poll.votes', { n: poll.total }) : t('poll.closed', { n: poll.total }), 'muted'));
  box.replaceChildren(wrap);
}

// ---------- Render DOM ----------
let logSig = '';
// ---------- Timeline: events grouped by game day, newest first ----------
const LOG_ICON = [['invest', '💸'], ['campaign', '📣'], ['found', '🏁'], ['hire', '🤝'], ['bankrupt', '💥'], ['crisis', '🔥'], ['speed', '⏱'], ['joined', '👋'], ['left', '🚪'], ['buy', '🔑'], ['team', '👥'], ['idea', '💡']];
const logIcon = key => (LOG_ICON.find(([k]) => key.includes(k)) || [0, '•'])[1];
function timelineItems(log, time) {
  const out = []; let lastDay = null;
  for (const l of log) {
    const day = l.day ?? null;
    if (day !== lastDay) {
      lastDay = day;
      const h = el('li', null, 'dayHdr');
      const month = Math.floor(((day || 1) - 1) % 360 / 30) + 1;
      h.textContent = day ? t('ui.day', { day, year: Math.floor((day - 1) / 360) + 1, quarter: Math.ceil(month / 3), month }) : t('ui.timelineStart');
      out.push(h);
    }
    const li = el('li', null, 'tlItem'); li.append(el('span', null, 'tlDot'), el('span', `${time(l.at)} · ${t(l.key, resolve(l.params))}`));
    out.push(li);
  }
  return out;
}
function render() {
  if (!i18next.isInitialized) return;
  $('day').textContent = state ? [seed?.economy?.cityMap ? cityName(state.city) : '', state.calendar ? t('ui.day', state.calendar) : ''].filter(Boolean).join(' · ') : '';
  renderProfile(me());
  renderHud();
  renderAdvisor();
  renderFinance();
  renderPoll();
  if (boardOpen) renderBoard();
  updateSpeedBtn(); updateAdBanner(); updateVehBar(); refreshHome();
  if (state) {
    const sig = `${state.log[0]?.at}|${state.log.length}|${state.ideas.length}|${i18next.language}`;
    if (sig !== logSig) {
      logSig = sig;
      const time = ts => new Date(ts).toLocaleTimeString(i18next.language, { hour: '2-digit', minute: '2-digit' });
      $('log').replaceChildren(...timelineItems(state.log, time));
      $('ideas').replaceChildren(...state.ideas.map(i => el('li', `${i.by}: ${i.text}`)));
    }
  } else { logSig = ''; $('log').replaceChildren(); $('ideas').replaceChildren(); $('hud').replaceChildren(); hudSig = ''; }
}
let profSig = '';
// ---------- Quests, teams, badges (profile card) ----------
const BADGE_ICON = { hobbyist: '🎸', scholar: '🎓', firstCompany: '🏁', sales10: '🛒', sales100: '🛍', sales1000: '💎', floor3: '🏢', floor6: '🏙', firstHire: '🤝', marketer: '📣', secure: '🛡',
  social: '👋', commuter: '🚌', teamPlayer: '👥', questHero: '🎯', survivor: '🔥', investor: '💸', tycoon: '👑', landlord: '🔑', driver: '🚗' };
let extraSig = '';
function renderExtras(p) {
  const teams = state?.teams || {};
  const sig = p ? JSON.stringify([p.quests, p.badges, p.team, teams, joined?.mode, i18next.language]) : '';
  if (sig === extraSig) return;
  extraSig = sig;
  const qBox = $('quests'), tBox = $('teams'), bBox = $('badges');
  qBox.replaceChildren(); tBox.replaceChildren(); bBox.replaceChildren();
  if (!p) return;
  // daily quests
  (p.quests || []).forEach(q => {
    const d = el('div', null, 'quest' + (q.done ? ' done' : ''));
    const r1 = el('div', null, 'row1'); r1.append(el('span', (q.done ? '✅ ' : '🎯 ') + t('quest.' + q.id, { goal: q.goal })), el('b', `${Math.min(q.progress, q.goal)}/${q.goal}`));
    const bar = el('div', null, 'bar'), fill = el('i'); fill.style.width = `${(Math.min(q.progress, q.goal) / q.goal) * 100}%`; bar.append(fill);
    d.append(r1, bar, el('small', t('quest.reward', { amount: q.coins, xp: q.xp }), 'muted'));
    qBox.append(d);
  });
  qBox.append(el('small', t('quest.resets'), 'muted'));
  // teams
  if (!joined || joined.mode === 'solo') tBox.append(el('small', t('team.soloNote'), 'muted'));
  else {
    const list = Object.values(teams);
    if (!list.length) tBox.append(el('small', t('team.none'), 'muted'));
    list.forEach(tm => {
      const members = Object.values(state.players).filter(x => x.team === tm.id).length;
      const row = el('div', null, 'teamRow'); const dot = el('i', null, 'dot'); dot.style.background = tm.color;
      row.append(dot, el('b', `${tm.name} · ${t('team.members', { n: members })}`));
      if (p.team === tm.id) row.append(btn(t('team.leave'), () => socket.emit('leaveTeam')));
      else row.append(btn(t('team.join'), () => socket.emit('joinTeam', { teamId: tm.id }), { primary: !p.team }));
      tBox.append(row);
    });
    if (joined.mode === 'multiplayer' && list.length < 8) {
      const used = list.map(x => x.color), row = el('div', null, 'row');
      const nm = el('input'); nm.placeholder = t('team.namePh'); nm.maxLength = 24;
      const col = el('select'); (seed.teamColors || []).filter(c => !used.includes(c)).forEach((c, i) => { const o = new Option('● ' + t('team.color', { n: i + 1 }), c); o.style.color = c; col.append(o); });
      row.append(nm, col, btn(t('team.create'), () => { if (nm.value.trim()) socket.emit('createTeam', { name: nm.value.trim(), color: col.value }); }));
      tBox.append(row);
    } else if (joined.mode === 'presentation') tBox.append(el('small', t('team.adminOnly'), 'muted'));
  }
  // badges
  (seed.badges || []).forEach(id => {
    const has = (p.badges || []).includes(id), d = el('div', null, 'badge2' + (has ? '' : ' locked'));
    d.title = t('badgeDesc.' + id); d.append(el('span', BADGE_ICON[id] || '🏅'), document.createTextNode(t('badge.' + id)));
    bBox.append(d);
  });
}
// ---------- Real data (TÜİK / SGK / market) reference card ----------
let realSig = '';
function renderRealData() {
  const box = $('realData'), e = seed?.economy;
  if (!e || realSig === i18next.language) return;
  realSig = i18next.language;
  const d = e.data, tbl = el('table'), row = (k, v, est) => { const tr = el('tr'); const td = el('td', k); if (est) td.append(el('span', '*', 'est')); tr.append(td, el('td', v)); tbl.append(tr); };
  const emp = d.sgk.employer + d.sgk.unemploymentEmployer;
  row(t('real.minGross'), tl(d.minWage.gross)); row(t('real.minNet'), tl(d.minWage.net));
  row(t('real.sgk', { pct: (d.sgk.employer * 100).toFixed(2), un: (d.sgk.unemploymentEmployer * 100).toFixed(0) }), '%' + (emp * 100).toFixed(2));
  row(t('real.employerCost'), tl(d.minWage.gross * (1 + emp)));
  Object.entries(e.collars).forEach(([k, v]) => row(t('collar.' + k) + ' ' + t('hr.gross'), tl(v.gross), v.est));
  Object.values(e.cities).forEach(c => row(t('real.rent', { city: c.name }), tl(c.rentM2) + '/m²', c.est));
  row(t('real.fuel', { date: d.fuel.asOf }), tl(d.fuel.gasoline) + ' / L');
  row(t('real.car'), tl(d.car.buyPrice), true); row(t('real.carRent'), tl(d.car.rentDaily) + '/' + t('real.day'), true);
  row(t('real.rate'), `1c = ${tl(e.rate)}`);
  const wrap = el('div', null, 'real'); wrap.append(tbl, el('small', t('real.note')));
  const src = el('ul'); d.sources.forEach(x => { const li = el('li'); const a = el('a', x.label); a.href = x.url; a.target = '_blank'; a.rel = 'noopener noreferrer'; li.append(a); src.append(li); });
  wrap.append(src);
  box.replaceChildren(wrap);
}
function renderProfile(p) {
  renderExtras(p);
  const box = $('profile');
  const sig = p ? `${p.coins}|${p.busCard}|${Math.round(p.stats.xp)}|${p.stats.knowledge}|${p.stats.success}|${p.role}|${p.life?.happiness}|${p.life?.health}|${i18next.language}` : '';
  if (sig === profSig) return;
  profSig = sig; box.replaceChildren();
  if (!p) return;
  const s = p.stats, nextXp = 10 * s.level ** 2, prevXp = 10 * (s.level - 1) ** 2;
  const row = (label, value) => { const d = el('div', null, 'stat'); d.append(el('span', label), el('b', String(value))); box.append(d); };
  row(t('ui.level'), s.level);
  const bar = el('div', null, 'bar'), fill = el('i');
  fill.style.width = `${Math.min(100, ((s.xp - prevXp) / Math.max(1, nextXp - prevXp)) * 100)}%`; bar.append(fill); box.append(bar);
  row(t('ui.xp'), Math.round(s.xp));
  row(t('ui.knowledge'), s.knowledge);
  row(t('ui.success'), s.success);
  row(t('ui.performance'), 'x' + s.performance);
  row('💰', money(p.coins));
  if (p.life) { row('😊 ' + t('home.happiness'), p.life.happiness + '/100'); row('❤️ ' + t('home.health'), p.life.health + '/100'); }
  row('💳 ' + t('bus.card'), money(p.busCard || 0));
  row('🎭', t(p.role));
}

// ---------- Modal ----------
let modalClosable = true;
function openModal(fill, { closable = true, onClose = null } = {}) {
  if (modalOpen && modalOnClose) { const cb = modalOnClose; modalOnClose = null; cb(); }
  modalClosable = closable; modalOpen = true; modalOnClose = onClose;
  const body = $('modalBody'); body.replaceChildren(); delete body.dataset.npc; delete body.dataset.modes; fill(body);
  if (closable) { const b = el('button', t('ui.close')); b.onclick = closeModal; body.append(b); }
  $('modal').style.display = 'flex';
  const def = body.querySelector('[data-default]');
  if (def && !touch && !body.querySelector('input:focus')) setTimeout(() => def.focus(), 30);
}
function closeModal() {
  $('modal').style.display = 'none'; modalOpen = false;
  if (modalOnClose) { const cb = modalOnClose; modalOnClose = null; cb(); }
}
$('modal').onclick = e => { if (e.target.id === 'modal' && modalClosable) closeModal(); };
const btn = (label, onClick, { primary = false, isDefault = false } = {}) => {
  const b = el('button', label, primary ? 'primary' : ''); b.onclick = onClick; if (isDefault) b.dataset.default = '1'; return b;
};

// lot.rent / lot.price come from the server (city real-estate data converted to coins)
const costLabel = (ws, lot) => {
  if (ws === 'shop') { const base = lot.rent, n = lot.companyIds.length + 1; return Math.ceil(base / n) + Math.ceil(base * 0.3 / n); }
  return seed.workspaces[ws].rent + (seed.workspaces[ws].electricity || 0);
};
const depositLabel = (ws, lot) => (ws === 'shop' ? Math.ceil(lot.rent / (lot.companyIds.length + 1)) * 5 : seed.workspaces[ws].deposit);
const breakEvenYears = lot => (lot.price / (lot.rent * 360)).toFixed(1);
const freeLot = type => state.lots.find(l => l.type === type && l.companyIds.length < maxTenants(seed, l));

// Template select with "Other (add your own)"
function productPicker(box, defaultIdx, sector) {
  const tplSel = el('select');
  seed.templates.forEach((tp, i) => { if (!sector || tp.sector === sector) tplSel.append(new Option(`${t(tp.key)} (${t(tp.sector)}, ${money(tp.price)})`, i)); });
  tplSel.append(new Option('➕ ' + t('ui.otherTemplate'), 'custom'));
  tplSel.value = [...tplSel.options].some(o => o.value === String(defaultIdx)) ? String(defaultIdx) : tplSel.options[0].value;
  const custom = el('div', null, 'row'); custom.hidden = true;
  const label = el('input'); label.placeholder = t('ui.customLabelPh'); label.maxLength = 30;
  const secSel = el('select'); seed.custom.sectors.forEach(s => secSel.append(new Option(t(s), s))); if (sector) secSel.value = sector;
  const unit = isTR() ? RATE() : 1; // Turkish players type the price in ₺
  const price = el('input'); price.type = 'number'; price.min = Math.round(seed.custom.minPrice * unit); price.max = Math.round(seed.custom.maxPrice * unit); price.value = Math.round(10 * unit);
  price.title = t('ui.customPrice', { min: money(seed.custom.minPrice), max: money(seed.custom.maxPrice) });
  custom.append(label, secSel, price);
  tplSel.onchange = () => { custom.hidden = tplSel.value !== 'custom'; if (!custom.hidden) label.focus(); };
  box.append(tplSel, custom);
  return () => (tplSel.value === 'custom'
    ? { custom: { label: label.value.trim(), sector: secSel.value, price: Math.max(seed.custom.minPrice, Math.min(seed.custom.maxPrice, Math.round(Number(price.value) / unit))) } }
    : { templateIdx: +tplSel.value });
}
function foundForm(body, { lot = null, choices, isDefault, rec }) {
  const box = el('div', null, isDefault ? 'rec' : 'co');
  box.append(el('h4', (isDefault ? '⭐ ' : '') + t('ui.foundHere')));
  if (rec) box.append(el('small', t(rec.reasonKey, resolve(rec.params))));
  const wsSel = el('select');
  choices.forEach(ws => wsSel.append(new Option(t('ws.' + ws), ws)));
  wsSel.value = rec?.action.payload.workspace || choices[0];
  const info = el('p');
  const refresh = () => (info.textContent = `${t('ui.deposit', { amount: depositLabel(wsSel.value, lot) })} · ${t('ui.cost', { cost: costLabel(wsSel.value, lot) })}`);
  wsSel.onchange = refresh; refresh();
  if (choices.length > 1) box.append(wsSel);
  box.append(info);
  let own = null;
  if (lot && lot.type === 'shop' && !lot.companyIds.length && !lot.owner) {
    own = el('select');
    own.append(new Option(t('estate.rentOpt', { dep: depositLabel('shop', lot), rent: lot.rent }), 'rent'), new Option(t('estate.buyOpt', { buy: lot.price }), 'buy'));
    box.append(own, el('small', t('estate.plan', { years: breakEvenYears(lot), city: seed.economy.cities[state.city]?.name || '' }), 'muted'));
  }
  const pick = productPicker(box, rec?.action.payload.templateIdx ?? (lot ? lot.id % seed.templates.length : 2));
  const nm = el('input'); nm.placeholder = t('ui.companyNamePh'); nm.maxLength = 40;
  box.append(nm);
  const row = el('div', null, 'row');
  row.append(btn((isDefault ? '✓ ' : '') + t('ui.found'), () => {
    const prod = pick();
    if (prod.custom && !prod.custom.label) return toast(t('toast.badCustom'));
    socket.emit('found', { lotId: lot?.id ?? null, workspace: wsSel.value, name: nm.value, ownership: own?.value, ...prod }); closeModal();
  }, { primary: true, isDefault }), btn('🧭 ' + t('wiz.open'), () => openWizard()));
  box.append(row);
  body.append(box);
}

// ---------- Founding wizard: Q&A, Next / OK ----------
// Company wizard. Quick = 2 steps, Standard = 4, Detailed = 7 (extra products, discounts, summary).
const WIZ_MODES = { quick: ['sectorProduct', 'placeName'], standard: ['sector', 'product', 'place', 'name'], detailed: ['sector', 'product', 'extra', 'discount', 'place', 'name', 'summary'] };
function openWizard() {
  if (!state) return;
  const w = { mode: null, step: 0, sector: seed.custom.sectors[2], product: null, workspace: 'home', name: '', discount: 0, extra: [] };
  const unit = isTR() ? RATE() : 1, pmin = seed.custom.minPrice, pmax = seed.custom.maxPrice, toCoins = v => Math.max(pmin, Math.min(pmax, Math.round(Number(v) / unit) || pmin));
  const primaryName = () => w.product?.custom ? w.product.custom.label : t(seed.templates[w.product?.templateIdx ?? 0].key);
  const primaryPrice = () => w.product?.custom ? w.product.custom.price : seed.templates[w.product?.templateIdx ?? 0].price;
  const placeGrid = body => {
    const grid = el('div', null, 'choices'), coins = me()?.coins || 0;
    const opts = ['home', 'virtual', 'eoffice', 'coworking', 'shop'].map(ws => {
      const lot = seed.workspaces[ws].physical ? freeLot(ws) : null, ok = !seed.workspaces[ws].physical || !!lot, dep = ok ? depositLabel(ws, lot) : null;
      return { ws, lot, ok: ok && coins >= (dep || 0), dep, cost: ok ? costLabel(ws, lot) : null };
    });
    if (!opts.find(o => o.ws === w.workspace)?.ok) w.workspace = 'home';
    opts.forEach(o => {
      const b = btn(`${t('ws.' + o.ws)} · ${o.dep == null ? t('ui.full') : t('wiz.deposit', { dep: o.dep, cost: o.cost })}`, () => { w.workspace = o.ws; render(); });
      b.disabled = !o.ok; if (o.ws === w.workspace) b.className = 'sel'; grid.append(b);
    });
    body.append(grid);
  };
  const nameInput = body => { const nm = el('input'); nm.placeholder = t('ui.companyNamePh'); nm.maxLength = 40; nm.value = w.name; nm.oninput = () => (w.name = nm.value); body.append(nm); };
  const found = () => {
    socket.emit('found', { lotId: seed.workspaces[w.workspace].physical ? 'auto' : null, workspace: w.workspace, name: w.name, ...w.product,
      discount: w.discount, products: w.extra.map(x => ({ name: x.name, price: x.price, discount: x.discount })) });
    closeModal();
  };
  const render = () => openModal(body => {
    if (!w.mode) { // step 0: choose how detailed the setup should be
      body.append(el('h3', `🧭 ${t('wiz.title')}`), el('p', t('wiz.chooseMode'), 'muted'));
      const grid = el('div', null, 'choices');
      Object.keys(WIZ_MODES).forEach(m => { const b = btn(`${t('wiz.mode.' + m)} · ${t('wiz.steps', { n: WIZ_MODES[m].length })}`, () => { w.mode = m; w.step = 0; render(); }); b.title = t('wiz.modeDesc.' + m); grid.append(b, el('small', t('wiz.modeDesc.' + m), 'muted')); });
      body.append(grid); return;
    }
    const steps = WIZ_MODES[w.mode], kind = steps[w.step], last = w.step === steps.length - 1;
    const bar = el('div', null, 'steps'); steps.forEach((_, i) => bar.append(el('i', null, i <= w.step ? 'on' : ''))); body.append(bar);
    body.append(el('h3', `🧭 ${t('wiz.title')} · ${w.step + 1}/${steps.length}`), el('p', t('wiz.q.' + kind), 'muted'));
    const nav = el('div', null, 'wizNav');
    const back = btn('◀ ' + t('wiz.back'), () => { if (w.step === 0) w.mode = null; else w.step--; render(); });
    let next = btn(t('wiz.next') + ' ▶', () => { w.step++; render(); }, { primary: true, isDefault: true });
    if (kind === 'sector') {
      const grid = el('div', null, 'choices');
      seed.custom.sectors.forEach(s => { const b = btn(t(s), () => { w.sector = s; w.step++; render(); }); if (s === w.sector) b.className = 'sel'; grid.append(b); });
      body.append(grid);
    } else if (kind === 'product' || kind === 'sectorProduct') {
      const box = el('div');
      let pick;
      const build = () => { box.replaceChildren(); pick = productPicker(box, seed.templates.findIndex(tp => tp.sector === w.sector), w.sector); };
      if (kind === 'sectorProduct') { const sel = el('select'); seed.custom.sectors.forEach(s => sel.append(new Option(t(s), s))); sel.value = w.sector; sel.onchange = () => { w.sector = sel.value; build(); }; body.append(sel); }
      build(); body.append(box);
      const go = () => { const p = pick(); if (p.custom && !p.custom.label) return toast(t('toast.badCustom')); w.product = p; if (kind === 'sectorProduct') { w.step++; render(); } else { w.step++; render(); } };
      next = btn(t('wiz.next') + ' ▶', go, { primary: true, isDefault: true });
    } else if (kind === 'extra') {
      body.append(el('small', t('wiz.extraNote', { name: primaryName() }), 'muted'));
      const list = el('div', null, 'prodList');
      w.extra.forEach((x, i) => { const row = el('div', null, 'prodRow'); row.append(el('div', `${x.name} · ${money(x.price)}`, 'prodName'), btn('🗑', () => { w.extra.splice(i, 1); render(); })); list.append(row); });
      body.append(list);
      if (w.extra.length < 7) {
        const row = el('div', null, 'row'), nm = el('input'); nm.placeholder = t('prod.namePh'); nm.maxLength = 30;
        const pr = el('input'); pr.type = 'number'; pr.inputMode = 'decimal'; pr.min = Math.round(pmin * unit); pr.max = Math.round(pmax * unit); pr.value = Math.round(10 * unit);
        row.append(nm, pr, btn('➕', () => { if (!nm.value.trim()) return toast(t('toast.badCustom')); w.extra.push({ name: nm.value.trim(), price: toCoins(pr.value), discount: 0 }); render(); }));
        body.append(row);
      }
    } else if (kind === 'discount') {
      const items = [{ name: primaryName(), price: primaryPrice(), get d() { return w.discount; }, set d(v) { w.discount = v; } }, ...w.extra.map(x => ({ name: x.name, price: x.price, get d() { return x.discount; }, set d(v) { x.discount = v; } }))];
      items.forEach(it => {
        const row = el('div', null, 'prodRow'), info = el('small', null, 'muted');
        const sl = el('input'); sl.type = 'range'; sl.min = 0; sl.max = 90; sl.value = it.d;
        const show = () => (info.textContent = `${it.name}: ${money(it.price)} → ${money(netPrice({ price: it.price, discount: it.d }))} (−%${it.d})`);
        sl.oninput = () => { it.d = Number(sl.value); show(); }; show();
        const col = el('div', null, 'prodName'); col.append(info, sl); row.append(col); body.append(row);
      });
    } else if (kind === 'place') placeGrid(body);
    else if (kind === 'placeName') { placeGrid(body); nameInput(body); }
    else if (kind === 'name') nameInput(body);
    else if (kind === 'summary') body.append(el('p', '✓ ' + t('wiz.summary', { sector: t(w.sector), product: primaryName() + (w.extra.length ? ` +${w.extra.length}` : ''), place: t('ws.' + w.workspace) })));
    if (kind === 'name' && !last) { /* detailed: name, then summary */ }
    if (last) {
      if (kind === 'name' || kind === 'placeName') body.append(el('p', t('wiz.summary', { sector: t(w.sector), product: primaryName() + (w.extra.length ? ` +${w.extra.length}` : ''), place: t('ws.' + w.workspace) })));
      next = btn('✓ ' + t('ui.found'), found, { primary: true, isDefault: true });
    }
    nav.append(back, next); body.append(nav);
  });
  render();
}

// ---------- Company cards (street building panel) ----------
function sparkline(canvas, values) {
  const dpr = window.devicePixelRatio || 1, w = canvas.clientWidth || 300, h = 44;
  canvas.width = w * dpr; canvas.height = h * dpr;
  const g = canvas.getContext('2d'); g.scale(dpr, dpr);
  if (values.length < 2) { g.fillStyle = css('--muted'); g.font = '11px system-ui'; g.fillText(t('fin.noHistory'), 4, 26); return; }
  const min = Math.min(0, ...values), max = Math.max(1, ...values), y = v => h - 4 - ((v - min) / (max - min)) * (h - 8);
  if (min < 0) { g.strokeStyle = css('--line'); g.lineWidth = 1; g.beginPath(); g.moveTo(0, y(0)); g.lineTo(w, y(0)); g.stroke(); }
  g.strokeStyle = css('--series-1'); g.lineWidth = 2; g.lineJoin = 'round'; g.beginPath();
  values.forEach((v, i) => { const x = 2 + (i / (values.length - 1)) * (w - 4); i ? g.lineTo(x, y(v)) : g.moveTo(x, y(v)); });
  g.stroke();
  g.fillStyle = css('--series-1'); g.beginPath(); g.arc(w - 2, y(values.at(-1)), 3, 0, Math.PI * 2); g.fill();
}
function miniFinance(box, c) {
  const f = finOf([c]), mini = el('div', null, 'mini');
  mini.append(kpi(t('fin.cash'), fmt(c.cash)), kpi(t('fin.revenueToday'), fmt(f.todayRev), css('--series-1')),
    kpi(t('fin.expenseDay'), fmt(f.dayExp), css('--series-2')), kpi(t('fin.monthNet'), (f.monthRev - f.monthExp >= 0 ? '+' : '') + fmt(f.monthRev - f.monthExp)));
  box.append(mini);
  const spark = el('canvas', null, 'spark'); spark.setAttribute('aria-label', t('ui.chartCash'));
  box.append(spark);
  getHistory(c.id, h => sparkline(spark, [...h.daily.slice(-30).map(d => d.cash), c.cash]), 5000);
}
function companyBlock(body, c, isDefault) {
  const box = el('div', null, 'co');
  box.append(el('h4', `${companyName(c)} · ${t('ws.' + c.workspace)}`));
  box.append(el('p', t('ui.info', { price: c.price, cash: c.cash, founders: c.founders.length, employees: staffOf(c) })));
  if (c.crisis && c.crisis.until > (state.day || 0)) {
    const mult = { concordat: 0.5, trustee: 0.3, govPressure: 0.7, politicalAttack: 0.6, war: 0.4, cyberAttack: 0.2 }[c.crisis.type];
    const w = el('p', t('ui.inCrisis', { crisis: t('crisis.' + c.crisis.type), mult })); w.style.color = 'var(--bad)'; box.append(w);
  }
  miniFinance(box, c);
  const { list, rec } = companyActions({ state, seed, myId: myId() }, c, ranked);
  const run = a => () => { socket.emit(a.ev, { cid: c.id, ...(a.payload || {}) }); closeModal(); };
  const pick = a => {
    if (a.ev === 'invest') return () => moneyPicker({ title: t('ui.investPick') + ' · ' + companyName(c), note: t('ui.investNote', { coins: money(me().coins) }), maxCoins: me().coins,
      defCoins: Math.min(a.payload?.amount || 100, me().coins), confirmLabel: t('ui.confirm'), onConfirm: amount => socket.emit('invest', { cid: c.id, amount }) });
    if (a.ev === 'withdraw') return () => moneyPicker({ title: t('ui.withdrawPick') + ' · ' + companyName(c), note: t('ui.withdrawNote', { cash: money(c.cash) }), maxCoins: c.cash,
      defCoins: c.cash * 0.2 / Math.max(1, c.founders.length), confirmLabel: t('ui.confirm'), onConfirm: amount => socket.emit('withdraw', { cid: c.id, amount }) });
    return run(a);
  };
  const top = list.find(a => a.recommended);
  if (top) {
    const r = el('div', null, 'rec');
    r.append(el('small', '⭐ ' + t('ui.recommended') + (rec ? ' · ' + t(rec.reasonKey, resolve(rec.params)) : '')));
    r.append(btn('✓ ' + t(top.key, top.payload), run(top), { primary: true, isDefault }));
    box.append(r);
  }
  const role = roleOf(c);
  if (role === 'busCard' && !isPres()) {
    const r2 = el('div', null, 'others');
    seed.economy.busTopups.forEach(a => r2.append(btn(`💳 ${t('bus.topup', { amount: a })}`, () => { socket.emit('busTopup', { cid: c.id, amount: a }); })));
    box.append(el('small', t('bus.cardInfo', { balance: me()?.busCard || 0, fare: seed.economy.busFare }), 'muted'), r2);
  }
  if (role === 'carDealer' || role === 'rentACar') { box.append(el('small', t('veh.dealerInfo.' + role, { buy: seed.economy.vehicle.models.sedan_new.price, rent: seed.economy.vehicle.rentPerDay }), 'muted')); if (!isPres()) box.append(btn('🏁 ' + t('veh.gallery'), () => openGalleryFor())); }
  const rest = list.filter(a => !a.recommended);
  const row = el('div', null, 'others');
  rest.forEach(a => row.append(btn((a.ev === 'invest' ? '🎚 ' + t('ui.investPick') : a.ev === 'withdraw' ? '🎚 ' + t('ui.withdrawPick') : t(a.key, a.payload)), pick(a))));
  if (!isPres()) row.append(btn('🚪 ' + t(isMember(c) ? 'ui.enterOffice' : 'ui.visit'), () => enterCompany(c)));
  if (!isPres() && c.founders.includes(myId())) row.append(btn('📢 ' + t('ad.title'), () => openAdManager(c)));
  if (row.children.length) { box.append(el('small', t('ui.otherOptions'), 'muted')); box.append(row); }
  body.append(box);
}
function openBuilding(b) {
  if (!state) return showModes();
  cancelPlan();
  const forThis = ranked.find(s => buildingOf(s.target)?.id === b.id);
  if (b.kind === 'guide') return openModal(body => { body.append(el('h3', t('ui.guide'))); seed.tutorial.forEach(k => body.append(el('p', t(k)))); });
  if (b.kind === 'demoday') return openDemoDay();
  if (b.kind === 'locked') return toast(t('ui.premiumAlert', { feature: t('locked.skyscraper') }));
  if (b.kind === 'home') return isPres() ? null : openHome();
  if (b.kind === 'parking') return openParking();
  if (b.kind === 'terminal') return openTerminal();
  if (b.kind === 'lot' && !isPres()) {
    const mine = b.lot.companyIds.map(id => state.companies[id]).find(c => c?.founders.includes(myId()));
    if (mine) return enterCompany(mine); // own HQ: zoom straight into the building
  }
  const foundRec = forThis?.action.ev === 'found' ? forThis : null;
  if (b.kind === 'plaza') return openModal(body => {
    body.append(el('h3', t('ui.plazaTitle')));
    const list = Object.values(state.companies).filter(c => c.lotId == null);
    const defCid = foundRec ? null : (forThis?.cid || list[0]?.id);
    if (!list.length) body.append(el('p', t('ui.noVirtual'), 'muted'));
    list.sort((a, c) => isMember(c) - isMember(a)).forEach(c => companyBlock(body, c, c.id === defCid));
    foundForm(body, { choices: ['home', 'virtual', 'eoffice'], isDefault: !!foundRec || !list.length, rec: foundRec });
  });
  const lot = b.lot, tenants = lot.companyIds.map(id => state.companies[id]).filter(Boolean), max = maxTenants(seed, lot);
  openModal(body => {
    body.append(el('h3', lot.type === 'coworking' ? t('ws.coworking') : `${t('ws.shop')} (${lot.size} m²)`));
    body.append(el('p', t('ui.tenants', { n: tenants.length, max }), 'muted'));
    const defCid = foundRec ? null : (forThis?.cid || tenants[0]?.id);
    tenants.forEach(c => companyBlock(body, c, c.id === defCid));
    if (tenants.length < max) foundForm(body, { lot, choices: [lot.type], isDefault: !!foundRec || !tenants.length, rec: foundRec });
    else body.append(el('p', t('ui.full'), 'muted'));
  });
}

// ---------- Department panels (inside the HQ) ----------
function benefitsEditor(box, c) {
  const wrap = el('details'); wrap.append(el('summary', t('ui.benefits')));
  const remote = seed.workspaces[c.workspace]?.remote, checks = {};
  for (const k of Object.keys(seed.benefits)) {
    const lab = el('label'); lab.style.cssText = 'display:flex;gap:8px;align-items:center;padding:4px 0';
    const cb = el('input'); cb.type = 'checkbox'; cb.checked = !!c.benefits?.[k]; cb.style.minHeight = '20px';
    if (k === 'transport' && remote) { cb.disabled = true; cb.checked = false; }
    checks[k] = cb;
    lab.append(cb, el('span', `${t('ben.' + k)} (${money(seed.benefits[k].cost)}, +${Math.round(seed.benefits[k].perf * 100)}%)`));
    wrap.append(lab);
  }
  if (remote) wrap.append(el('p', t('ui.remoteNote')));
  wrap.append(el('p', `${t('ui.benefitCost', { cost: c.benefitCost || 0 })} · ${t('ui.perfInfo', { perf: c.performance || 1 })}`));
  wrap.append(btn(t('ui.saveBenefits'), () => { socket.emit('setBenefits', { cid: c.id, benefits: Object.fromEntries(Object.entries(checks).map(([k, cb]) => [k, cb.checked])) }); closeModal(); }));
  box.append(wrap);
}
// Delivery & company vehicle: courier/taxi per km vs. rented or owned car (fuel + upkeep)
// ---------- Company vehicle: gallery (new / used), timed rental, parking ----------
const VEH = () => seed.economy.vehicle;
const vehName = id => t('veh.model.' + id);
const vehIcon = id => (id.startsWith('van') ? '🚐' : '🚗');
const vehLeft = v => (v?.type === 'rent' && v.until != null ? Math.max(0, v.until - (state.day || 0)) : null);
function openGallery(c) {
  const V = VEH();
  openModal(body => {
    body.append(el('h3', '🏁 ' + t('veh.gallery') + ' · ' + companyName(c)), el('p', t('veh.galleryNote', { cash: money(c.cash) }), 'muted'));
    const list = el('div', null, 'prodList');
    Object.entries(V.models).forEach(([id, m]) => {
      const row = el('div', null, 'prodRow'), label = el('div', null, 'prodName');
      label.append(el('b', `${vehIcon(id)} ${vehName(id)}`),
        el('span', `${m.cond === 'new' ? t('veh.new') : t('veh.used', { age: m.ageYears, km: Math.round(m.km / 1000) })} · ${t('veh.upkeep', { amount: money(m.upkeepPerDay) })} · ${t('veh.fuelKm', { amount: money(m.fuelPerKm * 100) })}${m.boost ? ' · ' + t('veh.boost', { pct: Math.round(m.boost * 100) }) : ''}`, 'prodPrice'));
      const b = btn(money(m.price), () => { closeModal(); socket.emit('vehicle', { cid: c.id, mode: 'buy', model: id }); });
      b.disabled = !!c.vehicle || c.cash < m.price; if (c.vehicle) b.title = t('veh.hasOne');
      row.append(label, b); list.append(row);
    });
    body.append(list);
    if (c.vehicle) body.append(el('small', t('veh.hasOne'), 'muted'));
    body.append(el('h4', t('veh.rentTitle')), el('small', t('veh.rentNote', { rent: money(V.rentPerDay) }), 'muted'));
    const row = el('div', null, 'others');
    V.rentDays.forEach(d => { const b = btn(t('veh.rentDays', { n: d }), () => { closeModal(); socket.emit('vehicle', { cid: c.id, mode: 'rent', days: d }); }); b.disabled = !!c.vehicle; row.append(b); });
    body.append(row);
  });
}
function openGalleryFor() {
  const mine = Object.values(state.companies).filter(c => c.founders.includes(myId()));
  if (!mine.length) return toast(t('veh.needCompany'));
  if (mine.length === 1) return openGallery(mine[0]);
  openModal(body => { body.append(el('h3', '🏁 ' + t('veh.gallery')), el('p', t('veh.pickCompany'), 'muted')); mine.forEach(c => body.append(btn(companyName(c), () => openGallery(c)))); });
}
function vehiclePanel(box, c, founder) {
  const V = VEH(), km = seed.economy.deliveryKm[sectorOf(c)] ?? 2, f = c.fin || {};
  const monthKm = (f.month?.km || 0) + (f.today?.km || 0), monthFuel = f.month?.fuel || 0, v = c.vehicle;
  const wrap = el('div', null, 'co'); wrap.append(el('h4', '🚚 ' + t('veh.title')));
  wrap.append(el('p', t('veh.info', { km, monthKm: Math.round(monthKm), fuel: monthFuel })));
  const k = el('div', null, 'mini');
  k.append(kpi(t('veh.courier'), money(V.courierPerKm * Math.max(1, km))), kpi(t('veh.ownFuel'), money(V.models.sedan_new.fuelPerKm * Math.max(1, km))),
    kpi(t('veh.rentDay'), money(V.rentPerDay)), kpi(t('veh.buy'), money(V.models.sedan_new.price, true)));
  wrap.append(el('small', t('veh.perSale'), 'muted'), k);
  if (v) {
    const left = vehLeft(v);
    wrap.append(el('p', `${vehIcon(v.model)} ${v.type === 'rent' ? t('veh.has.rent') + (left != null ? ' · ' + t('veh.daysLeft', { n: left }) : '') : t('veh.has.own') + ' · ' + vehName(v.model) + ' · ' + t('veh.value', { amount: money(c.vehicleValue || 0) })}`));
    wrap.append(el('p', '📍 ' + t(v.park === 'lot' ? 'veh.parkedLot' : 'veh.parkedDoor') + ' · ' + (v.park === 'lot' ? t('veh.parkFee', { amount: money(V.parkingPerDay) }) : t('veh.doorRisk', { pct: Math.round(V.damage.chancePerDay * 1000) / 10 })), 'muted'));
  } else wrap.append(el('p', '🚗 ' + t('veh.none')));
  if (founder) {
    const row = el('div', null, 'others');
    if (!v) {
      const courierMonth = monthKm * V.courierPerKm, rentMonth = V.rentPerDay * 30 + monthKm * V.models.sedan_new.fuelPerKm, better = courierMonth > rentMonth;
      row.append(btn('🏁 ' + t('veh.gallery'), () => openGallery(c), { primary: better, isDefault: better }));
      wrap.append(el('small', better ? t('veh.recRent') : t('veh.recCourier'), 'muted'));
    } else {
      if (v.type === 'rent') V.rentDays.slice(0, 3).forEach(d => row.append(btn('⏩ ' + t('veh.extend', { n: d }), () => { socket.emit('vehicle', { cid: c.id, mode: 'extend', days: d }); closeModal(); })));
      row.append(btn(v.park === 'lot' ? '🏠 ' + t('veh.toDoor') : '🅿 ' + t('veh.toLot', { amount: money(V.parkingPerDay) }), () => { socket.emit('vehicle', { cid: c.id, mode: 'park', where: v.park === 'lot' ? 'door' : 'lot' }); closeModal(); }));
      row.append(btn(v.type === 'own' ? t('veh.sellFor', { amount: money(c.vehicleValue || 0) }) : t('veh.return'), () => { socket.emit('vehicle', { cid: c.id, mode: 'none' }); closeModal(); }));
    }
    wrap.append(row);
  }
  box.append(wrap);
}
// Car park building at the end of the street: lists company cars parked there
function openParking() {
  const parked = Object.values(state.companies).filter(c => c.vehicle?.park === 'lot');
  openModal(body => {
    body.append(el('h3', '🅿 ' + t('veh.parkingSign')), el('p', t('veh.parkingNote', { fee: money(VEH().parkingPerDay) }), 'muted'));
    if (!parked.length) body.append(el('p', t('veh.parkingEmpty'), 'muted'));
    parked.forEach(c => { const row = el('div', null, 'prodRow'); row.append(el('div', `${vehIcon(c.vehicle.model)} ${companyName(c)} · ${vehName(c.vehicle.model)}`, 'prodName'));
      if (c.founders.includes(myId())) row.append(btn('🏠 ' + t('veh.toDoor'), () => { socket.emit('vehicle', { cid: c.id, mode: 'park', where: 'door' }); closeModal(); })); body.append(row); });
    const mine = Object.values(state.companies).filter(c => c.founders.includes(myId()) && c.vehicle && c.vehicle.park !== 'lot');
    mine.forEach(c => body.append(btn('🅿 ' + t('veh.toLotFor', { company: companyName(c) }), () => { socket.emit('vehicle', { cid: c.id, mode: 'park', where: 'lot' }); closeModal(); })));
  });
}
// Top bar: remaining time of the rentals of my companies
function updateVehBar() {
  const bar = $('vehBar'); if (!bar) return;
  const rows = state ? Object.values(state.companies).filter(c => c.founders.includes(myId()) && c.vehicle?.type === 'rent' && c.vehicle.until != null) : [];
  if (!rows.length) { bar.hidden = true; return; }
  bar.hidden = false;
  const sig = rows.map(c => `${c.id}:${c.vehicle.until}:${c.vehicle.days}:${state.day}`).join('|') + i18next.language;
  if (bar.dataset.sig === sig) return; bar.dataset.sig = sig;
  bar.replaceChildren(...rows.slice(0, 2).map(c => {
    const v = c.vehicle, left = vehLeft(v), total = v.days || 1, pct = Math.max(0, Math.min(100, Math.round((left / total) * 100)));
    const row = el('div', null, 'vehRow' + (left <= 1 ? ' low' : '')); row.append(el('span', `🚗 ${companyName(c)} · ${t('veh.daysLeft', { n: left })}`), Object.assign(el('div', null, 'bar'), {}));
    const fill = el('i'); fill.style.width = pct + '%'; row.lastChild.append(fill); return row;
  }));
}
// Real estate: rent vs. buy for the lot the company occupies
function estatePanel(box, c, founder) {
  if (c.lotId == null) return;
  const lot = state.lots[c.lotId]; if (lot.type !== 'shop') return;
  const wrap = el('div', null, 'co'); wrap.append(el('h4', '🏠 ' + t('estate.title', { city: seed.economy.cities[state.city]?.name || '' })));
  const k = el('div', null, 'mini');
  k.append(kpi(t('estate.rentDay'), money(lot.rent)), kpi(t('estate.rentMonth'), money(lot.rent * 30, true)), kpi(t('estate.price'), money(lot.price, true)), kpi(t('estate.breakEven'), t('estate.years', { years: breakEvenYears(lot) })));
  wrap.append(k);
  if (founder) {
    if (lot.owner === c.id) wrap.append(el('p', '🔑 ' + t('estate.owned')), btn(t('estate.sell', { sale: Math.round(lot.price * 0.9) }), () => { socket.emit('sellLot', { cid: c.id }); closeModal(); }));
    else if (!lot.owner && lot.companyIds.length === 1) wrap.append(btn(t('estate.buy', { buy: lot.price }), () => { socket.emit('buyLot', { cid: c.id }); closeModal(); }));
    else wrap.append(el('small', t('estate.shared'), 'muted'));
  }
  box.append(wrap);
}
// HR: blue / grey / white collar hiring with real 2026 salary data
const collarNet = (c, k) => { const col = seed.economy.collars[k]; return Math.round(c.price * (seed.workspaces[c.workspace]?.salesMult || 1) * col.factor - col.salary); };
function collarPanel(box, c, emit) {
  const cols = seed.economy.collars, best = Object.keys(cols).sort((a, b) => collarNet(c, b) - collarNet(c, a))[0];
  const tbl = el('table'); tbl.className = 'real'; tbl.style.width = '100%';
  const head = el('tr'); ['', t('hr.gross'), t('hr.net'), t('hr.employer'), t('hr.daily'), t('hr.contrib')].forEach(h => head.append(el('th', h))); tbl.append(head);
  Object.entries(cols).forEach(([k, v]) => {
    const tr = el('tr');
    [t('collar.' + k) + (v.est ? ' *' : ''), tl(v.gross), tl(v.net), tl(v.employerCost), money(v.salary), (collarNet(c, k) >= 0 ? '+' : '') + money(collarNet(c, k))].forEach(x => tr.append(el('td', x)));
    tbl.append(tr);
  });
  box.append(el('small', t('hr.source'), 'muted'), tbl);
  const mix = c.staffMix || { blue: c.npcStaff || 0, grey: 0, white: 0 };
  box.append(el('p', t('hr.mix', { blue: mix.blue || 0, grey: mix.grey || 0, white: mix.white || 0 })));
  const r = el('div', null, 'rec'); r.append(el('small', '⭐ ' + t('hr.recommend', { collar: t('collar.' + best) })));
  r.append(btn('✓ ' + t('hr.hire', { collar: t('collar.' + best), salary: cols[best].salary }), emit('hireNpc', { collar: best }), { primary: true, isDefault: true }));
  box.append(r);
  const row = el('div', null, 'others');
  Object.keys(cols).filter(k => k !== best).forEach(k => row.append(btn(t('hr.hire', { collar: t('collar.' + k), salary: cols[k].salary }), emit('hireNpc', { collar: k }))));
  box.append(row);
}
// ---------- Products / services of a company ----------
const productName = p => p.name || t(p.nameKey || 'tpl.custom');
const productsOf = c => (c.products?.length ? c.products : [{ id: 'p0', name: c.product || null, nameKey: c.nameKey, price: c.price, discount: 0 }]);
const netPrice = p => Math.max(1, Math.round(p.price * (1 - (p.discount || 0) / 100)));
// Add (p == null) or edit a product: name, list price (₺ for TR), discount slider 0-90 + manual number
function productEditor(c, p) {
  const unit = isTR() ? RATE() : 1, min = seed.custom.minPrice, max = seed.custom.maxPrice;
  openModal(body => {
    body.append(el('h3', (p ? '✏ ' : '➕ ') + t(p ? 'prod.edit' : 'prod.add') + ' · ' + companyName(c)));
    const name = el('input'); name.maxLength = 30; name.placeholder = t('prod.namePh'); name.value = p ? productName(p) : '';
    const price = el('input'); price.type = 'number'; price.min = Math.round(min * unit); price.max = Math.round(max * unit); price.inputMode = 'decimal'; price.value = Math.round((p ? p.price : 10) * unit);
    price.title = t('ui.customPrice', { min: money(min), max: money(max) });
    const slider = el('input'); slider.type = 'range'; slider.min = 0; slider.max = 90; slider.value = p?.discount || 0;
    const dnum = el('input'); dnum.type = 'number'; dnum.min = 0; dnum.max = 90; dnum.value = slider.value; dnum.inputMode = 'numeric';
    const info = el('small', null, 'muted');
    const coinsOf = () => Math.max(min, Math.min(max, Math.round(Number(price.value) / unit) || min));
    const sync = from => { const d = Math.max(0, Math.min(90, Math.floor(Number(from === 'num' ? dnum.value : slider.value)) || 0));
      if (from !== 'slider') slider.value = d; if (from !== 'num') dnum.value = d;
      info.textContent = t('prod.netInfo', { net: money(netPrice({ price: coinsOf(), discount: d })), pct: d }); };
    slider.oninput = () => sync('slider'); dnum.oninput = () => sync('num'); price.oninput = () => sync();
    body.append(el('small', t('prod.name'), 'muted'), name, el('small', t('prod.price'), 'muted'), price, el('small', t('prod.discount'), 'muted'), slider, dnum, info);
    const save = () => { if (!name.value.trim()) return toast(t('toast.badCustom')); closeModal();
      socket.emit('productSave', { cid: c.id, pid: p?.id, name: name.value.trim(), price: coinsOf(), discount: Number(slider.value) }); };
    body.append(btn('✓ ' + t('prod.save'), save, { primary: true, isDefault: true }));
    sync();
  });
}
// Sales department: one row per product (sell / buy, edit, remove)
function productList(box, c, member, founder) {
  const wrap = el('div', null, 'prodList');
  productsOf(c).forEach((p, i, all) => {
    const row = el('div', null, 'prodRow'), label = el('div', null, 'prodName');
    label.append(el('b', productName(p)));
    const price = el('span', null, 'prodPrice');
    if (p.discount) { price.append(el('s', money(p.price)), document.createTextNode(' ' + money(netPrice(p))), el('em', ' −%' + p.discount, 'disc')); } else price.textContent = money(p.price);
    label.append(price);
    const acts = el('div', null, 'prodActs');
    if (member) acts.append(btn('🖱 ' + t('ui.clickSell'), () => socket.emit('click', { cid: c.id, pid: p.id })));
    else if (!c.founders.includes(myId())) acts.append(btn('🛒 ' + t('ui.buy'), () => socket.emit('buy', { cid: c.id, pid: p.id })));
    if (founder) { acts.append(btn('✏', () => productEditor(c, p))); if (all.length > 1) acts.append(btn('🗑', () => socket.emit('productRemove', { cid: c.id, pid: p.id }))); }
    row.append(label, acts); wrap.append(row);
  });
  box.append(wrap);
  if (founder && productsOf(c).length < 8) box.append(btn('➕ ' + t('prod.add'), () => productEditor(c, null)));
}
// ---------- Advertising (street billboards, bus stops, bus livery, walls, roofs, mobile banners) ----------
const AD_ICON = { billboard: '🪧', stop: '🚏', bus: '🚌', wall: '🏢', roof: '🏙', mobile: '📱' };
const adSlotsFor = c => { // slots this company can see in its manager: shared ones + its own building
  const out = [];
  for (let i = 0; i < seed.ads.kinds.billboard.count; i++) out.push(`billboard:${i}`);
  for (let i = 0; i < seed.busStops.length; i++) out.push(`stop:${i}`);
  out.push('bus:0'); for (let i = 0; i < seed.ads.kinds.mobile.count; i++) out.push(`mobile:${i}`);
  if (c.lotId != null) out.push(`wall:${c.lotId}`, `roof:${c.lotId}`);
  return out;
};
const adKind = id => id.split(':')[0];
const adLabel = id => { const [k, n] = id.split(':'); return `${AD_ICON[k]} ${t('ad.kind.' + k)}${k === 'wall' || k === 'roof' ? '' : ' ' + (Number(n) + 1)}`; };
const adBoostOf = c => Math.min(seed.ads.maxBoost, Object.entries(state.ads || {}).reduce((s, [id, a]) => s + (a.owner === c.id && a.live ? seed.ads.kinds[adKind(id)].boost : 0), 0));
const adDrafts = new Map(); // last creative typed per slot (pending ads are not sent back to clients)
function openAdManager(c) {
  const mineIds = Object.entries(state.ads || {}).filter(([, a]) => a.owner === c.id).map(([id]) => id);
  openModal(body => {
    body.append(el('h3', '📢 ' + t('ad.title') + ' · ' + companyName(c)), el('p', t('ad.note'), 'muted'));
    body.append(el('p', t('ad.boostNow', { pct: Math.round(adBoostOf(c) * 100), max: Math.round(seed.ads.maxBoost * 100), n: mineIds.length, maxSlots: seed.ads.maxSlots })));
    const list = el('div', null, 'prodList');
    adSlotsFor(c).forEach(id => {
      const k = seed.ads.kinds[adKind(id)], a = state.ads?.[id], mine = a?.owner === c.id, taken = a && !mine;
      const row = el('div', null, 'prodRow'), label = el('div', null, 'prodName');
      const status = !a ? t('ad.statusFree') : taken ? t('ad.statusTaken', { who: a.owner === 'admin' ? 'Admin' : t('ad.otherCompany') })
        : a.pending ? t('ad.statusPending') : a.live ? t('ad.statusLive') : a.rejected ? t('ad.statusRejected', { reason: a.rejected }) : t('ad.statusNoAd');
      label.append(el('b', adLabel(id)), el('span', `${status} · ${money(k.price)}/${t('ad.day')} · +%${Math.round(k.boost * 100)}`, 'prodPrice'));
      const acts = el('div', null, 'prodActs');
      if (!a) acts.append(btn(t('ad.rent'), () => { socket.emit('adRent', { cid: c.id, slot: id }); setTimeout(() => state.ads?.[id]?.owner === c.id && openAdManager(c), 450); }));
      else if (mine) { acts.append(btn('✏ ' + t('ad.edit'), () => openAdEditor(c, id)), btn('🗑', () => { socket.emit('adRelease', { cid: c.id, slot: id }); setTimeout(() => openAdManager(c), 450); })); }
      row.append(label, acts); list.append(row);
    });
    body.append(list);
  });
}
function openAdEditor(c, id) {
  const kind = adKind(id), live = state.ads?.[id]?.live;
  const d = { type: 'text', title: '', text: '', fontSize: 20, color: '#ffffff', bg: '#2f6fe4', align: 'center', bold: true, imageUrl: '', ...(adDrafts.get(id) || live || {}) };
  openModal(body => {
    body.append(el('h3', '✏ ' + adLabel(id) + ' · ' + companyName(c)), el('p', t('ad.approvalNote'), 'muted'));
    const preview = el('canvas', null, 'adPreview'); body.append(preview);
    const repaint = () => { adDrafts.set(id, { ...d }); paintAd(preview, kind, { ...d, fontSize: Math.max(10, Math.min(40, d.fontSize)) }); };
    const field = (label, input) => { const l = el('label', null, 'adField'); l.append(el('small', label, 'muted'), input); return l; };
    const typeRow = el('div', null, 'others'); ['text', 'image'].forEach(ty => { const b = btn(t('ad.type.' + ty), () => { d.type = ty; refresh(); repaint(); }); b.className = d.type === ty ? 'sel' : ''; b.dataset.t = ty; typeRow.append(b); });
    const mk = (prop, max, ph) => { const i = el('input'); i.value = d[prop] || ''; i.maxLength = max; i.placeholder = ph || ''; i.oninput = () => { d[prop] = i.value; repaint(); }; return i; };
    const imgIn = mk('imageUrl', seed.ads.limits.url, 'https://…/banner.jpg');
    const fs = el('input'); fs.type = 'range'; fs.min = 10; fs.max = 40; fs.value = d.fontSize; fs.oninput = () => { d.fontSize = Number(fs.value); repaint(); };
    const col = (prop) => { const i = el('input'); i.type = 'color'; i.value = d[prop]; i.oninput = () => { d[prop] = i.value; repaint(); }; return i; };
    const alignRow = el('div', null, 'others'); ['left', 'center', 'right'].forEach(a => { const b = btn(({ left: '⬅', center: '↔', right: '➡' })[a], () => { d.align = a; [...alignRow.children].forEach(x => (x.className = x.dataset.a === a ? 'sel' : '')); repaint(); }); b.dataset.a = a; b.className = d.align === a ? 'sel' : ''; alignRow.append(b); });
    const boldB = btn('B', () => { d.bold = !d.bold; boldB.className = d.bold ? 'sel' : ''; repaint(); }); boldB.className = d.bold ? 'sel' : ''; boldB.style.fontWeight = '800';
    const textFields = el('div'), imageFields = el('div');
    textFields.append(field(t('ad.fTitle'), mk('title', seed.ads.limits.title)), field(t('ad.fText'), mk('text', seed.ads.limits.text)), field(t('ad.fFont') + ' (' + 10 + '–' + 40 + ')', fs));
    const colors = el('div', null, 'row'); colors.append(field(t('ad.fColor'), col('color')), field(t('ad.fBg'), col('bg')), field(t('ad.fAlign'), alignRow), field('', boldB));
    imageFields.append(field(t('ad.fImage'), imgIn), el('small', t('ad.imageNote'), 'muted'), field(t('ad.fCaption'), mk('title', seed.ads.limits.title)));
    const refresh = () => { textFields.hidden = d.type !== 'text'; imageFields.hidden = d.type !== 'image'; [...typeRow.children].forEach(b => (b.className = b.dataset.t === d.type ? 'sel' : '')); };
    body.append(typeRow, textFields, imageFields, colors);
    const send = () => { socket.emit('adSubmit', { cid: c.id, slot: id, creative: { ...d } }); closeModal(); setTimeout(() => state && openAdManager(c), 600); };
    body.append(btn('✓ ' + t('ad.submit'), send, { primary: true, isDefault: true }), btn('◀ ' + t('wiz.back'), () => openAdManager(c)));
    refresh(); repaint();
    // images load asynchronously: repaint a few times so the preview shows them
    let n = 0; const iv = setInterval(() => { if (++n > 12 || !preview.isConnected) clearInterval(iv); else repaint(); }, 500);
  });
}
// Mobile "meta" banner: rotates through the live mobile slots, shown only on phones
let adBannerIdx = 0;
function updateAdBanner() {
  const live = [0, 1, 2].map(i => state?.ads?.[`mobile:${i}`]?.live).filter(Boolean);
  const show = touch && !isPres() && live.length > 0;
  document.body.classList.toggle('hasAd', show);
  if (show) paintAd($('adCv'), 'mobile', live[adBannerIdx % live.length]);
}
setInterval(() => { adBannerIdx++; updateAdBanner(); }, 8000);
// ---------- Minimap: the whole street at a glance (M key / map button), click to walk there ----------
let minimapOpen = false, mmSig = '';
function toggleMinimap(force) { minimapOpen = force ?? !minimapOpen; $('minimap').hidden = !minimapOpen; mmSig = ''; if (minimapOpen) renderMinimapList(); }
const mmColor = b => { if (b.kind === 'guide') return '#f2b84b'; if (b.kind === 'plaza') return '#3987e5'; if (b.kind === 'demoday') return '#9b59b6'; if (b.kind === 'home') return '#e67e22'; if (b.kind === 'parking') return '#5b6475'; if (b.kind === 'terminal') return '#e67e22'; if (b.kind === 'locked') return '#b8c0cc';
  const ts = b.lot.companyIds.map(id => state.companies[id]).filter(Boolean); return !ts.length ? '#a9adb8' : ts.some(c => isMember(c)) ? '#f2b84b' : ts.some(c => c.isNpc) ? '#9b7be0' : '#3fa36b'; };
function drawMinimap() {
  const cv = $('mmCv'); if (!minimapOpen || !state || scene.name !== 'street') return;
  const w = cv.clientWidth || 340, h = 72, dpr = window.devicePixelRatio || 1;
  if (cv.width !== Math.round(w * dpr)) { cv.width = Math.round(w * dpr); cv.height = h * dpr; }
  const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
  const W = wWidth(), k = w / W;
  g.fillStyle = css('--panel-2'); g.fillRect(0, h - 14, w, 14);
  for (const b of buildings) { g.fillStyle = mmColor(b); const bh = Math.max(8, Math.min(46, b.h / 8)); g.fillRect(b.x * k, h - 14 - bh, Math.max(2, b.w * k), bh); }
  g.fillStyle = css('--accent'); for (const x of seed.busStops || []) { g.beginPath(); g.moveTo(x * k, h - 2); g.lineTo(x * k - 3, h - 9); g.lineTo(x * k + 3, h - 9); g.fill(); }
  g.strokeStyle = css('--text'); g.lineWidth = 1; g.strokeRect(view.camX * k, 2, (view.w / view.s) * k, h - 6);
  g.fillStyle = '#2a9d4b'; for (const o of others.values()) { g.beginPath(); g.arc(o.x * k, h - 7, 2.5, 0, 7); g.fill(); }
  g.fillStyle = '#e63946'; g.beginPath(); g.arc(player.x * k, h - 7, 3.5, 0, 7); g.fill();
}
$('mmCv').onclick = e => { const r = $('mmCv').getBoundingClientRect(); walkTo(((e.clientX - r.left) / r.width) * wWidth(), null, null); };
function renderMinimapList() {
  const box = $('mmList'); if (!state) return box.replaceChildren();
  const sig = buildings.map(b => b.id + (b.lot ? b.lot.companyIds.map(id => state.companies[id]?.name || id).join() : '')).join('|') + i18next.language;
  if (sig === mmSig) return; mmSig = sig;
  const items = [];
  const go = b => () => { walkTo(b.x + b.w / 2, () => openBuilding(b), b.id); if (touch) toggleMinimap(false); };
  for (const b of buildings) {
    if (b.kind === 'locked') continue;
    const name = b.kind === 'guide' ? t('ui.guideSign') : b.kind === 'plaza' ? t('ui.plazaTitle') : b.kind === 'demoday' ? '🎤 Demo Day' : b.kind === 'home' ? '🏠 ' + t('home.title') : b.kind === 'parking' ? '🅿 ' + t('veh.parkingSign') : b.kind === 'terminal' ? '🚌 ' + t('travel.sign')
      : b.lot.companyIds.length ? b.lot.companyIds.map(id => state.companies[id]).filter(Boolean).map(c => (isMember(c) ? '⭐ ' : '') + companyName(c)).join(', ') : null;
    if (name) items.push({ name, fn: go(b), color: mmColor(b) });
  }
  (seed.busStops || []).forEach((x, i) => items.push({ name: '🚏 ' + t('map.stop', { n: i + 1 }), fn: () => { walkTo(x, null, null); if (touch) toggleMinimap(false); }, color: css('--accent') }));
  box.replaceChildren(...items.map(it => { const b = btn(it.name, it.fn); b.style.borderLeft = `4px solid ${it.color}`; b.className = 'mmItem'; return b; }));
}
$('mapBtn').onclick = () => toggleMinimap(); $('mmClose').onclick = () => toggleMinimap(false);
// ---------- Intercity travel: bus terminal, tickets, the road ----------
const rad = d => (d * Math.PI) / 180;
function cityKm(a, b) {
  const I = seed.economy.intercity, A = seed.economy.cityMap.find(c => c.key === a), B = seed.economy.cityMap.find(c => c.key === b);
  const h = Math.sin(rad(B.lat - A.lat) / 2) ** 2 + Math.cos(rad(A.lat)) * Math.cos(rad(B.lat)) * Math.sin(rad(B.lon - A.lon) / 2) ** 2;
  return Math.round(2 * 6371 * Math.asin(Math.sqrt(h)) * I.roadFactor);
}
const tripHours = (km, mode) => km / (mode === 'car' ? seed.economy.intercity.carKmh : seed.economy.intercity.busKmh) + (mode === 'car' ? 0 : seed.economy.intercity.stopHours);
const tripSecs = (km, mode) => Math.max(5, Math.min(90, Math.round((tripHours(km, mode) * (seed.tickSeconds / 24)) / (state.speed || 1))));
const hm = h => `${Math.floor(h)} ${t('travel.h')} ${Math.round((h % 1) * 60)} ${t('travel.m')}`;
const cityName = key => seed.economy.cityMap.find(c => c.key === key)?.name || key;
function openTerminal() {
  const I = seed.economy.intercity, here = state.city, myCars = Object.values(state.companies).filter(c => c.founders.includes(myId()) && c.vehicle);
  openModal(body => {
    body.append(el('h3', '🚌 ' + t('travel.sign') + ' · ' + cityName(here)), el('p', t('travel.note') + (I.est ? ' *' : ''), 'muted'));
    if (!joined || joined.mode === 'presentation') return body.append(el('p', t('travel.notHere'), 'muted'));
    const list = el('div', null, 'prodList');
    seed.economy.cityMap.filter(c => c.status === 'open' && c.key !== here).forEach(c => {
      const km = cityKm(here, c.key), fare = Math.max(1, Math.round(km * I.busPerKm)), row = el('div', null, 'prodRow'), label = el('div', null, 'prodName');
      label.append(el('b', '🏙 ' + c.name), el('span', `${km} km · 🚌 ${money(fare)} · ${hm(tripHours(km, 'bus'))} (${tripSecs(km, 'bus')} ${t('travel.sec')})`, 'prodPrice'));
      const acts = el('div', null, 'prodActs'), bus = btn('🚌 ' + t('travel.busGo'), () => { closeModal(); socket.emit('travel', { to: c.key, mode: 'bus' }); }); bus.disabled = (me()?.coins || 0) < fare; acts.append(bus);
      if (myCars.length) { const car = myCars[0], fuel = Math.max(1, Math.round(km * seed.economy.vehicle.models[car.vehicle.model || 'sedan_new'].fuelPerKm * 2));
        const b2 = btn('🚗 ' + t('travel.carGo', { fuel: money(fuel), secs: tripSecs(km, 'car') }), () => { closeModal(); socket.emit('travel', { to: c.key, mode: 'car', cid: car.id }); }); b2.disabled = car.cash < fuel; acts.append(b2); }
      row.append(label, acts); list.append(row);
    });
    body.append(list, el('small', myCars.length ? t('travel.carNote', { company: companyName(myCars[0]) }) : t('travel.noCarNote'), 'muted'));
  });
}
socket.on('travelStart', info => {
  closeModal(); cancelPlan(); setAuto(false);
  const ov = $('travelOverlay'), card = el('div', null, 'card travelCard');
  card.append(el('div', info.mode === 'car' ? '🚗' : '🚌', 'travelIcon'), el('h3', t('travel.route', { from: cityName(info.from), to: cityName(info.to) })),
    el('p', t('travel.onRoad', { km: info.km, secs: info.seconds, fare: money(info.fare) }), 'muted'));
  const bar = el('div', null, 'bar'), fill = el('i'); bar.append(fill); card.append(bar); ov.replaceChildren(card); ov.hidden = false;
  fill.style.width = '0%'; fill.style.transition = `width ${info.seconds}s linear`; requestAnimationFrame(() => requestAnimationFrame(() => (fill.style.width = '100%')));
});
socket.on('joined', info => { if (info.travel) toast('📍 ' + t('travel.arrived', { city: cityName(info.city) })); });
// ---------- Home: personal life (spending, bills, hobbies, self-development) ----------
const LIFE = () => seed.economy.life;
const HOME_ICON = { groceries: '🛒', restaurant: '🍽', cinema: '🎬', clothes: '👕', gift: '🎁', doctor: '🏥', vacation: '✈️', walk: '🚶', rest: '😴',
  music: '🎸', sport: '🏋️', painting: '🎨', photo: '📷', gaming: '🎮', garden: '🌱', chess: '♟',
  book: '📖', online: '💻', language: '🗣', mentor: '🧑‍🏫', cert: '🎓' };
const lifeOf = () => me()?.life || { happiness: 60, health: 80, housing: 'family', utilities: {}, hobbies: {}, courses: 0, certs: 0, today: { day: -1, done: {} }, cooldowns: {} };
const cityRentFactorC = () => (seed.economy.cities[state.city]?.rentM2 || 850) / seed.economy.cities.istanbul.rentM2;
const doneToday = key => { const L = lifeOf(); return L.today.day === (state.day || 0) && !!L.today.done[key]; };
const cooldownLeft = (key, cd) => { const L = lifeOf(), at = L.cooldowns?.[key]; return cd && at != null ? Math.max(0, at + cd - (state.day || 0)) : 0; };
const hobbyLvl = pts => Math.floor(Math.sqrt(pts || 0));
// Daily personal bill (coins/day): rent of the chosen housing + switched-on utilities (gas is seasonal)
function dailyBill(L = lifeOf()) {
  const E = LIFE(), month = state.calendar?.month || 1; let due = E.housing[L.housing].perDay * cityRentFactorC();
  if (L.housing !== 'family') for (const [k, v] of Object.entries(E.utilitiesPerDay)) if (L.utilities[k] !== false) due += v * (k === 'gas' ? (month >= 11 || month <= 3 ? 1.8 : 0.3) : 1);
  return due;
}
const effChips = e => [e.h ? `😊 ${e.h > 0 ? '+' : ''}${e.h}` : '', e.hp ? `❤️ ${e.hp > 0 ? '+' : ''}${e.hp}` : '', e.k ? `🧠 +${e.k}` : '', e.xp ? `⭐ +${e.xp} XP` : ''].filter(Boolean).join(' · ');
function lifeBars(box) {
  const L = lifeOf(), mk = (icon, label, v) => { const row = el('div', null, 'lifeBar'); const bar = el('div', null, 'bar'), fill = el('i'); fill.style.width = v + '%'; fill.className = v < 30 ? 'bad' : v >= 70 ? 'good' : ''; bar.append(fill);
    row.append(el('span', `${icon} ${label}`), bar, el('b', String(v))); return row; };
  box.append(mk('😊', t('home.happiness'), L.happiness), mk('❤️', t('home.health'), L.health));
}
// one row of an action list: name + effects + price + button (disabled when done today / cooling down / too poor)
function lifeRow(list, { id, kind, name, eff, cost, cd = 0, extra }) {
  const key = kind === 'spend' ? id : kind + ':' + id, row = el('div', null, 'prodRow'), label = el('div', null, 'prodName');
  label.append(el('b', `${HOME_ICON[id] || '•'} ${name}`), el('span', [effChips(eff), cost ? money(cost) : t('home.free'), extra].filter(Boolean).join(' · '), 'prodPrice'));
  const cool = cooldownLeft(key, cd), done = doneToday(key), poor = (me()?.coins || 0) < cost;
  const ev = kind === 'spend' ? 'homeSpend' : kind === 'hobby' ? 'hobby' : 'learn', pay = kind === 'spend' ? { item: id } : { id };
  const b = btn(cool ? t('home.coolIn', { n: cool }) : done ? t('home.doneToday') : t('home.do'), () => socket.emit(ev, pay));
  b.disabled = !!cool || done || poor; if (poor && !done && !cool) b.title = t('toast.noCoins');
  row.append(label, b); list.append(row);
}
function spendRows(list, ids) { ids.forEach(id => lifeRow(list, { id, kind: 'spend', name: t('home.spend.' + id), eff: LIFE().spend[id], cost: LIFE().spend[id].cost, cd: LIFE().spend[id].cooldown })); }
function hobbyRows(list) {
  const L = lifeOf();
  Object.entries(LIFE().hobbies).forEach(([id, h]) => { const pts = L.hobbies[id] || 0, lvl = hobbyLvl(pts);
    lifeRow(list, { id, kind: 'hobby', name: t('home.hobby.' + id), eff: { ...h, h: h.h + Math.min(4, lvl * 0.5) }, cost: h.cost, extra: t('home.hobbyLvl', { lvl, now: pts, next: (lvl + 1) ** 2 }) }); });
}
function courseRows(list) {
  const L = lifeOf();
  Object.entries(LIFE().courses).forEach(([id, c]) => lifeRow(list, { id, kind: 'course', name: t('home.course.' + id), eff: c, cost: c.cost, cd: c.cooldown, extra: c.cert ? t('home.certNote', { n: L.certs, max: 3 }) : '' }));
}
// Housing + personal bills: family home is free; rented homes cost daily rent + optional utilities
function homeBillsPanel(box) {
  const L = lifeOf(), E = LIFE(), f = cityRentFactorC();
  box.append(el('h4', t('home.housingTitle')), el('small', t('home.housingNote', { city: cityName(state.city) }) + (E.est ? ' *' : ''), 'muted'));
  const row = el('div', null, 'others');
  Object.keys(E.housing).forEach(k => { const h = E.housing[k], label = `${t('home.housing.' + k)} · ${k === 'family' ? t('home.free') : t('home.rentDay', { amount: money(h.perDay * f) })}`;
    const b = btn(label, () => socket.emit('housing', { tier: k })); if (L.housing === k) b.className = 'sel'; b.disabled = L.housing !== k && k !== 'family' && L.housing === 'family' && (me()?.coins || 0) < Math.round(h.deposit * f); row.append(b); });
  box.append(row);
  if (L.housing !== 'family') {
    box.append(el('small', t('home.depositNote', { amount: money(Math.round(E.housing[L.housing].deposit * f)) }), 'muted'));
    const list = el('div', null, 'prodList'), month = state.calendar?.month || 1;
    Object.entries(E.utilitiesPerDay).forEach(([k, v]) => { const on = L.utilities[k] !== false, r = el('div', null, 'prodRow'), lab = el('div', null, 'prodName');
      lab.append(el('b', `${({ electricity: '⚡', water: '💧', gas: '🔥', internet: '🌐' })[k]} ${t('acc.util.' + k)}`), el('span', on ? t('acc.billDay', { amount: money(v * (k === 'gas' ? (month >= 11 || month <= 3 ? 1.8 : 0.3) : 1)) }) : t('home.utilOff.' + k), 'prodPrice'));
      const sw = btn(on ? t('acc.on') : t('acc.off'), () => socket.emit('homeUtility', { key: k, on: !on })); if (on) sw.className = 'sel'; r.append(lab, sw); list.append(r); });
    box.append(list);
  }
  box.append(el('p', `🧾 ${t('home.dailyBill', { amount: money(dailyBill(L)) })}` + (L.unpaid ? ` · ⚠ ${t('home.unpaid', { n: L.unpaid })}` : '')));
}
function homeHeader(body, title) {
  body.append(el('h3', title)); const card = el('div', null, 'co');
  card.append(el('p', `💰 ${money(me()?.coins || 0)} · 🏘 ${t('home.housing.' + lifeOf().housing)}`)); lifeBars(card); body.append(card);
}
const ROOM_ICON = { kitchen: '🍳', living: '🛋', study: '📚', hobby: '🎨', bedroom: '🛏', balcony: '🌿' };
let homeRoomOpen = null;
function openHomeRoom(key) {
  if (!state) return;
  openModal(body => {
    homeRoomOpen = key; homeHeader(body, `${ROOM_ICON[key]} ${t('dept.' + key)}`); body.append(el('p', t('home.room.' + key), 'muted'));
    const list = el('div', null, 'prodList');
    if (key === 'kitchen') spendRows(list, ['groceries', 'restaurant']);
    else if (key === 'study') courseRows(list);
    else if (key === 'hobby') hobbyRows(list);
    else if (key === 'bedroom') spendRows(list, ['rest', 'doctor']);
    else if (key === 'balcony') spendRows(list, ['walk', 'vacation']);
    else if (key === 'living') spendRows(list, ['cinema', 'clothes', 'gift']);
    body.append(list); if (key === 'living') homeBillsPanel(body);
    body.append(el('small', t('home.estNote'), 'muted'));
  }, { onClose: () => { homeRoomOpen = null; } });
}
// Outside the house: everything personal in one place, plus a button to walk in
function openHome() {
  if (!state) return showModes();
  openModal(body => {
    homeRoomOpen = 'outside'; homeHeader(body, '🏠 ' + t('home.title')); body.append(el('p', t('home.intro'), 'muted'));
    if (!isPres()) body.append(btn('🚪 ' + t('home.enter'), () => enterHome(), { primary: true, isDefault: true }));
    body.append(el('h4', t('home.spendTitle'))); const list = el('div', null, 'prodList'); spendRows(list, ['groceries', 'restaurant', 'cinema', 'clothes', 'gift', 'doctor', 'vacation', 'walk']); body.append(list);
    body.append(el('small', t('home.estNote'), 'muted'));
  }, { onClose: () => { homeRoomOpen = null; } });
}
// keep an open home panel in sync with the state (after every action the server pushes a new state)
let homeSig = '';
function refreshHome() {
  if (!homeRoomOpen || !modalOpen || !state) return;
  const L = lifeOf(), sig = [state.day, me()?.coins, L.happiness, L.health, L.housing, JSON.stringify(L.utilities), JSON.stringify(L.hobbies), L.courses, L.certs, JSON.stringify(L.today), JSON.stringify(L.cooldowns)].join('|');
  if (sig === homeSig) return; homeSig = sig;
  const y = $('modalBody').scrollTop, k = homeRoomOpen; if (k === 'outside') openHome(); else openHomeRoom(k); $('modalBody').scrollTop = y;
}
socket.on('homeResult', r => {
  const name = t(`home.${r.kind === 'spend' ? 'spend' : r.kind === 'hobby' ? 'hobby' : 'course'}.${r.id}`);
  toast(`${HOME_ICON[r.id] || '✓'} ${name}: ${effChips(r) || '✓'}${r.cost ? ' · −' + money(r.cost) : ''}`);
});
// ---------- Amount pickers: a 1-100 slider and a manual number stay in sync ----------
// moneyPicker: choose an amount of coins up to maxCoins. TR players type ₺, others coins.
function moneyPicker({ title, note, maxCoins, defCoins, confirmLabel, onConfirm }) {
  maxCoins = Math.floor(maxCoins); if (!(maxCoins >= 1)) return toast(t('toast.noCash'));
  const unit = isTR() ? RATE() : 1, clampC = v => Math.max(1, Math.min(maxCoins, Math.round(v)));
  let coins = clampC(defCoins ?? maxCoins * 0.2);
  openModal(body => {
    body.append(el('h3', title)); if (note) body.append(el('p', note, 'muted'));
    const big = el('div', null, 'pickBig'), sub = el('small', null, 'muted');
    const slider = el('input'); slider.type = 'range'; slider.min = 1; slider.max = 100; slider.step = 1; slider.setAttribute('aria-label', '%');
    const num = el('input'); num.type = 'number'; num.min = 1; num.step = 'any'; num.inputMode = 'decimal'; num.setAttribute('aria-label', t('ui.amount'));
    const sync = from => {
      const pct = Math.round(coins / maxCoins * 100);
      big.textContent = money(coins); sub.textContent = t('ui.ofMax', { pct, max: money(maxCoins) });
      if (from !== 'slider') slider.value = Math.max(1, pct);
      if (from !== 'num') num.value = String(unit === 1 ? coins : Math.round(coins * unit));
    };
    slider.oninput = () => { coins = clampC(maxCoins * Number(slider.value) / 100); sync('slider'); };
    num.oninput = () => { const v = Number(num.value); if (Number.isFinite(v) && v > 0) { coins = clampC(v / unit); sync('num'); } };
    num.onblur = () => sync();
    const chips = el('div', null, 'emojiBar');
    [25, 50, 75, 100].forEach(p => chips.append(btn(p + '%', () => { coins = clampC(maxCoins * p / 100); sync(); })));
    const go = () => { const v = coins; closeModal(); onConfirm(v); };
    num.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); go(); } };
    body.append(big, sub, slider, chips, num, btn('✓ ' + confirmLabel, go, { primary: true, isDefault: true }));
    sync();
  });
}
// budgetPicker: marketing intensity 10-100 (50 = standard). Cost and bonus scale with it.
function budgetPicker({ title, note, baseCost, baseBonusPct, maxCoins, confirmLabel, onConfirm }) {
  let pct = 50;
  openModal(body => {
    body.append(el('h3', title)); if (note) body.append(el('p', note, 'muted'));
    const big = el('div', null, 'pickBig'), sub = el('small', null, 'muted');
    const slider = el('input'); slider.type = 'range'; slider.min = 10; slider.max = 100; slider.step = 1;
    const num = el('input'); num.type = 'number'; num.min = 10; num.max = 100; num.step = 1; num.inputMode = 'numeric';
    const sync = from => {
      const cost = Math.round(baseCost * pct / 50), bonus = Math.round(baseBonusPct * pct / 50);
      big.textContent = money(cost); sub.textContent = t('ui.budgetInfo', { pct, bonus, left: money(maxCoins - cost) });
      if (from !== 'slider') slider.value = pct; if (from !== 'num') num.value = pct;
      okBtn.disabled = cost > maxCoins;
    };
    const okBtn = btn('✓ ' + confirmLabel, () => { const p = pct; closeModal(); onConfirm(p); }, { primary: true, isDefault: true });
    slider.oninput = () => { pct = Number(slider.value); sync('slider'); };
    num.oninput = () => { const v = Math.floor(Number(num.value)); if (Number.isFinite(v)) { pct = Math.max(10, Math.min(100, v)); sync('num'); } };
    num.onblur = () => sync();
    const chips = el('div', null, 'emojiBar');
    [25, 50, 75, 100].forEach(p => chips.append(btn(p + '%', () => { pct = p; sync(); })));
    body.append(big, sub, slider, chips, num, okBtn); sync();
  });
}
function openDept(c, d) {
  const founder = c.founders.includes(myId()), member = isMember(c);
  const emit = (ev, extra = {}) => () => { socket.emit(ev, { cid: c.id, ...extra }); closeModal(); };
  const open = deptOpen(seed, state, c, d.key);
  openModal(body => {
    body.append(el('h3', `${DEPT_ICON[d.key]} ${t('dept.' + d.key)} · ${companyName(c)}`));
    body.append(el('p', t('dept.desc.' + d.key), 'muted'));
    const box = el('div', null, 'co dept'); body.append(box);
    if (!open) { box.append(el('p', d.locked ? t('dept.premium') : t('dept.unlockAt', { cash: 250 * 2 ** d.floor }))); return; }
    const rec = (label, fn, why) => { const r = el('div', null, 'rec'); if (why) r.append(el('small', '⭐ ' + why)); r.append(btn('✓ ' + label, fn, { primary: true, isDefault: true })); box.append(r); };
    const visitorNote = () => box.append(el('p', t('dept.membersOnly'), 'muted'));
    switch (d.key) {
      case 'sales': {
        box.append(el('p', t('dept.salesInfo', { product: c.product || t(c.nameKey), price: c.price, units: c.fin?.today?.units || 0 })));
        if (member) rec(t('ui.clickSell'), () => socket.emit('click', { cid: c.id }), t('adv.sellWhy'));
        else if (!founder) rec(t('ui.buy'), emit('buy'), t('adv.buyWhy'));
        productList(box, c, member, founder);
        vehiclePanel(box, c, founder);
        break;
      }
      case 'finance': {
        miniFinance(box, c);
        const row = el('div', null, 'others');
        if (founder && c.cash < 0) rec(t('ui.invest'), emit('invest', { amount: 100 }), t('adv.rescueWhy'));
        else if (founder && c.cash >= 400) rec(t('ui.withdraw'), emit('withdraw'), t('adv.withdrawWhy'));
        row.append(btn('💸 ' + t('ui.investPick'), () => moneyPicker({ title: t('ui.investPick') + ' · ' + companyName(c), note: t('ui.investNote', { coins: money(me().coins) }),
          maxCoins: me().coins, defCoins: Math.min(100, me().coins), confirmLabel: t('ui.confirm'), onConfirm: amount => socket.emit('invest', { cid: c.id, amount }) })));
        if (founder) row.append(btn('🏦 ' + t('ui.withdrawPick'), () => moneyPicker({ title: t('ui.withdrawPick') + ' · ' + companyName(c), note: t('ui.withdrawNote', { cash: money(c.cash) }),
          maxCoins: c.cash, defCoins: c.cash * 0.2 / c.founders.length, confirmLabel: t('ui.confirm'), onConfirm: amount => socket.emit('withdraw', { cid: c.id, amount }) })));
        if (!founder && !c.isNpc && c.founders.length < 3) row.append(btn(t('ui.cofound'), emit('cofound')));
        if (member) row.append(btn('📊 ' + t('dept.openFinance'), () => { closeModal(); finSel = c.id; renderFinance(true); showTab('finance'); }));
        box.append(row);
        estatePanel(box, c, founder);
        break;
      }
      case 'accounting': {
        const ws = seed.workspaces[c.workspace], lot = c.lotId != null ? state.lots[c.lotId] : null;
        const rent = c.workspace === 'shop' || c.workspace === 'coworking' ? costLabel(c.workspace === 'shop' ? 'shop' : 'coworking', lot ? { ...lot, companyIds: lot.companyIds.slice(1) } : null) : (ws.rent + (ws.electricity || 0));
        const salaries = c.employees.length * (seed.salary + (c.benefitCost || 0)) + (c.npcStaff || 0) * seed.salary;
        const k = el('div', null, 'mini');
        k.append(kpi(t('acc.rent'), fmt(rent)), kpi(t('acc.salaries'), fmt(salaries)), kpi(t('acc.total'), fmt(rent + salaries)), kpi(t('acc.lastDay'), fmt(finOf([c]).dayExp)));
        box.append(el('small', t('acc.perDay'), 'muted'), k);
        taxPanel(box, c, founder);
        if (lot?.type === 'shop' || (c.workspace === 'shop')) billsPanel(box, c, founder);
        const tbl = el('table'); tbl.id = 'accTable'; tbl.style.width = '100%'; box.append(tbl);
        getHistory(c.id, h => { tbl.replaceChildren(pnlTable(h.monthly.slice(-6))); taxEstimate(c, h.monthly); });
        break;
      }
      case 'marketing': {
        const m = seed.marketing, active = c.marketing && c.marketing.until > (state.day || 0);
        box.append(el('p', active ? t('dept.campaignLeft', { days: c.marketing.until - state.day }) : t('dept.campaignInfo', { cost: m.cost, days: m.days, pct: Math.round((m.mult - 1) * 100) })));
        if (founder && !active) {
          rec(t('dept.startCampaign', { cost: m.cost }), emit('marketing'), t('adv.marketingWhy', { days: m.days }));
          box.append(btn('🎚 ' + t('dept.campaignBudget'), () => budgetPicker({ title: t('dept.campaignBudget') + ' · ' + companyName(c), note: t('dept.campaignInfo', { cost: m.cost, days: m.days, pct: Math.round((m.mult - 1) * 100) }),
            baseCost: m.cost, baseBonusPct: Math.round((m.mult - 1) * 100), maxCoins: c.cash, confirmLabel: t('dept.launch'), onConfirm: budget => socket.emit('marketing', { cid: c.id, budget }) })));
        }
        else if (!founder) visitorNote();
        break;
      }
      case 'hr': {
        const cap = employeeCap(seed, state, c), staff = staffOf(c);
        const names = [...c.founders.map(id => `👑 ${state.players[id]?.name || '—'}`), ...c.employees.map(id => `👷 ${state.players[id]?.name || '—'}`)];
        box.append(el('p', t('dept.hrInfo', { staff, cap, npc: c.npcStaff || 0, salary: seed.salary })));
        if (names.length) box.append(el('p', names.join(' · ')));
        if (founder) {
          if (staff < cap) collarPanel(box, c, emit);
          if (c.npcStaff > 0) box.append(btn(t('dept.fireNpc'), emit('fireNpc')));
          benefitsEditor(box, c);
        } else if (!c.employees.includes(myId()) && staff < cap) rec(t('npc.apply'), emit('work'), t('adv.workWhy', { salary: seed.salary }));
        else visitorNote();
        break;
      }
      case 'it': {
        const it = seed.itUpgrade, lvl = c.security || 0;
        box.append(el('p', t('dept.itInfo', { lvl, max: it.maxLevel, pct: Math.round(lvl * it.cyberShield * 100) })));
        if (founder && lvl < it.maxLevel) rec(t('dept.itUpgrade', { cost: it.cost }), emit('itUpgrade'), t('dept.itWhy'));
        else if (!founder) visitorNote();
        break;
      }
      default: box.append(el('p', t('dept.premium')));
    }
  });
}

// ---------- NPC dialogs with ID card ----------
function idCard(w) {
  const p = w.profile, card = el('div', null, 'idCard');
  const title = el('div', null, 'idTitle'); title.append(el('span', '🪪 ' + t('npc.idCard')), el('span', 'No ' + p.idNo)); card.append(title);
  const face = el('canvas'); face.width = 168; face.height = 168; card.append(face);
  const g = face.getContext('2d'); g.scale(2, 2); drawPerson(g, 42, 96, p.look, { scale: 2.1, dir: 1 });
  const dl = el('dl');
  const row = (k, v) => dl.append(el('dt', k), el('dd', v));
  row(t('npc.name'), p.name); row(t('npc.age'), String(p.age)); row(t('npc.job'), t('job.' + p.job));
  row(t('npc.trait'), t('trait.' + p.trait)); row(t('npc.interest'), t(p.interest)); row(t('npc.budget'), money(p.budget));
  if (met.has(w.id)) dl.append(el('dt', ''), (() => { const dd = el('dd'); dd.append(el('span', '🤝 ' + t('npc.met'), 'badge')); return dd; })());
  card.append(dl);
  return card;
}
function openNpc(w) {
  if (!state) return;
  w.talking = true;
  const p = w.profile, known = met.has(w.id);
  const mineAll = Object.values(state.companies).filter(isMember);
  const mine = mineAll.find(c => sectorOf(c) === p.interest) || mineAll[0];
  const founded = Object.values(state.companies).find(c => c.founders.includes(myId()) && staffOf(c) < employeeCap(seed, state, c));
  const openJob = Object.values(state.companies).filter(c => !c.founders.includes(myId()) && !c.employees.includes(myId()) && staffOf(c) < employeeCap(seed, state, c))
    .sort((a, b) => b.cash - a.cash)[0];
  const talk = (kind, cid) => () => socket.emit('npcTalk', { npcId: w.id, kind, cid });
  openModal(body => {
    body.dataset.npc = String(w.id);
    body.append(idCard(w));
    const greet = known ? t('npc.greetAgain', { name: p.name.split(' ')[0] }) : t('npc.greet', { name: p.name.split(' ')[0], job: t('job.' + p.job) });
    body.append(el('p', '💬 “' + greet + '”'));
    const options = [];
    if (!known) options.push({ label: '👋 ' + t('npc.meet'), fn: talk('meet'), why: t('npc.meetWhy') });
    if (mine) options.push({ label: '🛍 ' + t('npc.sell', { company: companyName(mine) }), fn: talk('sell', mine.id), why: t('npc.sellWhy', { interest: t(p.interest) }) });
    const collar = { engineer: 'white', developer: 'white', accountant: 'white', designer: 'white', marketer: 'white', nurse: 'grey', chef: 'grey', teacher: 'grey', recruiter: 'grey' }[p.job] || 'blue';
    if (founded) options.push({ label: '🤝 ' + t('npc.hire', { company: companyName(founded) }) + ` · ${t('collar.' + collar)}`,
      fn: () => socket.emit('npcTalk', { npcId: w.id, kind: 'hire', cid: founded.id, collar }), why: t('npc.hireWhy', { salary: seed.economy.collars[collar].salary }) });
    if (p.job === 'recruiter' && openJob) options.push({ label: '📝 ' + t('npc.applyAt', { company: companyName(openJob) }), fn: () => { socket.emit('work', { cid: openJob.id }); closeModal(); }, why: t('adv.workWhy', { salary: seed.salary }) });
    if (p.job !== 'student' && p.job !== 'retired') options.push({ label: '🎓 ' + t('npc.service', { cost: seed.npcTalk?.serviceCost ?? 30 }), fn: talk('service'), why: t('npc.serviceWhy') });
    const [first, ...rest] = options;
    if (first) { const r = el('div', null, 'rec'); r.append(el('small', '⭐ ' + first.why), btn('✓ ' + first.label, first.fn, { primary: true, isDefault: true })); body.append(r); }
    if (rest.length) { const row = el('div', null, 'others'); rest.forEach(o => row.append(btn(o.label, o.fn))); body.append(row); }
  }, { onClose: () => { w.talking = false; } });
}

// ---------- Demo Day: business model canvas, elevator pitch, pitch deck, investor / grant / angel events ----------
const CANVAS_KEYS = ['keyPartners', 'keyActivities', 'keyResources', 'valueProps', 'customerRelationships', 'channels', 'customerSegments', 'costStructure', 'revenueStreams'];
const BMC_ICON = { keyPartners: '🤝', keyActivities: '⚙️', keyResources: '🧰', valueProps: '🎁', customerRelationships: '💬', channels: '📢', customerSegments: '👥', costStructure: '💸', revenueStreams: '💰' };
function openDemoDay(cidArg, tab = 'events') {
  if (!state) return;
  const mine = Object.values(state.companies).filter(c => c.founders.includes(myId()));
  if (!mine.length) return openModal(body => {
    body.append(el('h3', '🎤 ' + t('demo.title')), el('p', t('demo.needCompany'), 'muted'));
    body.append(btn('🧭 ' + t('wiz.open'), () => openWizard(), { primary: true, isDefault: true }));
  });
  const c = state.companies[cidArg] && mine.includes(state.companies[cidArg]) ? state.companies[cidArg] : mine[0];
  socket.timeout(4000).emit('pitchGet', { cid: c.id }, (err, data) => { if (!err && data) renderDemo(c, data, tab, mine); });
}
function demoFacts(c) {
  const f = finOf([c]), sector = t(sectorOf(c) || 'sector.service'), product = c.product || t(c.nameKey);
  return { company: companyName(c), product, sector, price: c.price, city: seed.economy.cities[state.city]?.name || '', sales: c.sales || 0,
    month: f.monthRev, cash: c.cash, staff: staffOf(c), founders: c.founders.map(id => state.players[id]?.name || '—').join(', ') };
}
function renderDemo(c, data, tab, mine) {
  const facts = demoFacts(c), canvas = { ...data.canvas };
  openModal(body => {
    body.append(el('h3', `🎤 ${t('demo.title')} · ${companyName(c)}`));
    if (mine.length > 1) { const sel = el('select'); mine.forEach(x => sel.append(new Option(companyName(x), x.id))); sel.value = c.id; sel.onchange = () => openDemoDay(sel.value, tab); body.append(sel); }
    const tabs = el('div', null, 'others');
    ['events', 'canvas', 'pitch', 'deck'].forEach(k => tabs.append(btn(t('demo.tab.' + k), () => renderDemo(c, data, k, mine), { primary: k === tab })));
    body.append(tabs);
    const box = el('div', null, 'co'); body.append(box);
    if (tab === 'canvas') {
      box.append(el('p', t('demo.canvasIntro'), 'muted'));
      const grid = el('div', null, 'bmc'), areas = {};
      CANVAS_KEYS.forEach(k => {
        const cell = el('label', null, 'bmcCell bmc-' + k); cell.append(el('b', `${BMC_ICON[k]} ${t('bmc.' + k)}`), el('small', t('bmcHint.' + k), 'muted'));
        const ta = el('textarea'); ta.maxLength = 300; ta.value = canvas[k] || ''; ta.rows = 3; areas[k] = ta; cell.append(ta); grid.append(cell);
      });
      box.append(grid);
      const row = el('div', null, 'row');
      row.append(btn('✨ ' + t('demo.suggest'), () => { CANVAS_KEYS.forEach(k => { if (!areas[k].value.trim()) areas[k].value = t('bmcSuggest.' + k, facts); }); }));
      row.append(btn('✓ ' + t('demo.save'), () => {
        const next = Object.fromEntries(CANVAS_KEYS.map(k => [k, areas[k].value]));
        socket.emit('saveCanvas', { cid: c.id, canvas: next }); data.canvas = next; setTimeout(() => openDemoDay(c.id, 'events'), 250);
      }, { primary: true, isDefault: true }));
      box.append(row);
    } else if (tab === 'pitch') {
      box.append(el('p', t('demo.pitchIntro'), 'muted'));
      const ta = el('textarea'); ta.rows = 7; ta.maxLength = 900; ta.value = data.pitch || t('pitch.template', { ...facts, value: canvas.valueProps || '…', segment: canvas.customerSegments || '…' });
      const info = el('small', '', 'muted');
      const words = () => ta.value.trim().split(/\s+/).filter(Boolean).length;
      const upd = () => (info.textContent = t('demo.words', { n: words(), sec: Math.round(words() / 2.2) }));
      ta.oninput = upd; upd();
      const timer = el('b', '');
      let iv = null;
      const rehearse = btn('⏱ ' + t('demo.rehearse'), () => {
        clearInterval(iv); let left = 60; timer.textContent = ` ${left}s`;
        iv = setInterval(() => { left--; timer.textContent = left > 0 ? ` ${left}s` : ' ⏰ ' + t('demo.timeUp'); if (left <= 0 || !modalOpen) clearInterval(iv); }, 1000);
      });
      const row = el('div', null, 'row');
      row.append(rehearse, btn('✓ ' + t('demo.save'), () => { socket.emit('saveCanvas', { cid: c.id, pitch: ta.value }); data.pitch = ta.value; }, { primary: true, isDefault: true }));
      box.append(ta, info, timer, row);
    } else if (tab === 'deck') {
      deckViewer(box, c, data, facts);
    } else {
      const r = data.readiness, partsMax = { canvas: 36, pitch: 10, traction: 30, growth: 10, team: 14 };
      box.append(el('h4', `📈 ${t('demo.readiness')}: ${r.score}/100`));
      const bar = el('div', null, 'bar'), fill = el('i'); fill.style.width = r.score + '%'; bar.append(fill); box.append(bar);
      const k = el('div', null, 'mini');
      Object.entries(r.parts).forEach(([key, v]) => k.append(kpi(t('demo.part.' + key), `${v}/${partsMax[key]}`)));
      box.append(k, el('small', t('demo.valuation', { cash: r.valuation }), 'muted'));
      if (data.offer) {
        const o = data.offer, card = el('div', null, 'rec');
        card.append(el('b', '💼 ' + t('demo.offerTitle.' + o.kind)), el('p', t('demo.offerText', { amount: o.amount, equity: o.equity, cash: o.valuation, day: o.until })));
        const row = el('div', null, 'row');
        row.append(btn('✓ ' + t('demo.accept'), () => { socket.emit('offerReply', { cid: c.id, offerId: o.id, accept: true }); closeModal(); }, { primary: true, isDefault: true }),
          btn(t('demo.decline'), () => { socket.emit('offerReply', { cid: c.id, offerId: o.id, accept: false }); closeModal(); }));
        card.append(row); body.append(card);
      }
      const ev = (kind, cool) => {
        const card = el('div', null, 'co'); card.append(el('h4', t('demo.event.' + kind)), el('p', t('demo.eventDesc.' + kind, { amount: 2000, cash: 0 }), 'muted'));
        const wait = cool && cool > data.day ? cool - data.day : 0;
        const b = btn(wait ? t('demo.wait', { days: wait }) : t('demo.go.' + kind), () => {
          socket.timeout(5000).emit('pitchEvent', { cid: c.id, kind }, (err, res) => {
            if (err || !res) return;
            toast(t(res.key || 'demo.noOffer', { score: res.score, days: res.days, amount: res.amount, blocks: res.need?.blocks, age: res.age }));
            openDemoDay(c.id, 'events');
          });
        }, { primary: !wait && kind === (r.score >= 60 ? 'demoday' : 'angel') });
        b.disabled = !!wait || (kind === 'grant' && data.granted);
        card.append(b); return card;
      };
      body.append(ev('demoday', data.cooldowns.demo), ev('angel', data.cooldowns.angel), ev('grant', 0));
    }
  });
}
function deckSlides(c, data, facts) {
  const cv = data.canvas, r = data.readiness;
  const ask = Math.round(r.valuation * 0.15);
  return [
    { title: facts.company, sub: t('deck.tagline', facts), lines: [`${facts.sector} · ${facts.city}`, t('deck.founders', facts)] },
    { title: t('deck.problem'), lines: [cv.customerSegments || t('deck.fill'), cv.valueProps ? t('deck.pain') : ''] },
    { title: t('deck.solution'), lines: [cv.valueProps || t('deck.fill'), t('deck.product', facts)] },
    { title: t('deck.market'), lines: [cv.customerSegments || t('deck.fill'), cv.channels || ''] },
    { title: t('deck.model'), lines: [cv.revenueStreams || t('deck.fill'), t('deck.price', facts)] },
    { title: t('deck.traction'), kpis: [[t('deck.sales'), String(facts.sales)], [t('fin.revenue'), money(facts.month, true)], [t('fin.cash'), money(facts.cash, true)], [t('hud.employees'), String(facts.staff)]] },
    { title: t('deck.competition'), lines: [cv.keyActivities || t('deck.fill'), cv.keyResources || ''] },
    { title: t('deck.team'), lines: [t('deck.founders', facts), t('deck.staff', facts), cv.keyPartners || ''] },
    { title: t('deck.financials'), chart: true, lines: [cv.costStructure || t('deck.fill')] },
    { title: t('deck.ask'), lines: [t('deck.askText', { amount: ask, cash: r.valuation }), t('deck.useOfFunds')] }
  ];
}
function deckViewer(box, c, data, facts) {
  const slides = deckSlides(c, data, facts);
  let i = 0;
  const stageEl = el('div', null, 'slide'), nav = el('div', null, 'row'), counter = el('b');
  const show = () => {
    const sl = slides[i]; stageEl.replaceChildren(el('small', `${i + 1}/${slides.length}`, 'muted'), el('h2', sl.title));
    if (sl.sub) stageEl.append(el('p', sl.sub, 'lead'));
    (sl.lines || []).filter(Boolean).forEach(l => stageEl.append(el('p', '• ' + l)));
    if (sl.kpis) { const k = el('div', null, 'mini'); sl.kpis.forEach(([a, b]) => k.append(kpi(a, b))); stageEl.append(k); }
    if (sl.chart) {
      const cvs = el('canvas'); cvs.className = 'spark'; stageEl.append(cvs);
      getHistory(c.id, h => sparkline(cvs, h.monthly.map(m => m.revenue - m.expenses - m.losses).concat([finOf([c]).monthRev - finOf([c]).monthExp])), 5000);
    }
    counter.textContent = ` ${i + 1}/${slides.length} `;
  };
  nav.append(btn('◀', () => { i = (i + slides.length - 1) % slides.length; show(); }), counter, btn('▶', () => { i = (i + 1) % slides.length; show(); }, { primary: true, isDefault: true }),
    btn('⬇ ' + t('deck.download'), () => {
      const md = slides.map((sl, k) => `## ${k + 1}. ${sl.title}\n${sl.sub ? sl.sub + '\n' : ''}${(sl.lines || []).filter(Boolean).map(l => '- ' + l).join('\n')}${sl.kpis ? '\n' + sl.kpis.map(([a, b]) => `- ${a}: ${b}`).join('\n') : ''}`).join('\n\n');
      const blob = new Blob([`# ${facts.company} — Pitch Deck\n\n${md}\n`], { type: 'text/markdown' });
      const a = el('a'); a.href = URL.createObjectURL(blob); a.download = `${facts.company.replace(/[^\p{L}\p{N}]+/gu, '-')}-pitch.md`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }));
  box.append(stageEl, nav); show();
}

$('sendText').onclick = () => {
  const text = $('ideaText').value.trim();
  if (!text || !state) return;
  socket.emit('idea', { text }); $('ideaText').value = '';
};

// Test hook (only with ?debug): lets automated UI tests reach NPCs / scenes without pixel hunting
if (new URLSearchParams(location.search).has('debug')) {
  window.__fb = { npcs, player, perf, openNpc, enterCompany, openDept, toggleBoard, openWizard, openDemoDay, openStop, socket, traffic, state: () => state, seed: () => seed, myId, inner, scene };
}

// ---------- Boot ----------
(async () => {
  const saved = loadJSON('lang', null) || (navigator.language.startsWith('tr') ? 'tr' : 'en');
  await i18next.init({ lng: saved, fallbackLng: 'tr', resources: {} });
  $('lang').value = saved;
  await loadLang(saved);
  if (!matchMedia('(max-width:820px)').matches) document.querySelectorAll('#side .card').forEach(c => c.classList.add('active'));
  $('status').hidden = !showStatus;
  resize();
  requestAnimationFrame(frame);
  showModes();
})();
