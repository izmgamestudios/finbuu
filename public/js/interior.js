// public/js/interior.js
// Company HQ interior: same side-view 2D language as the street. A cross-section of the building:
// each floor = two departments + an elevator. Floors unlock as the building grows (cash -> floors).
import { drawPerson, lookFor, hash } from './world.js';

export const IW = 960, FH = 150, FLOORS = 4, ROOF = 34;
export const IH = FLOORS * FH + ROOF;
export const ELEV = { x: 440, w: 80 };
export const DEPT_ICON = { sales: '🛒', finance: '💰', accounting: '🧾', marketing: '📣', hr: '👥', it: '🖥', rnd: '🔬', board: '🏛' };
const WALL = { sales: '#fbf3e4', finance: '#eef6fd', accounting: '#f4f1ea', marketing: '#fdf0f3', hr: '#f0f8f1', it: '#eceff6', rnd: '#f1eefb', board: '#f6f1e7' };

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
  ctx.fillStyle = '#e3bfa0'; ctx.fillRect(-20, 0, IW + 40, IH + 20);
  ctx.fillStyle = '#9c6b4e'; ctx.fillRect(-30, 0, IW + 60, ROOF - 14);
  let staffIdx = 0;
  for (let f = 0; f < FLOORS; f++) {
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
    // elevator
    ctx.fillStyle = '#c9ced8'; ctx.fillRect(ELEV.x, top, ELEV.w, FH - 10);
    ctx.fillStyle = '#9aa3b5'; ctx.fillRect(ELEV.x + 10, base - 100, 28, 92); ctx.fillRect(ELEV.x + 42, base - 100, 28, 92);
    ctx.fillStyle = env.player.floor === f ? '#5cc08a' : '#7d8699';
    rr(ctx, ELEV.x + 26, top + 8, 28, 16, 4); ctx.fill();
    text(ctx, String(f + 1), ELEV.x + 40, top + 21, 11, '#fff', 700, 'center');
  }
  // player
  const p = env.player;
  drawPerson(ctx, p.x, floorBase(p.floor) - 8, env.myLook, { dir: p.dir, moving: p.moving, phase: p.phase, label: env.myName, mine: true });
}

export function staffLooks(state, c) {
  const looks = [...c.founders, ...c.employees].map(id => lookFor(state.players[id]?.avatar ?? 3));
  for (let k = 0; k < (c.npcStaff || 0); k++) looks.push(lookFor(500 + k * 17));
  if (c.isNpc) looks.push(lookFor(42), lookFor(77));
  return looks;
}
