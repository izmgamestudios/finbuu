// public/js/gfboard.js — GamFed building: editable TOY canvas, Business Canvas and Pitch Deck with PDF / PNG / JPEG / link export.
import { TOY_N, BMC_KEYS, DECK_IDS, LIMITS, cleanBoard, newBoard, sentenceParts, drawToy, drawBmc, drawSlide, allPages, toBlob, pdfFromCanvases, download, slug } from './board.js';

const BMC_ICON = { keyPartners: '🤝', keyActivities: '⚙️', keyResources: '🧰', valueProps: '🎁', customerRelationships: '💬', channels: '📢', customerSegments: '👥', costStructure: '💸', revenueStreams: '💰' };
const tt = (k, o) => i18next.t('gfBoard.' + k, o);
export const boardLabels = () => ({
  brand: tt('brand'), site: tt('site'), untitled: tt('untitled'), toyTitle: tt('toyTitle'), bmcTitle: tt('bmcTitle'), slide: tt('slide'), emptySlide: tt('emptySlide'), sentence: tt('sentence'),
  toyLabels: tt('toyLabels', { returnObjects: true }), bmc: Object.fromEntries(BMC_KEYS.map(k => [k, i18next.t('bmc.' + k)])), deck: tt('deckTitles', { returnObjects: true })
});

export function createBoardUi({ el, btn, toast, loadJSON, saveJSON }) {
  let board = cleanBoard(loadJSON('gamfedBoard', null)), share = loadJSON('gamfedShare', null), slideIdx = 0, saveTimer = null;
  const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveJSON('gamfedBoard', board), 300); };
  const U = k => tt('ui.' + k);

  // a textarea bound to a getter/setter with a char counter
  function field(max, get, set, { rows = 3, placeholder = '' } = {}) {
    const wrap = el('div'), ta = el('textarea'), cnt = el('small', '', 'muted');
    ta.rows = rows; ta.maxLength = max; ta.value = get(); ta.placeholder = placeholder;
    const upd = () => { cnt.textContent = U('chars').replace('{{n}}', ta.value.length).replace('{{max}}', max); };
    ta.oninput = () => { set(ta.value); upd(); persist(); }; upd(); wrap.append(ta, cnt); return wrap;
  }
  // used inside each floor of the tower: step n (1..10) of the TOY sentence
  const floorField = n => {
    const box = el('div'); box.append(el('h4', `✍ ${U('yours')} — ${tt('toyLabels', { returnObjects: true })[n - 1]}`), el('small', tt('toyHints', { returnObjects: true })[n - 1], 'muted'),
      field(LIMITS.toy, () => board.toy[n - 1], v => { board.toy[n - 1] = v; }, { rows: 3, placeholder: U('yoursPh') }), el('small', U('autosave'), 'muted'));
    return box;
  };
  const titleRow = () => {
    const r = el('label', null, 'row'); const inp = el('input'); inp.maxLength = LIMITS.title; inp.value = board.title; inp.placeholder = U('boardTitlePh'); inp.style.flex = '1';
    inp.oninput = () => { board.title = inp.value; persist(); }; r.append(el('b', U('boardTitle')), inp); return r;
  };

  async function publish(bar) {
    try {
      let res = null;
      if (share?.id) res = await fetch(`/api/boards/${share.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ editKey: share.editKey, board }) });
      if (!res || res.status === 403 || res.status === 404) res = await fetch('/api/boards', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ board }) });
      if (res.status === 429) return toast(U('rate'));
      const j = await res.json(); if (!j.ok) return toast(U('failed'));
      if (j.id) { share = { id: j.id, editKey: j.editKey }; saveJSON('gamfedShare', share); }
      const url = `${location.origin}/b/${share.id}`; try { await navigator.clipboard?.writeText(url); toast(U('copied')); } catch { toast(U('published')); }
      renderBar(bar, bar._ctx);
    } catch { toast(U('failed')); }
  }
  function renderBar(bar, ctx) {
    bar._ctx = ctx; bar.replaceChildren();
    const name = () => slug(board.title);
    const img = type => async () => { const c = ctx.page(); download(await toBlob(c, type === 'jpg' ? 'image/jpeg' : 'image/png'), `${name()}-${ctx.name}.${type}`); };
    bar.append(el('b', U('export') + ':'), btn(U('png'), img('png')), btn(U('jpg'), img('jpg')),
      btn(U('pdf'), async () => { download(await pdfFromCanvases(allPages(board, boardLabels())), `${name()}.pdf`); }),
      btn(share?.id ? U('updateLink') : U('link'), () => publish(bar), { primary: true }));
    if (share?.id) { const url = `${location.origin}/b/${share.id}`; const a = el('a', url); a.href = url; a.target = '_blank'; a.rel = 'noopener'; bar.append(a, btn(U('copy'), async () => { try { await navigator.clipboard.writeText(url); toast(U('copied')); } catch { prompt(U('copy'), url); } })); }
    bar.append(el('small', U('linkNote'), 'muted'));
  }
  const exportBar = ctx => { const bar = el('div', null, 'row'); bar.style.cssText = 'flex-wrap:wrap;align-items:center;gap:6px;margin-top:10px'; renderBar(bar, ctx); return bar; };

  function renderToy(box) {
    box.append(el('p', tt('toyTitle'), 'muted'), titleRow());
    const list = el('div'); list.style.cssText = 'display:flex;flex-direction:column;gap:8px;margin:8px 0';
    for (let i = 0; i < TOY_N; i++) {
      const row = el('div', null, 'bmcCell'); const head = el('div', null, 'row'); head.style.alignItems = 'center';
      const badge = el('b', String(i + 1)); badge.style.cssText = 'background:#f5b942;color:#0b0f1a;border-radius:6px;min-width:26px;flex:none;text-align:center;padding:1px 4px';
      head.append(badge, el('b', tt('toyLabels', { returnObjects: true })[i])); row.append(head, el('small', tt('toyHints', { returnObjects: true })[i], 'muted'), field(LIMITS.toy, () => board.toy[i], v => { board.toy[i] = v; prev(); }, { rows: 2, placeholder: U('yoursPh') })); list.append(row);
    }
    const preview = el('div'); preview.style.cssText = 'background:#000;color:#fff;border-radius:12px;padding:14px 16px;line-height:1.7;font-weight:700';
    const prev = () => {
      preview.replaceChildren(...sentenceParts(tt('sentence')).map(p => {
        if (!p.n) return document.createTextNode(p.text);
        const v = (board.toy[p.n - 1] || '').trim(), s = el('span', v || `[${tt('toyLabels', { returnObjects: true })[p.n - 1]}]`); s.style.color = v ? '#f5b942' : '#6b7280';
        const b = el('sup', String(p.n)); b.style.cssText = 'background:#f5b942;color:#0b0f1a;border-radius:4px;padding:0 4px;margin-right:3px;font-size:.65em'; const w = el('span'); w.append(b, s); return w;
      }));
    };
    prev(); box.append(el('h4', U('preview')), preview, list, exportBar({ name: 'toy', page: () => drawToy(board, boardLabels()) }));
  }
  function renderBmc(box) {
    box.append(el('p', tt('bmcTitle'), 'muted'), titleRow());
    const grid = el('div', null, 'bmc');
    BMC_KEYS.forEach(k => { const cell = el('div', null, 'bmcCell bmc-' + k); cell.append(el('b', `${BMC_ICON[k]} ${i18next.t('bmc.' + k)}`), el('small', i18next.t('bmcHint.' + k), 'muted'), field(LIMITS.bmc, () => board.bmc[k], v => { board.bmc[k] = v; }, { rows: 3 })); grid.append(cell); });
    box.append(grid, exportBar({ name: 'canvas', page: () => drawBmc(board, boardLabels()) }));
  }
  function renderDeck(box) {
    box.append(el('p', tt('ui.tabDeck'), 'muted'), titleRow());
    const nav = el('div', null, 'others'), edit = el('div', null, 'co');
    const draw = () => {
      slideIdx = Math.max(0, Math.min(slideIdx, board.deck.length - 1));
      nav.replaceChildren(...board.deck.map((s, i) => { const b = btn(`${i + 1}. ${(s.title || tt('deckTitles', { returnObjects: true })[s.id] || tt('slide')).slice(0, 14)}`, () => { slideIdx = i; draw(); }, { primary: i === slideIdx }); return b; }));
      if (board.deck.length < LIMITS.slides) nav.append(btn(U('addSlide'), () => { board.deck.push({ id: 'custom', title: '', body: '' }); slideIdx = board.deck.length - 1; persist(); draw(); }));
      const s = board.deck[slideIdx], def = tt('deckTitles', { returnObjects: true })[s.id] || tt('slide');
      const ti = el('input'); ti.maxLength = LIMITS.slideTitle; ti.value = s.title; ti.placeholder = `${U('slideTitlePh')} — ${def}`; ti.style.width = '100%'; ti.oninput = () => { s.title = ti.value; persist(); };
      const hint = tt('deckHints', { returnObjects: true })[s.id];
      edit.replaceChildren(el('h4', `${slideIdx + 1}. ${def}`), hint ? el('small', hint, 'muted') : el('span'), ti, field(LIMITS.slideBody, () => s.body, v => { s.body = v; }, { rows: 7, placeholder: U('slideBodyPh') }));
      if (board.deck.length > 1) edit.append(btn(U('delSlide'), () => { board.deck.splice(slideIdx, 1); persist(); draw(); }));
    };
    draw(); box.append(nav, edit, exportBar({ name: 'slide', page: () => drawSlide(board, slideIdx, boardLabels()) }));
    box.append(btn(U('clear'), () => { if (confirm(U('clearAsk'))) { board = newBoard(); persist(); box.replaceChildren(); renderDeck(box); } }));
  }
  const renderTab = (tab, box) => { box.replaceChildren(); ({ toy: renderToy, bmc: renderBmc, deck: renderDeck })[tab]?.(box); };
  return { floorField, renderTab };
}
