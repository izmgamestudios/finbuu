// Balance simulation (Sprint 25). Needs a running dev server: PORT=3998 ADMIN_TOKEN=test-token-123456 ADMIN_EMAIL=a@b.c node server.js ; then: node tools/sim-balance.js (requires playwright)
const { chromium } = require('playwright');
(async () => {
  const b = await chromium.launch(); const p = await b.newPage(); await p.exposeFunction('report', (n, r) => console.log(n, JSON.stringify(r))); await p.goto('http://127.0.0.1:3998/'); await p.waitForTimeout(500);
  const out = await p.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const post = (u, b, h = {}) => fetch(u, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify(b) }).then(x => x.json());
    let l = await post('/admin/auth/login', { email: 'a@b.c', password: 'a-new-long-password-1' }); if (!l.token) { l = await post('/admin/auth/login', { email: 'a@b.c', password: 'test-token-123456' }); await post('/admin/auth/password', { newPassword: 'a-new-long-password-1' }, { authorization: 'Bearer ' + l.token }); }
    const adm = io('/admin', { auth: { token: l.token }, forceNew: true }); await new Promise(r => adm.on('connect', r));
    const results = {};
    for (const [name, clicksPerDay, ws, price] of [['casual-home', 8, 'home', 30], ['active-home', 40, 'home', 30], ['active-eoffice', 40, 'eoffice', 30], ['casual-eoffice-price60', 8, 'eoffice', 60]]) {
      const s = io({ forceNew: true }); let st = null; s.on('state', x => { st = x; }); await new Promise(r => s.on('connect', r));
      s.emit('startSolo', { name: name.slice(0, 12) }); await sleep(800);
      s.emit('found', { lotId: null, workspace: ws, name: 'Sim', custom: { label: 'Big', sector: 'sector.retail', price } }); await sleep(700);
      const co = () => Object.values(st.companies).find(c => c.name === 'Sim'); const me = () => st.players[Object.keys(st.players)[0]];
      if (!co()) { results[name] = 'founding failed'; await window.report(name, 'founding failed'); s.close(); continue; }
      const cid = co().id, rows = []; const c0 = co().cash; const coin0 = me().coins;
      for (let day = 1; day <= 20; day++) {
        for (let i = 0; i < clicksPerDay; i++) { s.emit('click', { cid }); await sleep(105); }
        adm.emit('runTick', { days: 1 }); await sleep(450);
        if (day % 5 === 0) rows.push({ day, cash: Math.round(co().cash), coins: Math.round(me().coins), lvl: me().stats.level, xp: Math.round(me().stats.xp) });
      }
      results[name] = { startCash: Math.round(c0), startCoins: Math.round(coin0), rows }; await window.report(name, results[name]); s.close();
    }
    return results;
  });
  await b.close();
})();
