// public/js/world.js
// Side-scrolling street renderer: layout, buildings with cutaway interiors, people and ambient NPCs.
// Everything here is client-side only (zero server cost).

import { drawAd } from './ads.js';

export const WORLD_H = 540;
export const GROUND = 460; // building base line
export const FEET = 478;   // player walking line on the sidewalk
// The street starts with the player's home; everything else is shifted right by 250 (server mirrors: SPAWN_X, busStops, terminalX, WORLD_MAX_X)
export const HOME = { x: 30, w: 190 };
export const GUIDE = { x: 280, w: 160 };
export const PLAZA = { x: 475, w: 200 };
export const LOTS_X = 720, LOT_W = 200, LOT_GAP = 44;
const GROUND_H = 86, FLOOR_H = 48, ROOF_H = 12;
export const MAX_FLOORS = 6;

export const lotX = i => LOTS_X + i * (LOT_W + LOT_GAP);
export const worldWidth = lots => lotX(lots) + 1700; // car park and bus terminal at the end of the street
// Building height follows the tenants' finances: big cash = tall tower, losses = it shrinks.
// 1 floor < 250c, then one floor per doubling (500, 1k, 2k, 4k, 8k+).
export const floorsFor = cash => Math.max(1, Math.min(MAX_FLOORS, 1 + Math.floor(Math.log2(Math.max(1, cash) / 250))));
const heightOf = floors => GROUND_H + floors * FLOOR_H + ROOF_H;

export function layout(state) {
  const lots = state?.lots || [];
  const list = [
    { kind: 'home', id: 'home', seed: 900, x: HOME.x, w: HOME.w, h: 150 },
    { kind: 'guide', id: 'guide', seed: 901, x: GUIDE.x, w: GUIDE.w, h: heightOf(1) },
    { kind: 'plaza', id: 'plaza', seed: 902, x: PLAZA.x, w: PLAZA.w, h: heightOf(4) }
  ];
  lots.forEach(lot => {
    const cash = lot.companyIds.reduce((sum, id) => sum + (state.companies[id]?.cash || 0), 0);
    const floors = lot.companyIds.length ? floorsFor(cash) : 1;
    list.push({ kind: 'lot', id: 'lot' + lot.id, seed: lot.id + 1, lot, cash, floors, x: lotX(lot.id), w: LOT_W, h: heightOf(floors) });
  });
  list.push({ kind: 'demoday', id: 'demoday', seed: 904, x: lotX(lots.length || 12) + 10, w: 360, h: heightOf(3) });
  list.push({ kind: 'locked', id: 'locked', seed: 903, x: lotX(lots.length || 12) + 410, w: 380, h: 320 });
  list.push({ kind: 'parking', id: 'parking', seed: 905, x: lotX(lots.length || 12) + 830, w: 380, h: 70 });
  list.push({ kind: 'terminal', id: 'terminal', seed: 906, x: lotX(lots.length || 12) + 1250, w: 380, h: 120 });
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
// NPCs: muted / earthy outfits + always a hat (and often glasses) so they never look like real players.
const NPC_SHIRT = ['#8d7b68', '#a3b18a', '#b5838d', '#6d6875', '#9c6644', '#7f8c8d', '#bc8a5f', '#6b705c'];
const HAT = ['#3d405b', '#81b29a', '#e07a5f', '#5f0f40', '#264653', '#bc6c25'];
export const npcLook = n => {
  const k = Math.abs(n | 0), base = lookFor(k);
  return { ...base, shirt: NPC_SHIRT[(k * 5 + 1) % NPC_SHIRT.length], pants: '#5b5146', npc: true,
    hat: k % 3, hatColor: HAT[(k * 7) % HAT.length], glasses: k % 2 === 0 };
};
// Team uniform: same shirt colour for every member + a white chest stripe
export const teamLook = (look, color) => (color ? { ...look, shirt: color, team: color } : look);
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

// Speech bubble above a head: word-wrapped, max 3 lines
function speech(ctx, x, y, text) {
  ctx.font = '12px system-ui, sans-serif';
  const words = String(text).split(/\s+/), lines = []; let cur = '';
  for (const wd of words) { const next = cur ? cur + ' ' + wd : wd; if (ctx.measureText(next).width > 150 && cur) { lines.push(cur); cur = wd; } else cur = next; }
  if (cur) lines.push(cur);
  const shown = lines.slice(0, 3); if (lines.length > 3) shown[2] = shown[2].replace(/.{0,2}$/, '…');
  const bw = Math.min(160, Math.max(...shown.map(l => ctx.measureText(l).width)) + 16), bh = shown.length * 15 + 10;
  ctx.fillStyle = '#fff'; rr(ctx, x - bw / 2, y - bh, bw, bh, 9); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x - 5, y - 1); ctx.lineTo(x + 5, y - 1); ctx.lineTo(x, y + 6); ctx.fill();
  ctx.fillStyle = '#222'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  shown.forEach((l, i) => ctx.fillText(l, x, y - bh + 5 + 7.5 + i * 15));
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
}

const sayOf = (env, id) => { const b = env.bubbles?.get(id); if (!b || b.until < env.time) return {}; return b.text ? { say: b.text } : { bubble: b.emoji }; };

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
  if (look.team) { ctx.fillStyle = 'rgba(255,255,255,.85)'; ctx.fillRect(-7, -22, 14, 2.5); }
  if (look.npc) {
    ctx.fillStyle = look.hatColor;
    if (look.hat === 0) { ctx.beginPath(); ctx.arc(0, -37, 6.6, Math.PI, 0); ctx.fill(); ctx.fillRect(0, -38, 10, 2.4); }        // cap
    else if (look.hat === 1) { ctx.beginPath(); ctx.arc(0, -36, 7, Math.PI, 0); ctx.fill(); ctx.fillRect(-7, -37, 14, 3); }        // beanie
    else { ctx.fillRect(-9, -38, 18, 2.4); ctx.fillRect(-5, -44, 10, 6); }                                                       // fedora
    if (look.glasses) { ctx.strokeStyle = '#222'; ctx.lineWidth = 1.1; ctx.strokeRect(1.2, -35.4, 4.2, 3); ctx.beginPath(); ctx.moveTo(-3, -34); ctx.lineTo(1.2, -34); ctx.stroke(); }
  }
  ctx.restore();
  if (o.label) pill(ctx, x, feet - (look.npc ? 50 : 42) * s, o.label, look.team || (o.mine ? '#2f6fe4' : look.npc ? 'rgba(110,100,90,.75)' : 'rgba(35,40,55,.72)'));
  if (o.mine) { ctx.fillStyle = '#2f6fe4'; ctx.beginPath(); ctx.moveTo(x - 4, feet - 64 * s); ctx.lineTo(x + 4, feet - 64 * s); ctx.lineTo(x, feet - 59 * s); ctx.fill(); }
  if (o.bubble && !o.say) bubble(ctx, x, feet - (o.label ? 60 : 44) * s, o.bubble);
  if (o.say) speech(ctx, x, feet - (o.label ? 62 : 46) * s, o.say);
}
function silhouette(ctx, cx, bottom, look) {
  ctx.fillStyle = look.shirt; rr(ctx, cx - 8, bottom - 11, 16, 13, 5); ctx.fill();
  ctx.fillStyle = look.skin; circle(ctx, cx, bottom - 16, 5);
  ctx.fillStyle = look.npc ? look.hatColor : look.hair; ctx.beginPath(); ctx.arc(cx, -0.5 + bottom - 16, 5.3, Math.PI, 0); ctx.fill();
  if (look.npc) ctx.fillRect(cx, bottom - 18, 7, 1.6);
}

// ---------- building parts ----------
function windowAt(ctx, x, y, w, h, occupant) {
  ctx.fillStyle = '#f7f4ee'; ctx.fillRect(x - 2, y - 2, w + 4, h + 4);
  ctx.fillStyle = NIGHT > 0.5 ? '#ffe2a0' : '#a9d8f2'; ctx.fillRect(x, y, w, h);
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
      const occ = !LOW && hash(b.seed, f, i, slot) < 0.3 ? npcLook(b.seed * 31 + f * 7 + i + slot) : null;
      windowAt(ctx, wx, fy + 9, 40, 30, occ);
    }
    if (balcony) {
      const wx = b.x + margin + (40 + margin), base = fy + 46;
      glassDoor(ctx, wx + 6, fy + 6, 28, 40);
      const slot = Math.floor(time / 12000 + hash(b.seed, f) * 5);
      if (!LOW && hash(b.seed, f, slot, 3) < 0.55) drawPerson(ctx, wx + 18, base, npcLook(b.seed * 13 + f + slot), { scale: 0.78, dir: hash(b.seed, slot) < 0.5 ? -1 : 1 });
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
  if (!LOW && hash(b.seed, slot, 9) < 0.6) drawPerson(ctx, b.x + b.w - 100, y, npcLook(b.seed * 17 + slot), { scale: 0.78, dir: 1 });
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
  const wallAd = env.ads?.['wall:' + lot.id]?.live, roofAd = env.ads?.['roof:' + lot.id]?.live;
  if (wallAd) drawAd(ctx, 'wall', wallAd, b.x + 25, GROUND - b.h + ROOF_H + 4, 150, 40);
  if (roofAd) { // sign standing on the roof
    const rx = b.x + b.w - 118, ry = GROUND - b.h - 44;
    ctx.fillStyle = '#4b5563'; ctx.fillRect(rx + 14, ry + 38, 3, 6); ctx.fillRect(rx + 92, ry + 38, 3, 6);
    drawAd(ctx, 'roof', roofAd, rx, ry, 110, 38.5);
  }
  if (tenants.length) {
    const trend = env.trend(tenants);
    const k = Math.abs(b.cash) >= 1000 ? (b.cash / 1000).toFixed(1) + 'k' : String(Math.round(b.cash));
    pill(ctx, b.x + 46, GROUND - b.h - (hash(b.seed, 3) < 0.5 ? 16 : 4), `💰 ${env.money ? env.money(b.cash, true) : k} ${trend > 0 ? '▲' : trend < 0 ? '▼' : '•'}`,
      b.cash < 0 ? '#c0453f' : 'rgba(35,40,55,.72)', '#fff', 10);
  }
  const label = lot.type === 'coworking' && !tenants.length ? env.t('ui.coworkingSign')
    : tenants.length ? env.name(tenants[0]) + (tenants.length > 1 ? ` +${tenants.length - 1}` : '') : `${lot.size} m²`;
  signBoard(ctx, b, label, color, mine ? '#3a2a05' : '#fff');
  const rank = env.ranks?.get(lot.id);
  if (lot.owner) pill(ctx, b.x + b.w - 30, GROUND - GROUND_H - 18, '🔑', '#2a9d4b', '#fff', 10);
  if (rank) pill(ctx, b.x + 24, GROUND - GROUND_H + 2, `#${rank}`, rank === 1 ? '#c98500' : '#2f6fe4', '#fff', 11);
  if (tenants.some(c => c.marketing && c.marketing.until > (env.state.day || 0))) { ctx.font = '12px system-ui'; ctx.fillText('📣', b.x + b.w - 52, GROUND - GROUND_H + 20); }
  if (lot.type === 'shop') awning(ctx, b, color);
  const staff = [];
  tenants.forEach(c => {
    const ids = [...c.founders, ...c.employees];
    ids.forEach(id => { const p = env.state.players[id]; staff.push(teamLook(lookFor(p?.avatar ?? hash(id.length, 5) * 1000), env.state.teams?.[p?.team]?.color)); });
    if (c.isNpc) staff.push(npcLook(b.seed * 7 + 3));
    for (let k = 0; k < Math.min(3, c.npcStaff || 0); k++) staff.push(npcLook(b.seed * 11 + k * 5));
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

// The player's home at the start of the street: a small house with a garden fence and a mailbox
function drawHome(ctx, b, env) {
  const x = b.x, w = b.w, top = GROUND - b.h, wallTop = GROUND - 92, night = NIGHT > 0.3;
  ctx.fillStyle = 'rgba(0,0,0,.08)'; ctx.fillRect(x + 8, GROUND - 2, w - 16, 3);
  ctx.fillStyle = '#f3e3c8'; ctx.fillRect(x + 10, wallTop, w - 20, 92); ctx.fillStyle = 'rgba(0,0,0,.06)'; ctx.fillRect(x + w - 18, wallTop, 8, 92);
  ctx.fillStyle = '#b5523b'; ctx.beginPath(); ctx.moveTo(x - 6, wallTop); ctx.lineTo(x + w / 2, top); ctx.lineTo(x + w + 6, wallTop); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#8a4a3a'; ctx.fillRect(x + w - 54, top + 16, 15, 34);
  ctx.fillStyle = night ? '#ffe9a8' : '#a9d8f2'; ctx.fillRect(x + 26, wallTop + 22, 36, 30); ctx.fillRect(x + w - 62, wallTop + 22, 36, 30);
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeRect(x + 26, wallTop + 22, 36, 30); ctx.strokeRect(x + w - 62, wallTop + 22, 36, 30);
  ctx.beginPath(); ctx.moveTo(x + 44, wallTop + 22); ctx.lineTo(x + 44, wallTop + 52); ctx.moveTo(x + w - 44, wallTop + 22); ctx.lineTo(x + w - 44, wallTop + 52); ctx.stroke();
  ctx.fillStyle = '#7a4b2a'; rr(ctx, x + w / 2 - 15, GROUND - 58, 30, 58, 3); ctx.fill(); ctx.fillStyle = '#f2b84b'; ctx.beginPath(); ctx.arc(x + w / 2 + 8, GROUND - 28, 2.5, 0, 7); ctx.fill();
  ctx.fillStyle = '#fff'; for (let k = 0; k < w - 20; k += 12) { if (Math.abs(x + 10 + k - (x + w / 2)) < 22) continue; ctx.fillRect(x + 10 + k, GROUND - 20, 7, 20); }
  ctx.fillRect(x + 10, GROUND - 14, w - 20, 3);
  ctx.fillStyle = '#6dbb6b'; ctx.beginPath(); ctx.arc(x + 14, GROUND - 22, 13, 0, 7); ctx.arc(x + w - 14, GROUND - 22, 11, 0, 7); ctx.fill();
  ctx.fillStyle = '#4b5563'; ctx.fillRect(x + w + 12, GROUND - 34, 3, 34); ctx.fillStyle = '#e63946'; ctx.fillRect(x + w + 6, GROUND - 44, 16, 11);
  pill(ctx, x + w / 2, GROUND - 100, '🏠 ' + env.t('home.sign'), '#e67e22', '#fff', 11);
}
function drawGuide(ctx, b, env) {
  shell(ctx, b, '#f6d77a', '#c99a3c');
  drawUpperFloors(ctx, b, 1, env.time);
  signBoard(ctx, b, env.t('ui.guideSign'), '#d89a1c');
  const books = ['#ef6f6c', '#4f8ff7', '#5cc08a', '#9b7be0', '#f2b84b'];
  interior(ctx, b, { empty: false, staff: [npcLook(42)], goods: books, wall: '#fff6dc' });
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
      if (!LOW && hash(b.seed, f, i, slot) < 0.18) { ctx.save(); ctx.beginPath(); ctx.rect(b.x + i * cw + 2, fy + 4, cw - 4, FLOOR_H - 8); ctx.clip(); silhouette(ctx, b.x + i * cw + cw / 2, fy + FLOOR_H - 4, npcLook(f * 11 + i + slot)); ctx.restore(); }
    }
    ctx.fillStyle = 'rgba(255,255,255,.25)'; ctx.fillRect(b.x, fy + FLOOR_H - 3, b.w, 2);
  }
  const virtual = Object.values(env.state?.companies || {}).filter(c => c.lotId == null);
  signBoard(ctx, b, env.t('ui.plaza'), '#3b82c4');
  const staff = virtual.flatMap(c => c.founders).map(id => lookFor(env.state.players[id]?.avatar ?? 7));
  interior(ctx, b, { empty: false, desks: true, staff: staff.length ? staff : [npcLook(77)], wall: '#eef6fd' });
  if (virtual.length) pill(ctx, b.x + b.w - 30, GROUND - GROUND_H - 4, `🏢 ${virtual.length}`, 'rgba(35,40,55,.6)', '#fff', 9);
}
// Demo Day & investment hub: stage, podium, pitch screen, jury (NPC investors) — end of the street
function drawDemoDay(ctx, b, env) {
  const top = GROUND - b.h;
  ctx.fillStyle = '#3b2f63'; ctx.fillRect(b.x, top + ROOF_H, b.w, b.h - ROOF_H);
  ctx.fillStyle = '#251d42'; ctx.fillRect(b.x - 8, top, b.w + 16, ROOF_H);
  // marquee lights
  for (let i = 0; i < 18; i++) { const on = hash(i, Math.floor(env.time / 300)) < 0.7; ctx.fillStyle = on ? '#ffe9a8' : '#6b5fa8'; circle(ctx, b.x + 12 + i * ((b.w - 24) / 17), top + ROOF_H + 8, 3); }
  ctx.fillStyle = '#f2b84b'; rr(ctx, b.x + 30, top + ROOF_H + 20, b.w - 60, 44, 10); ctx.fill();
  ctx.font = '800 22px system-ui, sans-serif'; ctx.fillStyle = '#3b2f63'; ctx.textAlign = 'center';
  ctx.fillText('🎤 DEMO DAY', b.x + b.w / 2, top + ROOF_H + 50);
  ctx.font = '700 11px system-ui, sans-serif'; ctx.fillStyle = '#e9e4ff';
  ctx.fillText(env.t('demo.sign'), b.x + b.w / 2, top + ROOF_H + 84); ctx.textAlign = 'left';
  // upper windows with investors
  for (let i = 0; i < 4; i++) { const wx = b.x + 24 + i * 84; windowAt(ctx, wx, top + ROOF_H + 96, 60, 36, !LOW && hash(904, i, Math.floor(env.time / 9000)) < 0.5 ? npcLook(904 + i) : null); }
  // ground floor cut-away: stage
  const gy = GROUND - GROUND_H, ix = b.x + 12, iy = gy + 8, iw = b.w - 24, ih = GROUND - iy;
  ctx.save(); ctx.beginPath(); ctx.rect(ix, iy, iw, ih); ctx.clip();
  ctx.fillStyle = '#1f1838'; ctx.fillRect(ix, iy, iw, ih);
  ctx.fillStyle = '#8b1e3f'; ctx.fillRect(ix, iy, 26, ih); ctx.fillRect(ix + iw - 26, iy, 26, ih);           // curtains
  ctx.fillStyle = '#e9e4ff'; ctx.fillRect(ix + 40, iy + 6, 120, 52);                                          // pitch screen
  ctx.fillStyle = '#2a78d6'; for (let k = 0; k < 5; k++) ctx.fillRect(ix + 52 + k * 20, iy + 50 - (k + 1) * 7, 12, (k + 1) * 7);
  ctx.fillStyle = '#5b4a3a'; ctx.fillRect(ix + 180, GROUND - 30, 22, 24);                                      // podium
  drawPerson(ctx, ix + 191, GROUND - 28, lookFor(7), { scale: 0.7, dir: -1 });
  ctx.fillStyle = '#4b3f7a'; ctx.fillRect(ix + 220, GROUND - 22, iw - 250, 6);                                 // jury desk
  for (let k = 0; k < 3; k++) drawPerson(ctx, ix + 238 + k * 30, GROUND - 16, npcLook(910 + k), { scale: 0.75, dir: -1 });
  ctx.fillStyle = 'rgba(255,233,168,.18)'; ctx.beginPath(); ctx.moveTo(ix + 191, iy); ctx.lineTo(ix + 160, GROUND); ctx.lineTo(ix + 222, GROUND); ctx.fill();
  ctx.restore();
  ctx.strokeStyle = '#f2b84b'; ctx.lineWidth = 3; ctx.strokeRect(ix, iy, iw, ih);
}
// A company car as a parked vehicle (colour from the company id; vans are bigger)
const carOf = (c, x, y) => { const van = c.vehicle.model?.startsWith('van'); let h = 0; for (const ch of c.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return { kind: 'car', body: van ? 'van' : 'car', x, y, dir: 1, w: van ? 68 : 58, h: van ? 26 : 22, color: CAR_COLORS[h % CAR_COLORS.length] }; };
function drawParking(ctx, b, env) {
  ctx.fillStyle = '#9aa0ad'; ctx.fillRect(b.x, GROUND - 6, b.w, 30);
  ctx.fillStyle = 'rgba(255,255,255,.8)'; for (let i = 0; i <= 6; i++) ctx.fillRect(b.x + 10 + i * 60, GROUND - 4, 3, 24);
  ctx.fillStyle = '#4b5563'; ctx.fillRect(b.x + 20, GROUND - 74, 4, 70); ctx.fillRect(b.x + b.w - 24, GROUND - 74, 4, 70);
  ctx.fillStyle = '#1d70f5'; rr(ctx, b.x + 10, GROUND - 92, b.w - 20, 24, 6); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '700 14px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('🅿 ' + env.t('veh.parkingSign'), b.x + b.w / 2, GROUND - 75); ctx.textAlign = 'left';
  const parked = Object.values(env.state?.companies || {}).filter(c => c.vehicle?.park === 'lot');
  parked.slice(0, 6).forEach((c, i) => drawVehicle(ctx, carOf(c, b.x + 40 + i * 60, GROUND + 18)));
  if (parked.length > 6) pill(ctx, b.x + b.w / 2, GROUND - 100, `+${parked.length - 6}`, 'rgba(35,40,55,.78)', '#fff', 11);
}
// Intercity bus terminal ("otogar") at the end of the street
function drawTerminal(ctx, b, env) {
  ctx.fillStyle = '#c9ccd4'; ctx.fillRect(b.x, GROUND - 6, b.w, 30);
  ctx.fillStyle = '#e8ebf1'; ctx.fillRect(b.x + 10, GROUND - b.h, b.w - 20, b.h - 6);
  ctx.fillStyle = '#4b5563'; ctx.fillRect(b.x, GROUND - b.h - 10, b.w, 12);
  ctx.fillStyle = '#e67e22'; rr(ctx, b.x + 60, GROUND - b.h - 44, b.w - 120, 30, 6); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.font = '700 15px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText('🚌 ' + env.t('travel.sign'), b.x + b.w / 2, GROUND - b.h - 23); ctx.textAlign = 'left';
  ctx.fillStyle = '#9fd3f0'; for (let i = 0; i < 3; i++) ctx.fillRect(b.x + 28 + i * 112, GROUND - b.h + 18, 90, 52);
  ctx.fillStyle = '#6b7280'; ctx.fillRect(b.x + 28, GROUND - 38, b.w - 56, 4);
  drawVehicle(ctx, { kind: 'bus', x: b.x + 90, y: GROUND + 34, dir: 1, w: 150, h: 52, color: '#e67e22', text: '' });
  drawVehicle(ctx, { kind: 'bus', x: b.x + 290, y: GROUND + 34, dir: -1, w: 150, h: 52, color: '#2a9d8f', text: '' });
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
const mix = (a, b, k) => { const p = x => [1, 3, 5].map(i => parseInt(x.slice(i, i + 2), 16)); const [A, B] = [p(a), p(b)]; return `rgb(${A.map((v, i) => Math.round(v + (B[i] - v) * k)).join(',')})`; };
function drawSky(ctx, w, h) {
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, mix('#8ec5f5', '#14213d', NIGHT)); g.addColorStop(1, mix('#dff0fc', '#3a4a7a', NIGHT));
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
  if (NIGHT > 0.3) { ctx.fillStyle = `rgba(255,233,168,${0.25 * NIGHT})`; ctx.beginPath(); ctx.moveTo(x + 13, FEET - 80); ctx.lineTo(x - 20, FEET); ctx.lineTo(x + 46, FEET); ctx.fill(); }
  ctx.fillStyle = '#ffe9a8'; rr(ctx, x + 8, FEET - 84, 10, 6, 3); ctx.fill();
}
// Bus stop shelter (🚏) on the sidewalk
// Billboards stand in four street gaps (never where a bus stop is), spread evenly along the street
let bbCache = { n: -1, stops: '', gaps: [] };
function billboardGaps(env) {
  const key = (env.busStops || []).join(','), n = env.buildings.length;
  if (bbCache.n === n && bbCache.stops === key) return bbCache.gaps;
  const free = [];
  for (let i = 0; i < n - 1; i++) {
    const b = env.buildings[i], gx = b.x + b.w + (env.buildings[i + 1].x - b.x - b.w) / 2;
    if (!(env.busStops || []).some(x => Math.abs(x - gx) < 30)) free.push(i);
  }
  const gaps = free.length <= 4 ? free : [0, 1, 2, 3].map(k => free[Math.floor((k + 0.5) * free.length / 4)]);
  bbCache = { n, stops: key, gaps }; return gaps;
}
function drawBillboard(ctx, x, slot, t) {
  const bw = 150, bh = 75, top = GROUND - 250;
  ctx.fillStyle = '#4b5563'; ctx.fillRect(x - 14, top + bh, 4, GROUND - top - bh + 18); ctx.fillRect(x + 10, top + bh, 4, GROUND - top - bh + 18);
  ctx.fillStyle = '#374151'; ctx.fillRect(x - bw / 2 - 4, top - 4, bw + 8, bh + 8);
  if (slot?.live) drawAd(ctx, 'billboard', slot.live, x - bw / 2, top, bw, bh);
  else {
    ctx.fillStyle = slot?.owner ? '#1f2937' : '#f3f4f6'; ctx.fillRect(x - bw / 2, top, bw, bh);
    ctx.fillStyle = slot?.owner ? '#9ca3af' : '#6b7280'; ctx.font = '600 11px system-ui, sans-serif'; ctx.textAlign = 'center';
    ctx.fillText(slot?.owner ? '…' : '📢 ' + (t ? t('ad.free') : ''), x, top + bh / 2 + 4); ctx.textAlign = 'left';
  }
}
function drawStop(ctx, x, label, ad) {
  ctx.fillStyle = 'rgba(169,216,242,.55)'; ctx.fillRect(x - 20, FEET - 62, 40, 50);
  ctx.fillStyle = '#4b5563'; ctx.fillRect(x - 22, FEET - 66, 44, 5); ctx.fillRect(x - 21, FEET - 62, 2, 62); ctx.fillRect(x + 19, FEET - 62, 2, 62);
  ctx.fillStyle = '#9c6644'; ctx.fillRect(x - 14, FEET - 18, 28, 4);
  if (ad) drawAd(ctx, 'stop', ad, x - 16, FEET - 59, 32, 44.8);
  ctx.fillStyle = '#1d70f5'; rr(ctx, x + 22, FEET - 92, 22, 22, 4); ctx.fill();
  ctx.fillStyle = '#4b5563'; ctx.fillRect(x + 32, FEET - 70, 2, 70);
  ctx.font = '13px system-ui'; ctx.textAlign = 'center'; ctx.fillText('🚏', x + 33, FEET - 76); ctx.textAlign = 'left';
  if (label) pill(ctx, x, FEET - 70, label, 'rgba(29,112,245,.85)', '#fff', 9);
}

// ---------- traffic (cosmetic, simulated only around the camera; the city bus loops the whole street) ----------
const LANE_A = GROUND + 50, LANE_B = GROUND + 76;
const CAR_COLORS = ['#ef6f6c', '#4f8ff7', '#5cc08a', '#8aa1b8', '#2b2f3a', '#f4f4f4', '#9b7be0'];
function drawVehicle(ctx, v) {
  const { x, y, dir, kind } = v, w = v.w, h = v.h;
  ctx.save(); ctx.translate(x, y); ctx.scale(dir, 1);
  ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.fillRect(-w / 2 + 4, -2, w - 8, 4);
  ctx.fillStyle = v.color; rr(ctx, -w / 2, -h, w, h - 4, kind === 'bus' || kind === 'shuttle' ? 6 : 8); ctx.fill();
  if (kind === 'bus' || kind === 'shuttle') {
    ctx.fillStyle = '#cfe8f7'; for (let wx = -w / 2 + 8; wx < w / 2 - 20; wx += 20) ctx.fillRect(wx, -h + 6, 15, 13);
    ctx.fillStyle = '#9fd3f0'; ctx.fillRect(w / 2 - 16, -h + 6, 12, 22);
    if (v.ad && kind === 'bus') { ctx.save(); ctx.scale(dir, 1); drawAd(ctx, 'bus', v.ad, -w / 2 + 6, -h + 22, w - 22, 26); ctx.restore(); }
    else { ctx.fillStyle = '#fff'; ctx.font = '700 8px system-ui'; ctx.textAlign = 'center';
      ctx.save(); ctx.scale(dir, 1); ctx.fillText(v.text || '', 0, -6); ctx.restore(); ctx.textAlign = 'left'; }
  } else {
    if (v.body === 'van') { ctx.fillStyle = v.color; rr(ctx, -w / 2 + 2, -h - 12, w * 0.62, 16, 4); ctx.fill(); ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.fillRect(-w / 2 + 8, -h - 6, w * 0.62 - 14, 3);
      ctx.fillStyle = '#cfe8f7'; ctx.fillRect(w / 2 - 22, -h - 8, 14, 9); }
    else { ctx.fillStyle = v.color; rr(ctx, -w / 4, -h - 9, w / 2, 11, 5); ctx.fill();
      ctx.fillStyle = '#cfe8f7'; ctx.fillRect(-w / 4 + 3, -h - 7, w / 4 - 4, 7); ctx.fillRect(2, -h - 7, w / 4 - 5, 7); }
    if (kind === 'taxi') { ctx.fillStyle = '#2b2f3a'; ctx.fillRect(-7, -h - 13, 14, 4); }
  }
  ctx.fillStyle = '#ffe9a8'; ctx.fillRect(w / 2 - 3, -h + 8, 3, 4);
  ctx.fillStyle = '#2b2f3a'; circle(ctx, -w / 2 + 12, -3, 5); circle(ctx, w / 2 - 12, -3, 5);
  ctx.fillStyle = '#9aa3b5'; circle(ctx, -w / 2 + 12, -3, 2); circle(ctx, w / 2 - 12, -3, 2);
  ctx.restore();
}
export function createTraffic() {
  const cars = [], drops = [];
  const bus = { kind: 'bus', x: 0, y: LANE_A, dir: 1, w: 150, h: 52, color: '#1d70f5', text: '🚌 FİNBUU 42', speed: 95, wait: 0, nextStop: 0 };
  const make = (kind, x, lane, dir, color) => ({ kind, x, y: lane, dir, color, w: kind === 'shuttle' ? 84 : 58, h: kind === 'shuttle' ? 36 : 22,
    speed: kind === 'shuttle' ? 80 : 110 + Math.random() * 60, text: kind === 'shuttle' ? 'SERVİS' : '' });
  return {
    bus, cars, drops,
    // shuttle / private car dropping staff in front of a company
    dropoff(targetX, looks, kind, color, camX) {
      if (cars.filter(c => c.target != null).length >= 2) return;
      const v = make(kind === 'car' ? 'car' : 'shuttle', camX - 120, LANE_A, 1, kind === 'car' ? color : '#f4f4f4');
      v.target = targetX; v.looks = looks; v.stay = 2;
      cars.push(v);
    },
    update(dt, camX, viewW, worldW, stops, density) {
      // city bus: loops the street, stopping at every stop
      if (bus.wait > 0) bus.wait -= dt;
      else {
        bus.x += bus.dir * bus.speed * dt;
        const stopX = stops[bus.nextStop];
        if (stopX != null && Math.abs(bus.x - stopX) < bus.speed * dt + 1) { bus.x = stopX; bus.wait = 2.5; bus.nextStop = (bus.nextStop + 1) % stops.length; }
        if (bus.x > worldW + 200) { bus.x = -200; bus.nextStop = 0; }
      }
      const ambient = cars.filter(c => c.target == null).length;
      if (ambient < density && Math.random() < dt * 1.5) {
        const dir = Math.random() < 0.5 ? 1 : -1, kind = Math.random() < 0.25 ? 'taxi' : 'car';
        cars.push(make(kind, dir > 0 ? camX - 100 : camX + viewW + 100, dir > 0 ? LANE_A : LANE_B, dir, kind === 'taxi' ? '#f2c230' : CAR_COLORS[Math.floor(Math.random() * CAR_COLORS.length)]));
      }
      for (let i = cars.length - 1; i >= 0; i--) {
        const c = cars[i];
        if (c.target != null && c.stay > 0) {
          const d = c.target - c.x;
          if (Math.abs(d) > 2) c.x += Math.sign(d) * Math.min(Math.abs(d), Math.max(25, Math.abs(d) * 1.8) * dt + 0.5);
          else {
            if (c.looks) { c.looks.slice(0, 3).forEach((look, k) => drops.push({ x: c.x - 10 + k * 12, tx: c.target + 4 + k * 6, look, t: 3 })); c.looks = null; }
            c.stay -= dt;
          }
        } else {
          c.target = null;
          c.x += c.dir * c.speed * dt;
          if (c.x < camX - 300 || c.x > camX + viewW + 300) cars.splice(i, 1);
        }
      }
      for (let i = drops.length - 1; i >= 0; i--) {
        const d = drops[i]; d.t -= dt;
        if (Math.abs(d.tx - d.x) > 2) d.x += Math.sign(d.tx - d.x) * 40 * dt;
        if (d.t <= 0) drops.splice(i, 1);
      }
    },
    draw(ctx, camX, viewW, riding) {
      for (const c of [...cars, bus]) if (c.x > camX - 200 && c.x < camX + viewW + 200 && !(riding && c === bus)) drawVehicle(ctx, c);
      if (riding) drawVehicle(ctx, { ...bus, x: riding.x, dir: riding.dir, text: '🚌 ' + (riding.text || '') });
    }
  };
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
    id, look: npcLook(100 + id * 13),
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
    speed: 18 + Math.random() * 22, look: npcLook(100 + i * 13), phase: Math.random() * 6, pause: 0, talking: false, lane: FEET - 6 + Math.random() * 10 });
  return {
    walkers, visitors,
    setWidth(w) { width = w; },
    spawnVisitor(tx, emoji) {
      if (visitors.length >= 3) visitors.shift();
      const side = Math.random() < 0.5 ? -1 : 1;
      visitors.push({ x: tx + side * 260, tx, dir: -side, speed: 80, look: npcLook(Math.floor(Math.random() * 900)), phase: 0, emoji, stay: 3, lane: FEET - 2 });
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
let NIGHT = 0;               // 0 = day, 1 = night (from the analog game clock)
// env: { state, view:{w,h,s,ty,camX,dpr}, time, myId, player, others, npcs, buildings, near, targetId, t, name, sector, maxTenants, tenants, keyHint }
export function draw(ctx, env) {
  const { view } = env, { w, h, s, ty, camX, dpr } = view, viewWorldW = w / s;
  LOW = !!env.low;
  NIGHT = env.night || 0;
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
    if (b.kind === 'home') drawHome(ctx, b, env);
    else if (b.kind === 'guide') drawGuide(ctx, b, env);
    else if (b.kind === 'plaza') drawPlaza(ctx, b, env);
    else if (b.kind === 'lot') drawLot(ctx, b, env);
    else if (b.kind === 'demoday') drawDemoDay(ctx, b, env);
    else if (b.kind === 'parking') drawParking(ctx, b, env);
    else if (b.kind === 'terminal') drawTerminal(ctx, b, env);
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
    const stopIdx = (env.busStops || []).findIndex(x => Math.abs(x - gx) < 30);
    const bbIdx = billboardGaps(env).indexOf(i);
    if (stopIdx >= 0) drawStop(ctx, gx, env.nearStop === stopIdx ? env.stopHint : null, env.ads?.['stop:' + stopIdx]?.live);
    else if (bbIdx >= 0) drawBillboard(ctx, gx, env.ads?.['billboard:' + bbIdx], env.t);
    else if (i % 2) drawLamp(ctx, gx); else drawTree(ctx, gx);
  }
  // people, sorted by depth
  const people = [];
  for (const n of env.npcs.walkers.slice(0, env.npcLimit ?? 99)) people.push({ x: n.x, y: n.lane, look: n.look, o: { dir: n.dir, moving: n.pause <= 0 && !n.talking, phase: n.phase, scale: 0.92,
    bubble: env.nearNpc === n ? '💬' : null, label: env.met?.has(n.id) ? n.profile.name.split(' ')[0] : null } });
  for (const v of env.npcs.visitors) people.push({ x: v.x, y: v.lane, look: v.look, o: { dir: v.dir, moving: Math.abs(v.tx - v.x) > 3, phase: v.phase, bubble: v.emoji, scale: 0.92 } });
  for (const [id, o] of env.others) {
    const p = env.state?.players[id]; if (!p || p.loc) continue;
    people.push({ x: o.x, y: FEET + 2, look: teamLook(lookFor(p.avatar ?? 0), env.state.teams?.[p.team]?.color), o: { dir: o.dir, moving: o.moving, phase: o.phase, label: (p.afk ? '💤 ' : '') + p.name, ...sayOf(env, id) } });
  }
  const meP = env.state?.players[env.myId];
  for (const d of env.traffic?.drops || []) people.push({ x: d.x, y: FEET - 4, look: d.look, o: { dir: Math.sign(d.tx - d.x) || 1, moving: Math.abs(d.tx - d.x) > 2, phase: d.t * 18, scale: 0.92 } });
  if (meP && !env.hideMe && !env.riding) people.push({ x: env.player.x, y: FEET + 4, look: teamLook(lookFor(meP.avatar ?? 0), env.state.teams?.[meP.team]?.color), o: { dir: env.player.dir, moving: env.player.moving, phase: env.player.phase, label: (meP.afk ? '💤 ' : '') + meP.name, mine: true, ...sayOf(env, env.myId) } });
  people.sort((a, b) => a.y - b.y);
  for (const p of people) {
    if (p.x < camX - 40 || p.x > camX + viewWorldW + 40) continue;
    drawPerson(ctx, p.x, p.y, p.look, p.o);
  }
  if (env.traffic) { env.traffic.bus.ad = env.ads?.['bus:0']?.live || null; env.traffic.draw(ctx, camX, viewWorldW, env.riding); }
  if (env.state) for (const b of env.buildings) { // company cars parked at the building door (free, but street parking can get damaged)
    if (b.kind !== 'lot' || b.x > camX + viewWorldW + 80 || b.x + b.w < camX - 80) continue;
    let k = 0;
    for (const id of b.lot.companyIds) {
      const c = env.state.companies[id]; if (!c?.vehicle || c.vehicle.park === 'lot' || k > 1) continue;
      const x = b.x + b.w - 52 - k * 78, y = GROUND + 46; k++;
      drawVehicle(ctx, carOf(c, x, y));
      if (c.vehicle.type === 'rent' && c.vehicle.until != null) { const left = Math.max(0, c.vehicle.until - (env.state.day || 0)); pill(ctx, x, y - 38, `🚗 ${left}${env.t('veh.dayShort')}`, 'rgba(35,40,55,.75)', '#fff', 9); }
    }
  }
  if (meP && env.keyHint && (env.near || env.nearNpc || env.nearStop != null) && !env.riding) pill(ctx, env.player.x, FEET - 70, env.keyHint, '#2f6fe4', '#fff', 11);
  if (NIGHT > 0) { ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.fillStyle = `rgba(10,20,50,${0.22 * NIGHT})`; ctx.fillRect(0, 0, w, h); }
}
