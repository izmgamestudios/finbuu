// public/js/wiki.js — Sprint 32: Guide encyclopedia inside the Guide building.
// Nested categories (hamburger-style tree), full-text search, type filter, FAQ-style articles with "how do I get there" steps and a Go button.
// Content comes from /data/guide.json (admin-editable); everything is plain data, so new sprints just add items.
import { norm, words } from './help.js';

const TYPE_ICON = { faq: '❓', menu: '☰', building: '🏢', feature: '⚙️', term: '📖', quest: '🎯', tip: '💡' };
const S = { q: '', type: '', cat: '', item: null, open: new Set(), tree: false };   // survives re-opening during the session

export function createWiki({ el, btn, t, L10, loadData, buildings, walkTo, openBuilding, showTab, closeModal, toast }) {
  function index(doc) {
    const catById = new Map(), parent = new Map(), order = [];
    const walk = (cs, par, path) => cs.forEach(c => { const p = [...path, c]; catById.set(c.id, { c, path: p }); parent.set(c.id, par); order.push(c.id); if (c.children) walk(c.children, c.id, p); });
    walk(doc.categories, null, []);
    const subtree = id => { const out = [id]; (catById.get(id)?.c.children || []).forEach(k => out.push(...subtree(k.id))); return out; };
    return { catById, parent, order, subtree };
  }
  const crumb = (ix, id) => (ix.catById.get(id)?.path || []).map(c => `${c.icon || ''} ${L10(c.title)}`.trim()).join(' › ');
  // search both languages at once: a Turkish player can type an English term and vice versa
  const hay = (ix, it) => ({ title: norm(`${it.title.tr} ${it.title.en}`), tags: norm(it.tags.join(' ')), body: norm(`${it.body.tr} ${it.body.en} ${it.steps.tr.join(' ')} ${it.steps.en.join(' ')} ${crumb(ix, it.cat)}`) });
  function search(doc, ix) {
    const qw = words(S.q), allowed = S.cat ? new Set(ix.subtree(S.cat)) : null, pos = new Map(doc.items.map((it, i) => [it.id, i]));
    const out = [];
    for (const it of doc.items) {
      if (S.type && it.type !== S.type) continue; if (allowed && !allowed.has(it.cat)) continue;
      let score = 0;
      if (qw.length) {
        const h = hay(ix, it); let ok = true;
        for (const w of qw) {
          let s = 0; const st = w.length >= 6 ? w.slice(0, -2) : null;   // light stemming (ortaklık ~ ortaklığı)
          if (h.title.split(/\s+/).includes(w)) s += 6; else if (h.title.includes(w)) s += 4; else if (st && h.title.includes(st)) s += 3;
          if (h.tags.includes(w)) s += 3; else if (st && h.tags.includes(st)) s += 2;
          if (h.body.includes(w)) s += 1; else if (st && h.body.includes(st)) s += 0.5;
          if (!s) { ok = false; break; } score += s;
        }
        if (!ok) continue;
      }
      out.push({ it, score, i: pos.get(it.id) });
    }
    return out.sort((a, b) => b.score - a.score || a.i - b.i);
  }
  const goLabel = go => (go.kind === 'building' ? t('wiki.goBuilding') : t('wiki.goTab'));
  function go(it) {
    if (it.go.kind === 'tab') { closeModal(); return showTab(it.go.target); }
    if (it.go.kind === 'building') {
      const b = buildings().find(x => x.kind === it.go.target);
      if (!b) return toast(t('wiki.noBuilding'));
      closeModal(); walkTo(b.x + b.w / 2, () => openBuilding(b), b.id);
    }
  }
  function render(body, doc, redraw) {
    const ix = index(doc), counts = new Map();
    for (const it of doc.items) for (let id = it.cat; id; id = ix.parent.get(id)) counts.set(id, (counts.get(id) || 0) + 1);
    const matches = search(doc, ix);
    // header: search + hamburger
    const top = el('div', null, 'wikiTop'), q = el('input'); q.type = 'search'; q.placeholder = t('wiki.search'); q.value = S.q; q.setAttribute('aria-label', t('wiki.search'));
    q.oninput = () => { S.q = q.value; S.item = null; const pos = q.selectionStart; redraw(); const n = body.querySelector('.wikiTop input'); if (n) { n.focus(); n.setSelectionRange(pos, pos); } };
    const ham = btn('☰ ' + t('wiki.categories'), () => { S.tree = !S.tree; redraw(); }); ham.classList.add('wikiHam');
    top.append(ham, q); body.append(top);
    const chips = el('div', null, 'wikiChips');
    [['', t('wiki.all')], ...Object.keys(TYPE_ICON).map(k => [k, `${TYPE_ICON[k]} ${t('wiki.type.' + k)}`])].forEach(([k, label]) => { const b = btn(label, () => { S.type = k; S.item = null; redraw(); }); if (S.type === k) b.classList.add('primary'); b.classList.add('chip'); chips.append(b); });
    body.append(chips);
    const wrap = el('div', null, 'wiki' + (S.tree ? ' treeOpen' : '')), tree = el('div', null, 'wikiTree'), main = el('div', null, 'wikiMain');
    // tree
    const all = btn(`📚 ${t('wiki.all')} (${doc.items.length})`, () => { S.cat = ''; S.item = null; S.tree = false; redraw(); }); all.classList.add('catBtn'); if (!S.cat) all.classList.add('on'); tree.append(all);
    if (S.cat) for (let id = ix.parent.get(S.cat); id; id = ix.parent.get(id)) S.open.add(id);
    const node = (c, depth) => {
      const row = el('div', null, 'catRow'); row.style.paddingLeft = depth * 14 + 'px';
      const has = !!c.children?.length, arrow = el('button', has ? (S.open.has(c.id) ? '▾' : '▸') : '·', 'arrow'); arrow.type = 'button'; arrow.disabled = !has; arrow.setAttribute('aria-label', 'toggle');
      arrow.onclick = e => { e.stopPropagation(); S.open.has(c.id) ? S.open.delete(c.id) : S.open.add(c.id); redraw(); };
      const b = btn(`${c.icon || ''} ${L10(c.title)} (${counts.get(c.id) || 0})`.trim(), () => { S.cat = c.id; S.item = null; if (has) S.open.add(c.id); if (!has) S.tree = false; redraw(); }); b.classList.add('catBtn'); if (S.cat === c.id) b.classList.add('on');
      row.append(arrow, b); tree.append(row);
      if (has && S.open.has(c.id)) c.children.forEach(k => node(k, depth + 1));
    };
    doc.categories.forEach(c => node(c, 0));
    // main: detail or results
    const item = S.item && doc.items.find(i => i.id === S.item);
    if (item) {
      main.append(btn('← ' + t('wiki.back'), () => { S.item = null; redraw(); }));
      main.append(el('h3', `${item.icon || TYPE_ICON[item.type]} ${L10(item.title)}`));
      const meta = el('div', null, 'wikiMeta'); meta.append(el('span', `${TYPE_ICON[item.type]} ${t('wiki.type.' + item.type)}`, 'tag'));
      const cb = el('button', '📁 ' + crumb(ix, item.cat), 'crumb'); cb.type = 'button'; cb.onclick = () => { S.cat = item.cat; S.item = null; redraw(); }; meta.append(cb); main.append(meta);
      main.append(el('p', L10(item.body)));
      const steps = item.steps[i18next.language?.startsWith('tr') ? 'tr' : 'en']?.length ? item.steps[i18next.language?.startsWith('tr') ? 'tr' : 'en'] : item.steps.tr;
      if (steps.length) { main.append(el('h4', '📍 ' + t('wiki.how'))); const ol = el('ol', null, 'wikiSteps'); steps.forEach(s => ol.append(el('li', s))); main.append(ol); }
      if (item.go.kind) main.append(btn(`➜ ${goLabel(item.go)}`, () => go(item), { primary: true }));
      const rel = item.related.map(id => doc.items.find(i => i.id === id)).filter(Boolean);
      if (rel.length) { main.append(el('h4', '🔗 ' + t('wiki.related'))); const r = el('div', null, 'wikiChips'); rel.forEach(x => { const b = btn(`${x.icon || TYPE_ICON[x.type]} ${L10(x.title)}`, () => { S.item = x.id; redraw(); }); b.classList.add('chip'); r.append(b); }); main.append(r); }
      if (item.tags.length) { const tg = el('div', null, 'wikiChips'); item.tags.forEach(x => { const b = btn('#' + x, () => { S.q = x; S.item = null; redraw(); }); b.classList.add('chip', 'tagChip'); tg.append(b); }); main.append(tg); }
    } else {
      main.append(el('small', t('wiki.results', { n: matches.length }) + (S.cat ? ' · ' + crumb(ix, S.cat) : ''), 'muted'));
      if (!matches.length) main.append(el('p', t('wiki.none'), 'muted'));
      matches.forEach(({ it }) => {
        const row = el('button', null, 'wikiRow'); row.type = 'button';
        row.append(el('b', `${it.icon || TYPE_ICON[it.type]} ${L10(it.title)}`), el('small', `${t('wiki.type.' + it.type)} · ${crumb(ix, it.cat)}`, 'muted'), el('span', L10(it.body).slice(0, 110) + (L10(it.body).length > 110 ? '…' : '')));
        row.onclick = () => { S.item = it.id; redraw(); }; main.append(row);
      });
    }
    wrap.append(tree, main); body.append(wrap);
  }
  // Mount into a modal body; `again` re-renders the whole tab
  function mount(body, again) {
    loadData('guide', doc => { const sub = el('div'); body.append(sub); const redraw = () => { sub.replaceChildren(); render(sub, doc, redraw); }; redraw(); });
  }
  return { mount };
}
