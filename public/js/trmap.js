// public/js/trmap.js
// Stylized map of Türkiye (rough outline, not survey-grade) with clickable city markers. Used for choosing the city of a room.
const OUTLINE = [[26.04, 41.72], [26.6, 41.97], [27.95, 42.0], [28.5, 41.55], [29.1, 41.22], [29.9, 41.15], [30.6, 41.05], [31.2, 41.1], [31.8, 41.45], [32.35, 41.7], [33.0, 42.0],
  [33.8, 42.0], [34.8, 41.95], [35.2, 42.05], [36.0, 41.7], [36.45, 41.25], [37.3, 41.15], [38.4, 40.95], [39.2, 41.05], [40.0, 40.98], [40.9, 41.15], [41.5, 41.52], [42.4, 41.5],
  [43.2, 41.1], [43.7, 40.6], [44.3, 40.05], [44.8, 39.7], [44.6, 39.3], [44.4, 38.4], [44.2, 37.8], [44.6, 37.2], [44.2, 36.98], [43.2, 37.3], [42.35, 37.1], [41.2, 37.1],
  [40.2, 36.9], [39.0, 36.7], [38.0, 36.85], [37.0, 36.65], [36.7, 36.8], [36.2, 36.7], [36.15, 35.9], [35.9, 36.3], [35.8, 36.7], [35.0, 36.65], [34.6, 36.75], [34.0, 36.2],
  [33.4, 36.15], [32.8, 36.05], [32.3, 36.35], [31.7, 36.65], [31.0, 36.8], [30.5, 36.85], [30.55, 36.5], [29.7, 36.15], [29.1, 36.65], [28.5, 36.75], [28.0, 36.85], [27.5, 37.0],
  [27.25, 37.5], [27.2, 37.85], [26.9, 38.2], [26.7, 38.7], [26.75, 39.3], [26.4, 39.55], [26.15, 39.9], [26.2, 40.2], [26.1, 40.6], [26.05, 41.0], [26.35, 41.2], [26.55, 41.6]];
const MARMARA = [[27.2, 40.95], [28.2, 41.0], [29.0, 40.95], [29.5, 40.75], [29.3, 40.4], [28.3, 40.35], [27.5, 40.4]];
const LON0 = 25.6, LAT0 = 42.3, K = 60, KX = K * Math.cos((39 * Math.PI) / 180);
export const MAP_W = Math.round((45 - LON0) * KX), MAP_H = Math.round((42.3 - 35.7) * K);
const px = (lon, lat) => [(lon - LON0) * KX, (LAT0 - lat) * K];
const path = pts => 'M' + pts.map(([lo, la]) => px(lo, la).map(v => v.toFixed(1)).join(',')).join('L') + 'Z';
const NS = 'http://www.w3.org/2000/svg';
const mk = (tag, attrs = {}, text) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text != null) e.textContent = text; return e; };

// cities: [{ key, name, lon, lat, status }]; selected: key; onPick(city) is called for every click (locked cities too, so the caller can explain)
export function renderTrMap(cities, { selected, onPick }) {
  const svg = mk('svg', { viewBox: `0 0 ${MAP_W} ${MAP_H}`, class: 'trMap', role: 'img', 'aria-label': 'Türkiye' });
  svg.append(mk('path', { d: path(OUTLINE), class: 'trLand' }), mk('path', { d: path(MARMARA), class: 'trSea' }));
  for (const c of cities) {
    const [x, y] = px(c.lon, c.lat), g = mk('g', { class: `trCity ${c.status}${c.key === selected ? ' sel' : ''}`, tabindex: 0, role: 'button', 'aria-label': c.name });
    g.append(mk('circle', { cx: x, cy: y, r: c.status === 'open' ? 9 : 7 }), mk('text', { x, y: y - 13, 'text-anchor': 'middle' }, (c.status === 'open' ? '' : '🔒 ') + c.name));
    g.onclick = () => onPick(c); g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(c); } };
    svg.append(g);
  }
  return svg;
}

// Sprint 29b: world overview map. data[cityKey] = { current, companies[], home, team, players }; cities as for renderTrMap.
// Cities where the player has something get a larger pin with badges (🏢 companies, 🏠 home, 👥 team); others are small grey dots. onPick(city, info) on click.
export function renderWorldMap(cities, data, { onPick, labels }) {
  const svg = mk('svg', { viewBox: `0 0 ${MAP_W} ${MAP_H}`, class: 'trMap worldMap', role: 'img', 'aria-label': 'Türkiye' });
  svg.append(mk('path', { d: path(OUTLINE), class: 'trLand' }), mk('path', { d: path(MARMARA), class: 'trSea' }));
  for (const c of cities) {
    const info = data[c.key], [x, y] = px(c.lon, c.lat), has = !!info && (info.companies.length || info.home || info.team);
    const g = mk('g', { class: `trCity wm ${c.status}${info?.current ? ' here' : ''}${has ? ' has' : ''}`, tabindex: 0, role: 'button', 'aria-label': c.name });
    g.append(mk('circle', { cx: x, cy: y, r: has ? 11 : info ? 8 : 6 }));
    if (info?.current) g.append(mk('circle', { cx: x, cy: y, r: 17, class: 'pulse' }));
    g.append(mk('text', { x, y: y - 16, 'text-anchor': 'middle', class: 'nm' }, c.name));
    const badge = [info?.companies.length ? `🏢${info.companies.length}` : '', info?.home ? '🏠' : '', info?.team ? `👥${info.team.members}` : ''].filter(Boolean).join(' ');
    if (badge) g.append(mk('text', { x, y: y + 24, 'text-anchor': 'middle', class: 'bd' }, badge));
    else if (c.status !== 'open') g.append(mk('text', { x, y: y + 20, 'text-anchor': 'middle', class: 'bd' }, '🔒'));
    g.onclick = () => onPick(c, info || null); g.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(c, info || null); } };
    svg.append(g);
  }
  return svg;
}
