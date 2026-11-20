// public/js/ads.js
// Shared ad renderer: the same sprite is used on the street (billboard, bus stop, bus, walls, roofs), in the mobile banner,
// in the owner's editor preview and in the admin moderation list. Ads are rendered once into a small cached canvas.
export const AD_SIZE = { billboard: [200, 100], stop: [100, 140], bus: [160, 32], wall: [150, 40], roof: [160, 56], mobile: [320, 50] };
const SCALE = 2, MAX_SPRITES = 80;

// Remote images: loaded lazily, never sending a referrer. A failed image falls back to the ad's background colour.
const images = new Map();
function imageFor(url) {
  let e = images.get(url);
  if (!e) {
    if (images.size > 40) images.clear();
    e = { img: new Image(), state: 'loading' };
    e.img.referrerPolicy = 'no-referrer'; e.img.decoding = 'async';
    e.img.onload = () => (e.state = 'ok'); e.img.onerror = () => (e.state = 'err');
    e.img.src = url; images.set(url, e);
  }
  return e;
}
const sprites = new Map();

function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function wrapLines(g, text, maxW) {
  const lines = []; let cur = '';
  for (const word of String(text).split(' ')) {
    const next = cur ? cur + ' ' + word : word;
    if (g.measureText(next).width > maxW && cur) { lines.push(cur); cur = word; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines;
}
// Text block: title (bigger) + text, shrinking the font until everything fits the panel
function drawText(g, c, w, h, pad) {
  let fs = c.fontSize, lines = [], titleLines = [], lh = 0;
  const weight = c.bold ? '700' : '500';
  for (let i = 0; i < 14; i++) {
    g.font = `700 ${fs * 1.15}px system-ui, sans-serif`; titleLines = c.title ? wrapLines(g, c.title, w - pad * 2) : [];
    g.font = `${weight} ${fs}px system-ui, sans-serif`; lines = c.text ? wrapLines(g, c.text, w - pad * 2) : [];
    lh = fs * 1.2; if (titleLines.length * lh * 1.15 + lines.length * lh <= h - pad * 2 || fs <= 7) break; fs *= 0.88;
  }
  const total = titleLines.length * lh * 1.15 + lines.length * lh;
  let y = (h - total) / 2; const x = c.align === 'left' ? pad : c.align === 'right' ? w - pad : w / 2;
  g.fillStyle = c.color; g.textAlign = c.align; g.textBaseline = 'top';
  g.font = `700 ${fs * 1.15}px system-ui, sans-serif`; titleLines.forEach(l => { g.fillText(l, x, y); y += lh * 1.15; });
  g.font = `${weight} ${fs}px system-ui, sans-serif`; lines.forEach(l => { g.fillText(l, x, y); y += lh; });
}
// Returns a cached canvas (or null when there is no creative). Key includes the image state so it refreshes once loaded.
export function adSprite(kind, c) {
  if (!c || !AD_SIZE[kind]) return null;
  const im = c.type === 'image' && c.imageUrl ? imageFor(c.imageUrl) : null;
  const key = [kind, c.type, c.title, c.text, c.fontSize, c.color, c.bg, c.align, c.bold, c.imageUrl, im?.state].join('\u0001');
  let cv = sprites.get(key); if (cv) return cv;
  if (sprites.size > MAX_SPRITES) sprites.clear();
  const [w, h] = AD_SIZE[kind];
  cv = document.createElement('canvas'); cv.width = w * SCALE; cv.height = h * SCALE;
  const g = cv.getContext('2d'); g.scale(SCALE, SCALE);
  g.save(); roundRect(g, 0, 0, w, h, Math.min(8, h / 4)); g.clip();
  g.fillStyle = c.bg; g.fillRect(0, 0, w, h);
  if (im?.state === 'ok') {
    const iw = im.img.naturalWidth || w, ih = im.img.naturalHeight || h, k = Math.max(w / iw, h / ih), dw = iw * k, dh = ih * k;
    g.drawImage(im.img, (w - dw) / 2, (h - dh) / 2, dw, dh);
    if (c.title || c.text) { g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, h * 0.62, w, h * 0.38); g.save(); g.translate(0, h * 0.62); drawText(g, { ...c, fontSize: Math.min(c.fontSize, h * 0.2) }, w, h * 0.38, 6); g.restore(); }
  } else if (im) { g.fillStyle = 'rgba(255,255,255,.85)'; g.font = `${Math.min(24, h * 0.5)}px system-ui`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(im.state === 'err' ? '🖼 ✕' : '…', w / 2, h / 2); }
  else drawText(g, c, w, h, Math.max(5, h * 0.08));
  g.restore();
  g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; roundRect(g, 0.5, 0.5, w - 1, h - 1, Math.min(8, h / 4)); g.stroke();
  sprites.set(key, cv); return cv;
}
export function drawAd(ctx, kind, c, x, y, w, h) { const s = adSprite(kind, c); if (s) ctx.drawImage(s, x, y, w, h); return !!s; }
// Fills a visible <canvas> (editor preview, admin list, mobile banner) with the ad, keeping the design aspect ratio
export function paintAd(canvas, kind, c) {
  const [w, h] = AD_SIZE[kind]; canvas.width = w * SCALE; canvas.height = h * SCALE; canvas.style.aspectRatio = `${w} / ${h}`;
  const g = canvas.getContext('2d'); g.clearRect(0, 0, canvas.width, canvas.height);
  const s = adSprite(kind, c); if (s) g.drawImage(s, 0, 0); return !!s;
}
