// public/js/refs.js — Sprint 36: Open Source building · official reference lists (NACE Rev.2.1, İŞKUR occupations, HS) with detailed search,
// the bibliography, and "My documents": virtual tax plate / customs document / occupation sheet for a company.
import { toBlob, pdfFromCanvases, download, slug } from './board.js';

const T = (k, o) => i18next.t('refs.' + k, o);
const SETS = ['nace', 'jobs', 'hs'];
const FILE = { nace: '/data/nace.json', jobs: '/data/meslek.json', hs: '/data/hs.json' };
const ICON = { nace: '🏭', jobs: '👷', hs: '📦' };
const LIST_OF = { taxPlate: 'nace', customs: 'hs', jobs: 'jobs' };
const DOC_ICON = { taxPlate: '🧾', customs: '🛃', jobs: '👷' };
const PAGE = 30;
// Turkish-aware, accent-insensitive normalisation: "Çiçekçi" ~ "cicekci", "I/İ/ı" all fold to "i"
const norm = s => String(s ?? '').replace(/İ/g, 'i').replace(/I/g, 'i').toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ğ/g, 'g').replace(/ş/g, 's').replace(/ç/g, 'c').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/\s+/g, ' ').trim();

export function createRefsUi({ el, btn, kpi, toast, socket, openModal, closeModal, getState, companyName, founderCos, openOss }) {
  const cache = {}, loading = {};
  const call = (ev, payload) => new Promise(res => socket.timeout(5000).emit(ev, payload, (err, r) => res(err ? { ok: false } : r)));

  // ---------- data ----------
  async function load(kind) {
    if (cache[kind]) return cache[kind];
    loading[kind] ||= fetch(FILE[kind]).then(r => { if (!r.ok) throw new Error(r.status); return r.json(); }).then(doc => (cache[kind] = prepare(kind, doc)));
    try { return await loading[kind]; } catch (e) { delete loading[kind]; throw e; }
  }
  function prepare(kind, doc) {
    const byCode = new Map();
    const rows = (doc.items || []).map(it => {
      const row = { code: it[0], name: it[1], raw: it, n: norm(it[1]) };
      row.k = norm(it[0] + ' ' + String(it[0]).replace(/\./g, '')); byCode.set(it[0], row); return row;
    });
    if (kind === 'nace') {
      const mk = new Map((doc.meslek || []).map(m => [m[0], { code: m[0], sector: m[1], name: m[2] }]));
      rows.forEach(r => { r.meslek = (r.raw[2] || []).map(c => mk.get(c)).filter(Boolean); r.esnaf = r.meslek.length > 0; r.sector = [...new Set(r.meslek.map(m => m.sector))]; r.n += ' ' + norm(r.meslek.map(m => m.name).join(' ')); });
      return { kind, doc, rows, byCode, sectors: new Map(doc.sectors || []), meslek: mk };
    }
    if (kind === 'hs') {
      rows.forEach(r => { r.level = r.raw[3]; r.parent = r.raw[2]; r.section = r.raw[4]; });
      return { kind, doc, rows, byCode, sections: new Map(doc.sections || []) };
    }
    rows.forEach(r => { r.group = String(r.code)[0]; });
    return { kind, doc, rows, byCode, groups: doc.groups || {} };
  }
  const lookupName = (kind, code) => cache[kind]?.byCode.get(code)?.name || '';

  // ---------- frame: tabs shared by Open Source building, lists and documents ----------
  function frame(tab, fill) {
    openModal(body => {
      body.classList.add('wideBody');
      const bar = el('div', null, 'others');
      [['tools', '🧰 ' + T('tab.tools'), () => openOss()], ['lists', '📚 ' + T('tab.lists'), () => openLists()], ['docs', '📄 ' + T('tab.docs'), () => openDocs()]].forEach(([k, label, fn]) => bar.append(btn(label, fn, { primary: k === tab })));
      body.append(bar); fill(body);
    });
  }
  const bar = () => { const d = el('div', null, 'others'); return d; };
  const tabBar = tab => { const b = bar(); [['tools', '🧰 ' + T('tab.tools'), () => openOss()], ['lists', '📚 ' + T('tab.lists'), () => openLists()], ['docs', '📄 ' + T('tab.docs'), () => openDocs()]].forEach(([k, label, fn]) => b.append(btn(label, fn, { primary: k === tab }))); return b; };

  // ---------- 1) official lists with detailed search ----------
  const view = { set: 'nace', q: '', f: {}, shown: PAGE };
  function openLists(set) {
    if (set) { view.set = set; view.q = ''; view.f = {}; view.shown = PAGE; }
    openModal(body => {
      body.classList.add('wideBody');
      body.append(tabBar('lists'), el('h3', '📚 ' + T('title')), el('p', T('intro'), 'muted'));
      const seg = el('div', null, 'others');
      SETS.forEach(k => seg.append(btn(`${ICON[k]} ${T('set.' + k)}`, () => openLists(k), { primary: k === view.set })));
      body.append(seg);
      const holder = el('div'); body.append(holder);
      holder.append(el('small', T('loading'), 'muted'));
      load(view.set).then(ds => renderSet(holder, ds), () => holder.replaceChildren(el('small', T('loadFail'), 'muted')));
      body.append(bibliography());
    });
  }
  function select(options, value, onChange) { const s = el('select'); options.forEach(([v, l]) => s.append(new Option(l, v))); s.value = value ?? ''; s.onchange = () => onChange(s.value); return s; }
  function renderSet(holder, ds) {
    holder.replaceChildren();
    const kind = ds.kind, f = view.f;
    holder.append(el('small', T('count.' + kind, { n: ds.rows.length.toLocaleString(), v: ds.doc.version || '' }), 'muted'));
    const q = el('input'); q.type = 'search'; q.placeholder = T('search.' + kind); q.value = view.q; q.style.width = '100%'; q.maxLength = 80; q.setAttribute('aria-label', T('search.' + kind));
    const filters = el('div', null, 'row'); filters.style.cssText = 'flex-wrap:wrap;gap:6px;margin:6px 0';
    const list = el('div'), more = el('div'), info = el('small', '', 'muted');
    let timer = null;
    const refresh = () => { view.shown = PAGE; draw(); };
    const addFilter = (key, label, options) => { const w = el('label'); w.style.cssText = 'display:flex;flex-direction:column;gap:2px;flex:1;min-width:150px'; w.append(el('small', label, 'muted'), select(options, f[key], v => { f[key] = v; if (key === 'sector') f.meslek = ''; refresh(); if (key === 'sector') renderSet(holder, ds); })); filters.append(w); };
    if (kind === 'nace') {
      addFilter('sector', T('f.sector'), [['', T('f.all')], ...[...ds.sectors].map(([c, n]) => [c, `${c} · ${n}`])]);
      addFilter('meslek', T('f.meslek'), [['', T('f.all')], ...[...ds.meslek.values()].filter(m => !f.sector || m.sector === f.sector).map(m => [m.code, `${m.code} · ${m.name}`])]);
      addFilter('scope', T('f.scope'), [['', T('f.scopeAll')], ['esnaf', T('f.scopeEsnaf')], ['other', T('f.scopeOther')]]);
      addFilter('div', T('f.division'), [['', T('f.all')], ...[...new Set(ds.rows.map(r => r.code.slice(0, 2)))].map(d => [d, d])]);
    } else if (kind === 'hs') {
      addFilter('section', T('f.section'), [['', T('f.all')], ...[...ds.sections].map(([c, n]) => [c, `${c} · ${n.slice(0, 60)}`])]);
      addFilter('level', T('f.level'), [['', T('f.all')], ['2', T('hs.l2')], ['4', T('hs.l4')], ['6', T('hs.l6')]]);
    } else {
      const groups = [...new Set(ds.rows.map(r => r.group))].sort();
      addFilter('group', T('f.group'), [['', T('f.all')], ...groups.map(g => [g, ds.groups[g] ? `${g} · ${ds.groups[g]}` : g])]);
    }
    holder.append(q, filters, info, list, more);
    const matches = () => {
      const toks = norm(q.value).split(' ').filter(Boolean), hits = [];
      for (const r of ds.rows) {
        if (kind === 'nace') {
          if (f.sector && !r.sector.includes(f.sector)) continue;
          if (f.meslek && !r.meslek.some(m => m.code === f.meslek)) continue;
          if (f.scope === 'esnaf' && !r.esnaf) continue; if (f.scope === 'other' && r.esnaf) continue;
          if (f.div && r.code.slice(0, 2) !== f.div) continue;
        } else if (kind === 'hs') { if (f.section && r.section !== f.section) continue; if (f.level && String(r.level) !== f.level) continue; }
        else if (f.group && r.group !== f.group) continue;
        let ok = true, score = 0;
        for (const t of toks) { const inCode = r.k.includes(t), inName = r.n.includes(t); if (!inCode && !inName) { ok = false; break; } score += r.k.startsWith(t) ? 3 : inCode ? 2 : r.n.startsWith(t) ? 2 : 1; }
        if (ok) hits.push([score, r]);
      }
      if (toks.length) hits.sort((a, b) => b[0] - a[0]);
      return hits.map(h => h[1]);
    };
    const draw = () => {
      const hits = matches(); list.replaceChildren(); more.replaceChildren();
      info.textContent = T('results', { n: hits.length.toLocaleString() });
      hits.slice(0, view.shown).forEach(r => list.append(rowEl(ds, r)));
      if (!hits.length) list.append(el('small', T('noResults'), 'muted'));
      if (hits.length > view.shown) more.append(btn(T('showMore', { n: Math.min(PAGE, hits.length - view.shown) }), () => { view.shown += PAGE; draw(); }));
    };
    q.oninput = () => { clearTimeout(timer); timer = setTimeout(() => { view.q = q.value; refresh(); }, 160); };
    draw();
  }
  const badge = (txt, color) => { const b = el('b', txt); b.style.cssText = `background:${color || '#f5b942'};color:#0b0f1a;border-radius:6px;padding:1px 6px;font-size:.85em;white-space:nowrap`; return b; };
  function rowEl(ds, r) {
    const kind = ds.kind, box = el('div', null, 'prodRow'); box.style.cssText = 'display:block;margin:6px 0';
    const head = el('div'); head.style.cssText = 'display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap';
    const title = el('div'); title.style.cssText = 'flex:1;min-width:200px';
    title.append(badge(r.code), document.createTextNode(' ' + r.name));
    head.append(title, addControl(kind, r.code)); box.append(head);
    const small = [];
    if (kind === 'nace') { small.push(r.esnaf ? '✅ ' + T('nace.esnaf') : T('nace.other')); }
    if (kind === 'hs') { small.push(T('hs.l' + r.level)); }
    if (kind === 'jobs') { const g = ds.groups[r.group]; if (g) small.push(g); }
    if (small.length) box.append(el('small', small.join(' · '), 'muted'));
    // details: NACE → esnaf trades; HS → chapter / heading path
    const extra = [];
    if (kind === 'nace' && r.meslek.length) { const ul = el('ul'); r.meslek.forEach(m => ul.append(el('li', `${m.code} · ${m.name} (${ds.sectors.get(m.sector) || m.sector})`))); extra.push(el('b', T('nace.trades')), ul); }
    if (kind === 'hs') { const path = []; let cur = r; while (cur) { path.unshift(cur); cur = cur.parent ? ds.byCode.get(cur.parent) : null; } if (path.length > 1) { const ol = el('div'); path.slice(0, -1).forEach(p => ol.append(el('div', `${'↳ '.repeat(Math.max(0, path.indexOf(p)))}${p.code} · ${p.name}`))); extra.push(el('b', T('hs.path')), ol); } const sec = ds.sections.get(r.section); if (sec) extra.push(el('small', `${T('hs.section')} ${r.section}: ${sec}`, 'muted')); }
    if (extra.length) { const d = el('details'); d.append(el('summary', T('detail'))); extra.forEach(x => d.append(x)); box.append(d); }
    return box;
  }
  // ➕ add this code to one of my companies' document lists
  function addControl(kind, code) {
    const w = el('div'); w.style.cssText = 'display:flex;gap:6px;align-items:center;flex-wrap:wrap';
    const cos = founderCos();
    if (!cos.length) { w.append(el('small', T('noCompany'), 'muted')); return w; }
    const sel = el('select'); cos.forEach(c => sel.append(new Option(companyName(c), c.id))); sel.hidden = cos.length < 2; sel.value = view.cid && cos.some(c => c.id === view.cid) ? view.cid : cos[0].id; sel.onchange = () => (view.cid = sel.value);
    const b = btn('➕ ' + T('add'), async () => { b.disabled = true; view.cid = sel.value; const r = await call('docsAdd', { cid: sel.value, list: kind, code }); b.disabled = false; toast(r?.ok ? T('added') : r?.key ? i18next.t(r.key, r.params) : T('err.generic')); });
    w.append(sel, b); return w;
  }

  // ---------- bibliography ----------
  const SRC = [
    { set: 'nace', title: 'T.C. Ticaret Bakanlığı — Esnaf ve Sanatkâr Meslek Kolları · Sektör Meslek NACE Kodları (NACE Rev.2.1, altılı), güncel liste', url: 'https://ticaret.gov.tr/esnaf-sanatkarlar/esnaf-ve-sanatkar-meslek-kollari/sektor-meslek-nace-listeleri/guncel-liste', lic: 'srcPublic' },
    { set: 'jobs', title: 'T.C. İş Kurumu (İŞKUR) — Türk Meslekler Sözlüğü', url: 'https://esube.iskur.gov.tr/meslek/meslek.aspx', lic: 'srcPublic' },
    { set: 'hs', title: 'datasets/harmonized-system — Harmonized System (HS 2022); kaynak: UN Comtrade, WCO HS Nomenclature', url: 'https://github.com/datasets/harmonized-system', lic: 'srcPddl' }
  ];
  function bibliography() {
    const box = el('div', null, 'co'); box.style.marginTop = '14px';
    box.append(el('h4', '📖 ' + T('bib.title')), el('small', T('bib.intro'), 'muted'));
    const ol = el('ol');
    SRC.forEach(s => {
      const li = el('li'), a = el('a', s.title, 'extLink'); a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
      li.append(a, el('div', `${T('bib.url')}: ${s.url}`, 'muted'), el('small', `${T('bib.access')}: ${cache[s.set]?.doc.access || '2026-11-25'} · ${T('bib.' + s.lic)}${cache[s.set] ? ' · ' + T('bib.records', { n: cache[s.set].rows.length.toLocaleString() }) : ''}`, 'muted'));
      ol.append(li);
    });
    box.append(ol, el('small', T('bib.note'), 'muted'));
    return box;
  }

  // ---------- 2) my documents ----------
  async function openDocs(cidArg) {
    const cos = founderCos();
    await Promise.all(SETS.map(k => load(k).catch(() => null)));
    openModal(body => {
      body.classList.add('wideBody');
      body.append(tabBar('docs'), el('h3', '📄 ' + T('docs.title')), el('p', T('docs.intro'), 'muted'));
      if (!cos.length) return body.append(el('small', T('noCompany'), 'muted'));
      const cid = cidArg && cos.some(c => c.id === cidArg) ? cidArg : view.cid && cos.some(c => c.id === view.cid) ? view.cid : cos[0].id; view.cid = cid;
      if (cos.length > 1) { const sel = el('select'); cos.forEach(c => sel.append(new Option(companyName(c), c.id))); sel.value = cid; sel.onchange = () => openDocs(sel.value); body.append(sel); }
      const holder = el('div'); body.append(holder, el('small', T('docs.disclaimer'), 'muted'));
      call('docsGet', { cid }).then(r => { if (!r?.ok) return holder.append(el('small', T('err.generic'), 'muted')); renderDocs(holder, cid, r); });
    });
  }
  function renderDocs(holder, cid, data) {
    holder.replaceChildren();
    const co = getState().companies[cid];
    ['taxPlate', 'customs', 'jobs'].forEach(kind => {
      const list = LIST_OF[kind], codes = data.docs[list] || [], issued = data.docs.issued?.[kind], card = el('div', null, 'co');
      card.append(el('h4', `${DOC_ICON[kind]} ${T('doc.' + kind)}`), el('small', T('doc.' + kind + 'Desc'), 'muted'));
      const ul = el('div');
      codes.forEach(c => { const r = el('div', null, 'row'); r.style.cssText = 'align-items:center;gap:6px;margin:3px 0'; const t = el('span'); t.append(badge(c), document.createTextNode(' ' + lookupName(list, c))); t.style.flex = '1'; const rm = btn('✕', async () => { const x = await call('docsRemove', { cid, list, code: c }); if (x?.ok) renderDocs(holder, cid, x); }); rm.style.cssText = 'flex:none;width:auto;min-width:40px'; rm.setAttribute('aria-label', T('doc.remove')); r.append(t, rm); ul.append(r); });
      if (!codes.length) ul.append(el('small', T('doc.noCodes'), 'muted'));
      card.append(ul, el('small', T('doc.count', { n: codes.length, max: data.max[list] }), 'muted'));
      const act = el('div', null, 'row'); act.style.cssText = 'flex-wrap:wrap;gap:6px;margin-top:6px';
      act.append(btn('🔎 ' + T('doc.find'), () => openLists(list)));
      act.append(btn((issued ? '🔄 ' + T('doc.reissue') : '📄 ' + T('doc.issue')), async () => { const x = await call('docIssue', { cid, kind }); if (!x?.ok) return toast(x?.key ? i18next.t(x.key) : T('err.generic')); toast(T('doc.issued')); renderDocs(holder, cid, x); }, { primary: !issued && codes.length > 0 }));
      if (issued) { act.append(btn('👁 ' + T('doc.view'), () => viewDoc(kind, cid, data, issued))); card.append(el('small', '✅ ' + T('doc.issuedInfo', { no: issued.no, day: issued.day }), 'muted')); }
      card.append(act); holder.append(card);
    });
  }

  // ---------- virtual document rendering (canvas → screen / PNG / PDF) ----------
  function wrap(ctx, text, maxW) {
    const words = String(text).split(/\s+/), lines = []; let cur = '';
    for (const w of words) { const t = cur ? cur + ' ' + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; }
    if (cur) lines.push(cur); return lines;
  }
  function drawDoc(kind, cid, data, issued) {
    const st = getState(), co = st.companies[cid], city = st.cityName || '', W = 1000, margin = 56, list = LIST_OF[kind];
    const palette = { taxPlate: ['#0f766e', '#ccfbf1'], customs: ['#1d4ed8', '#dbeafe'], jobs: ['#9a3412', '#ffedd5'] }[kind];
    const tmp = document.createElement('canvas').getContext('2d'); tmp.font = '600 17px Nunito, system-ui, sans-serif';
    const items = (issued.codes || []).map(c => ({ code: c, lines: wrap(tmp, lookupName(list, c) || '—', W - margin * 2 - 150) }));
    const rowsH = items.reduce((a, i) => a + Math.max(34, i.lines.length * 22 + 12), 0);
    const H = 420 + rowsH + 140, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fffdf7'; ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = palette[0]; ctx.lineWidth = 6; ctx.strokeRect(14, 14, W - 28, H - 28); ctx.lineWidth = 2; ctx.strokeRect(24, 24, W - 48, H - 48);
    ctx.fillStyle = palette[0]; ctx.fillRect(24, 24, W - 48, 92);
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.font = '800 34px "Baloo 2", system-ui, sans-serif'; ctx.fillText(T('doc.' + kind + 'Title'), W / 2, 74);
    ctx.font = '700 15px Nunito, system-ui, sans-serif'; ctx.fillText(T(kind === 'customs' ? 'doc.issuerCustoms' : kind === 'jobs' ? 'doc.issuerJobs' : 'doc.issuer', { city: city || '—' }), W / 2, 100);
    ctx.fillStyle = palette[1]; ctx.fillRect(24, 116, W - 48, 30); ctx.fillStyle = palette[0]; ctx.font = '800 14px Nunito, system-ui, sans-serif'; ctx.fillText('⚠ ' + T('doc.watermark'), W / 2, 137);
    ctx.textAlign = 'left'; let y = 184;
    const field = (label, value, x, w) => { ctx.fillStyle = '#6b7280'; ctx.font = '700 13px Nunito, system-ui, sans-serif'; ctx.fillText(label.toUpperCase(), x, y); ctx.fillStyle = '#111827'; ctx.font = '800 20px "Baloo 2", system-ui, sans-serif'; const t = wrap(ctx, value, w)[0] || ''; ctx.fillText(t, x, y + 24); };
    const half = (W - margin * 2) / 2;
    field(T('doc.company'), co ? companyName(co) : '—', margin, half - 10); field(T('doc.taxNo'), data.taxNo, margin + half, half - 10); y += 62;
    field(T('doc.docNo'), issued.no, margin, half - 10); field(T('doc.date'), T('doc.dayN', { n: issued.day }), margin + half, half - 10); y += 62;
    if (kind === 'jobs') { field(T('doc.staff'), String(co ? (co.employees?.length || 0) + (co.npcStaff || 0) : 0), margin, half - 10); field(T('doc.city'), city || '—', margin + half, half - 10); y += 62; }
    else { field(kind === 'customs' ? T('doc.customsOffice') : T('doc.office'), T(kind === 'customs' ? 'doc.customsOfficeName' : 'doc.officeName', { city: city || '—' }), margin, half - 10); field(T('doc.started'), T('doc.dayN', { n: data.foundedDay }), margin + half, half - 10); y += 62; }
    ctx.fillStyle = palette[0]; ctx.font = '800 18px "Baloo 2", system-ui, sans-serif'; ctx.fillText(T('doc.' + kind + 'Table'), margin, y); y += 10;
    ctx.fillStyle = palette[1]; ctx.fillRect(margin, y, W - margin * 2, 30); ctx.fillStyle = palette[0]; ctx.font = '800 14px Nunito, system-ui, sans-serif'; ctx.fillText(T('doc.code'), margin + 10, y + 20); ctx.fillText(T('doc.desc'), margin + 160, y + 20); y += 30;
    items.forEach((it, i) => { const h = Math.max(34, it.lines.length * 22 + 12); ctx.fillStyle = i % 2 ? '#f9fafb' : '#ffffff'; ctx.fillRect(margin, y, W - margin * 2, h); ctx.fillStyle = '#111827'; ctx.font = '800 17px "Baloo 2", system-ui, sans-serif'; ctx.fillText(it.code, margin + 10, y + 23); ctx.font = '600 17px Nunito, system-ui, sans-serif'; it.lines.forEach((l, j) => ctx.fillText(l, margin + 160, y + 23 + j * 22)); y += h; });
    ctx.strokeStyle = '#d1d5db'; ctx.lineWidth = 1; ctx.strokeRect(margin, y - rowsH - 30, W - margin * 2, rowsH + 30);
    // stamp + footer
    const sx = W - margin - 90, sy = H - 96; ctx.save(); ctx.translate(sx, sy); ctx.rotate(-0.2); ctx.strokeStyle = palette[0]; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, 62, 0, 7); ctx.stroke(); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, 54, 0, 7); ctx.stroke();
    ctx.fillStyle = palette[0]; ctx.textAlign = 'center'; ctx.font = '800 15px "Baloo 2", system-ui, sans-serif'; ctx.fillText('FINBUU', 0, -8); ctx.font = '700 12px Nunito, system-ui, sans-serif'; ctx.fillText(T('doc.stamp'), 0, 10); ctx.fillText(`#${issued.day}`, 0, 26); ctx.restore();
    ctx.textAlign = 'left'; ctx.fillStyle = '#6b7280'; ctx.font = '600 13px Nunito, system-ui, sans-serif'; wrap(ctx, T('doc.footer'), W - margin * 2 - 190).forEach((l, i) => ctx.fillText(l, margin, H - 74 + i * 18));
    return cv;
  }
  function viewDoc(kind, cid, data, issued) {
    const cv = drawDoc(kind, cid, data, issued), co = getState().companies[cid];
    openModal(body => {
      body.classList.add('wideBody');
      body.append(el('h3', `${DOC_ICON[kind]} ${T('doc.' + kind)}`));
      cv.style.cssText = 'width:100%;height:auto;border-radius:8px;box-shadow:0 2px 10px rgba(0,0,0,.2)'; body.append(cv);
      const name = `${slug(co ? companyName(co) : 'finbuu')}-${kind}`, row = el('div', null, 'row'); row.style.cssText = 'flex-wrap:wrap;gap:6px;margin-top:8px';
      row.append(btn('🖼 PNG', async () => download(await toBlob(cv, 'image/png'), name + '.png')), btn('📕 PDF', async () => download(await pdfFromCanvases([cv]), name + '.pdf'), { primary: true }), btn('← ' + T('doc.back'), () => openDocs(cid)));
      body.append(row);
    });
  }
  return { openLists, openDocs, tabBar };
}
