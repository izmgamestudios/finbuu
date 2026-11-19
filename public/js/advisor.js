// public/js/advisor.js
// Suggestion engine: ranks the next sensible move so the game can be played with OK / Next / Auto.
// Pure functions over the public state snapshot; the server still validates every action.

const RESCUE_AMOUNT = 100;
export const staffOf = c => c.employees.length + (c.npcStaff || 0);
// Must mirror server floorsFor(): building floors follow the lot's total cash (own cash for virtual companies)
export const floorsFor = cash => Math.max(1, Math.min(6, 1 + Math.floor(Math.log2(Math.max(1, cash) / 250))));
export const floorsOfCompany = (state, c) => floorsFor(c.lotId == null ? c.cash
  : state.lots[c.lotId].companyIds.reduce((sum, id) => sum + (state.companies[id]?.cash || 0), 0));
export const deptOpen = (seed, state, c, key) => { const d = seed.departments?.find(x => x.key === key); return !!d && !d.locked && d.floor < floorsOfCompany(state, c); };
const WITHDRAW_AT = 400;
const SHOP_UPGRADE_COINS = 400;

export const employeeCap = (seed, state, c) =>
  c.workspace === 'shop' ? seed.lotSizes[state.lots[c.lotId].size].capacity : seed.workspaces[c.workspace].maxEmployees;
export const maxTenants = (seed, lot) =>
  lot.type === 'coworking' ? seed.workspaces.coworking.maxTenants : seed.lotSizes[lot.size].maxTenants;
const shopDeposit = (seed, lot) => Math.ceil(seed.lotSizes[lot.size].rent / (lot.companyIds.length + 1)) * 5;
const targetOf = c => (c.lotId == null ? { kind: 'plaza' } : { kind: 'lot', lotId: c.lotId });
const bestTemplateIdx = seed => seed.templates.reduce((best, tp, i, all) => (tp.price > all[best].price ? i : best), 0);

// Returns candidates sorted by score (highest first). Each candidate:
// { id, score, labelKey, reasonKey, params, cid?, target, action: { ev, payload } }
export function suggestions({ state, seed, myId, name }) {
  const me = state?.players?.[myId];
  if (!me || !seed) return [];
  const companies = Object.values(state.companies);
  const mine = companies.filter(c => c.founders.includes(myId));
  const job = companies.find(c => c.employees.includes(myId));
  const out = [];
  const add = (cand) => out.push(cand);

  if (!mine.length && !job) {
    add({ id: 'foundHome', score: 90, labelKey: 'adv.foundHome', reasonKey: 'adv.foundHomeWhy', params: {},
      target: { kind: 'plaza' }, action: { ev: 'found', payload: { lotId: null, workspace: 'home', name: '', templateIdx: bestTemplateIdx(seed) } } });
  }

  for (const c of mine) {
    const p = { company: name(c) };
    const blocked = c.crisis && c.crisis.until > (state.day || 0) && c.crisis.type === 'trustee';
    if (c.cash < 0 && me.coins >= RESCUE_AMOUNT) {
      add({ id: 'rescue:' + c.id, score: 110, labelKey: 'adv.rescue', reasonKey: 'adv.rescueWhy', params: p, cid: c.id,
        target: targetOf(c), action: { ev: 'invest', payload: { cid: c.id, amount: RESCUE_AMOUNT } } });
    }
    if (c.cash >= WITHDRAW_AT && !blocked) {
      add({ id: 'withdraw:' + c.id, score: 85, labelKey: 'adv.withdraw', reasonKey: 'adv.withdrawWhy', params: p, cid: c.id,
        target: targetOf(c), action: { ev: 'withdraw', payload: { cid: c.id } } });
    }
    const active = c.marketing && c.marketing.until > (state.day || 0);
    if (seed.marketing && deptOpen(seed, state, c, 'marketing') && !active && c.cash >= seed.marketing.cost + 200) {
      add({ id: 'marketing:' + c.id, score: 82, labelKey: 'adv.marketing', reasonKey: 'adv.marketingWhy', params: { ...p, days: seed.marketing.days }, cid: c.id,
        target: targetOf(c), action: { ev: 'marketing', payload: { cid: c.id } } });
    }
    const npcProfit = c.price * (seed.workspaces[c.workspace]?.salesMult || 1) * 4 - (seed.salary ?? 25);
    if (deptOpen(seed, state, c, 'hr') && staffOf(c) < employeeCap(seed, state, c) && npcProfit > 0 && c.cash > 200) {
      add({ id: 'hire:' + c.id, score: 79, labelKey: 'adv.hire', reasonKey: 'adv.hireWhy', params: { ...p, profit: Math.round(npcProfit) }, cid: c.id,
        target: targetOf(c), action: { ev: 'hireNpc', payload: { cid: c.id } } });
    }
    add({ id: 'sell:' + c.id, score: c.cash < 50 ? 100 : 80 - Math.min(20, c.cash / 50), labelKey: 'adv.sell',
      reasonKey: c.cash < 50 ? 'adv.sellLowWhy' : 'adv.sellWhy', params: p, cid: c.id,
      target: targetOf(c), action: { ev: 'click', payload: { cid: c.id } } });
  }

  if (job && !job.founders.includes(myId)) {
    add({ id: 'sell:' + job.id, score: 75, labelKey: 'adv.sell', reasonKey: 'adv.sellJobWhy', params: { company: name(job) }, cid: job.id,
      target: targetOf(job), action: { ev: 'click', payload: { cid: job.id } } });
  }

  // Upgrade: only digital companies so far and enough coins -> open a physical shop
  if (mine.length && mine.every(c => c.lotId == null) && me.coins >= SHOP_UPGRADE_COINS) {
    const lot = state.lots.filter(l => l.type === 'shop' && l.companyIds.length < maxTenants(seed, l))
      .sort((a, b) => shopDeposit(seed, a) - shopDeposit(seed, b))[0];
    if (lot) add({ id: 'foundShop:' + lot.id, score: 78, labelKey: 'adv.foundShop', reasonKey: 'adv.foundShopWhy', params: { size: lot.size },
      target: { kind: 'lot', lotId: lot.id }, action: { ev: 'found', payload: { lotId: lot.id, workspace: 'shop', name: '', templateIdx: lot.id % seed.templates.length } } });
  }

  if (!job) {
    const open = companies.filter(c => !c.founders.includes(myId) && staffOf(c) < employeeCap(seed, state, c))
      .sort((a, b) => (b.performance || 1) - (a.performance || 1) || b.cash - a.cash)[0];
    if (open) add({ id: 'work:' + open.id, score: mine.length ? 40 : 70, labelKey: 'adv.work', reasonKey: 'adv.workWhy',
      params: { company: name(open), salary: seed.salary ?? 25 }, cid: open.id, target: targetOf(open), action: { ev: 'work', payload: { cid: open.id } } });
  }

  const partner = companies.find(c => !c.isNpc && !c.founders.includes(myId) && c.founders.length < 3);
  if (partner) add({ id: 'cofound:' + partner.id, score: 30, labelKey: 'adv.cofound', reasonKey: 'adv.cofoundWhy', params: { company: name(partner) },
    cid: partner.id, target: targetOf(partner), action: { ev: 'cofound', payload: { cid: partner.id } } });

  const shop = companies.filter(c => c.isNpc && c.price <= me.coins).sort((a, b) => a.price - b.price)[0];
  if (shop) add({ id: 'buy:' + shop.id, score: 15, labelKey: 'adv.buy', reasonKey: 'adv.buyWhy', params: { company: name(shop) },
    cid: shop.id, target: targetOf(shop), action: { ev: 'buy', payload: { cid: shop.id } } });

  return out.sort((a, b) => b.score - a.score);
}

// Actions available on one company card, recommended first.
export function companyActions({ state, seed, myId }, c, ranked) {
  const me = state.players[myId];
  const founder = c.founders.includes(myId), employee = c.employees.includes(myId);
  const list = [];
  if (founder || employee) list.push({ ev: 'click', key: 'ui.clickSell' });
  if (!founder && me.coins >= c.price) list.push({ ev: 'buy', key: 'ui.buy' });
  if (!c.isNpc && !founder && c.founders.length < 3) list.push({ ev: 'cofound', key: 'ui.cofound' });
  if (!employee && staffOf(c) < employeeCap(seed, state, c)) list.push({ ev: 'work', key: 'ui.work' });
  if (me.coins >= RESCUE_AMOUNT) list.push({ ev: 'invest', key: 'ui.invest', payload: { amount: RESCUE_AMOUNT } });
  if (founder && c.cash > 0) list.push({ ev: 'withdraw', key: 'ui.withdraw' });
  const rec = ranked.find(s => s.cid === c.id && list.some(a => a.ev === s.action.ev));
  const recEv = rec ? rec.action.ev : list[0]?.ev;
  list.forEach(a => (a.recommended = a.ev === recEv));
  list.sort((a, b) => b.recommended - a.recommended);
  return { list, rec };
}
