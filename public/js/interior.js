// public/js/interior.js
// Company HQ interior: same side-view 2D language as the street. A cross-section of the building:
// each floor = two departments + an elevator. Floors unlock as the building grows (cash -> floors).
import { drawPerson, lookFor, npcLook, teamLook, hash } from './world.js';

export const IW = 960, FH = 150, FLOORS = 4, ROOF = 34;
export const IH = FLOORS * FH + ROOF;
export const ELEV = { x: 440, w: 80 };
export const DEPT_ICON = { sales: '🛒', finance: '💰', accounting: '🧾', marketing: '📣', hr: '👥', it: '🖥', rnd: '🔬', board: '🏛',
  kitchen: '🍳', living: '🛋', study: '📚', hobby: '🎨', bedroom: '🛏', balcony: '🌿' };
const WALL = { sales: '#fbf3e4', finance: '#eef6fd', accounting: '#f4f1ea', marketing: '#fdf0f3', hr: '#f0f8f1', it: '#eceff6', rnd: '#f1eefb', board: '#f6f1e7',
  kitchen: '#fdf6e3', living: '#f3ece3', study: '#eef3f8', hobby: '#f7eefb', bedroom: '#f1eff9', balcony: '#e3f3fb' };
// The player's home: 3 floors, two rooms per floor, stairs instead of the elevator
export const HOME_FLOORS = 3;
export const HOME_ROOMS = [{ key: 'kitchen', floor: 0 }, { key: 'living', floor: 0 }, { key: 'study', floor: 1 }, { key: 'hobby', floor: 1 }, { key: 'bedroom', floor: 2 }, { key: 'balcony', floor: 2 }];

export const floorBase = f => IH - f * FH;           // y of the floor surface
export const roomOf = (depts, x, f) => {
  const pair = depts.filter(d => d.floor === f);
  if (x < ELEV.x) return pair[0] || null;
  if (x > ELEV.x + ELEV.w) return pair[1] || null;
  return null;
};
export const roomCenter = side => (side === 0 ? ELEV.x / 2 : ELEV.x + ELEV.w + (IW - ELEV.x - ELEV.w) / 2);

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function text(ctx, s, x, y, size = 12, color = '#2b2f3a', weight = 600, align = 'left') {
  ctx.font = `${weight} ${size}px system-ui, sans-serif`; ctx.fillStyle = color; ctx.textAlign = align; ctx.fillText(s, x, y); ctx.textAlign = 'left';
}
function desk(ctx, x, y, screen = '#7fc3f0') {
  ctx.fillStyle = '#c9a27a'; ctx.fillRect(x, y - 24, 70, 5);
  ctx.fillStyle = '#9a7656'; ctx.fillRect(x + 4, y - 19, 4, 19); ctx.fillRect(x + 62, y - 19, 4, 19);
  ctx.fillStyle = '#3d4252'; ctx.fillRect(x + 24, y - 44, 26, 18); ctx.fillRect(x + 35, y - 26, 4, 3);
  ctx.fillStyle = screen; ctx.fillRect(x + 26, y - 42, 22, 14);
}

// --- furniture per department ---
const FURNITURE = {
  sales(ctx, x0, w, y, env) {
    const goods = env.goods;
    for (let r = 0; r < 3; r++) {
      ctx.fillStyle = '#c9a27a'; ctx.fillRect(x0 + 24, y - 118 + r * 26 + 18, w - 48, 3);
      for (let k = 0; k < Math.floor((w - 56) / 14); k++) { ctx.fillStyle = goods[(k + r) % goods.length]; ctx.fillRect(x0 + 28 + k * 14, y - 118 + r * 26 + 4, 10, 14); }
    }
    ctx.fillStyle = '#b07a4f'; ctx.fillRect(x0 + 60, y - 30, w - 160, 30);
    ctx.fillStyle = '#c9946a'; ctx.fillRect(x0 + 56, y - 34, w - 152, 5);
    ctx.fillStyle = '#3d4252'; ctx.fillRect(x0 + 80, y - 48, 22, 14);
  },
  finance(ctx, x0, w, y, env) {
    ctx.fillStyle = '#3d4252'; rr(ctx, x0 + 30, y - 128, 150, 70, 6); ctx.fill();
    ctx.strokeStyle = '#5cc08a'; ctx.lineWidth = 3; ctx.beginPath();
    const tr = env.trend || 0;
    [0, 1, 2, 3, 4, 5].forEach(i => { const px = x0 + 40 + i * 26, py = y - 70 - i * 8 * (tr >= 0 ? 1 : -0.6) - hash(i, 3) * 8; i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); });
    ctx.stroke();
    desk(ctx, x0 + 210, y); desk(ctx, x0 + 300, y, '#b6e3c4');
  },
  accounting(ctx, x0, w, y) {
    for (let k = 0; k < 3; k++) {
      ctx.fillStyle = '#9aa3b5'; ctx.fillRect(x0 + 24 + k * 44, y - 92, 38, 92);
      ctx.fillStyle = '#7d8699'; for (let d = 0; d < 3; d++) ctx.fillRect(x0 + 30 + k * 44, y - 84 + d * 30, 26, 3);
    }
    desk(ctx, x0 + 200, y, '#f7f4ee'); desk(ctx, x0 + 300, y, '#f7f4ee');
    ctx.fillStyle = '#fff'; ctx.fillRect(x0 + 214, y - 30, 14, 6); ctx.fillRect(x0 + 316, y - 30, 14, 6);
  },
  marketing(ctx, x0, w, y, env) {
    // cork board (mantar pano) with sticky notes
    ctx.fillStyle = '#b5835a'; rr(ctx, x0 + 26, y - 132, 190, 86, 6); ctx.fill();
    ctx.fillStyle = '#c99a6b'; ctx.fillRect(x0 + 32, y - 126, 178, 74);
    const notes = ['#ffe58a', '#ffb3c7', '#b6e3c4', '#a9d8f2'];
    for (let k = 0; k < 8; k++) {
      const nx = x0 + 40 + (k % 4) * 42, ny = y - 120 + Math.floor(k / 4) * 34;
      ctx.fillStyle = notes[k % 4]; ctx.fillRect(nx, ny, 30, 26);
      ctx.fillStyle = '#e34948'; ctx.beginPath(); ctx.arc(nx + 15, ny + 3, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    desk(ctx, x0 + 250, y, '#f28fb1');
    if (env.campaign) { ctx.fillStyle = '#e34948'; rr(ctx, x0 + 240, y - 132, 150, 26, 13); ctx.fill(); text(ctx, env.campaignText, x0 + 315, y - 114, 12, '#fff', 700, 'center'); }
  },
  hr(ctx, x0, w, y) {
    ctx.fillStyle = '#c9a27a'; rr(ctx, x0 + 120, y - 40, 170, 10, 5); ctx.fill();
    ctx.fillStyle = '#9a7656'; ctx.fillRect(x0 + 200, y - 30, 8, 30);
    ctx.fillStyle = '#5cc08a'; rr(ctx, x0 + 30, y - 128, 120, 52, 6); ctx.fill();
    text(ctx, '★ ★ ★', x0 + 90, y - 96, 16, '#fff', 700, 'center');
    ctx.fillStyle = '#6dbb6b'; ctx.beginPath(); ctx.arc(x0 + w - 40, y - 40, 16, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#b5704a'; ctx.fillRect(x0 + w - 48, y - 24, 16, 24);
  },
  it(ctx, x0, w, y, env) {
    for (let k = 0; k < 2; k++) {
      ctx.fillStyle = '#3d4252'; ctx.fillRect(x0 + 26 + k * 56, y - 118, 46, 118);
      for (let led = 0; led < 9; led++) {
        const on = hash(k, led, Math.floor(env.time / 400)) < 0.6;
        ctx.fillStyle = on ? '#5cc08a' : '#2b2f3a'; ctx.fillRect(x0 + 34 + k * 56, y - 110 + led * 12, 6, 3);
        ctx.fillStyle = '#596075'; ctx.fillRect(x0 + 44 + k * 56, y - 110 + led * 12, 20, 3);
      }
    }
    desk(ctx, x0 + 170, y); desk(ctx, x0 + 260, y, '#9b7be0');
    text(ctx, '🛡'.repeat(Math.max(1, env.security || 0)), x0 + w - 70, y - 100, 18);
  },
  kitchen(ctx, x0, w, y, env) {
    ctx.fillStyle = '#d6b48a'; ctx.fillRect(x0 + 20, y - 132, 175, 32); ctx.fillStyle = '#b89268'; for (let k = 1; k < 4; k++) ctx.fillRect(x0 + 20 + k * 44, y - 132, 2, 32);
    ctx.fillStyle = '#c9a27a'; ctx.fillRect(x0 + 20, y - 36, 175, 36); ctx.fillStyle = '#ebe6dc'; ctx.fillRect(x0 + 16, y - 42, 183, 7);
    ctx.fillStyle = '#7d8699'; ctx.fillRect(x0 + 40, y - 46, 46, 5); ctx.fillStyle = '#4b5563'; ctx.fillRect(x0 + 60, y - 64, 3, 20); ctx.fillRect(x0 + 60, y - 64, 12, 3);
    ctx.fillStyle = '#e9edf2'; rr(ctx, x0 + 215, y - 108, 48, 108, 5); ctx.fill(); ctx.fillStyle = '#b8c0cc'; ctx.fillRect(x0 + 215, y - 66, 48, 3); ctx.fillRect(x0 + 254, y - 96, 3, 22);
    ctx.fillStyle = '#4b5563'; ctx.fillRect(x0 + 275, y - 38, 60, 38); ctx.fillStyle = '#2b2f3a'; ctx.beginPath(); ctx.arc(x0 + 292, y - 38, 7, Math.PI, 0); ctx.arc(x0 + 318, y - 38, 7, Math.PI, 0); ctx.fill();
    ctx.fillStyle = '#9aa3b5'; ctx.fillRect(x0 + 288, y - 56, 22, 16); const st = Math.sin(env.time / 300);
    text(ctx, '♨', x0 + 299 + st * 3, y - 62, 12, '#9aa3b5', 700, 'center');
    ctx.fillStyle = '#c9a27a'; ctx.fillRect(x0 + 355, y - 34, 70, 5); ctx.fillRect(x0 + 362, y - 29, 4, 29); ctx.fillRect(x0 + 414, y - 29, 4, 29);
    ctx.fillStyle = '#f4f4f4'; ctx.beginPath(); ctx.ellipse(x0 + 375, y - 36, 9, 3, 0, 0, 7); ctx.ellipse(x0 + 405, y - 36, 9, 3, 0, 0, 7); ctx.fill();
  },
  living(ctx, x0, w, y) {
    ctx.fillStyle = '#d9a5a5'; ctx.beginPath(); ctx.ellipse(x0 + 190, y - 3, 150, 6, 0, 0, 7); ctx.fill();
    ctx.fillStyle = '#6f84ad'; rr(ctx, x0 + 24, y - 64, 135, 46, 8); ctx.fill(); ctx.fillStyle = '#7b8fb5'; rr(ctx, x0 + 24, y - 40, 135, 36, 8); ctx.fill();
    ctx.fillStyle = '#8fa2c6'; rr(ctx, x0 + 36, y - 52, 50, 24, 6); ctx.fill(); rr(ctx, x0 + 96, y - 52, 50, 24, 6); ctx.fill(); ctx.fillStyle = '#4e5d7d'; ctx.fillRect(x0 + 30, y - 6, 6, 6); ctx.fillRect(x0 + 147, y - 6, 6, 6);
    ctx.fillStyle = '#c9a27a'; ctx.fillRect(x0 + 175, y - 24, 70, 5); ctx.fillRect(x0 + 180, y - 19, 4, 19); ctx.fillRect(x0 + 236, y - 19, 4, 19);
    ctx.fillStyle = '#fff'; ctx.fillRect(x0 + 186, y - 30, 22, 6); ctx.fillStyle = '#f2b84b'; ctx.fillRect(x0 + 212, y - 29, 18, 5); ctx.fillStyle = '#e63946'; ctx.fillRect(x0 + 220, y - 29, 6, 3);
    ctx.fillStyle = '#8a5d44'; ctx.fillRect(x0 + 275, y - 22, 100, 22); ctx.fillStyle = '#2b2f3a'; rr(ctx, x0 + 285, y - 76, 80, 50, 4); ctx.fill(); ctx.fillStyle = '#7fc3f0'; ctx.fillRect(x0 + 289, y - 72, 72, 42);
    ctx.fillStyle = '#6dbb6b'; ctx.beginPath(); ctx.arc(x0 + 400, y - 52, 16, 0, 7); ctx.fill(); ctx.fillStyle = '#b5704a'; ctx.fillRect(x0 + 392, y - 38, 16, 38);
  },
  study(ctx, x0, w, y) {
    ctx.fillStyle = '#8a5d44'; ctx.fillRect(x0 + 18, y - 124, 125, 124); ctx.fillStyle = '#f1e6d4'; ctx.fillRect(x0 + 24, y - 118, 113, 112);
    const bc = ['#ef6f6c', '#4f8ff7', '#5cc08a', '#f2b84b', '#9b7be0', '#2a9d8f'];
    for (let r = 0; r < 4; r++) { ctx.fillStyle = '#8a5d44'; ctx.fillRect(x0 + 24, y - 90 + r * 28, 113, 3); for (let k = 0; k < 8; k++) { ctx.fillStyle = bc[(k + r) % bc.length]; ctx.fillRect(x0 + 28 + k * 13, y - 116 + r * 28, 10, 26 - (k % 3) * 3); } }
    desk(ctx, x0 + 190, y, '#b6e3c4'); ctx.fillStyle = '#f2b84b'; ctx.fillRect(x0 + 258, y - 60, 3, 36); ctx.beginPath(); ctx.moveTo(x0 + 250, y - 60); ctx.lineTo(x0 + 270, y - 60); ctx.lineTo(x0 + 266, y - 70); ctx.lineTo(x0 + 254, y - 70); ctx.fill();
    ctx.fillStyle = '#c9a27a'; ctx.beginPath(); ctx.arc(x0 + 330, y - 40, 14, 0, 7); ctx.fill(); ctx.fillStyle = '#4f8ff7'; ctx.beginPath(); ctx.arc(x0 + 330, y - 40, 11, 0, 7); ctx.fill(); ctx.fillStyle = '#8a5d44'; ctx.fillRect(x0 + 328, y - 26, 4, 26);
    for (let k = 0; k < 3; k++) { ctx.fillStyle = '#d4a017'; ctx.fillRect(x0 + 180 + k * 46, y - 128, 36, 26); ctx.fillStyle = '#fff'; ctx.fillRect(x0 + 184 + k * 46, y - 124, 28, 18); text(ctx, '★', x0 + 198 + k * 46, y - 110, 11, '#d4a017', 700, 'center'); }
  },
  hobby(ctx, x0, w, y) {
    ctx.strokeStyle = '#8a5d44'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x0 + 40, y); ctx.lineTo(x0 + 70, y - 104); ctx.lineTo(x0 + 100, y); ctx.moveTo(x0 + 70, y - 104); ctx.lineTo(x0 + 70, y - 6); ctx.stroke();
    ctx.fillStyle = '#fff'; ctx.fillRect(x0 + 36, y - 112, 68, 52); ['#ef6f6c', '#4f8ff7', '#f2b84b', '#5cc08a'].forEach((c, k) => { ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x0 + 52 + k * 15, y - 92 + (k % 2) * 12, 8, 0, 7); ctx.fill(); });
    ctx.fillStyle = '#b5704a'; ctx.beginPath(); ctx.ellipse(x0 + 170, y - 40, 22, 28, 0, 0, 7); ctx.fill(); ctx.fillStyle = '#6b4226'; ctx.beginPath(); ctx.arc(x0 + 170, y - 40, 7, 0, 7); ctx.fill(); ctx.fillStyle = '#8a5d44'; ctx.fillRect(x0 + 166, y - 110, 8, 44);
    ctx.fillStyle = '#c9a27a'; ctx.fillRect(x0 + 230, y - 34, 90, 5); ctx.fillRect(x0 + 238, y - 29, 4, 29); ctx.fillRect(x0 + 308, y - 29, 4, 29);
    for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) { ctx.fillStyle = (r + k) % 2 ? '#3d4252' : '#f4f1ea'; ctx.fillRect(x0 + 250 + k * 12, y - 52 + r * 4 - 0, 12, 4); }
    ctx.fillStyle = '#f4f4f4'; ctx.beginPath(); ctx.arc(x0 + 380, y - 12, 12, 0, 7); ctx.fill(); ctx.fillStyle = '#2b2f3a'; ctx.beginPath(); ctx.arc(x0 + 380, y - 12, 4, 0, 7); ctx.fill();
    ctx.fillStyle = '#6dbb6b'; ctx.beginPath(); ctx.arc(x0 + 410, y - 36, 12, 0, 7); ctx.fill(); ctx.fillStyle = '#b5704a'; ctx.fillRect(x0 + 404, y - 24, 12, 24);
  },
  bedroom(ctx, x0, w, y) {
    ctx.fillStyle = '#8a5d44'; ctx.fillRect(x0 + 24, y - 76, 10, 76); ctx.fillRect(x0 + 24, y - 28, 175, 28);
    ctx.fillStyle = '#e9eef6'; rr(ctx, x0 + 34, y - 44, 160, 20, 6); ctx.fill(); ctx.fillStyle = '#7fa6d9'; rr(ctx, x0 + 76, y - 44, 118, 20, 6); ctx.fill(); ctx.fillStyle = '#fff'; rr(ctx, x0 + 40, y - 54, 36, 14, 6); ctx.fill();
    ctx.fillStyle = '#a5785a'; ctx.fillRect(x0 + 212, y - 30, 38, 30); ctx.fillStyle = '#f2b84b'; ctx.fillRect(x0 + 228, y - 52, 5, 22); ctx.beginPath(); ctx.moveTo(x0 + 218, y - 52); ctx.lineTo(x0 + 243, y - 52); ctx.lineTo(x0 + 238, y - 64); ctx.lineTo(x0 + 223, y - 64); ctx.fill();
    ctx.fillStyle = '#a5785a'; rr(ctx, x0 + 290, y - 112, 96, 112, 4); ctx.fill(); ctx.fillStyle = '#8a5d44'; ctx.fillRect(x0 + 337, y - 112, 3, 112); ctx.fillStyle = '#f2b84b'; ctx.fillRect(x0 + 330, y - 62, 4, 10); ctx.fillRect(x0 + 343, y - 62, 4, 10);
    ctx.fillStyle = '#9fd3f0'; ctx.fillRect(x0 + 100, y - 126, 64, 40); ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.strokeRect(x0 + 100, y - 126, 64, 40); ctx.beginPath(); ctx.moveTo(x0 + 132, y - 126); ctx.lineTo(x0 + 132, y - 86); ctx.stroke();
  },
  balcony(ctx, x0, w, y, env) {
    ctx.fillStyle = 'rgba(160,190,215,.55)'; [[20, 70], [60, 96], [110, 60], [170, 84], [230, 66], [290, 100], [350, 74]].forEach(([dx, h]) => ctx.fillRect(x0 + dx, y - 26 - h, 36, h));
    ctx.fillStyle = '#7d8699'; ctx.fillRect(x0, y - 60, w, 4); ctx.fillRect(x0, y - 28, w, 3); for (let k = 0; k < w; k += 20) ctx.fillRect(x0 + k, y - 60, 3, 56);
    [[40, '#5cc08a'], [95, '#f2b84b'], [370, '#ef6f6c']].forEach(([dx, c]) => { ctx.fillStyle = '#b5704a'; ctx.fillRect(x0 + dx, y - 18, 24, 18); ctx.fillStyle = c; ctx.beginPath(); ctx.arc(x0 + dx + 12, y - 26, 13, 0, 7); ctx.fill(); });
    ctx.fillStyle = '#c9a27a'; ctx.fillRect(x0 + 200, y - 30, 70, 4); ctx.fillRect(x0 + 206, y - 26, 4, 26); ctx.fillRect(x0 + 260, y - 26, 4, 26);
    ctx.fillStyle = '#e63946'; ctx.beginPath(); ctx.moveTo(x0 + 190, y - 108); ctx.lineTo(x0 + 280, y - 108); ctx.lineTo(x0 + 235, y - 130); ctx.fill(); ctx.fillStyle = '#8a5d44'; ctx.fillRect(x0 + 233, y - 108, 4, 80);
    text(ctx, '☀', x0 + w - 50, y - 100 + Math.sin(env.time / 700) * 2, 26, '#f2b84b', 700, 'center');
  },
  rnd(ctx, x0, w, y) { ctx.fillStyle = '#d8d4ea'; ctx.fillRect(x0 + 40, y - 34, w - 80, 34); text(ctx, '💡', x0 + w / 2, y - 80, 30, '#000', 400, 'center'); },
  board(ctx, x0, w, y) { ctx.fillStyle = '#8a5d44'; ctx.fillRect(x0 + 40, y - 34, w - 80, 8); text(ctx, '🏛', x0 + w / 2, y - 80, 30, '#000', 400, 'center'); }
};

// env: { view:{w,h,s,camX,camY,dpr}, time, company, depts, unlocked(floorIdx)->bool, threshold(floorIdx), t, goods, staff:[look], player:{x,floor,dir,moving,phase}, myName, myLook, highlight, campaign, campaignText, security, trend }
export function drawInterior(ctx, env) {
  const { w, h, s, camX, camY, dpr } = env.view;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#dff0fc'; ctx.fillRect(0, 0, w, h);
  ctx.setTransform(dpr * s, 0, 0, dpr * s, -camX * dpr * s, -camY * dpr * s);
  // building shell
  const floors = env.floors ?? FLOORS, home = env.theme === 'home';
  const shellTop = home ? floorBase(floors - 1) - FH + 10 : 0;
  ctx.fillStyle = home ? '#f0dcc3' : '#e3bfa0'; ctx.fillRect(-20, shellTop, IW + 40, IH + 20 - shellTop);
  if (home) { ctx.fillStyle = '#b5523b'; ctx.beginPath(); ctx.moveTo(-40, shellTop); ctx.lineTo(IW / 2, shellTop - 84); ctx.lineTo(IW + 40, shellTop); ctx.closePath(); ctx.fill(); ctx.fillStyle = '#8a4a3a'; ctx.fillRect(IW - 150, shellTop - 70, 30, 50); }
  else { ctx.fillStyle = '#9c6b4e'; ctx.fillRect(-30, 0, IW + 60, ROOF - 14); }
  let staffIdx = 0;
  for (let f = 0; f < floors; f++) {
    const base = floorBase(f), top = base - FH + 10, open = env.unlocked(f);
    const pair = env.depts.filter(d => d.floor === f);
    pair.forEach((d, side) => {
      const x0 = side === 0 ? 10 : ELEV.x + ELEV.w, rw = (side === 0 ? ELEV.x : IW - ELEV.x - ELEV.w) - 10;
      ctx.fillStyle = WALL[d.key] || '#f6f1e7'; ctx.fillRect(x0, top, rw, FH - 10);
      ctx.fillStyle = '#e3cfb0'; ctx.fillRect(x0, base - 8, rw, 8);
      ctx.fillStyle = '#ffe9a8'; ctx.fillRect(x0 + rw / 2 - 18, top, 36, 4);
      if (open && !d.locked) {
        FURNITURE[d.key]?.(ctx, x0, rw, base - 8, env);
        // staff in this room
        const n = Math.min(2, Math.max(0, env.staff.length - staffIdx));
        for (let k = 0; k < n; k++) drawPerson(ctx, x0 + rw - 70 - k * 50, base - 8, env.staff[staffIdx++], { dir: -1, scale: 0.95 });
      }
      // sign plate
      const label = `${DEPT_ICON[d.key]} ${env.t('dept.' + d.key)}`;
      ctx.font = '700 13px system-ui, sans-serif';
      const tw = ctx.measureText(label).width + 20;
      ctx.fillStyle = env.highlight === d.key ? '#2f6fe4' : 'rgba(35,40,55,.78)'; rr(ctx, x0 + 12, top + 10, tw, 24, 12); ctx.fill();
      text(ctx, label, x0 + 22, top + 27, 13, '#fff', 700);
      if (!open || d.locked) {
        ctx.fillStyle = 'rgba(120,126,140,.55)'; ctx.fillRect(x0, top, rw, FH - 10);
        const why = d.locked ? env.t('dept.premium') : env.t('dept.unlockAt', { cash: env.threshold(f) });
        text(ctx, '🔒 ' + why, x0 + rw / 2, base - FH / 2, 13, '#fff', 700, 'center');
      }
    });
    // slab
    ctx.fillStyle = '#b49377'; ctx.fillRect(-20, base, IW + 40, 10);
    if (home) { // stairs
      ctx.fillStyle = '#e6d2b6'; ctx.fillRect(ELEV.x, top, ELEV.w, FH - 10);
      ctx.fillStyle = '#a5785a'; for (let k = 0; k < 7; k++) ctx.fillRect(ELEV.x + 6 + k * 10, base - 14 - k * 17, 74 - k * 10, 6);
      ctx.fillStyle = '#8a5d44'; ctx.fillRect(ELEV.x + 4, base - 18, 3, -108 + 18 + 18);
      text(ctx, '🪜 ' + (f + 1), ELEV.x + 40, top + 21, 11, '#6b4226', 700, 'center');
    } else {
    // elevator
    ctx.fillStyle = '#c9ced8'; ctx.fillRect(ELEV.x, top, ELEV.w, FH - 10);
    ctx.fillStyle = '#9aa3b5'; ctx.fillRect(ELEV.x + 10, base - 100, 28, 92); ctx.fillRect(ELEV.x + 42, base - 100, 28, 92);
    ctx.fillStyle = env.player.floor === f ? '#5cc08a' : '#7d8699';
    rr(ctx, ELEV.x + 26, top + 8, 28, 16, 4); ctx.fill();
    text(ctx, String(f + 1), ELEV.x + 40, top + 21, 11, '#fff', 700, 'center');
    }
  }
  // player
  const p = env.player;
  drawPerson(ctx, p.x, floorBase(p.floor) - 8, env.myLook, { dir: p.dir, moving: p.moving, phase: p.phase, label: env.myName, mine: true });
}

export function staffLooks(state, c) {
  const looks = [...c.founders, ...c.employees].map(id => { const p = state.players[id]; return teamLook(lookFor(p?.avatar ?? 3), state.teams?.[p?.team]?.color); });
  for (let k = 0; k < (c.npcStaff || 0); k++) looks.push(npcLook(500 + k * 17));
  if (c.isNpc) looks.push(npcLook(42), npcLook(77));
  return looks;
}
