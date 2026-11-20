// crm.js — Sprint 17a: Mini SaaS (CRM + KPI) for the IT department. Pure helpers; server.js owns I/O and money.
const FIRST = ['Ahmet', 'Ayşe', 'Mehmet', 'Fatma', 'Mustafa', 'Elif', 'Emre', 'Zeynep', 'Can', 'Selin', 'Burak', 'Deniz', 'Ece', 'Kaan', 'Merve', 'Oğuz', 'Pınar', 'Cem', 'Derya', 'Hakan',
  'İpek', 'Murat', 'Nur', 'Onur', 'Sibel', 'Tolga', 'Yasemin', 'Berk', 'Gül', 'Serkan'];
const INITIALS = 'ABCÇDEFGHİKLMNOPRSŞTUVYZ';
const CAP = 40, DORMANT_DAYS = 30, FOLLOW_COST = 10, FOLLOW_COOLDOWN_DAYS = 10, AUTO_CHANCE = 0.08;
const WIN_CHANCE = { lead: 0.4, dormant: 0.5, active: 0.3 };

const stageOf = (cu, day) => (cu.orders === 0 ? 'lead' : day - cu.last > DORMANT_DAYS ? 'dormant' : 'active');
const randomName = rnd => `${FIRST[rnd(FIRST.length)]} ${INITIALS[rnd(INITIALS.length)]}.`;
const book = c => (c.crm ||= { customers: [], seq: 0 });

// Add a customer or update an existing one. amount > 0 = a purchase; 0 = a lead that did not buy.
function record(c, day, { id = null, name, persona = null, amount = 0 }) {
  const b = book(c);
  let cu = id != null ? b.customers.find(x => x.id === id) : null;
  if (!cu) {
    cu = { id: ++b.seq, name, persona, orders: 0, spent: 0, first: day, last: day, followAt: -1e9 };
    b.customers.push(cu);
    if (b.customers.length > CAP) { // drop the least valuable (lowest spend, then oldest)
      b.customers.sort((x, y) => x.spent - y.spent || x.last - y.last); b.customers.shift();
    }
  }
  if (amount > 0) { cu.orders++; cu.spent += Math.round(amount); }
  cu.last = day;
  return cu;
}
const canFollow = (cu, day) => day - cu.followAt >= FOLLOW_COOLDOWN_DAYS;
const winChance = (cu, day) => WIN_CHANCE[stageOf(cu, day)];

function kpis(c, day) {
  const list = book(c).customers, buyers = list.filter(x => x.orders > 0);
  const count = s => list.filter(x => stageOf(x, day) === s).length;
  const orders = buyers.reduce((s, x) => s + x.orders, 0), spent = buyers.reduce((s, x) => s + x.spent, 0);
  const d = (c.fin?.daily || []).slice(-30), sum = k => d.reduce((s, x) => s + (x[k] || 0), 0);
  const revenue30 = sum('revenue'), expenses30 = sum('expenses') + sum('advertising') + sum('tax') + sum('utilities') + sum('accounting') + sum('stampTax');
  return {
    customers: list.length, leads: count('lead'), active: count('active'), dormant: count('dormant'),
    repeatRate: buyers.length ? Math.round((buyers.filter(x => x.orders >= 2).length / buyers.length) * 100) : 0,
    avgOrder: orders ? Math.round(spent / orders) : 0, ltv: buyers.length ? Math.round(spent / buyers.length) : 0,
    revenue30: Math.round(revenue30), units30: sum('units'), expenses30: Math.round(expenses30),
    margin: revenue30 > 0 ? Math.round(((revenue30 - expenses30) / revenue30) * 100) : null,
    cac: list.length && sum('advertising') > 0 ? Math.round(sum('advertising') / list.length) : null,
    days: d.length
  };
}
module.exports = { CAP, DORMANT_DAYS, FOLLOW_COST, FOLLOW_COOLDOWN_DAYS, AUTO_CHANCE, stageOf, randomName, record, canFollow, winChance, kpis, book };
