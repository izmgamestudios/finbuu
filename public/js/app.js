// public/js/app.js
// Finbuu client: scenes (street <-> zoom <-> company interior), input (keys, click, joystick), advisor (OK / Next / Auto),
// HUD, status overlay (FPS / ping / sync), leaderboard layer, NPC dialogs with ID cards, department panels,
// founding wizard, chat + polls, presentation (watch-only) mode. The server stays authoritative for every action.
import { layout, draw, createNpcs, worldWidth, WORLD_H, GROUND, MAX_FLOORS, drawPerson, lookFor } from './world.js';
import { suggestions, companyActions, employeeCap, maxTenants, staffOf, floorsFor, floorsOfCompany, deptOpen } from './advisor.js';
import { drawInterior, staffLooks, IW, IH, FH, FLOORS, ELEV, floorBase, roomOf, roomCenter, DEPT_ICON } from './interior.js';

const { i18next, io, Chart } = window;
const $ = id => document.getElementById(id);
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
const cv = $('cv'), ctx = cv.getContext('2d'), stage = $('stage');
const touch = matchMedia('(pointer: coarse)').matches;
const SPEED = 170, MOVE_SEND_MS = 100, AUTO_MS = 1500, NPC_COUNT = 7, NPC_PRESENTATION = 4, NPC_LOW = 3;
const INNER_PAD_TOP = 70, INNER_PAD_BOTTOM = 80;
const ZOOM_IN_MS = 520, ZOOM_OUT_MS = 420, FADE_MS = 260, TOUR_MS = 7000;

// ---------- state ----------
let seed = null, state = null, joined = null, buildings = layout(null), spawned = false;
const view = { w: 0, h: 0, s: 1, ty: 0, camX: 0, dpr: 1 };
const player = { x: 120, dir: 1, phase: 0, moving: false, target: null, onArrive: null, targetId: null };
const others = new Map(); // id -> { x, tx, dir, phase, moving }
const npcs = createNpcs(NPC_COUNT);
const keys = new Set();
const joy = { axis: 0, id: null };
let near = null, nearNpc = null, plan = null, auto = false, advIdx = 0, ranked = [], modalOpen = false, modalOnClose = null;
let lastSent = { x: -1, at: 0 };
const met = new Set(loadJSON('met', []));
const votedPolls = new Set();
const histCache = new Map(); // cid -> { at, data }
// scene: street | zoomIn | interior | zoomOut
const scene = { name: 'street', t0: 0, b: null, cid: null };
const inner = { x: 120, floor: 0, dir: 1, moving: false, phase: 0, target: null, onArrive: null };
const iview = { w: 0, h: 0, s: 1, camX: 0, camY: 0, dpr: 1 };
// perf / status
const perf = { fps: 60, frameMs: 0, ping: null, syncTimes: [], stateKB: 0, stateCount: 0, quality: 'auto', low: false, lowSince: 0, highSince: 0 };
let showStatus = loadJSON('status', true), boardOpen = false, focusOverride = null, tour = { idx: 0, at: 0 };

const t = (k, o) => (i18next.isInitialized ? i18next.t(k, { interpolation: { escapeValue: false }, ...o }) : k);
const resolve = p => { const out = { ...p }; for (const [k, v] of Object.entries(p || {})) if (k.endsWith('Key')) out[k.slice(0, -3)] = t(v); return out; };
const companyName = c => c.name || t(c.nameKey);
const myId = () => socket.id;
const me = () => state?.players?.[myId()];
const fmt = n => { const a = Math.abs(n); const s = a >= 10000 ? (a / 1000).toFixed(1) + 'k' : String(Math.round(a)); return (n < 0 ? '−' : '') + s; };
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
  document.title = t('ui.title');
  document.querySelectorAll('[data-i18n]').forEach(e => (e.textContent = t(e.dataset.i18n)));
  document.querySelectorAll('[data-i18n-ph]').forEach(e => (e.placeholder = t(e.dataset.i18nPh)));
  $('recAudio').textContent = '☁🔒 ' + t('ui.recAudio');
  $('recVideo').textContent = '☁🔒 ' + t('ui.recVideo');
  updateControls(); renderSeed(); renderRoomBar(); render(); updateAutoBtn();
}
function renderSeed() {
  if (!seed || !i18next.isInitialized) return;
  $('tut').replaceChildren(...seed.tutorial.map(k => el('li', t(k))));
  $('locked').replaceChildren(...seed.locked.map(k => { const s = el('span', '☁🔒 ' + t(k), 'locked'); s.onclick = () => toast(t('ui.premiumAlert', { feature: t(k) })); return s; }));
}

// ---------- Navigation ----------
const openDrawer = v => { $('drawer').classList.toggle('open', v); $('scrim').classList.toggle('show', v); };
$('menuBtn').onclick = () => openDrawer(true);
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
socket.on('seed', s => { seed = s; renderSeed(); });
socket.on('state', s => {
  const now = performance.now();
  perf.syncTimes.push(now); if (perf.syncTimes.length > 10) perf.syncTimes.shift();
  if (perf.stateCount++ % 5 === 0) perf.stateKB = JSON.stringify(s).length / 1024;
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
  joined = info;
  if (info.mode !== 'solo') history.replaceState(null, '', `?room=${encodeURIComponent(info.roomId)}`);
  closeModal(); renderRoomBar(); updateControls();
  $('advisor').hidden = false;
  $('chatCard').hidden = info.mode === 'solo';
  if (isPres()) { showTab(matchMedia('(max-width:820px)').matches ? 'street' : 'chat'); setAuto(false); }
  setTimeout(() => ($('hint').style.display = 'none'), 10000);
});
socket.on('chatHistory', list => { $('chatList').replaceChildren(); list.forEach(addChat); });
socket.on('chat', addChat);
socket.on('chatDeleted', id => document.querySelector(`#chatList li[data-id="${CSS.escape(id)}"]`)?.remove());
socket.on('disconnect', () => {
  joined = null; state = null; spawned = false; others.clear(); setAuto(false); exitCompany(true);
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

// ---------- Mode selection ----------
function showModes() {
  if (joined) return toast(t('ui.roomInfo', { room: joined.roomId, pin: joined.pin || '—' }));
  const urlRoom = new URLSearchParams(location.search).get('room') || '';
  const digits = (input, max) => { input.inputMode = 'numeric'; input.maxLength = max; input.pattern = '[0-9]*'; input.oninput = () => (input.value = input.value.replace(/\D/g, '').slice(0, max)); };
  openModal(body => {
    body.append(el('h3', t('ui.modeTitle')));
    const name = el('input'); name.placeholder = t('ui.namePh'); name.maxLength = 20; body.append(name);
    const solo = el('div', null, 'mode');
    solo.append(el('b', t('ui.solo')), el('p', t('ui.soloDesc')));
    const soloBtn = el('button', t('ui.startSolo'), 'primary');
    soloBtn.onclick = () => socket.emit('startSolo', { name: name.value });
    if (!urlRoom) soloBtn.dataset.default = '1';
    solo.append(soloBtn); body.append(solo);

    const multi = el('div', null, 'mode');
    multi.append(el('b', t('ui.multi')), el('p', t('ui.multiDesc')));
    const newPin = el('input'); newPin.placeholder = t('ui.newPinPh'); digits(newPin, 6);
    const create = el('button', t('ui.createRoom'));
    create.onclick = () => {
      const pin = newPin.value.trim();
      if (pin && !/^\d{4,6}$/.test(pin)) return toast(t('toast.badPin'));
      socket.emit('createRoom', { name: name.value, pin });
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
const buildingOf = target => buildings.find(b => (target.kind === 'plaza' ? b.kind === 'plaza' : b.kind === 'lot' && b.lot.id === target.lotId));
const buildingOfCompany = c => buildingOf(c.lotId == null ? { kind: 'plaza' } : { kind: 'lot', lotId: c.lotId });

function updateControls() {
  const inside = scene.name === 'interior';
  $('joy').hidden = !touch || isPres();
  $('hint').textContent = isPres() ? t('ui.presHint') : t(touch ? 'ui.moveHintTouch' : 'ui.moveHint');
  $('actBtn').textContent = inside ? '⬆ ' + t('ui.open') : '⬆ ' + t('ui.enter');
  $('innerBar').hidden = !inside;
  $('advisor').hidden = !joined || scene.name !== 'street';
}

// ---------- Input: keyboard ----------
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
  if (k === 'f3') { e.preventDefault(); $('toggleStatus').click(); return; }
  if ((k === ' ' || k === 'control') && state) { e.preventDefault(); toggleBoard(); return; }
  if (boardOpen) { if (k === 'escape') toggleBoard(false); return; }
  if (!state) return;
  if (scene.name === 'interior') return innerKey(e, k);
  if (scene.name !== 'street') return;
  if (k === 'enter') { acceptSuggestion(); e.preventDefault(); return; }
  if (k === 'n') { nextSuggestion(); return; }
  if (isPres()) return; // watch-only: no walking
  if (KEYMAP[k]) { keys.add(KEYMAP[k]); manualInput(); e.preventDefault(); }
  if (['w', 'arrowup', 'e'].includes(k)) {
    e.preventDefault();
    if (nearNpc) openNpc(nearNpc); else if (near) openBuilding(near);
  }
});
addEventListener('keyup', e => { const k = KEYMAP[e.key.toLowerCase()]; if (k) keys.delete(k); });
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
const endJoy = e => { if (e.pointerId !== joy.id) return; joy.id = null; joy.axis = 0; knob.style.transform = ''; };
joyEl.addEventListener('pointerup', endJoy); joyEl.addEventListener('pointercancel', endJoy);
function moveJoy(e) {
  const r = joyEl.getBoundingClientRect(), dx = clamp(e.clientX - (r.left + r.width / 2), -40, 40);
  joy.axis = Math.abs(dx) < 6 ? 0 : dx / 40;
  knob.style.transform = `translateX(${dx}px)`;
}
$('actBtn').onclick = () => {
  if (scene.name === 'interior') return openDeptHere();
  if (nearNpc) openNpc(nearNpc); else if (near) openBuilding(near);
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
  $('advLabel').textContent = s ? (plan ? '🚶 ' : '💡 ') + t(s.labelKey, s.params) : t('adv.none');
  $('advReason').textContent = s ? t(s.reasonKey, s.params) : '';
  $('advOk').disabled = !s; $('advNext').disabled = ranked.length < 2;
}
function acceptSuggestion() { const s = currentSuggestion(); if (s) startPlan(s); }
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
  socket.emit(s.action.ev, s.action.payload);
  if (s.action.ev !== 'click') toast('✓ ' + t(s.labelKey, s.params));
  advIdx = 0; renderAdvisor();
}
function cancelPlan() { if (plan) setTimeout(renderAdvisor); plan = null; player.target = null; player.onArrive = null; player.targetId = null; }
function setAuto(v) { auto = v; updateAutoBtn(); if (v && !plan) acceptSuggestion(); }
function updateAutoBtn() { $('advAuto').textContent = t(auto ? 'ui.autoOn' : 'ui.auto'); $('advAuto').classList.toggle('on', auto); }
$('advOk').onclick = acceptSuggestion;
$('advNext').onclick = nextSuggestion;
$('advAuto').onclick = () => setAuto(!auto);
setInterval(() => { if (auto && state && !plan && !modalOpen && scene.name === 'street') acceptSuggestion(); }, AUTO_MS);

// ---------- Scenes: street <-> company interior ----------
const ease = p => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2);
function enterCompany(c) {
  const b = buildingOfCompany(c); if (!b || isPres()) return;
  closeModal(); cancelPlan(); setAuto(false); keys.clear();
  Object.assign(scene, { name: 'zoomIn', t0: performance.now(), b, cid: c.id });
  Object.assign(inner, { x: ELEV.x - 60, floor: 0, dir: -1, target: null, onArrive: null });
  $('innerTitle').textContent = `🏢 ${companyName(c)}`;
  updateControls();
}
function exitCompany(instant) {
  if (scene.name === 'street') return;
  keys.clear(); closeModal();
  if (instant) Object.assign(scene, { name: 'street', b: null, cid: null });
  else Object.assign(scene, { name: 'zoomOut', t0: performance.now() });
  updateControls();
}
const company = () => state?.companies[scene.cid];
const floorsUnlocked = c => Math.min(FLOORS - 1, floorsOfCompany(state, c)); // last floor is premium
const unlocked = (c, f) => f < floorsUnlocked(c);
function changeFloor(d) {
  const c = company(); if (!c) return;
  const f = inner.floor + d;
  if (f < 0 || f >= FLOORS) return;
  if (!unlocked(c, f)) return toast(f === FLOORS - 1 ? t('dept.premium') : t('dept.unlockAt', { cash: 250 * 2 ** f }));
  inner.floor = f; inner.x = clamp(inner.x, 20, IW - 20); inner.target = null;
}
const floorAtY = y => { for (let f = 0; f < FLOORS; f++) if (y <= floorBase(f) && y >= floorBase(f) - FH) return f; return null; };
function innerTap(e) {
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
  const c = company(); if (!c) return;
  const d = roomOf(seed.departments, inner.x, inner.floor);
  if (d) openDept(c, d); else toast(t('ui.useElevator'));
}

// ---------- Game loop ----------
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  const t0 = performance.now();
  if (scene.name === 'interior') { updateInner(dt); renderInterior(now); }
  else { updatePlayer(dt, now); updateStreet(dt); renderStreet(now); }
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
      else { Object.assign(scene, { name: 'street', b: null, cid: null }); updateControls(); }
    }
  }
  draw(ctx, {
    state, view: v, time: now, myId: myId(), player, others: isPres() ? new Map() : others, npcs, buildings,
    near: isPres() ? null : near, nearNpc: isPres() ? null : nearNpc, targetId: player.targetId, met, low: perf.low, npcLimit: npcLimit(), hideMe: isPres(),
    ranks: boardOpen ? lotRanks() : null,
    t, name: companyName, sector: sectorOf, maxTenants: lot => maxTenants(seed, lot),
    tenants: lot => lot.companyIds.map(id => state.companies[id]).filter(Boolean),
    trend: list => list.reduce((s, c) => s + (c.fin?.lastDay && c.fin.prevCash != null ? c.fin.lastDay.cash - c.fin.prevCash : 0), 0),
    keyHint: touch || isPres() ? null : nearNpc ? `E 💬 ${t('npc.talk')}` : `W ⬆ ${t('ui.enter')}`
  });
  if (white > 0) { ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0); ctx.fillStyle = `rgba(255,255,255,${white})`; ctx.fillRect(0, 0, view.w, view.h); }
}
function updatePlayer(dt, now) {
  if (scene.name !== 'street' || isPres()) { near = nearNpc = null; $('actBtn').hidden = true; return; }
  let axis = 0;
  if (keys.has('left')) axis -= 1;
  if (keys.has('right')) axis += 1;
  if (joy.axis) axis = joy.axis;
  let vx = axis * SPEED;
  if (axis) { player.target = null; player.onArrive = null; }
  else if (player.target != null) {
    const d = player.target - player.x;
    if (Math.abs(d) < 4) { player.target = null; const cb = player.onArrive; player.onArrive = null; if (cb) cb(); }
    else vx = Math.sign(d) * SPEED;
  }
  player.x = clamp(player.x + vx * dt, 10, wWidth() - 10);
  player.moving = vx !== 0;
  if (vx) { player.dir = Math.sign(vx); player.phase += dt * 16; }
  near = state ? buildings.find(b => b.kind !== 'locked' && player.x >= b.x && player.x <= b.x + b.w) || null : null;
  nearNpc = state && !player.moving ? npcs.nearest(player.x) : null;
  $('actBtn').hidden = !(touch && (near || nearNpc));
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
  let vx = axis * SPEED;
  if (axis) { inner.target = null; inner.onArrive = null; }
  else if (inner.target != null) {
    const d = inner.target - inner.x;
    if (Math.abs(d) < 4) { inner.target = null; const cb = inner.onArrive; inner.onArrive = null; if (cb) cb(); }
    else vx = Math.sign(d) * SPEED;
  }
  inner.x = clamp(inner.x + vx * dt, 20, IW - 20);
  inner.moving = vx !== 0;
  if (vx) { inner.dir = Math.sign(vx); inner.phase += dt * 16; }
  $('actBtn').hidden = !touch;
}
function renderInterior(now) {
  const c = company(); if (!c || !iview.w) return;
  const vw = iview.w / iview.s, vh = iview.h / iview.s;
  const tx = vw >= IW ? (IW - vw) / 2 : clamp(inner.x - vw / 2, 0, IW - vw);
  const padB = INNER_PAD_BOTTOM / iview.s, padT = INNER_PAD_TOP / iview.s;
  const ty = vh >= IH + padB + padT ? IH + padB - vh : clamp(floorBase(inner.floor) + padB - vh * 0.85, -padT, IH + padB - vh);
  iview.camX += (tx - iview.camX) * 0.15; iview.camY += (ty - iview.camY) * 0.15;
  if (now - scene.t0 < 30) { iview.camX = tx; iview.camY = ty; }
  const p = me();
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
const signed = (n, cls) => el('span', (n >= 0 ? '+' : '') + fmt(n), cls || (n >= 0 ? 'pos' : 'neg'));
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
function sortedRows() { const k = $('boardSort').value || 'cash'; return boardRows().sort((a, b) => b[k] - a[k]); }
function myRank() { const rows = sortedRows(); const i = rows.findIndex(r => r.c.founders.includes(myId())); return i >= 0 ? i + 1 : null; }
function lotRanks() {
  const m = new Map();
  sortedRows().forEach((r, i) => { if (r.c.lotId != null && !m.has(r.c.lotId)) m.set(r.c.lotId, i + 1); });
  return m;
}
function toggleBoard(v = !boardOpen) { boardOpen = v; $('board').hidden = !v; if (v) renderBoard(); }
function renderBoard() {
  if (!boardOpen) return;
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
function addChat(m) {
  const li = el('li'); li.dataset.id = m.id;
  li.append(el('b', m.by + ':'), document.createTextNode(m.text));
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
    case 'cek': case 'withdraw': if (need()) socket.emit('withdraw', { cid: c.id }); break;
    case 'kur': case 'found': openWizard(); break;
    case 'oneri': case 'ok': acceptSuggestion(); break;
    case 'sira': case 'top': toggleBoard(true); break;
    default: sysChat(t('cmd.help'));
  }
}
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
function render() {
  if (!i18next.isInitialized) return;
  $('day').textContent = state?.calendar ? t('ui.day', state.calendar) : '';
  renderProfile(me());
  renderHud();
  renderAdvisor();
  renderFinance();
  renderPoll();
  if (boardOpen) renderBoard();
  if (state) {
    const sig = `${state.log[0]?.at}|${state.log.length}|${state.ideas.length}|${i18next.language}`;
    if (sig !== logSig) {
      logSig = sig;
      const time = ts => new Date(ts).toLocaleTimeString(i18next.language, { hour: '2-digit', minute: '2-digit' });
      $('log').replaceChildren(...state.log.map(l => el('li', `${time(l.at)} · ${t(l.key, resolve(l.params))}`)));
      $('ideas').replaceChildren(...state.ideas.map(i => el('li', `${i.by}: ${i.text}`)));
    }
  } else { logSig = ''; $('log').replaceChildren(); $('ideas').replaceChildren(); $('hud').replaceChildren(); hudSig = ''; }
}
let profSig = '';
function renderProfile(p) {
  const box = $('profile');
  const sig = p ? `${p.coins}|${Math.round(p.stats.xp)}|${p.stats.knowledge}|${p.stats.success}|${p.role}|${i18next.language}` : '';
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
  row('💰', p.coins);
  row('🎭', t(p.role));
}

// ---------- Modal ----------
let modalClosable = true;
function openModal(fill, { closable = true, onClose = null } = {}) {
  if (modalOpen && modalOnClose) { const cb = modalOnClose; modalOnClose = null; cb(); }
  modalClosable = closable; modalOpen = true; modalOnClose = onClose;
  const body = $('modalBody'); body.replaceChildren(); delete body.dataset.npc; fill(body);
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

const costLabel = (ws, lot) => {
  if (ws === 'shop') { const base = seed.lotSizes[lot.size].rent, n = lot.companyIds.length + 1; return Math.ceil(base / n) + Math.ceil(base * 0.3 / n); }
  return seed.workspaces[ws].rent + (seed.workspaces[ws].electricity || 0);
};
const depositLabel = (ws, lot) => (ws === 'shop' ? Math.ceil(seed.lotSizes[lot.size].rent / (lot.companyIds.length + 1)) * 5 : seed.workspaces[ws].deposit);
const freeLot = type => state.lots.find(l => l.type === type && l.companyIds.length < maxTenants(seed, l));

// Template select with "Other (add your own)"
function productPicker(box, defaultIdx, sector) {
  const tplSel = el('select');
  seed.templates.forEach((tp, i) => { if (!sector || tp.sector === sector) tplSel.append(new Option(`${t(tp.key)} (${t(tp.sector)}, ${tp.price}c)`, i)); });
  tplSel.append(new Option('➕ ' + t('ui.otherTemplate'), 'custom'));
  tplSel.value = [...tplSel.options].some(o => o.value === String(defaultIdx)) ? String(defaultIdx) : tplSel.options[0].value;
  const custom = el('div', null, 'row'); custom.hidden = true;
  const label = el('input'); label.placeholder = t('ui.customLabelPh'); label.maxLength = 30;
  const secSel = el('select'); seed.custom.sectors.forEach(s => secSel.append(new Option(t(s), s))); if (sector) secSel.value = sector;
  const price = el('input'); price.type = 'number'; price.min = seed.custom.minPrice; price.max = seed.custom.maxPrice; price.value = 10;
  price.title = t('ui.customPrice', { min: seed.custom.minPrice, max: seed.custom.maxPrice });
  custom.append(label, secSel, price);
  tplSel.onchange = () => { custom.hidden = tplSel.value !== 'custom'; if (!custom.hidden) label.focus(); };
  box.append(tplSel, custom);
  return () => (tplSel.value === 'custom'
    ? { custom: { label: label.value.trim(), sector: secSel.value, price: Number(price.value) } }
    : { templateIdx: +tplSel.value });
}
function foundForm(body, { lot = null, choices, isDefault, rec }) {
  const box = el('div', null, isDefault ? 'rec' : 'co');
  box.append(el('h4', (isDefault ? '⭐ ' : '') + t('ui.foundHere')));
  if (rec) box.append(el('small', t(rec.reasonKey, rec.params)));
  const wsSel = el('select');
  choices.forEach(ws => wsSel.append(new Option(t('ws.' + ws), ws)));
  wsSel.value = rec?.action.payload.workspace || choices[0];
  const info = el('p');
  const refresh = () => (info.textContent = `${t('ui.deposit', { amount: depositLabel(wsSel.value, lot) })} · ${t('ui.cost', { cost: costLabel(wsSel.value, lot) })}`);
  wsSel.onchange = refresh; refresh();
  if (choices.length > 1) box.append(wsSel);
  box.append(info);
  const pick = productPicker(box, rec?.action.payload.templateIdx ?? (lot ? lot.id % seed.templates.length : 2));
  const nm = el('input'); nm.placeholder = t('ui.companyNamePh'); nm.maxLength = 40;
  box.append(nm);
  const row = el('div', null, 'row');
  row.append(btn((isDefault ? '✓ ' : '') + t('ui.found'), () => {
    const prod = pick();
    if (prod.custom && !prod.custom.label) return toast(t('toast.badCustom'));
    socket.emit('found', { lotId: lot?.id ?? null, workspace: wsSel.value, name: nm.value, ...prod }); closeModal();
  }, { primary: true, isDefault }), btn('🧭 ' + t('wiz.open'), () => openWizard()));
  box.append(row);
  body.append(box);
}

// ---------- Founding wizard: Q&A, Next / OK ----------
function openWizard() {
  if (!state) return;
  const w = { step: 0, sector: seed.custom.sectors[2], product: null, workspace: 'home', name: '' };
  const steps = ['sector', 'product', 'place', 'name'];
  const render = () => openModal(body => {
    const bar = el('div', null, 'steps'); steps.forEach((_, i) => bar.append(el('i', null, i <= w.step ? 'on' : ''))); body.append(bar);
    body.append(el('h3', `🧭 ${t('wiz.title')} · ${w.step + 1}/${steps.length}`), el('p', t('wiz.q.' + steps[w.step]), 'muted'));
    const nav = el('div', null, 'wizNav');
    const back = btn('◀ ' + t('wiz.back'), () => { w.step--; render(); }); back.disabled = w.step === 0;
    let next;
    if (steps[w.step] === 'sector') {
      const grid = el('div', null, 'choices');
      seed.custom.sectors.forEach(s => { const b = btn(t(s), () => { w.sector = s; w.step++; render(); }); if (s === w.sector) b.className = 'sel'; grid.append(b); });
      body.append(grid);
      next = btn(t('wiz.next') + ' ▶', () => { w.step++; render(); }, { primary: true, isDefault: true });
    } else if (steps[w.step] === 'product') {
      const box = el('div'); body.append(box);
      const tplInSector = seed.templates.findIndex(tp => tp.sector === w.sector);
      const pick = productPicker(box, tplInSector, w.sector);
      next = btn(t('wiz.next') + ' ▶', () => { const p = pick(); if (p.custom && !p.custom.label) return toast(t('toast.badCustom')); w.product = p; w.step++; render(); }, { primary: true, isDefault: true });
    } else if (steps[w.step] === 'place') {
      const grid = el('div', null, 'choices');
      const coins = me()?.coins || 0;
      const opts = ['home', 'virtual', 'eoffice', 'coworking', 'shop'].map(ws => {
        const lot = seed.workspaces[ws].physical ? freeLot(ws) : null;
        const ok = !seed.workspaces[ws].physical || !!lot;
        const dep = ok ? depositLabel(ws, lot) : null;
        return { ws, lot, ok: ok && coins >= (dep || 0), dep, cost: ok ? costLabel(ws, lot) : null };
      });
      if (!opts.find(o => o.ws === w.workspace)?.ok) w.workspace = 'home';
      opts.forEach(o => {
        const b = btn(`${t('ws.' + o.ws)} · ${o.dep == null ? t('ui.full') : t('wiz.deposit', { dep: o.dep, cost: o.cost })}`, () => { w.workspace = o.ws; render(); });
        b.disabled = !o.ok; if (o.ws === w.workspace) b.className = 'sel'; grid.append(b);
      });
      body.append(grid);
      next = btn(t('wiz.next') + ' ▶', () => { w.step++; render(); }, { primary: true, isDefault: true });
    } else {
      const nm = el('input'); nm.placeholder = t('ui.companyNamePh'); nm.maxLength = 40; nm.value = w.name; nm.oninput = () => (w.name = nm.value);
      body.append(nm);
      const prodLabel = w.product?.custom ? `${w.product.custom.label} (${w.product.custom.price}c)` : t(seed.templates[w.product?.templateIdx ?? 0].key);
      body.append(el('p', t('wiz.summary', { sector: t(w.sector), product: prodLabel, place: t('ws.' + w.workspace) })));
      next = btn('✓ ' + t('ui.found'), () => {
        socket.emit('found', { lotId: seed.workspaces[w.workspace].physical ? 'auto' : null, workspace: w.workspace, name: w.name, ...w.product });
        closeModal();
      }, { primary: true, isDefault: true });
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
  const top = list.find(a => a.recommended);
  if (top) {
    const r = el('div', null, 'rec');
    r.append(el('small', '⭐ ' + t('ui.recommended') + (rec ? ' · ' + t(rec.reasonKey, rec.params) : '')));
    r.append(btn('✓ ' + t(top.key), run(top), { primary: true, isDefault }));
    box.append(r);
  }
  const rest = list.filter(a => !a.recommended);
  const row = el('div', null, 'others');
  rest.forEach(a => row.append(btn(t(a.key), run(a))));
  if (!isPres()) row.append(btn('🚪 ' + t(isMember(c) ? 'ui.enterOffice' : 'ui.visit'), () => enterCompany(c)));
  if (row.children.length) { box.append(el('small', t('ui.otherOptions'), 'muted')); box.append(row); }
  body.append(box);
}
function openBuilding(b) {
  if (!state) return showModes();
  cancelPlan();
  const forThis = ranked.find(s => buildingOf(s.target)?.id === b.id);
  if (b.kind === 'guide') return openModal(body => { body.append(el('h3', t('ui.guide'))); seed.tutorial.forEach(k => body.append(el('p', t(k)))); });
  if (b.kind === 'locked') return toast(t('ui.premiumAlert', { feature: t('locked.skyscraper') }));
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
    lab.append(cb, el('span', `${t('ben.' + k)} (${seed.benefits[k].cost}c, +${Math.round(seed.benefits[k].perf * 100)}%)`));
    wrap.append(lab);
  }
  if (remote) wrap.append(el('p', t('ui.remoteNote')));
  wrap.append(el('p', `${t('ui.benefitCost', { cost: c.benefitCost || 0 })} · ${t('ui.perfInfo', { perf: c.performance || 1 })}`));
  wrap.append(btn(t('ui.saveBenefits'), () => { socket.emit('setBenefits', { cid: c.id, benefits: Object.fromEntries(Object.entries(checks).map(([k, cb]) => [k, cb.checked])) }); closeModal(); }));
  box.append(wrap);
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
        else rec(t('ui.buy'), emit('buy'), t('adv.buyWhy'));
        break;
      }
      case 'finance': {
        miniFinance(box, c);
        const row = el('div', null, 'others');
        if (founder && c.cash < 0) rec(t('ui.invest'), emit('invest', { amount: 100 }), t('adv.rescueWhy'));
        else if (founder && c.cash >= 400) rec(t('ui.withdraw'), emit('withdraw'), t('adv.withdrawWhy'));
        row.append(btn(t('ui.invest'), emit('invest', { amount: 100 })));
        if (founder) row.append(btn(t('ui.withdraw'), emit('withdraw')));
        if (!founder && !c.isNpc && c.founders.length < 3) row.append(btn(t('ui.cofound'), emit('cofound')));
        if (member) row.append(btn('📊 ' + t('dept.openFinance'), () => { closeModal(); finSel = c.id; renderFinance(true); showTab('finance'); }));
        box.append(row);
        break;
      }
      case 'accounting': {
        const ws = seed.workspaces[c.workspace], lot = c.lotId != null ? state.lots[c.lotId] : null;
        const rent = c.workspace === 'shop' || c.workspace === 'coworking' ? costLabel(c.workspace === 'shop' ? 'shop' : 'coworking', lot ? { ...lot, companyIds: lot.companyIds.slice(1) } : null) : (ws.rent + (ws.electricity || 0));
        const salaries = c.employees.length * (seed.salary + (c.benefitCost || 0)) + (c.npcStaff || 0) * seed.salary;
        const k = el('div', null, 'mini');
        k.append(kpi(t('acc.rent'), fmt(rent)), kpi(t('acc.salaries'), fmt(salaries)), kpi(t('acc.total'), fmt(rent + salaries)), kpi(t('acc.lastDay'), fmt(finOf([c]).dayExp)));
        box.append(el('small', t('acc.perDay'), 'muted'), k);
        const tbl = el('table'); tbl.id = 'accTable'; tbl.style.width = '100%'; box.append(tbl);
        getHistory(c.id, h => tbl.replaceChildren(pnlTable(h.monthly.slice(-6))));
        break;
      }
      case 'marketing': {
        const m = seed.marketing, active = c.marketing && c.marketing.until > (state.day || 0);
        box.append(el('p', active ? t('dept.campaignLeft', { days: c.marketing.until - state.day }) : t('dept.campaignInfo', { cost: m.cost, days: m.days, pct: Math.round((m.mult - 1) * 100) })));
        if (founder && !active) rec(t('dept.startCampaign', { cost: m.cost }), emit('marketing'), t('adv.marketingWhy', { days: m.days }));
        else if (!founder) visitorNote();
        break;
      }
      case 'hr': {
        const cap = employeeCap(seed, state, c), staff = staffOf(c);
        const names = [...c.founders.map(id => `👑 ${state.players[id]?.name || '—'}`), ...c.employees.map(id => `👷 ${state.players[id]?.name || '—'}`)];
        box.append(el('p', t('dept.hrInfo', { staff, cap, npc: c.npcStaff || 0, salary: seed.salary })));
        if (names.length) box.append(el('p', names.join(' · ')));
        if (founder) {
          if (staff < cap) rec(t('dept.hireNpc', { salary: seed.salary }), emit('hireNpc'), t('adv.hireWhy', { profit: Math.round(c.price * (seed.workspaces[c.workspace]?.salesMult || 1) * 4 - seed.salary) }));
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
  row(t('npc.trait'), t('trait.' + p.trait)); row(t('npc.interest'), t(p.interest)); row(t('npc.budget'), `${p.budget}c`);
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
    if (founded) options.push({ label: '🤝 ' + t('npc.hire', { company: companyName(founded) }), fn: talk('hire', founded.id), why: t('npc.hireWhy', { salary: seed.salary }) });
    if (p.job === 'recruiter' && openJob) options.push({ label: '📝 ' + t('npc.applyAt', { company: companyName(openJob) }), fn: () => { socket.emit('work', { cid: openJob.id }); closeModal(); }, why: t('adv.workWhy', { salary: seed.salary }) });
    if (p.job !== 'student' && p.job !== 'retired') options.push({ label: '🎓 ' + t('npc.service', { cost: seed.npcTalk?.serviceCost ?? 30 }), fn: talk('service'), why: t('npc.serviceWhy') });
    const [first, ...rest] = options;
    if (first) { const r = el('div', null, 'rec'); r.append(el('small', '⭐ ' + first.why), btn('✓ ' + first.label, first.fn, { primary: true, isDefault: true })); body.append(r); }
    if (rest.length) { const row = el('div', null, 'others'); rest.forEach(o => row.append(btn(o.label, o.fn))); body.append(row); }
  }, { onClose: () => { w.talking = false; } });
}

$('sendText').onclick = () => {
  const text = $('ideaText').value.trim();
  if (!text || !state) return;
  socket.emit('idea', { text }); $('ideaText').value = '';
};

// Test hook (only with ?debug): lets automated UI tests reach NPCs / scenes without pixel hunting
if (new URLSearchParams(location.search).has('debug')) {
  window.__fb = { npcs, player, perf, openNpc, enterCompany, openDept, toggleBoard, openWizard, state: () => state, seed: () => seed, myId, inner, scene };
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
