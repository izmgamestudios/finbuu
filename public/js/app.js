// public/js/app.js
// Finbuu client: character movement (WASD / arrows / click / joystick), camera, advisor (OK / Next / Auto),
// HUD bars, finance panel with charts, building panels. Server stays authoritative for every action.
import { layout, draw, createNpcs, worldWidth, WORLD_H, GROUND, floorsFor, MAX_FLOORS } from './world.js';
import { suggestions, companyActions, employeeCap, maxTenants } from './advisor.js';

const { i18next, io, Chart } = window;
const $ = id => document.getElementById(id);
const el = (tag, text, cls) => { const e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; };
const cv = $('cv'), ctx = cv.getContext('2d'), stage = $('stage');
const touch = matchMedia('(pointer: coarse)').matches;
const SPEED = 170, MOVE_SEND_MS = 100, AUTO_MS = 1500;

let seed = null, state = null, joined = null, buildings = layout(null), spawned = false;
const view = { w: 0, h: 0, s: 1, ty: 0, camX: 0, dpr: 1 };
const player = { x: 120, dir: 1, phase: 0, moving: false, target: null, onArrive: null };
const others = new Map(); // id -> { x, tx, dir, phase, moving }
const npcs = createNpcs(16);
const keys = new Set();
const joy = { axis: 0, id: null };
let near = null, plan = null, auto = false, advIdx = 0, ranked = [], modalOpen = false, lastSent = { x: -1, at: 0 };

const t = (k, o) => (i18next.isInitialized ? i18next.t(k, { interpolation: { escapeValue: false }, ...o }) : k);
const resolve = p => { const out = { ...p }; for (const [k, v] of Object.entries(p || {})) if (k.endsWith('Key')) out[k.slice(0, -3)] = t(v); return out; };
const companyName = c => c.name || t(c.nameKey);
const myId = () => socket.id;
const me = () => state?.players?.[myId()];
const fmt = n => { const a = Math.abs(n); const s = a >= 10000 ? (a / 1000).toFixed(1) + 'k' : String(Math.round(a)); return (n < 0 ? '−' : '') + s; };
const sectorOf = c => seed?.templates.find(tp => tp.key === c?.nameKey)?.sector;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wWidth = () => worldWidth(state?.lots.length || 12);

function toast(msg) {
  const tEl = $('toast'); tEl.textContent = msg; tEl.style.display = 'block';
  clearTimeout(toast.timer); toast.timer = setTimeout(() => (tEl.style.display = 'none'), 3000);
}

// ---------- i18n ----------
async function loadLang(lng) {
  if (!i18next.hasResourceBundle(lng, 'translation')) i18next.addResourceBundle(lng, 'translation', await fetch(`/locales/${lng}.json`).then(r => r.json()));
  await i18next.changeLanguage(lng);
  try { localStorage.setItem('lang', lng); } catch { /* private mode */ }
  document.documentElement.lang = lng;
  document.title = t('ui.title');
  document.querySelectorAll('[data-i18n]').forEach(e => (e.textContent = t(e.dataset.i18n)));
  document.querySelectorAll('[data-i18n-ph]').forEach(e => (e.placeholder = t(e.dataset.i18nPh)));
  $('recAudio').textContent = '☁🔒 ' + t('ui.recAudio');
  $('recVideo').textContent = '☁🔒 ' + t('ui.recVideo');
  $('actBtn').textContent = '⬆ ' + t('ui.enter');
  $('hint').textContent = t(touch ? 'ui.moveHintTouch' : 'ui.moveHint');
  renderSeed(); renderRoomBar(); render(); updateAutoBtn();
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
function showTab(tab) {
  document.querySelectorAll('nav button').forEach(x => x.classList.toggle('active', x.dataset.tab === tab));
  $('side').classList.toggle('open', tab !== 'street');
  document.querySelectorAll('#side .card').forEach(c => c.classList.toggle('active', c.dataset.panel === tab));
  if (tab === 'finance') renderFinance(true);
}
document.querySelectorAll('nav button').forEach(b => b.onclick = () => (b.dataset.tab === 'menu' ? openDrawer(true) : showTab(b.dataset.tab)));
$('lang').onchange = e => loadLang(e.target.value);
$('recAudio').onclick = $('recVideo').onclick = () => toast(t('ui.premiumAlert', { feature: t('locked.mediaIdeas') }));

// ---------- Socket ----------
const socket = io();
socket.on('seed', s => { seed = s; renderSeed(); });
socket.on('state', s => {
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
  render();
});
socket.on('pos', ({ id, x, dir }) => { const o = others.get(id); if (o) { o.tx = x; o.dir = dir; } });
socket.on('toast', k => toast(t(k)));
socket.on('announce', msg => toast(`${t('ui.announce')}: ${msg}`));
socket.on('npcEvent', ({ cid, type }) => {
  const c = state?.companies[cid]; if (!c) return;
  const b = buildingOf(c.lotId == null ? { kind: 'plaza' } : { kind: 'lot', lotId: c.lotId });
  const emoji = { customer: '🛍', sponsor: '📣', investor: '💼', thief: '🦹', scammer: '🎭' }[type] || '⚠️';
  if (b) npcs.spawnVisitor(b.x + b.w / 2, emoji);
});
socket.on('joined', info => {
  joined = info;
  if (info.mode === 'multiplayer') history.replaceState(null, '', `?room=${encodeURIComponent(info.roomId)}`);
  closeModal(); renderRoomBar();
  $('advisor').hidden = false;
  setTimeout(() => ($('hint').style.display = 'none'), 10000);
});
socket.on('disconnect', () => { joined = null; state = null; spawned = false; others.clear(); setAuto(false); $('advisor').hidden = true; renderRoomBar(); render(); });

function renderRoomBar() {
  const show = joined?.mode === 'multiplayer';
  $('roomBar').style.display = show ? 'flex' : 'none';
  if (show) $('roomInfo').textContent = t('ui.roomInfo', { room: joined.roomId, pin: joined.pin });
}
$('copyLink').onclick = async () => {
  const link = `${location.origin}/?room=${encodeURIComponent(joined.roomId)}`;
  try { await navigator.clipboard.writeText(link); toast(t('ui.copied')); } catch { prompt(t('ui.copyLink'), link); }
};

// ---------- Mode selection ----------
function showModes() {
  if (joined) return toast(t('ui.roomInfo', { room: joined.roomId, pin: joined.pin || '—' }));
  const urlRoom = new URLSearchParams(location.search).get('room') || '';
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
    const create = el('button', t('ui.createRoom'));
    create.onclick = () => socket.emit('createRoom', { name: name.value });
    const rid = el('input'); rid.placeholder = t('ui.roomIdPh'); rid.value = urlRoom; rid.maxLength = 20;
    const pin = el('input'); pin.placeholder = t('ui.pinPh'); pin.inputMode = 'numeric'; pin.maxLength = 4; pin.pattern = '[0-9]*';
    const joinBtn = el('button', t('ui.joinRoom'), urlRoom ? 'primary' : '');
    joinBtn.onclick = () => socket.emit('joinRoom', { roomId: rid.value.trim(), pin: pin.value.trim(), name: name.value });
    if (urlRoom) joinBtn.dataset.default = '1';
    multi.append(create, rid, pin, joinBtn); body.append(multi);
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
  view.dpr = window.devicePixelRatio || 1;
  view.w = r.width; view.h = r.height;
  view.s = Math.min(view.h / WORLD_H, view.w / 480);
  view.ty = view.h - WORLD_H * view.s;
  cv.width = Math.round(view.w * view.dpr); cv.height = Math.round(view.h * view.dpr);
}
new ResizeObserver(resize).observe(stage);
const toWorld = (clientX, clientY) => {
  const r = cv.getBoundingClientRect();
  return { x: (clientX - r.left) / view.s + view.camX, y: (clientY - r.top - view.ty) / view.s };
};
const buildingAt = (x, y) => buildings.find(b => x >= b.x && x <= b.x + b.w && y >= GROUND - b.h && y <= GROUND + 30);
const buildingOf = target => buildings.find(b => (target.kind === 'plaza' ? b.kind === 'plaza' : b.kind === 'lot' && b.lot.id === target.lotId));

// ---------- Input: keyboard ----------
const KEYMAP = { a: 'left', arrowleft: 'left', d: 'right', arrowright: 'right' };
const typing = e => ['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName);
addEventListener('keydown', e => {
  if (modalOpen) {
    if (e.key === 'Escape' || (e.key.toLowerCase() === 's' && !typing(e))) { if (modalClosable) closeModal(); return; }
    if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.tagName !== 'BUTTON') {
      const def = $('modalBody').querySelector('[data-default]'); if (def) { e.preventDefault(); def.click(); }
    }
    return;
  }
  if (typing(e)) return;
  const k = e.key.toLowerCase();
  if (KEYMAP[k]) { keys.add(KEYMAP[k]); manualInput(); e.preventDefault(); }
  if (['w', 'arrowup', 'e'].includes(k) && near) { openBuilding(near); e.preventDefault(); }
  if (k === 'enter' && state) { acceptSuggestion(); e.preventDefault(); }
  if (k === 'n' && state) { nextSuggestion(); }
});
addEventListener('keyup', e => { const k = KEYMAP[e.key.toLowerCase()]; if (k) keys.delete(k); });
addEventListener('blur', () => keys.clear());

// ---------- Input: mouse / tap (walk to, open building) ----------
cv.addEventListener('pointerdown', e => {
  if (!state) return showModes();
  const p = toWorld(e.clientX, e.clientY), b = buildingAt(p.x, p.y);
  manualInput();
  if (b) walkTo(b.x + b.w / 2, () => openBuilding(b), b.id);
  else walkTo(p.x, null, null);
});
cv.addEventListener('pointermove', e => {
  if (touch) return;
  const p = toWorld(e.clientX, e.clientY);
  cv.style.cursor = buildingAt(p.x, p.y) ? 'pointer' : 'default';
});
function walkTo(x, onArrive, targetId) {
  player.target = clamp(x, 10, wWidth() - 10); player.onArrive = onArrive; player.targetId = targetId;
  if (near && targetId === near.id && onArrive) { player.target = null; player.targetId = null; onArrive(); }
}

// ---------- Input: joystick + action button (mobile) ----------
if (touch) { $('joy').hidden = false; }
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
$('actBtn').onclick = () => near && openBuilding(near);

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
setInterval(() => { if (auto && state && !plan && !modalOpen) acceptSuggestion(); }, AUTO_MS);

// ---------- Game loop ----------
let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  updatePlayer(dt, now);
  for (const o of others.values()) {
    const d = o.tx - o.x; o.moving = Math.abs(d) > 1;
    if (o.moving) { o.x += clamp(d, -SPEED * dt * 1.3, SPEED * dt * 1.3); o.phase += dt * 16; } else o.x = o.tx;
  }
  npcs.update(dt);
  const viewWorldW = view.w / view.s;
  const targetCam = clamp(player.x - viewWorldW / 2, 0, Math.max(0, wWidth() - viewWorldW));
  view.camX += (targetCam - view.camX) * Math.min(1, dt * 6);
  if (view.w) draw(ctx, {
    state, view, time: now, myId: myId(), player, others, npcs, buildings, near, targetId: player.targetId,
    t, name: companyName, sector: sectorOf, maxTenants: lot => maxTenants(seed, lot),
    tenants: lot => lot.companyIds.map(id => state.companies[id]).filter(Boolean),
    trend: list => list.reduce((s, c) => { const d = c.fin?.daily || []; return s + (d.length > 1 ? d.at(-1).cash - d.at(-2).cash : 0); }, 0),
    keyHint: touch ? null : `W ⬆ ${t('ui.enter')}`
  });
  requestAnimationFrame(frame);
}
function updatePlayer(dt, now) {
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
  $('actBtn').hidden = !(touch && near);
  if (state && Math.abs(player.x - lastSent.x) > 1 && now - lastSent.at > MOVE_SEND_MS) {
    lastSent = { x: player.x, at: now };
    socket.emit('move', { x: Math.round(player.x), dir: player.dir });
  }
}

// ---------- HUD (top bars) ----------
const curMonthKey = () => { const d = (state?.day || 0) + 1, y = Math.floor((d - 1) / 360) + 1, m = Math.floor(((d - 1) % 360) / 30) + 1; return `Y${y}-M${String(m).padStart(2, '0')}`; };
function myCompanies() {
  if (!state) return [];
  return Object.values(state.companies).filter(c => c.founders.includes(myId()) || c.employees.includes(myId()));
}
function finOf(list) {
  const key = curMonthKey(), sum = { cash: 0, todayRev: 0, dayExp: 0, monthRev: 0, monthExp: 0, units: 0, todayUnits: 0, bestUnits: 1, employees: 0, cap: 0 };
  for (const c of list) {
    const f = c.fin || {}, last = f.daily?.at(-1), m = f.monthly?.[key];
    sum.cash += c.cash; sum.todayRev += f.today?.revenue || 0;
    sum.dayExp += last ? last.expenses + last.losses : 0;
    sum.monthRev += (m?.revenue || 0) + (f.today?.revenue || 0);
    sum.monthExp += (m?.expenses || 0) + (m?.losses || 0) + (f.today?.losses || 0);
    sum.units += c.sales || 0; sum.todayUnits += f.today?.units || 0;
    sum.bestUnits = Math.max(sum.bestUnits, ...(f.daily || []).map(d => d.units || 0));
    sum.employees += c.employees.length; sum.cap += employeeCap(seed, state, c);
  }
  return sum;
}
function chip(icon, label, value, pct, cls) {
  const c = el('div', null, 'chip');
  const k = el('div', null, 'k'); k.append(el('span', `${icon} ${label}`)); c.append(k);
  const v = el('div', null, 'v'); if (typeof value === 'string') v.textContent = value; else v.append(...value); c.append(v);
  if (pct != null) { const b = el('div', null, 'bar'), i = el('i'); i.style.width = `${clamp(pct, 0, 1) * 100}%`; if (cls) i.style.background = cls; b.append(i); c.append(b); }
  return c;
}
const signed = (n, cls) => el('span', (n >= 0 ? '+' : '') + fmt(n), cls || (n >= 0 ? 'pos' : 'neg'));
function renderHud() {
  const p = me(), hud = $('hud');
  if (!p) return hud.replaceChildren();
  const owned = Object.values(state.companies).filter(c => c.founders.includes(myId()));
  const f = finOf(myCompanies()), fo = finOf(owned);
  const floors = floorsFor(fo.cash), next = 250 * 2 ** floors, prev = floors > 1 ? 250 * 2 ** (floors - 1) : 0;
  const s = p.stats, nextXp = 10 * s.level ** 2, prevXp = 10 * (s.level - 1) ** 2;
  hud.replaceChildren(
    chip('💰', t('hud.coins'), fmt(p.coins), p.coins / 2000),
    chip('🏦', t('hud.cash'), owned.length ? fmt(fo.cash) : '—', owned.length ? (floors >= MAX_FLOORS ? 1 : (fo.cash - prev) / (next - prev)) : 0, fo.cash < 0 ? 'var(--bad)' : null),
    chip('🛒', t('hud.customers'), f.units ? `${f.units} · ${t('hud.today')} ${f.todayUnits}` : '—', f.todayUnits / f.bestUnits),
    chip('👷', t('hud.employees'), f.cap ? `${f.employees}/${f.cap}` : '—', f.cap ? f.employees / f.cap : 0),
    chip('📈', t('hud.today'), [signed(f.todayRev), el('span', ' / '), signed(-f.dayExp)]),
    chip('📅', t('hud.month'), [signed(f.monthRev - f.monthExp)]),
    chip('⭐', `${t('ui.level')} ${s.level}`, `${Math.round(s.xp)} XP`, (s.xp - prevXp) / Math.max(1, nextXp - prevXp))
  );
}

// ---------- Finance panel (charts) ----------
const charts = {};
let finSel = null, finLast = 0;
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
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
function renderFinance(force) {
  const now = performance.now();
  clearTimeout(renderFinance.timer);
  if (!force && now - finLast < 700) { renderFinance.timer = setTimeout(() => renderFinance(true), 750); return; }
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
  const daily = (c.fin?.daily || []).slice(-30);
  document.querySelectorAll('#finBody figure').forEach(fg => fg.classList.toggle('empty', !daily.length));
  document.querySelectorAll('#finBody figure').forEach(fg => (fg.dataset.empty = t('fin.noHistory')));
  const dayLbl = daily.map(d => `${t('fin.dayShort')}${d.day}`);
  upsertChart('chCash', 'line', [...dayLbl, t('hud.today')], [{ label: t('fin.cash'), data: [...daily.map(d => d.cash), c.cash], borderColor: rev, backgroundColor: rev, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0.25 }], false);
  const last14 = daily.slice(-14);
  upsertChart('chDaily', 'bar', last14.map(d => `${t('fin.dayShort')}${d.day}`), [
    { label: t('fin.revenue'), data: last14.map(d => d.revenue), backgroundColor: rev, borderRadius: 4, maxBarThickness: 12 },
    { label: t('fin.expense'), data: last14.map(d => d.expenses + d.losses), backgroundColor: exp, borderRadius: 4, maxBarThickness: 12 }], true);
  const months = Object.values(c.fin?.monthly || {}).sort((a, b) => a.key.localeCompare(b.key)).slice(-6);
  upsertChart('chMonthly', 'bar', months.map(m => t('fin.monthShort', { y: m.year, m: m.month })), [
    { label: t('fin.revenue'), data: months.map(m => m.revenue), backgroundColor: rev, borderRadius: 4, maxBarThickness: 16 },
    { label: t('fin.expense'), data: months.map(m => m.expenses + m.losses), backgroundColor: exp, borderRadius: 4, maxBarThickness: 16 }], true);
  const head = el('tr'); [t('fin.period'), t('fin.revenue'), t('fin.expense'), t('fin.profit'), t('fin.cash')].forEach(h => head.append(el('th', h)));
  $('finTable').replaceChildren(head, ...months.map(m => {
    const tr = el('tr');
    [t('fin.monthShort', { y: m.year, m: m.month }), fmt(m.revenue), fmt(m.expenses + m.losses), fmt(m.revenue - m.expenses - m.losses), fmt(m.closingCash)].forEach(v => tr.append(el('td', v)));
    return tr;
  }));
}
$('finCompany').onchange = e => { finSel = e.target.value; Object.values(charts).forEach(ch => ch.destroy()); for (const k in charts) delete charts[k]; renderFinance(true); };

// ---------- Render DOM ----------
function render() {
  if (!i18next.isInitialized) return;
  $('day').textContent = state?.calendar ? t('ui.day', state.calendar) : '';
  renderProfile(me());
  renderHud();
  renderAdvisor();
  renderFinance();
  if (state) {
    const time = ts => new Date(ts).toLocaleTimeString(i18next.language, { hour: '2-digit', minute: '2-digit' });
    $('log').replaceChildren(...state.log.map(l => el('li', `${time(l.at)} · ${t(l.key, resolve(l.params))}`)));
    $('ideas').replaceChildren(...state.ideas.map(i => el('li', `${i.by}: ${i.text}`)));
  } else { $('log').replaceChildren(); $('ideas').replaceChildren(); $('hud').replaceChildren(); }
}
function renderProfile(p) {
  const box = $('profile'); box.replaceChildren();
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
function openModal(fill, { closable = true } = {}) {
  modalClosable = closable; modalOpen = true;
  const body = $('modalBody'); body.replaceChildren(); fill(body);
  if (closable) { const b = el('button', t('ui.close')); b.onclick = closeModal; body.append(b); }
  $('modal').style.display = 'flex';
  const def = body.querySelector('[data-default]');
  if (def && !touch && !body.querySelector('input:focus')) setTimeout(() => def.focus(), 30);
}
function closeModal() { $('modal').style.display = 'none'; modalOpen = false; }
$('modal').onclick = e => { if (e.target.id === 'modal' && modalClosable) closeModal(); };

const costLabel = (ws, lot) => {
  if (ws === 'shop') { const base = seed.lotSizes[lot.size].rent, n = lot.companyIds.length + 1; return Math.ceil(base / n) + Math.ceil(base * 0.3 / n); }
  return seed.workspaces[ws].rent + (seed.workspaces[ws].electricity || 0);
};
const depositLabel = (ws, lot) => (ws === 'shop' ? Math.ceil(seed.lotSizes[lot.size].rent / (lot.companyIds.length + 1)) * 5 : seed.workspaces[ws].deposit);

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
  const tplSel = el('select');
  seed.templates.forEach((tp, i) => tplSel.append(new Option(`${t(tp.key)} (${t(tp.sector)}, ${tp.price}c)`, i)));
  tplSel.value = String(rec?.action.payload.templateIdx ?? (lot ? lot.id % seed.templates.length : 0));
  const nm = el('input'); nm.placeholder = t('ui.companyNamePh'); nm.maxLength = 40;
  if (choices.length > 1) box.append(wsSel);
  box.append(info, tplSel, nm);
  const b = el('button', (isDefault ? '✓ ' : '') + t('ui.found'), 'primary');
  if (isDefault) b.dataset.default = '1';
  b.onclick = () => { socket.emit('found', { lotId: lot?.id ?? null, workspace: wsSel.value, name: nm.value, templateIdx: +tplSel.value }); closeModal(); };
  box.append(b);
  body.append(box);
}

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
  const save = el('button', t('ui.saveBenefits'));
  save.onclick = () => { socket.emit('setBenefits', { cid: c.id, benefits: Object.fromEntries(Object.entries(checks).map(([k, cb]) => [k, cb.checked])) }); closeModal(); };
  wrap.append(save); box.append(wrap);
}

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
  const lx = w - 2, ly = y(values.at(-1)); g.fillStyle = css('--series-1'); g.beginPath(); g.arc(lx, ly, 3, 0, Math.PI * 2); g.fill();
}

function companyBlock(body, c, isDefault) {
  const box = el('div', null, 'co');
  box.append(el('h4', `${companyName(c)} · ${t('ws.' + c.workspace)}`));
  box.append(el('p', t('ui.info', { price: c.price, cash: c.cash, founders: c.founders.length, employees: c.employees.length })));
  if (c.crisis && c.crisis.until > (state.day || 0)) {
    const mult = { concordat: 0.5, trustee: 0.3, govPressure: 0.7, politicalAttack: 0.6, war: 0.4, cyberAttack: 0.2 }[c.crisis.type];
    const w = el('p', t('ui.inCrisis', { crisis: t('crisis.' + c.crisis.type), mult })); w.style.color = 'var(--bad)'; box.append(w);
  }
  // Mini finance "properties" strip
  const f = finOf([c]), mini = el('div', null, 'mini');
  mini.append(kpi(t('fin.cash'), fmt(c.cash)), kpi(t('fin.revenueToday'), fmt(f.todayRev), css('--series-1')),
    kpi(t('fin.expenseDay'), fmt(f.dayExp), css('--series-2')), kpi(t('fin.monthNet'), (f.monthRev - f.monthExp >= 0 ? '+' : '') + fmt(f.monthRev - f.monthExp)));
  box.append(mini);
  const spark = el('canvas', null, 'spark'); spark.setAttribute('aria-label', t('ui.chartCash'));
  box.append(spark);
  requestAnimationFrame(() => sparkline(spark, [...(c.fin?.daily || []).slice(-30).map(d => d.cash), c.cash]));

  const { list, rec } = companyActions({ state, seed, myId: myId() }, c, ranked);
  const run = a => () => { socket.emit(a.ev, { cid: c.id, ...(a.payload || {}) }); closeModal(); };
  const top = list.find(a => a.recommended);
  if (top) {
    const r = el('div', null, 'rec');
    r.append(el('small', '⭐ ' + t('ui.recommended') + (rec ? ' · ' + t(rec.reasonKey, rec.params) : '')));
    const b = el('button', '✓ ' + t(top.key), 'primary'); b.onclick = run(top);
    if (isDefault) b.dataset.default = '1';
    r.append(b); box.append(r);
  }
  const rest = list.filter(a => !a.recommended);
  if (rest.length) {
    box.append(el('small', t('ui.otherOptions'), 'muted'));
    const row = el('div', null, 'others');
    rest.forEach(a => { const b = el('button', t(a.key)); b.onclick = run(a); row.append(b); });
    box.append(row);
  }
  if (c.founders.includes(myId())) benefitsEditor(box, c);
  body.append(box);
}

function openBuilding(b) {
  if (!state) return showModes();
  cancelPlan();
  const forThis = ranked.find(s => buildingOf(s.target)?.id === b.id);
  if (b.kind === 'guide') return openModal(body => { body.append(el('h3', t('ui.guide'))); seed.tutorial.forEach(k => body.append(el('p', t(k)))); });
  if (b.kind === 'locked') return toast(t('ui.premiumAlert', { feature: t('locked.skyscraper') }));
  if (b.kind === 'plaza') return openModal(body => {
    body.append(el('h3', t('ui.plazaTitle')));
    const list = Object.values(state.companies).filter(c => c.lotId == null);
    const foundRec = forThis?.action.ev === 'found' ? forThis : null;
    const defCid = foundRec ? null : (forThis?.cid || list[0]?.id);
    if (!list.length) body.append(el('p', t('ui.noVirtual'), 'muted'));
    list.forEach(c => companyBlock(body, c, c.id === defCid));
    foundForm(body, { choices: ['home', 'virtual', 'eoffice'], isDefault: !!foundRec || !list.length, rec: foundRec });
  });
  const lot = b.lot, tenants = lot.companyIds.map(id => state.companies[id]).filter(Boolean), max = maxTenants(seed, lot);
  openModal(body => {
    body.append(el('h3', lot.type === 'coworking' ? t('ws.coworking') : `${t('ws.shop')} (${lot.size} m²)`));
    body.append(el('p', t('ui.tenants', { n: tenants.length, max }), 'muted'));
    const foundRec = forThis?.action.ev === 'found' ? forThis : null;
    const defCid = foundRec ? null : (forThis?.cid || tenants[0]?.id);
    tenants.forEach(c => companyBlock(body, c, c.id === defCid));
    if (tenants.length < max) foundForm(body, { lot, choices: [lot.type], isDefault: !!foundRec || !tenants.length, rec: foundRec });
    else body.append(el('p', t('ui.full'), 'muted'));
  });
}

$('sendText').onclick = () => {
  const text = $('ideaText').value.trim();
  if (!text || !state) return;
  socket.emit('idea', { text }); $('ideaText').value = '';
};

// ---------- Boot ----------
(async () => {
  let saved = null;
  try { saved = localStorage.getItem('lang'); } catch { /* private mode */ }
  saved ||= navigator.language.startsWith('tr') ? 'tr' : 'en';
  await i18next.init({ lng: saved, fallbackLng: 'tr', resources: {} });
  $('lang').value = saved;
  await loadLang(saved);
  if (!matchMedia('(max-width:820px)').matches) document.querySelectorAll('#side .card').forEach(c => c.classList.add('active'));
  resize();
  requestAnimationFrame(frame);
  showModes();
})();
