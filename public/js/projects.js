// public/js/projects.js — Sprint 35: Demo Day project floors (list of floors, project page with linked Demo Day / GamFed tabs, feedback).
import { BMC_KEYS, newBoard } from './board.js';

const T = (k, o) => i18next.t('proj.' + k, o);
const BMC_ICON = { keyPartners: '🤝', keyActivities: '⚙️', keyResources: '🧰', valueProps: '🎁', customerRelationships: '💬', channels: '📢', customerSegments: '👥', costStructure: '💸', revenueStreams: '💰' };
const TABS = ['about', 'events', 'canvas', 'pitch', 'deck', 'partners', 'exit', 'toy', 'gbmc', 'feedback'];
const TAB_ICON = { about: 'ℹ️', events: '🎤', canvas: '🧩', pitch: '⏱', deck: '📊', partners: '🤝', exit: '💼', toy: '🎮', gbmc: '📋', feedback: '💬' };
const okUrl = u => (typeof u === 'string' && /^https?:\/\/[^\s]+$/i.test(u) ? u : null);

export function createProjectsUi({ el, btn, kpi, toast, openModal, closeModal, socket, getState, companyName, demoFacts, openDemoDay, createBoardUi, openWizard }) {
  const link = (label, url) => { const a = el('a', label, 'extLink'); a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer'; return a; };
  const input = (value, max, ph) => { const i = el('input'); i.maxLength = max; i.value = value || ''; if (ph) i.placeholder = ph; i.style.width = '100%'; return i; };
  const area = (value, max, rows = 3) => { const a = el('textarea'); a.maxLength = max; a.rows = rows; a.value = value || ''; return a; };
  const labeled = (label, node) => { const w = el('label'); w.append(el('b', label), node); w.style.cssText = 'display:flex;flex-direction:column;gap:3px'; return w; };
  const call = (ev, payload) => new Promise(res => socket.timeout(5000).emit(ev, payload, (err, r) => res(err ? { ok: false, error: 'network' } : r)));
  const errToast = r => toast(r?.key ? i18next.t(r.key) : r?.error || T('err.generic'));
  const liveName = l => l?.name || (l?.nameKey ? i18next.t(l.nameKey) : '');

  // ---------- the tower: one row per floor, top floor first ----------
  async function open() {
    const r = await call('projectsList', {});
    if (!r?.ok) return toast(T('err.generic'));
    openModal(body => {
      body.append(el('h3', '🎤 ' + T('title')), el('p', T('intro'), 'muted'));
      const free = (r.companies || []).filter(c => !c.taken), st = getState();
      const row = el('div', null, 'row'); row.style.cssText = 'flex-wrap:wrap;gap:6px;margin:6px 0';
      if (free.length && r.projects.length < r.max) row.append(btn('➕ ' + T('add'), () => openAdd(free), { primary: true }));
      row.append(btn('🎤 ' + T('myDemo'), () => openDemoDay()));
      body.append(row);
      if (!free.length && st && !(r.companies || []).length) body.append(el('small', T('needCompany'), 'muted'));
      else if (!free.length && (r.companies || []).length) body.append(el('small', T('oneEach'), 'muted'));
      if (r.projects.length >= r.max) body.append(el('small', T('towerFull', { n: r.max }), 'muted'));
      const list = el('div'); list.style.cssText = 'display:flex;flex-direction:column;gap:6px;margin-top:8px';
      r.projects.map((p, i) => ({ p, n: i + 1 })).reverse().forEach(({ p, n }) => {
        const card = el('button', null, 'prodRow'); card.type = 'button'; card.style.cssText = `display:flex;align-items:center;gap:10px;text-align:left;width:100%;cursor:pointer;border-left:6px solid ${/^#[0-9a-f]{6}$/i.test(p.color) ? p.color : '#5b4a9a'}`;
        const badge = el('b', String(n)); badge.style.cssText = 'background:#f5b942;color:#0b0f1a;border-radius:50%;min-width:26px;height:26px;display:grid;place-items:center;flex:none';
        const mid = el('div'); mid.style.cssText = 'flex:1;min-width:0';
        mid.append(el('b', `${p.icon} ${p.name}`), el('small', [p.tagline, p.owner ? '👤 ' + p.owner : '', p.fb ? '💬 ' + p.fb : '', p.exit === 'seeking' ? '💼 ' + T('exitSeeking') : p.exit === 'sold' ? '✅ ' + T('exitSold') : ''].filter(Boolean).join(' · '), 'muted'));
        mid.querySelector('small').style.display = 'block';
        card.append(badge, mid, el('span', p.mine ? '✏️' : '›'));
        card.onclick = () => openProject(p.id);
        list.append(card);
      });
      if (!r.projects.length) list.append(el('small', T('empty'), 'muted'));
      body.append(list);
    });
  }

  function openAdd(free) {
    const st = getState();
    openModal(body => {
      body.append(el('h3', '➕ ' + T('add')), el('p', T('addIntro'), 'muted'));
      const sel = el('select'); free.forEach(c => { const co = st.companies[c.id]; if (co) sel.append(new Option(companyName(co), c.id)); });
      const name = input('', 40, T('f.name')), tag = input('', 80, T('f.tagline')), url = input('', 200, 'https://'), icon = input('💡', 8), desc = area('', 600, 4);
      const update = () => { const co = st.companies[sel.value]; if (co && !name.value) name.value = companyName(co).slice(0, 40); }; sel.onchange = () => { name.value = ''; update(); }; update();
      const msg = el('small', '', 'muted'); msg.style.color = '#dc2626';
      body.append(labeled(T('f.company'), sel), labeled(T('f.name'), name), labeled(T('f.tagline'), tag), labeled(T('f.icon'), icon), labeled(T('f.url'), url), labeled(T('f.desc'), desc), msg,
        btn('✓ ' + T('create'), async () => {
          const r = await call('projectAdd', { cid: sel.value, project: { name: name.value, tagline: tag.value, url: url.value, icon: icon.value, desc: desc.value } });
          if (!r?.ok) return (msg.textContent = r?.key ? i18next.t(r.key) : r?.error || T('err.generic'));
          toast(T('created')); openProject(r.id);
        }, { primary: true }));
    });
  }

  // ---------- one project (= one floor) ----------
  async function openProject(id, tab = 'about') {
    const r = await call('projectGet', { id });
    if (!r?.ok) return toast(T('err.generic'));
    render(r.project, tab);
  }
  const readToy = (box, board) => {
    const labels = i18next.t('gfBoard.toyLabels', { returnObjects: true }), ol = el('ol');
    (board.toy || []).forEach((v, i) => { if (v.trim()) { const li = el('li'); li.append(el('b', labels[i] + ': '), document.createTextNode(v)); ol.append(li); } });
    box.append(ol.children.length ? ol : el('small', T('nothingYet'), 'muted'));
  };
  const readBmc = (box, bmc) => {
    if (!BMC_KEYS.some(k => (bmc?.[k] || '').trim())) return box.append(el('small', T('nothingYet'), 'muted'));
    const grid = el('div', null, 'bmc');
    BMC_KEYS.forEach(k => { const cell = el('div', null, 'bmcCell bmc-' + k); cell.append(el('b', `${BMC_ICON[k]} ${i18next.t('bmc.' + k)}`)); const p = el('p', bmc[k] || '—'); p.style.whiteSpace = 'pre-wrap'; cell.append(p); grid.append(cell); });
    box.append(grid);
  };
  const readDeck = (box, deck) => {
    const slides = (deck || []).filter(s => (s.title || s.body || '').trim());
    if (!slides.length) return box.append(el('small', T('nothingYet'), 'muted'));
    const names = i18next.t('gfBoard.deckTitles', { returnObjects: true });
    slides.forEach((s, i) => { const c = el('div', null, 'co'); c.append(el('h4', `${i + 1}. ${s.title || names[s.id] || i18next.t('gfBoard.slide')}`)); const p = el('p', s.body); p.style.whiteSpace = 'pre-wrap'; c.append(p); box.append(c); });
  };
  const textBlock = txt => { const p = el('p', txt); p.style.whiteSpace = 'pre-wrap'; return p; };

  function render(p, tab) {
    const st = getState(), live = p.live, co = live?.cid ? st?.companies?.[live.cid] : null;
    let gfui = null;
    if (p.mine) { if (!p.board.deck?.length) p.board.deck = newBoard().deck; }
    if (p.mine) gfui = createBoardUi({ el, btn, toast, loadJSON: (k, d) => (k === 'gamfedBoard' ? p.board : d), saveJSON: (k, v) => { if (k === 'gamfedBoard') { p.board = v; socket.emit('projectBoardSave', { id: p.id, board: v }); } }, onChange: null, facts: () => (co ? demoFacts(co) : {}) });
    const save = async patch => { const r = await call('projectUpdate', { id: p.id, patch }); if (!r?.ok) return errToast(r); toast(T('saved')); render(r.project, tab); };
    const tabs = TABS.filter(k => k !== 'gbmc' || p.owner);
    openModal(body => {
      body.classList.add('wideBody');
      const head = el('h3', `${p.icon} ${p.name}`); body.append(head);
      const sub = [p.tagline, p.owner ? '👤 ' + p.owner.name : '🏛 ' + T('byAdmin')].filter(Boolean).join(' · '); body.append(el('small', sub, 'muted'));
      const u = okUrl(p.url); if (u) { const row = el('div'); row.style.margin = '6px 0'; row.append(link('🔗 ' + T('visit') + ': ' + u.replace(/^https?:\/\//, '').replace(/\/$/, ''), u)); body.append(row); }
      const bar = el('div', null, 'others');
      tabs.forEach(k => bar.append(btn(`${TAB_ICON[k]} ${T('tab.' + k)}`, () => render(p, k), { primary: k === tab })));
      body.append(el('div', null, 'row').appendChild(btn('← ' + T('allFloors'), () => open())).parentNode, bar);
      const box = el('div', null, 'co'); body.append(box);
      const manage = (label, t2) => { if (p.mine && live?.cid) box.append(btn('🎤 ' + label, () => openDemoDay(live.cid, t2))); };

      if (tab === 'about') {
        if (p.desc) box.append(textBlock(p.desc));
        if (live) {
          const k = el('div', null, 'mini'); k.append(kpi(T('readiness'), `${live.score}/100`), kpi(T('blocks'), `${live.blocks}/9`), kpi(T('company'), liveName(live) || '—')); box.append(k);
          if (live.stale) box.append(el('small', T('stale'), 'muted'));
        } else if (p.owner) box.append(el('small', T('stale'), 'muted'));
        if (p.mine) {
          box.append(el('h4', '✏️ ' + T('edit')));
          const name = input(p.name, 40), tag = input(p.tagline, 80), url = input(p.url, 200, 'https://'), icon = input(p.icon, 8), desc = area(p.desc, 600, 4);
          box.append(labeled(T('f.name'), name), labeled(T('f.tagline'), tag), labeled(T('f.icon'), icon), labeled(T('f.url'), url), labeled(T('f.desc'), desc),
            btn('✓ ' + T('save'), () => save({ name: name.value, tagline: tag.value, url: url.value, icon: icon.value, desc: desc.value }), { primary: true }),
            btn('🗑 ' + T('delete'), async () => { if (!confirm(T('deleteAsk'))) return; const r = await call('projectDelete', { id: p.id }); if (r?.ok) { toast(T('deleted')); open(); } }));
        }
      } else if (tab === 'events') {
        if (live) {
          const day = n => (n == null ? T('never') : T('dayN', { n }));
          const k = el('div', null, 'mini'); k.append(kpi(T('ev.demo'), day(live.demoAt)), kpi(T('ev.angel'), day(live.angelAt)), kpi(T('ev.grant'), live.granted ? '✓' : '—')); box.append(k);
        }
        const rows = (p.events || []).map(e => ({ ...e }));
        if (!p.mine) {
          if (!rows.length && !live) box.append(el('small', T('nothingYet'), 'muted'));
          rows.forEach(e => { const d = el('div', null, 'prodRow'); d.append(el('b', e.title), el('small', e.when || '', 'muted')); const eu = okUrl(e.url); if (eu) d.append(link('🔗', eu)); box.append(d); });
        } else {
          const list = el('div'); box.append(el('h4', T('ev.list')), list);
          const draw = () => { list.replaceChildren(); rows.forEach((e, i) => { const d = el('div', null, 'row'); d.style.cssText = 'flex-wrap:wrap;gap:6px;align-items:center'; const t1 = input(e.title, 60, T('ev.title')), w = input(e.when, 30, T('ev.when')), uu = input(e.url, 200, 'https://'); t1.oninput = () => (e.title = t1.value); w.oninput = () => (e.when = w.value); uu.oninput = () => (e.url = uu.value); d.append(t1, w, uu, btn('✕', () => { rows.splice(i, 1); draw(); })); list.append(d); }); };
          draw();
          box.append(btn('➕ ' + T('ev.add'), () => { if (rows.length < 8) { rows.push({ title: '', when: '', url: '' }); draw(); } }), btn('✓ ' + T('save'), () => save({ events: rows }), { primary: true }));
        }
        manage(T('openDemo'), 'events');
      } else if (tab === 'canvas') {
        box.append(el('p', T('canvasIntro'), 'muted'));
        if (live) { readBmc(box, live.canvas); manage(T('editCanvas'), 'canvas'); }
        else if (p.mine) gfui.renderTab('bmc', box);
        else readBmc(box, p.board.bmc);
      } else if (tab === 'gbmc') {
        box.append(el('p', T('gfIntro'), 'muted'));
        if (p.mine) gfui.renderTab('bmc', box); else readBmc(box, p.board.bmc);
      } else if (tab === 'pitch') {
        box.append(el('p', T('pitchIntro'), 'muted'));
        const txt = live?.pitch || p.pitch;
        if (txt) box.append(textBlock(txt)); else box.append(el('small', T('nothingYet'), 'muted'));
        if (live) manage(T('editPitch'), 'pitch');
        else if (p.mine) { const a = area(p.pitch, 900, 7); box.append(a, btn('✓ ' + T('save'), () => save({ pitch: a.value }), { primary: true })); }
      } else if (tab === 'deck') {
        if (p.mine) gfui.renderTab('deck', box); else readDeck(box, p.board.deck);
      } else if (tab === 'toy') {
        box.append(el('p', T('toyIntro'), 'muted'));
        if (p.mine) gfui.renderTab('toy', box); else readToy(box, p.board);
      } else if (tab === 'partners') {
        if (live?.partners?.length || live?.npcEquity) {
          box.append(el('h4', '🤝 ' + T('pt.game')));
          live.partners.forEach(x => box.append(el('div', `${x.name} · %${x.pct}`)));
          if (live.npcEquity) box.append(el('div', `${T('pt.investors')} · %${live.npcEquity}`));
        }
        const rows = (p.partners || []).map(x => ({ ...x }));
        if (!p.mine) {
          if (!rows.length && !live?.partners?.length && !live?.npcEquity) box.append(el('small', T('nothingYet'), 'muted'));
          rows.forEach(x => box.append(el('div', `${x.name}${x.role ? ' — ' + x.role : ''}`)));
        } else {
          const list = el('div'); box.append(el('h4', T('pt.team')), list);
          const draw = () => { list.replaceChildren(); rows.forEach((x, i) => { const d = el('div', null, 'row'); d.style.cssText = 'flex-wrap:wrap;gap:6px;align-items:center'; const n1 = input(x.name, 40, T('pt.name')), r1 = input(x.role, 40, T('pt.role')); n1.oninput = () => (x.name = n1.value); r1.oninput = () => (x.role = r1.value); d.append(n1, r1, btn('✕', () => { rows.splice(i, 1); draw(); })); list.append(d); }); };
          draw();
          box.append(btn('➕ ' + T('pt.add'), () => { if (rows.length < 10) { rows.push({ name: '', role: '' }); draw(); } }), btn('✓ ' + T('save'), () => save({ partners: rows }), { primary: true }));
        }
        manage(T('openPartners'), 'partners');
      } else if (tab === 'exit') {
        box.append(el('p', T('exitIntro'), 'muted'));
        const label = { none: T('exitNone'), seeking: '💼 ' + T('exitSeeking'), sold: '✅ ' + T('exitSold') };
        box.append(el('b', label[p.exit.status])); if (p.exit.note) box.append(textBlock(p.exit.note));
        if (p.mine) {
          const sel = el('select'); ['none', 'seeking', 'sold'].forEach(k => sel.append(new Option(label[k], k))); sel.value = p.exit.status;
          const note = area(p.exit.note, 200, 3);
          box.append(labeled(T('exitStatus'), sel), labeled(T('exitNote'), note), btn('✓ ' + T('save'), () => save({ exit: { status: sel.value, note: note.value } }), { primary: true }));
        }
        manage(T('openExit'), 'exit');
      } else if (tab === 'feedback') {
        box.append(el('p', T('fbIntro'), 'muted'));
        const list = el('div'); box.append(list);
        const draw = fb => {
          list.replaceChildren();
          if (!fb.length) list.append(el('small', T('fbEmpty'), 'muted'));
          fb.slice().reverse().forEach(f => {
            const c = el('div', null, 'prodRow'); c.style.cssText = 'display:block';
            c.append(el('b', `${{ feedback: '💬', suggestion: '💡', question: '❓' }[f.kind] || '💬'} ${f.name}`), el('small', ' · ' + new Date(f.at).toLocaleDateString(), 'muted'), textBlock(f.text));
            if (p.mine) c.append(btn('🗑', async () => { const r = await call('projectFeedbackDelete', { id: p.id, fid: f.id }); if (r?.ok) { p.feedback = r.feedback; draw(r.feedback); } }));
            list.append(c);
          });
        };
        draw(p.feedback || []);
        const kind = el('select'); ['feedback', 'suggestion', 'question'].forEach(k => kind.append(new Option(T('fb.' + k), k)));
        const txt = area('', 300, 3); const cnt = el('small', '', 'muted'); txt.oninput = () => (cnt.textContent = `${txt.value.length}/300`); txt.oninput();
        box.append(el('h4', '✍ ' + T('fbWrite')), kind, txt, cnt, btn('📨 ' + T('fbSend'), async () => {
          if (!txt.value.trim()) return;
          const r = await call('projectFeedback', { id: p.id, kind: kind.value, text: txt.value });
          if (!r?.ok) return errToast(r);
          txt.value = ''; txt.oninput(); p.feedback = r.feedback; draw(r.feedback); toast(T('fbThanks'));
        }, { primary: true }));
      }
    });
  }
  return { open, openProject };
}
