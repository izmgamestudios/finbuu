// public/js/board.js — GamFed board: TOY 10-step sentence canvas, Business Model Canvas and Pitch Deck.
// Pure drawing + export helpers (no DOM state): used by the game (app.js) and by the read-only share page (board.html).
export const TOY_N = 10;
export const BMC_KEYS = ['keyPartners', 'keyActivities', 'keyResources', 'valueProps', 'customerRelationships', 'channels', 'customerSegments', 'costStructure', 'revenueStreams'];
export const DECK_IDS = ['problem', 'solution', 'market', 'product', 'model', 'traction', 'competition', 'team', 'finance', 'ask'];
export const LIMITS = { title: 80, toy: 300, bmc: 400, slideTitle: 80, slideBody: 600, slides: 12 };

export const newBoard = () => ({
  title: '',
  toy: Array.from({ length: TOY_N }, () => ''),
  bmc: Object.fromEntries(BMC_KEYS.map(k => [k, ''])),
  deck: DECK_IDS.map(id => ({ id, title: '', body: '' }))
});

// Make any stored/received object safe and complete (same rules as the server)
export function cleanBoard(b) {
  const out = newBoard(), s = (v, n) => String(v ?? '').slice(0, n);
  if (!b || typeof b !== 'object') return out;
  out.title = s(b.title, LIMITS.title);
  if (Array.isArray(b.toy)) out.toy = out.toy.map((_, i) => s(b.toy[i], LIMITS.toy));
  if (b.bmc && typeof b.bmc === 'object') BMC_KEYS.forEach(k => { out.bmc[k] = s(b.bmc[k], LIMITS.bmc); });
  if (Array.isArray(b.deck)) out.deck = b.deck.slice(0, LIMITS.slides).map((x, i) => ({ id: s(x?.id || DECK_IDS[i] || 'custom', 20), title: s(x?.title, LIMITS.slideTitle), body: s(x?.body, LIMITS.slideBody) }));
  return out;
}

// "Kurumun {1} iş hedeflerini ..." -> [{text}, {n: 1}, ...]
export const sentenceParts = tpl => String(tpl).split(/\{(\d+)\}/).map((p, i) => (i % 2 ? { n: Number(p) } : { text: p })).filter(p => p.n || p.text);

const GOLD = '#f5b942', INK = '#0b0f1a', PAPER = '#fffdf7';
function wrapLines(ctx, text, maxW) {
  const out = [];
  for (const para of String(text).split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? line + ' ' + word : word;
      if (ctx.measureText(test).width <= maxW || !line) line = test; else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}
function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h); }
function fitText(ctx, text, x, y, w, h, { font = 'Nunito, system-ui, sans-serif', max = 26, min = 12, color = '#222', lh = 1.25 } = {}) {
  for (let size = max; size >= min; size -= 1) {
    ctx.font = `600 ${size}px ${font}`; const lines = wrapLines(ctx, text, w);
    if (lines.length * size * lh <= h || size === min) {
      ctx.fillStyle = color; ctx.textBaseline = 'top';
      lines.slice(0, Math.max(1, Math.floor(h / (size * lh)))).forEach((l, i) => ctx.fillText(l, x, y + i * size * lh));
      return;
    }
  }
}
function footer(ctx, W, H, labels, board, dark) {
  ctx.font = '600 15px Nunito, system-ui, sans-serif'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = dark ? '#8d96a8' : '#7a8190';
  ctx.fillText(`${board.title || labels.untitled} · ${labels.brand}`, 32, H - 20); ctx.textAlign = 'right'; ctx.fillText(labels.site, W - 32, H - 20); ctx.textAlign = 'left';
}

// TOY Gamification Decards sentence poster (1280 x 800)
export function drawToy(board, labels) {
  const W = 1280, H = 800, c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = GOLD; ctx.font = '800 22px Nunito, system-ui, sans-serif'; ctx.textBaseline = 'alphabetic'; ctx.fillText(`🎮 ${labels.toyTitle}`, 40, 52);
  if (board.title) { ctx.fillStyle = '#fff'; ctx.font = '700 18px Nunito, system-ui, sans-serif'; ctx.fillText(board.title, 40, 82); }
  const tokens = [];
  for (const p of sentenceParts(labels.sentence)) {
    if (p.n) { const v = (board.toy[p.n - 1] || '').trim(); tokens.push({ badge: p.n, text: v || `[${labels.toyLabels[p.n - 1]}]`, color: v ? GOLD : '#6b7280' }); }
    else tokens.push({ text: p.text, color: '#fff' });
  }
  const size = 34, lh = 62, left = 60, maxW = W - 120; let x = left, y = 150;
  ctx.font = `700 ${size}px Nunito, system-ui, sans-serif`; ctx.textBaseline = 'alphabetic';
  for (const tk of tokens) {
    const words = tk.text.split(/(\s+)/).filter(w => w.length);
    if (tk.badge) {
      if (x + 34 > left + maxW) { x = left; y += lh; }
      roundRect(ctx, x, y - 26, 28, 28, 6); ctx.fillStyle = GOLD; ctx.fill(); ctx.fillStyle = INK; ctx.font = '800 17px Nunito, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.fillText(String(tk.badge), x + 14, y - 6); ctx.textAlign = 'left'; x += 36;
      ctx.font = `700 ${size}px Nunito, system-ui, sans-serif`;
    }
    for (const w of words) {
      const wd = ctx.measureText(w).width;
      if (x + wd > left + maxW && w.trim()) { x = left; y += lh; }
      if (x === left && !w.trim()) continue;
      ctx.fillStyle = tk.color; ctx.fillText(w, x, y); x += wd;
    }
  }
  footer(ctx, W, H, labels, board, true);
  return c;
}

// Business Model Canvas (1280 x 800)
export function drawBmc(board, labels) {
  const W = 1280, H = 800, c = makeCanvas(W, H), ctx = c.getContext('2d');
  ctx.fillStyle = PAPER; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = INK; ctx.font = '800 26px Nunito, system-ui, sans-serif'; ctx.textBaseline = 'alphabetic'; ctx.fillText(`📋 ${labels.bmcTitle}${board.title ? ' · ' + board.title : ''}`, 32, 44);
  const gx = 24, gy = 64, cw = (W - gx * 2) / 5, rh = (H - gy - 56) / 5; // 5 columns, 5 half-rows; blocks span rows
  const cells = { keyPartners: [0, 0, 1, 4], keyActivities: [1, 0, 1, 2], keyResources: [1, 2, 1, 2], valueProps: [2, 0, 1, 4], customerRelationships: [3, 0, 1, 2], channels: [3, 2, 1, 2], customerSegments: [4, 0, 1, 4], costStructure: [0, 4, 2.5, 1], revenueStreams: [2.5, 4, 2.5, 1] };
  for (const k of BMC_KEYS) {
    const [cx, cy, sw, sh] = cells[k], x = gx + cx * cw, y = gy + cy * rh, w = sw * cw - 8, h = sh * rh - 8;
    roundRect(ctx, x, y, w, h, 10); ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#d8d2c0'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#b4750c'; ctx.font = '800 17px Nunito, system-ui, sans-serif'; ctx.textBaseline = 'alphabetic'; ctx.fillText(labels.bmc[k], x + 12, y + 26);
    const v = (board.bmc[k] || '').trim();
    fitText(ctx, v || '—', x + 12, y + 38, w - 24, h - 48, { max: 22, min: 11, color: v ? '#1f2937' : '#b0b6c2' });
  }
  footer(ctx, W, H, labels, board, false);
  return c;
}

// One pitch-deck slide (1280 x 720)
export function drawSlide(board, i, labels) {
  const W = 1280, H = 720, c = makeCanvas(W, H), ctx = c.getContext('2d'), s = board.deck[i];
  const g = ctx.createLinearGradient(0, 0, W, H); g.addColorStop(0, '#0f1b3d'); g.addColorStop(1, '#1d2f66'); ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = GOLD; ctx.fillRect(0, 0, 14, H);
  ctx.fillStyle = '#8fa2d8'; ctx.font = '700 20px Nunito, system-ui, sans-serif'; ctx.textBaseline = 'alphabetic'; ctx.fillText(`${i + 1} / ${board.deck.length}`, 60, 70);
  const title = (s.title || '').trim() || labels.deck[s.id] || labels.slide;
  ctx.fillStyle = GOLD; ctx.font = '800 56px Nunito, system-ui, sans-serif'; ctx.fillText(title.slice(0, 40), 60, 150);
  const v = (s.body || '').trim();
  fitText(ctx, v || labels.emptySlide, 60, 200, W - 140, H - 300, { max: 38, min: 16, color: v ? '#ffffff' : '#6f7ca3', lh: 1.35 });
  footer(ctx, W, H, labels, board, true);
  return c;
}

export const allPages = (board, labels) => [drawToy(board, labels), drawBmc(board, labels), ...board.deck.map((_, i) => drawSlide(board, i, labels))];
export const toBlob = (canvas, type = 'image/png', q = 0.92) => new Promise(r => canvas.toBlob(r, type, q));

// Minimal multi-page PDF: every page is one JPEG covering the whole page (size = canvas size in points * 0.75)
export async function pdfFromCanvases(canvases) {
  const enc = new TextEncoder(), parts = []; let len = 0; const offsets = [];
  const push = d => { const u = typeof d === 'string' ? enc.encode(d) : d; parts.push(u); len += u.length; };
  const obj = (n, body) => { offsets[n] = len; push(`${n} 0 obj\n${body}\nendobj\n`); };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = canvases.length; obj(1, '<</Type/Catalog/Pages 2 0 R>>');
  obj(2, `<</Type/Pages/Kids [${canvases.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}]/Count ${n}>>`);
  for (let i = 0; i < n; i++) {
    const cv = canvases[i], W = Math.round(cv.width * 0.75), H = Math.round(cv.height * 0.75), p = 3 + 3 * i;
    const jpg = new Uint8Array(await (await toBlob(cv, 'image/jpeg', 0.9)).arrayBuffer());
    obj(p, `<</Type/Page/Parent 2 0 R/MediaBox[0 0 ${W} ${H}]/Contents ${p + 1} 0 R/Resources<</XObject<</Im0 ${p + 2} 0 R>>>>>>`);
    const cs = `q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`; obj(p + 1, `<</Length ${cs.length}>>\nstream\n${cs}\nendstream`);
    offsets[p + 2] = len; push(`${p + 2} 0 obj\n<</Type/XObject/Subtype/Image/Width ${cv.width}/Height ${cv.height}/ColorSpace/DeviceRGB/BitsPerComponent 8/Filter/DCTDecode/Length ${jpg.length}>>\nstream\n`); push(jpg); push('\nendstream\nendobj\n');
  }
  const total = 3 + 3 * n, xref = len; let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offsets[i]).padStart(10, '0') + ' 00000 n \n';
  push(x + `trailer\n<</Size ${total}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`);
  return new Blob(parts, { type: 'application/pdf' });
}

export function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
}
export const slug = s => (String(s || 'finbuu-board').toLowerCase().replace(/[^a-z0-9ığüşöç]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'finbuu-board');
