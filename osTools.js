// osTools.js — Sprint 21a: install open-source tools on a company (setup + monthly hosting are real costs, license = 0).
// Pure helpers; server.js owns money/XP/IO. Catalog: public/data/open-source-tools.json (also shown client-side in the Open Source building).
'use strict';
const path = require('path');
const catalog = require(path.join(__dirname, 'public', 'data', 'open-source-tools.json'));

const BY_ID = new Map(catalog.tools.map(t => [t.id, t]));
const SETUP_SCALE = 0.4;               // catalog setupCost x0.4 (tier 1 = 200 coins instead of 500: half of the 1000 start coins was too heavy)
const DIMINISH = 0.8;                  // each extra tool on the same stat counts 80 % of the previous one
const CAP = { default: 0.35, operatingCostReduction: 0.2 };
const MAX_TOOLS = 12, XP_DIV = 5;      // catalog xpReward / 5 -> 10 / 24 / 50 / 100 XP on first install
const GRACE_NOTE = 'suspended';        // a tool whose hosting cannot be paid is suspended (effects off), never bankrupting the company

// effects that are already wired into the economy (Sprint 21a); the rest arrive in 21c and cannot be bought yet
const WIRED = new Set(['employeeProductivity', 'operatingCostReduction', 'customerRetention', 'conversionRate']);
const get = id => BY_ID.get(id) || null;
const setupCost = tool => Math.max(1, Math.round(tool.game.setupCost * SETUP_SCALE));
const book = c => (c.tools ||= []);
const active = c => book(c).filter(x => !x.suspended && BY_ID.has(x.id));
const hostingMonthly = c => active(c).reduce((s, x) => s + BY_ID.get(x.id).game.monthlyHostingCost, 0);

// Sum of effects per stat: sorted desc, each next tool x0.8, then capped.
function effects(c) {
  const per = {};
  for (const x of active(c)) { const e = BY_ID.get(x.id).game.effect; (per[e.stat] ||= []).push(e.value); }
  const out = {};
  for (const [stat, vals] of Object.entries(per)) {
    if (stat === 'onlineSalesChannel') { out[stat] = 1; continue; }            // binary: opens a channel, never stacks
    vals.sort((a, b) => b - a);
    const sum = vals.reduce((s, v, i) => s + v * DIMINISH ** i, 0);
    out[stat] = Math.min(CAP[stat] ?? CAP.default, +sum.toFixed(4));
  }
  return out;
}
const effectOf = (c, stat) => (c.tools?.length ? effects(c)[stat] || 0 : 0);

// -> { ok:true, tool, cost } | { ok:false, key }
function checkInstall(c, id, level) {
  const tool = get(id);
  if (!tool) return { ok: false, key: 'toast.toolBad' };
  if (!WIRED.has(tool.game.effect.stat)) return { ok: false, key: 'toast.toolSoon' };
  if (book(c).some(x => x.id === id)) return { ok: false, key: 'toast.toolHave' };
  if (book(c).length >= MAX_TOOLS) return { ok: false, key: 'toast.toolFull' };
  if (level < tool.game.unlockLevel) return { ok: false, key: 'toast.toolLevel' };
  const cost = setupCost(tool);
  if (c.cash < cost) return { ok: false, key: 'toast.noCash' };
  return { ok: true, tool, cost };
}
const place = (c, id, day) => { book(c).push({ id, day, suspended: false }); };
function remove(c, id) { const n = book(c).length; c.tools = book(c).filter(x => x.id !== id); return c.tools.length < n; }

// Month close: pay hosting for each active tool in catalog order of installation; those that cannot be paid are suspended.
function chargeMonth(c) {
  let paid = 0; const suspended = [];
  for (const x of book(c)) {
    if (x.suspended || !BY_ID.has(x.id)) continue;
    const cost = BY_ID.get(x.id).game.monthlyHostingCost;
    if (c.cash >= cost) { c.cash -= cost; paid += cost; } else { x.suspended = true; suspended.push(x.id); }
  }
  return { paid, suspended };
}
// Reactivate a suspended tool: pays one month upfront. -> { ok, cost } | { ok:false, key }
function reactivate(c, id) {
  const x = book(c).find(y => y.id === id); if (!x || !x.suspended) return { ok: false, key: 'toast.toolBad' };
  const cost = BY_ID.get(id).game.monthlyHostingCost;
  if (c.cash < cost) return { ok: false, key: 'toast.noCash' };
  c.cash -= cost; x.suspended = false; return { ok: true, cost };
}
const categories = c => new Set(book(c).map(x => BY_ID.get(x.id)?.category).filter(Boolean));
module.exports = { WIRED, SETUP_SCALE, DIMINISH, CAP, MAX_TOOLS, XP_DIV, get, setupCost, book, active, hostingMonthly, effects, effectOf, checkInstall, place, remove, chargeMonth, reactivate, categories, GRACE_NOTE };
