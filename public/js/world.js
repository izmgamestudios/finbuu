// public/js/world.js
// Side-scrolling street renderer: layout, buildings with cutaway interiors, people and ambient NPCs.
// Everything here is client-side only (zero server cost).

export const WORLD_H = 540;
export const GROUND = 460; // building base line
export const FEET = 478;   // player walking line on the sidewalk
export const GUIDE = { x: 30, w: 160 };
export const PLAZA = { x: 225, w: 200 };
export const LOTS_X = 470, LOT_W = 200, LOT_GAP = 44;
const GROUND_H = 86, FLOOR_H = 48, ROOF_H = 12;
export const MAX_FLOORS = 6;

export const lotX = i => LOTS_X + i * (LOT_W + LOT_GAP);
export const worldWidth = lots => lotX(lots) + 460;
// Building height follows the tenants' finances: big cash = tall tower, losses = it shrinks.
// 1 floor < 250c, then one floor per doubling (500, 1k, 2k, 4k, 8k+).
export const floorsFor = cash => Math.max(1, Math.min(MAX_FLOORS, 1 + Math.floor(Math.log2(Math.max(1, cash) / 250))));
const heightOf = floors => GROUND_H + floors * FLOOR_H + ROOF_H;

export function layout(state) {
  const lots = state?.lots || [];
  const list = [
    { kind: 'guide', id: 'guide', seed: 901, x: GUIDE.x, w: GUIDE.w, h: heightOf(1) },
    { kind: 'plaza', id: 'plaza', seed: 902, x: PLAZA.x, w: PLAZA.w, h: heightOf(4) }
  ];
  lots.forEach(lot => {
    const cash = lot.companyIds.reduce((sum, id) => sum + (state.companies[id]?.cash || 0), 0);
    const floors = lot.companyIds.length ? floorsFor(cash) : 1;
    list.push({ kind: 'lot', id: 'lot' + lot.id, seed: lot.id + 1, lot, cash, floors, x: lotX(lot.id), w: LOT_W, h: heightOf(floors) });
  });
  list.push({ kind: 'locked', id: 'locked', seed: 903, x: lotX(lots.length || 12) + 20, w: 380, h: 320 });
  return list;
}

// Deterministic 0..1 hash so windows / balconies stay stable between frames.
export function hash(...nums) {
  let h = 2166136261;
  for (const n of nums) { h ^= Math.imul(n | 0, 2654435761) >>> 0; h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 13; h = Math.imul(h, 1274126177) >>> 0; h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const SKIN = ['#f1c7a5', '#e0ac83', '#c68c5d', '#8d5a3b', '#f6d7bf'];
const HAIR = ['#2b2118', '#5a3a22', '#a86b32', '#d9b26a', '#7a7a7a', '#1d1d1d'];
const SHIRT = ['#4f8ff7', '#ef6f6c', '#5cc08a', '#f2b84b', '#9b7be0', '#4cc3c9', '#f28fb1', '#8aa1b8'];
const PANTS = ['#34405a', '#4a4a4a', '#5b4a3a', '#2f5d7c'];
export const lookFor = n => {
  const k = Math.abs(n | 0);
  return { skin: SKIN[k % 5], hair: HAIR[(k * 7 + 3) % 6], shirt: SHIRT[(k * 3 + 1) % 8], pants: PANTS[(k * 5 + 2) % 4] };
};
const BODY = ['#e8c9a6', '#d9b48f', '#efd8bd', '#e3bfa0', '#d6c2a8', '#e9cfb0'];
const ROOF = ['#9c6b4e', '#8a5d44', '#a5785a'];
const SECTOR_GOODS = {
  'sector.food': ['#f2b84b', '#e57d5c', '#c9824a'],
  'sector.tech': ['#5aa9e6', '#8aa1b8', '#4f8ff7'],
  'sector.service': ['#9b7be0', '#8aa1b8', '#5cc08a'],
  'sector.retail': ['#ef6f6c', '#f2b84b', '#4cc3c9'],
  'sector.health': ['#5cc08a', '#ffffff', '#4cc3c9'],
  'sector.education': ['#4f8ff7', '#f2b84b', '#ef6f6c'],
  'sector.creative': ['#f28fb1', '#9b7be0', '#f2b84b']
};

// ---------- primitives ----------
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
function circle(ctx, x, y, r) { ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); }
function fitText(ctx, text, maxW) {
  if (ctx.measureText(text).width <= maxW) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxW) s = s.slice(0, -1);
  return s + '…';
}
function pill(ctx, x, y, text, bg, fg = '#fff', size = 10) {
  ctx.font = `600 ${size}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width + 12, h = size + 6;
  ctx.fillStyle = bg; rr(ctx, x - w / 2, y - h, w, h, h / 2); ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y - h / 2 + 0.5);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}
function bubble(ctx, x, y, emoji) {
  ctx.fillStyle = '#fff'; rr(ctx, x - 13, y - 24, 26, 22, 8); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - 4, y - 3); ctx.lineTo(x + 4, y - 3); ctx.lineTo(x, y + 3); ctx.fill();
  ctx.font = '14px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(emoji, x, y - 13); ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

// ---------- people ----------
export function drawPerson(ctx, x, feet, look, o = {}) {
  const s = o.scale || 1, dir = o.dir || 1, swing = o.moving ? Math.sin(o.phase || 0) * 3.5 : 0;
  ctx.save();
  ctx.translate(x, feet);
  ctx.scale(s * dir, s);
  ctx.fillStyle = 'rgba(0,0,0,.13)';
  ctx.beginPath(); ctx.ellipse(0, 0, 9, 2.5, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = look.pants;
  ctx.fillRect(-5 + swing, -13, 4, 13);
  ctx.fillRect(1 - swing, -13, 4, 13);
  ctx.fillStyle = look.shirt; rr(ctx, -7, -27, 14, 15, 4); ctx.fill();
  ctx.fillStyle = look.skin; ctx.fillRect(-1 - swing * 0.6, -24, 3, 9);
  circle(ctx, 0, -33, 6);
  ctx.fillStyle = look.hair;
  ctx.beginPath(); ctx.arc(0, -34, 6.3, Math.PI, 0); ctx.fill();
  ctx.fillRect(-6.3, -35, 3, 5);
  ctx.fillStyle = '#2a2a2a'; ctx.fillRect(2.6, -34, 1.4, 1.8);
  ctx.restore();
  if (o.label) pill(ctx, x, feet - 42 * s, o.label, o.mine ? '#2f6fe4' : 'rgba(35,40,55,.72)');
  if (o.mine) { ctx.fillStyle = '#2f6fe4'; ctx.beginPath(); ctx.moveTo(x - 4, feet - 64 * s); ctx.lineTo(x + 4, feet - 64 * s); ctx.lineTo(x, feet - 59 * s); ctx.fill(); }
  if (o.bubble) bubble(ctx, x, feet - (o.label ? 60 : 44) * s, o.bubble);
}
function silhouette(ctx, cx, bottom, look) {
  ctx.fillStyle = look.shirt; rr(ctx, cx - 8, bottom - 11, 16, 13, 5); ctx.fill();
  ctx.fillStyle = look.skin; circle(ctx, cx, bottom - 16, 5);
  ctx.fillStyle = look.hair; ctx.beginPath(); ctx.arc(cx, -0.5 + bottom - 16, 5.3, Math.PI, 0); ctx.fill();
}

// ---------- building parts ----------
function windowAt(ctx, x, y, w, h, occupant) {
  ctx.fillStyle = '#f7f4ee'; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = '#a9d8f2'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#f7f4ee'; ctx.fillRect(x + w / 2 - 1, y, 2, h);
  if (occupant) { ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); silhouette(ctx, x + w * 0.3, y + h, occupant); ctx.restore(); }
  ctx.fillStyle = 'rgba(255,255,255,.42)';
  ctx.beginPath(); ctx.moveTo(x + w * 0.12, y + h); ctx.lineTo(x + w * 0.42, y); ctx.lineTo(x + w * 0.56, y); ctx.lineTo(x + w * 0.26, y + h); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,.1)'; ctx.fillRect(x - 4, y + h + 2, w + 8, 3);
}
function glassDoor(ctx, x, y, w, h) {
  ctx.fillStyle = '#6b7080'; ctx.fillRect(x - 2, y - 2, w + 4, h + 2);
  ctx.fillStyle = '#b9def3'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = 'rgba(255,255,255,.45)';
  ctx.beginPath(); ctx.moveTo(x + 3, y + h); ctx.lineTo(x + w * 0.55, y); ctx.lineTo(x + w * 0.75, y); ctx.lineTo(x + w * 0.2, y + h); ctx.fill();
  ctx.fillStyle = '#e8e8e8'; ctx.fillRect(x + w - 7, y + h / 2 - 4, 3, 9);
}
function drawUpperFloors(ctx, b, floors, time) {
  const margin = (b.w - 3 * 40) / 4;
  for (let f = 0; f < floors; f++) {
    const fy = GROUND - GROUND_H - (f + 1) * FLOOR_H;
    const balcony = hash(b.seed, f, 7) < 0.4;
    for (let i = 0; i < 3; i++) {
      const wx = b.x + margin + i * (40 + margin);
      if (balcony && i === 1) continue;
      const slot = Math.floor(time / 9000 + hash(b.seed, f, i) * 7);
      const occ = !LOW && hash(b.seed, f, i, slot) < 0.3 ? lookFor(b.seed * 31 + f * 7 + i + slot) : null;
      windowAt(ctx, wx, fy + 9, 40, 30, occ);
    }
    if (balcony) {
      const wx = b.x + margin + (40 + margin), base = fy + 46;
      glassDoor(ctx, wx + 6, fy + 6, 28, 40);
      const slot = Math.floor(time / 12000 + hash(b.seed, f) * 5);
      if (!LOW && hash(b.seed, f, slot, 3) < 0.55) drawPerson(ctx, wx + 18, base, lookFor(b.seed * 13 + f + slot), { scale: 0.78, dir: hash(b.seed, slot) < 0.5 ? -1 : 1 });
      ctx.fillStyle = '#cfc6b8'; ctx.fillRect(wx - 12, base, 64, 4);
      ctx.fillStyle = '#7d828f';
      for (let px = wx - 11; px <= wx + 50; px += 7) ctx.fillRect(px, base - 13, 1.5, 13);
      ctx.fillRect(wx - 12, base - 14, 64, 2);
      ctx.fillStyle = '#b5704a'; ctx.fillRect(wx + 42, base - 8, 8, 8);
      ctx.fillStyle = '#6dbb6b'; circle(ctx, wx + 46, base - 12, 6);
    }
  }
}
function drawTerrace(ctx, b, time, accent) {
  const y = GROUND - b.h;
  const slot = Math.floor(time / 15000 + hash(b.seed, 5) * 4);
  ctx.fillStyle = '#7d828f'; ctx.fillRect(b.x + b.w - 70, y - 34, 2, 34);
  ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(b.x + b.w - 69, y - 32, 22, Math.PI, 0); ctx.fill();
  if (!LOW && hash(b.seed, slot, 9) < 0.6) drawPerson(ctx, b.x + b.w - 100, y, lookFor(b.seed * 17 + slot), { scale: 0.78, dir: 1 });
  ctx.fillStyle = '#7d828f';
  for (let px = b.x; px <= b.x + b.w; px += 9) ctx.fillRect(px, y - 12, 1.5, 12);
  ctx.fillRect(b.x, y - 13, b.w, 2);
}
function shell(ctx, b, body, roof) {
  const top = GROUND - b.h;
  ctx.fillStyle = body; ctx.fillRect(b.x, top + ROOF_H, b.w, b.h - ROOF_H);
  ctx.fillStyle = 'rgba(0,0,0,.06)'; ctx.fillRect(b.x + b.w - 8, top + ROOF_H, 8, b.h - ROOF_H);
  ctx.fillStyle = roof; ctx.fillRect(b.x - 6, top, b.w + 12, ROOF_H);
  ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.fillRect(b.x, GROUND - GROUND_H - 2, b.w, 3);
}
function signBoard(ctx, b, text, color, fg = '#fff') {
  const gy = GROUND - GROUND_H;
  ctx.fillStyle = color; rr(ctx, b.x + 8, gy + 4, b.w - 16, 22, 5); ctx.fill();
  ctx.font = '700 12px system-ui, sans-serif'; ctx.fillStyle = fg;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(fitText(ctx, text, b.w - 40), b.x + b.w / 2, gy + 15.5);
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}
function awning(ctx, b, color) {
  const y = GROUND - GROUND_H + 28, n = 10, sw = (b.w - 16) / n;
  for (let i = 0; i < n; i++) {
    ctx.fillStyle = i % 2 ? '#fdfbf7' : color;
    const sx = b.x + 8 + i * sw;
    ctx.fillRect(sx, y, sw, 7);
    ctx.beginPath(); ctx.arc(sx + sw / 2, y + 7, sw / 2, 0, Math.PI); ctx.fill();
  }
}

// Interior cutaway of the ground floor: back wall, goods, counter/desks and staff.
function interior(ctx, b, opts) {
  const gy = GROUND - GROUND_H, ix = b.x + 10, iy = gy + 40, iw = b.w - 20 - 38, ih = GROUND - iy;
  ctx.save(); ctx.beginPath(); ctx.rect(ix, iy, iw, ih); ctx.clip();
  ctx.fillStyle = opts.empty ? '#ececf0' : opts.wall || '#fbf3e4'; ctx.fillRect(ix, iy, iw, ih);
  ctx.fillStyle = opts.empty ? '#dcdce2' : '#e3cfb0'; ctx.fillRect(ix, GROUND - 6, iw, 6);
  if (opts.empty) {
    ctx.fillStyle = '#fff'; rr(ctx, ix + iw / 2 - 34, iy + 8, 68, 22, 4); ctx.fill();
    ctx.fillStyle = '#c0453f'; ctx.font = '700 10px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(fitText(ctx, opts.forRent, 62), ix + iw / 2, iy + 23); ctx.textAlign = 'left';
  } else if (opts.desks) {
    const n = 3, step = iw / n;
    opts.staff.slice(0, n).forEach((look, k) => drawPerson(ctx, ix + step * k + step / 2 - 4, GROUND - 6, look, { scale: 0.78, dir: 1 }));
    for (let k = 0; k < n; k++) {
      const dx = ix + step * k + 6;
      ctx.fillStyle = '#c9a27a'; ctx.fillRect(dx, GROUND - 22, step - 12, 4);
      ctx.fillStyle = '#9a7656'; ctx.fillRect(dx + 3, GROUND - 18, 3, 12); ctx.fillRect(dx + step - 21, GROUND - 18, 3, 12);
      ctx.fillStyle = '#3d4252'; ctx.fillRect(dx + step / 2 - 2, GROUND - 31, 14, 9);
      ctx.fillStyle = '#7fc3f0'; ctx.fillRect(dx + step / 2 - 1, GROUND - 30, 12, 7);
    }
  } else {
    const goods = opts.goods || SECTOR_GOODS['sector.retail'];
    for (let r = 0; r < 2; r++) {
      const sy = iy + 6 + r * 14;
      ctx.fillStyle = '#c9a27a'; ctx.fillRect(ix + 4, sy + 9, iw - 8, 2);
      for (let k = 0; k < Math.floor((iw - 10) / 9); k++) { ctx.fillStyle = goods[(k + r) % goods.length]; ctx.fillRect(ix + 6 + k * 9, sy + 1, 6, 8); }
    }
    const staff = opts.staff.slice(0, 3), step = (iw - 30) / Math.max(1, staff.length);
    staff.forEach((look, k) => drawPerson(ctx, ix + 22 + k * step, GROUND - 6, look, { scale: 0.8, dir: 1 }));
    ctx.fillStyle = '#b07a4f'; ctx.fillRect(ix + 6, GROUND - 22, iw - 12, 16);
    ctx.fillStyle = '#c9946a'; ctx.fillRect(ix + 4, GROUND - 24, iw - 8, 4);
  }
  ctx.fillStyle = 'rgba(190,225,250,.16)'; ctx.fillRect(ix, iy, iw, ih);
  ctx.fillStyle = 'rgba(255,255,255,.28)';
  ctx.beginPath(); ctx.moveTo(ix + 10, GROUND); ctx.lineTo(ix + 50, iy); ctx.lineTo(ix + 64, iy); ctx.lineTo(ix + 24, GROUND); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#6b7080'; ctx.lineWidth = 3; ctx.strokeRect(ix, iy, iw, ih);
  glassDoor(ctx, b.x + b.w - 42, GROUND - 50, 30, 50);
}

function drawLot(ctx, b, env) {
  const { lot } = b, tenants = env.tenants(lot), me = env.myId;
  const mine = tenants.some(c => c.founders.includes(me) || c.employees.includes(me));
  const npc = tenants.some(c => c.isNpc);
  const color = !tenants.length ? '#a9adb8' : mine ? '#f2b84b' : npc ? '#9b7be0' : '#3fa36b';
  shell(ctx, b, BODY[b.seed % BODY.length], ROOF[b.seed % ROOF.length]);
  const visibleFloors = Math.max(0, Math.floor((b.h - GROUND_H - ROOF_H) / FLOOR_H + 0.05));
  drawUpperFloors(ctx, b, visibleFloors, env.time);
  if (hash(b.seed, 3) < 0.5) drawTerrace(ctx, b, env.time, color);
  if (tenants.length) {
    const trend = env.trend(tenants);
    const k = Math.abs(b.cash) >= 1000 ? (b.cash / 1000).toFixed(1) + 'k' : String(Math.round(b.cash));
    pill(ctx, b.x + 36, GROUND - b.h - (hash(b.seed, 3) < 0.5 ? 16 : 4), `💰 ${k} ${trend > 0 ? '▲' : trend < 0 ? '▼' : '•'}`,
      b.cash < 0 ? '#c0453f' : 'rgba(35,40,55,.72)', '#fff', 10);
  }
  const label = lot.type === 'coworking' && !tenants.length ? env.t('ui.coworkingSign')
    : tenants.length ? env.name(tenants[0]) + (tenants.length > 1 ? ` +${tenants.length - 1}` : '') : `${lot.size} m²`;
  signBoard(ctx, b, label, color, mine ? '#3a2a05' : '#fff');
  const rank = env.ranks?.get(lot.id);
  if (rank) pill(ctx, b.x + 24, GROUND - GROUND_H + 2, `#${rank}`, rank === 1 ? '#c98500' : '#2f6fe4', '#fff', 11);
  if (tenants.some(c => c.marketing && c.marketing.until > (env.state.day || 0))) { ctx.font = '12px system-ui'; ctx.fillText('📣', b.x + b.w - 52, GROUND - GROUND_H + 20); }
  if (lot.type === 'shop') awning(ctx, b, color);
  const staff = [];
  tenants.forEach(c => {
    const ids = [...c.founders, ...c.employees];
    ids.forEach(id => staff.push(lookFor(env.state.players[id]?.avatar ?? hash(id.length, 5) * 1000)));
    if (c.isNpc) staff.push(lookFor(b.seed * 7 + 3));
    for (let k = 0; k < Math.min(3, c.npcStaff || 0); k++) staff.push(lookFor(b.seed * 11 + k * 5));
  });
  interior(ctx, b, { empty: !tenants.length, forRent: env.t('ui.forRent'), desks: lot.type === 'coworking' || tenants[0]?.workspace === 'coworking',
    staff, goods: SECTOR_GOODS[env.sector(tenants[0])] });
  const gy = GROUND - GROUND_H;
  ctx.font = '12px system-ui, sans-serif';
  if (tenants.some(c => c.crisis && c.crisis.until > (env.state.day || 0))) ctx.fillText('⚠️', b.x + b.w - 30, gy + 20);
  if (mine) ctx.fillText('⭐', b.x + 14, gy + 20);
  const max = env.maxTenants(lot);
  if (tenants.length && tenants.length < max) pill(ctx, b.x + b.w - 26, gy - 4, `${tenants.length}/${max}`, 'rgba(35,40,55,.6)', '#fff', 9);
}

function drawGuide(ctx, b, env) {
  shell(ctx, b, '#f6d77a', '#c99a3c');
  drawUpperFloors(ctx, b, 1, env.time);
  signBoard(ctx, b, env.t('ui.guideSign'), '#d89a1c');
  const books = ['#ef6f6c', '#4f8ff7', '#5cc08a', '#9b7be0', '#f2b84b'];
  interior(ctx, b, { empty: false, staff: [lookFor(42)], goods: books, wall: '#fff6dc' });
  bubble(ctx, b.x + 32, GROUND - 52, '❓');
}
function drawPlaza(ctx, b, env) {
  const top = GROUND - b.h;
  ctx.fillStyle = '#8fc1e8'; ctx.fillRect(b.x, top + ROOF_H, b.w, b.h - ROOF_H);
  ctx.fillStyle = '#5f8fb8'; ctx.fillRect(b.x - 4, top, b.w + 8, ROOF_H);
  ctx.fillStyle = '#7d828f'; ctx.fillRect(b.x + b.w / 2 - 1, top - 40, 2, 40);
  ctx.fillStyle = '#ef6f6c'; circle(ctx, b.x + b.w / 2, top - 41, 3);
  const cols = 8, cw = b.w / cols;
  for (let f = 0; f < 4; f++) {
    const fy = top + ROOF_H + f * FLOOR_H;
    for (let i = 0; i < cols; i++) {
      const slot = Math.floor(env.time / 10000 + hash(b.seed, f, i) * 6);
      ctx.fillStyle = (i + f) % 3 ? '#b6dcf5' : '#a3d0ee';
      ctx.fillRect(b.x + i * cw + 2, fy + 4, cw - 4, FLOOR_H - 8);
      if (!LOW && hash(b.seed, f, i, slot) < 0.18) { ctx.save(); ctx.beginPath(); ctx.rect(b.x + i * cw + 2, fy + 4, cw - 4, FLOOR_H - 8); ctx.clip(); silhouette(ctx, b.x + i * cw + cw / 2, fy + FLOOR_H - 4, lookFor(f * 11 + i + slot)); ctx.restore(); }
    }
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(b.x, fy + FLOOR_H - 3, b.w, 2);
  }
  const virtual = Object.values(env.state?.companies || {}).filter(c => c.lotId == null);
  signBoard(ctx, b, env.t('ui.plaza'), '#3b82c4');
  const staff = virtual.flatMap(c => c.founders).map(id => lookFor(env.state.players[id]?.avatar ?? 7));
  interior(ctx, b, { empty: false, desks: true, staff: staff.length ? staff : [lookFor(77)], wall: '#eef6fd' });
  if (virtual.length) pill(ctx, b.x + b.w - 30, GROUND - GROUND_H - 4, `🏢 ${virtual.length}`, 'rgba(35,40,55,.6)', '#fff', 9);
}
function drawLocked(ctx, b, env) {
  ctx.save();
  ctx.globalAlpha = 0.45;
  [[0, 120, 300], [140, 110, 240], [260, 110, 320]].forEach(([dx, w, h]) => {
    ctx.fillStyle = '#8aa1b8'; ctx.fillRect(b.x + dx, GROUND - h, w, h);
    ctx.fillStyle = '#c9dcef';
    for (let y = GROUND - h + 12; y < GROUND - 20; y += 22) for (let x = b.x + dx + 10; x < b.x + dx + w - 14; x += 20) ctx.fillRect(x, y, 12, 12);
  });
  ctx.restore();
  pill(ctx, b.x + b.w / 2, GROUND - 140, env.t('ui.lockedDistrict'), 'rgba(35,40,55,.78)', '#fff', 12);
}

// ---------- scenery ----------
function drawSky(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#8ec5f5'); g.addColorStop(1, '#dff0fc');
  ctx.fillStyle = g; ctx.fillRect(0, 0, w, h);
}
function drawBackdrop(ctx, camX, viewW, wWidth) {
  for (let i = 0; i < (LOW ? 0 : 14); i++) {
    const p = 0.2, cx = i * 420 + 120 + camX * (1 - p), cy = 40 + hash(i, 1) * 90;
    if (cx < camX - 120 || cx > camX + viewW + 120) continue;
    ctx.fillStyle = 'rgba(255,255,255,.85)';
    circle(ctx, cx, cy, 18); circle(ctx, cx + 20, cy - 8, 22); circle(ctx, cx + 44, cy, 16);
    ctx.fillRect(cx, cy, 44, 14);
  }
  const p = 0.45;
  for (let i = 0, x = -200; x < wWidth + 400; i++) {
    const w = 50 + hash(i, 2) * 70, h = 110 + hash(i, 3) * 170, bx = x + camX * (1 - p);
    x += w + 6;
    if (bx + w < camX || bx > camX + viewW) continue;
    ctx.fillStyle = i % 3 ? '#b5d3ee' : '#a8c9e8';
    ctx.fillRect(bx, GROUND - h, w, h);
  }
}
function drawStreet(ctx, camX, viewW) {
  const x0 = camX - 20, w = viewW + 40;
  ctx.fillStyle = '#dcdde2'; ctx.fillRect(x0, GROUND, w, 24);
  ctx.fillStyle = 'rgba(0,0,0,.05)';
  for (let x = Math.floor(x0 / 40) * 40; x < x0 + w; x += 40) ctx.fillRect(x, GROUND, 1.5, 24);
  ctx.fillStyle = '#b9bbc3'; ctx.fillRect(x0, GROUND + 24, w, 4);
  ctx.fillStyle = '#50545f'; ctx.fillRect(x0, GROUND + 28, w, WORLD_H - GROUND + 200);
  ctx.fillStyle = 'rgba(255,255,255,.75)';
  for (let x = Math.floor(x0 / 70) * 70; x < x0 + w; x += 70) ctx.fillRect(x, GROUND + 52, 36, 4);
}
function drawTree(ctx, x) {
  ctx.fillStyle = '#8a5a3c'; ctx.fillRect(x - 3, FEET - 34, 6, 34);
  ctx.fillStyle = '#68b866'; circle(ctx, x, FEET - 44, 16);
  ctx.fillStyle = '#7ccf7a'; circle(ctx, x - 9, FEET - 38, 11); circle(ctx, x + 8, FEET - 50, 11);
}
function drawLamp(ctx, x) {
  ctx.fillStyle = '#6b7080'; ctx.fillRect(x - 1.5, FEET - 86, 3, 86);
  ctx.fillRect(x - 1.5, FEET - 86, 14, 3);
  ctx.fillStyle = '#ffe9a8'; rr(ctx, x + 8, FEET - 84, 10, 6, 3); ctx.fill();
}

// ---------- ambient NPCs ----------
// Each street NPC has a stable identity (ID card) derived from its id.
const FIRST = ['Ayşe', 'Mehmet', 'Elif', 'Can', 'Zeynep', 'Burak', 'Deniz', 'Ece', 'Emre', 'Selin', 'Kerem', 'Derya', 'Mert', 'Naz', 'Ozan', 'Pelin'];
const LAST = ['Yılmaz', 'Kaya', 'Demir', 'Şahin', 'Çelik', 'Aydın', 'Arslan', 'Doğan', 'Koç', 'Kurt', 'Özdemir', 'Polat'];
const JOBS = ['engineer', 'teacher', 'designer', 'student', 'retired', 'developer', 'chef', 'accountant', 'nurse', 'marketer', 'recruiter', 'freelancer'];
const TRAITS = ['friendly', 'curious', 'thrifty', 'ambitious', 'calm', 'picky'];
const INTERESTS = ['sector.food', 'sector.tech', 'sector.service', 'sector.retail', 'sector.health', 'sector.education', 'sector.creative'];
export function npcProfile(id) {
  const r = k => hash(id, k);
  return {
    id, look: lookFor(100 + id * 13),
    name: `${FIRST[Math.floor(r(1) * FIRST.length)]} ${LAST[Math.floor(r(2) * LAST.length)]}`,
    age: 19 + Math.floor(r(3) * 50), job: JOBS[Math.floor(r(4) * JOBS.length)], trait: TRAITS[Math.floor(r(5) * TRAITS.length)],
    interest: INTERESTS[Math.floor(r(6) * INTERESTS.length)], budget: 10 + Math.floor(r(7) * 19) * 10,
    idNo: String(100000 + Math.floor(r(8) * 899999))
  };
}

export function createNpcs(count = 7) {
  const walkers = [], visitors = [];
  let width = 3400;
  for (let i = 0; i < count; i++) walkers.push({ id: i, profile: npcProfile(i), x: 200 + Math.random() * (width - 400), dir: Math.random() < 0.5 ? -1 : 1,
    speed: 18 + Math.random() * 22, look: lookFor(100 + i * 13), phase: Math.random() * 6, pause: 0, talking: false, lane: FEET - 6 + Math.random() * 10 });
  return {
    walkers, visitors,
    setWidth(w) { width = w; },
    spawnVisitor(tx, emoji) {
      if (visitors.length >= 3) visitors.shift();
      const side = Math.random() < 0.5 ? -1 : 1;
      visitors.push({ x: tx + side * 260, tx, dir: -side, speed: 80, look: lookFor(Math.floor(Math.random() * 900)), phase: 0, emoji, stay: 3, lane: FEET - 2 });
    },
    at(x, y) { return walkers.find(w => Math.abs(w.x - x) < 13 && y > w.lane - 42 && y < w.lane + 6) || null; },
    nearest(x, max = 26) { let best = null, d = max; for (const w of walkers) { const dd = Math.abs(w.x - x); if (dd < d) { d = dd; best = w; } } return best; },
    update(dt, limit = 99) {
      for (const w of walkers.slice(0, limit)) {
        if (w.talking) continue;
        if (w.pause > 0) { w.pause -= dt; continue; }
        w.x += w.dir * w.speed * dt; w.phase += dt * w.speed * 0.32;
        if (w.x < 20) w.dir = 1; else if (w.x > width - 20) w.dir = -1;
        if (Math.random() < dt * 0.08) w.pause = 1.5 + Math.random() * 3; // window shopping
        else if (Math.random() < dt * 0.03) w.dir *= -1;
      }
      for (let i = visitors.length - 1; i >= 0; i--) {
        const v = visitors[i], d = v.tx - v.x;
        if (Math.abs(d) > 3) { v.dir = Math.sign(d); v.x += v.dir * v.speed * dt; v.phase += dt * 20; }
        else if ((v.stay -= dt) <= 0) visitors.splice(i, 1);
      }
    }
  };
}

// ---------- main draw ----------
const heightAnim = new Map(); // building id -> animated height (grow / shrink smoothly)
let LOW = false;             // low-quality mode (set per frame by the adaptive quality controller)
// env: { state, view:{w,h,s,ty,camX,dpr}, time, myId, player, others, npcs, buildings, near, targetId, t, name, sector, maxTenants, tenants, keyHint }
export function draw(ctx, env) {
  const { view } = env, { w, h, s, ty, camX, dpr } = view, viewWorldW = w / s;
  LOW = !!env.low;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawSky(ctx, w, h);
  ctx.setTransform(dpr * s, 0, 0, dpr * s, -camX * dpr * s, ty * dpr);
  const wWidth = env.buildings.length ? env.buildings[env.buildings.length - 1].x + 460 : 3400;
  drawBackdrop(ctx, camX, viewWorldW, wWidth);
  drawStreet(ctx, camX, viewWorldW);
  for (const target of env.buildings) {
    const prev = heightAnim.get(target.id) ?? target.h;
    const hNow = Math.abs(target.h - prev) < 0.5 ? target.h : prev + (target.h - prev) * 0.06;
    heightAnim.set(target.id, hNow);
    const b = hNow === target.h ? target : { ...target, h: hNow };
    if (b.x > camX + viewWorldW + 60 || b.x + b.w < camX - 60) continue;
    if (b.kind === 'guide') drawGuide(ctx, b, env);
    else if (b.kind === 'plaza') drawPlaza(ctx, b, env);
    else if (b.kind === 'lot') drawLot(ctx, b, env);
    else drawLocked(ctx, b, env);
    if (env.near?.id === b.id) { ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.lineWidth = 3; rr(ctx, b.x - 3, GROUND - b.h - 3, b.w + 6, b.h + 3, 6); ctx.stroke(); }
    if (env.targetId === b.id) {
      const by = GROUND - b.h - 22 + Math.sin(env.time / 180) * 4;
      ctx.fillStyle = '#2f6fe4'; ctx.beginPath(); ctx.moveTo(b.x + b.w / 2 - 9, by); ctx.lineTo(b.x + b.w / 2 + 9, by); ctx.lineTo(b.x + b.w / 2, by + 11); ctx.fill();
    }
  }
  // trees & lamps in the gaps between buildings
  for (let i = 0; i < env.buildings.length - 1; i++) {
    const b = env.buildings[i], gx = b.x + b.w + (env.buildings[i + 1].x - b.x - b.w) / 2;
    if (gx < camX - 40 || gx > camX + viewWorldW + 40) continue;
    if (i % 2) drawLamp(ctx, gx); else drawTree(ctx, gx);
  }
  // people, sorted by depth
  const people = [];
  for (const n of env.npcs.walkers.slice(0, env.npcLimit ?? 99)) people.push({ x: n.x, y: n.lane, look: n.look, o: { dir: n.dir, moving: n.pause <= 0 && !n.talking, phase: n.phase, scale: 0.92,
    bubble: env.nearNpc === n ? '💬' : null, label: env.met?.has(n.id) ? n.profile.name.split(' ')[0] : null } });
  for (const v of env.npcs.visitors) people.push({ x: v.x, y: v.lane, look: v.look, o: { dir: v.dir, moving: Math.abs(v.tx - v.x) > 3, phase: v.phase, bubble: v.emoji, scale: 0.92 } });
  for (const [id, o] of env.others) {
    const p = env.state?.players[id]; if (!p) continue;
    people.push({ x: o.x, y: FEET + 2, look: lookFor(p.avatar ?? 0), o: { dir: o.dir, moving: o.moving, phase: o.phase, label: p.name } });
  }
  const meP = env.state?.players[env.myId];
  if (meP && !env.hideMe) people.push({ x: env.player.x, y: FEET + 4, look: lookFor(meP.avatar ?? 0), o: { dir: env.player.dir, moving: env.player.moving, phase: env.player.phase, label: meP.name, mine: true } });
  people.sort((a, b) => a.y - b.y);
  for (const p of people) {
    if (p.x < camX - 40 || p.x > camX + viewWorldW + 40) continue;
    drawPerson(ctx, p.x, p.y, p.look, p.o);
  }
  if (meP && env.keyHint && (env.near || env.nearNpc)) pill(ctx, env.player.x, FEET - 70, env.keyHint, '#2f6fe4', '#fff', 11);
}
