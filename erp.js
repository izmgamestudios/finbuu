// erp.js — Sprint 17c: Mini SaaS ERP (stock / capacity + supply orders) for the IT department. Pure helpers; server.js owns money and I/O.
const INITIAL_STOCK = 20, IN_STOCK_BONUS = 1.05, OUT_MULT = 0.6, UNIT_COST_PCT = 0.4;
const MAX_QTY = 200, MAX_PENDING = 5, LEAD_MAX = 5, LEAD_MIN = 2, STREAK_GOAL = 30;
const SERVICE_SECTORS = ['sector.service', 'sector.tech', 'sector.education', 'sector.creative', 'sector.health'];
const book = c => (c.erp ||= { stock: {}, orders: [], seq: 0, lost: 0, okDays: 0 });
const isService = c => SERVICE_SECTORS.includes(c.sector);
// Every product starts with a free stock so the game never blocks new players.
const stockOf = (c, pid) => { const b = book(c); if (b.stock[pid] === undefined) b.stock[pid] = INITIAL_STOCK; return b.stock[pid]; };
const leadDays = c => Math.max(LEAD_MIN, LEAD_MAX - (c.security || 0));

// Take `units` from stock. Returns the revenue multiplier (units in stock sell at +5 %, missing units at 60 %).
function consume(c, pid, units) {
  const have = stockOf(c, pid), b = book(c), n = Math.max(1, units), used = Math.min(have, n);
  b.stock[pid] = have - used;
  return (used * IN_STOCK_BONUS + (n - used) * OUT_MULT) / n;
}
function order(c, day, pid, qty, unitPrice) {
  const b = book(c), q = Math.floor(Number(qty));
  if (!(q >= 1 && q <= MAX_QTY)) return { ok: false, key: 'toast.erpBad' };
  if (b.orders.length >= MAX_PENDING) return { ok: false, key: 'toast.erpFull' };
  const cost = Math.max(1, Math.round(unitPrice * UNIT_COST_PCT)) * q, due = day + leadDays(c);
  return { ok: true, cost, order: { id: ++b.seq, pid, qty: q, due, placed: day } };
}
const place = (c, o) => { book(c).orders.push(o); };
// Called once per game day: delivers due orders, returns them; updates the "never out of stock" streak.
function tick(c, day, pids) {
  const b = book(c), delivered = b.orders.filter(o => o.due <= day);
  for (const o of delivered) b.stock[o.pid] = stockOf(c, o.pid) + o.qty;
  b.orders = b.orders.filter(o => o.due > day);
  b.okDays = pids.every(p => stockOf(c, p) > 0) ? b.okDays + 1 : 0;
  return { delivered, streakReached: b.okDays >= STREAK_GOAL };
}
module.exports = { INITIAL_STOCK, IN_STOCK_BONUS, OUT_MULT, UNIT_COST_PCT, MAX_QTY, MAX_PENDING, STREAK_GOAL, book, isService, stockOf, leadDays, consume, order, place, tick };
