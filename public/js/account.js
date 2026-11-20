// public/js/account.js — Sprint 31: email + password account (login / register / recovery / delete) and GamFed board sync.
const tt = (k, o) => i18next.t('acct.' + k, o);
const KEY = 'finbuuSession', INFO = 'finbuuAccount';

export function createAccountUi({ el, btn, toast, openModal, closeModal, socket, loadJSON, saveJSON, onBoardAdopted, getBoard, setLabel }) {
  let token = loadJSON(KEY, null), info = loadJSON(INFO, null), pushTimer = null;
  const authHeaders = () => ({ 'content-type': 'application/json', authorization: 'Bearer ' + token });
  const api = async (path, body, method = 'POST', auth = false) => {
    try {
      const r = await fetch('/api/account' + path, { method, headers: auth ? authHeaders() : { 'content-type': 'application/json' }, body: method === 'GET' ? undefined : JSON.stringify(body || {}) });
      const j = await r.json().catch(() => ({ ok: false })); j.status = r.status; return j;
    } catch { return { ok: false, error: 'network' }; }
  };
  const errText = e => tt('err.' + (e || 'generic'));
  const refreshLabel = () => setLabel?.(info ? info.name : tt("menu"));

  function connect() { // called on every socket (re)connect, before 'resume'
    if (!token) return;
    socket.emit('authSession', { token }, r => { if (!r?.ok) { token = null; info = null; saveJSON(KEY, null); saveJSON(INFO, null); } else { info = r.account; saveJSON(INFO, info); } refreshLabel(); });
  }
  async function afterLogin(r) {
    token = r.token; info = r.account; saveJSON(KEY, token); saveJSON(INFO, info); refreshLabel();
    socket.emit('authSession', { token }, () => {});
    // GamFed board: local content wins (pushed to the account); otherwise adopt the account's board
    const me = await api('/me', null, 'GET', true), local = getBoard();
    const hasLocal = local && (local.board.title || local.board.toy.some(Boolean) || Object.values(local.board.bmc).some(Boolean) || local.board.deck.some(d => d.title || d.body));
    if (hasLocal) pushBoard(); else if (me.board) onBoardAdopted?.(me.board, me.share);
  }
  function pushBoard() {
    if (!token) return; clearTimeout(pushTimer);
    pushTimer = setTimeout(() => { const b = getBoard(); if (b) api('/board', b, 'PUT', true); }, 1500);
  }
  function showRecovery(code, next) {
    openModal(body => {
      body.append(el('h3', '🔑 ' + tt('recoveryTitle')), el('p', tt('recoveryNote'), 'muted'));
      const box = el('div', code); box.style.cssText = 'font:700 1.4rem/1.4 monospace;text-align:center;background:#000;color:#f5b942;border-radius:10px;padding:14px;letter-spacing:.06em;user-select:all';
      body.append(box, btn(tt('copy'), async () => { try { await navigator.clipboard.writeText(code); toast(tt('copied')); } catch { /* user can select it */ } }));
      const ok = el('label'); const cb = el('input'); cb.type = 'checkbox'; ok.append(cb, ' ' + tt('saved')); body.append(ok);
      const go = btn(tt('continue'), () => { if (!cb.checked) return toast(tt('mustConfirm')); closeModal(); next?.(); }, { primary: true }); body.append(go);
    }, { closable: false });
  }
  const field = (type, ph, auto) => { const i = el('input'); i.type = type; i.placeholder = ph; i.autocomplete = auto; i.style.width = '100%'; return i; };

  function openForms(tab = 'login') {
    openModal(body => {
      body.append(el('h3', '👤 ' + tt('title')), el('p', tt('intro'), 'muted'));
      const tabs = el('div', null, 'others');
      [['login', 'tabLogin'], ['register', 'tabRegister'], ['reset', 'tabReset']].forEach(([k, key]) => tabs.append(btn(tt(key), () => openForms(k), { primary: k === tab })));
      body.append(tabs);
      const msg = el('small', '', 'muted'); msg.style.color = '#dc2626';
      const email = field('email', tt('email'), 'email');
      if (tab === 'login') {
        const pw = field('password', tt('password'), 'current-password');
        const go = btn(tt('login'), async () => { go.disabled = true; const r = await api('/login', { email: email.value, password: pw.value }); go.disabled = false; if (!r.ok) return (msg.textContent = errText(r.error)); await afterLogin(r); closeModal(); toast(tt('welcome', { name: info.name })); }, { primary: true, isDefault: true });
        body.append(email, pw, go, msg);
      } else if (tab === 'register') {
        const name = field('text', tt('displayName'), 'nickname'); name.maxLength = 20; const pw = field('password', tt('passwordNew'), 'new-password');
        const go = btn(tt('register'), async () => { go.disabled = true; const r = await api('/register', { email: email.value, password: pw.value, name: name.value }); go.disabled = false; if (!r.ok) return (msg.textContent = errText(r.error)); await afterLogin(r); showRecovery(r.recovery, () => toast(tt('welcome', { name: info.name }))); }, { primary: true, isDefault: true });
        body.append(name, email, pw, go, msg, el('small', tt('registerNote'), 'muted'));
      } else {
        const rec = field('text', tt('recoveryCode'), 'off'), pw = field('password', tt('passwordNew'), 'new-password');
        const go = btn(tt('resetGo'), async () => { go.disabled = true; const r = await api('/reset', { email: email.value, recovery: rec.value, password: pw.value }); go.disabled = false; if (!r.ok) return (msg.textContent = errText(r.error)); await afterLogin(r); showRecovery(r.recovery, () => toast(tt('resetDone'))); }, { primary: true, isDefault: true });
        body.append(email, rec, pw, go, msg, el('small', tt('resetNote'), 'muted'));
      }
    });
  }
  function openProfile() {
    openModal(body => {
      const p = info.profile || {}, st = p.streak, se = p.season;
      body.append(el('h3', '👤 ' + info.name), el('small', info.email, 'muted'));
      const tiles = el('div', null, 'mini');
      const kpi = (l, v) => { const d = el('div', null, 'kpi'); d.append(el('small', l, 'muted'), el('b', String(v))); return d; };
      tiles.append(kpi('🔥 ' + tt('streak'), st?.n || 0), kpi(tt('best'), st?.best || 0), kpi('🏅 ' + tt('season'), se?.sp || 0), kpi('🎖 ' + tt('badges'), Object.keys(p.badges || {}).length));
      body.append(tiles, el('small', tt('syncNote'), 'muted'));
      body.append(btn(tt('logout'), async () => { await api('/logout', {}, 'POST', true); token = null; info = null; saveJSON(KEY, null); saveJSON(INFO, null); socket.emit('authSession', { token: '' }, () => {}); refreshLabel(); closeModal(); toast(tt('loggedOut')); }));
      body.append(btn('🗑 ' + tt('delete'), async () => { const pw = prompt(tt('deleteAsk')); if (!pw) return; const r = await api('/delete', { password: pw }, 'POST', true); if (!r.ok) return toast(errText(r.error)); token = null; info = null; saveJSON(KEY, null); saveJSON(INFO, null); socket.emit('authSession', { token: '' }, () => {}); refreshLabel(); closeModal(); toast(tt('deleted')); }));
    });
  }
  const open = () => (info && token ? openProfile() : openForms('login'));
  refreshLabel();
  return { open, connect, pushBoard, isLoggedIn: () => !!token };
}
