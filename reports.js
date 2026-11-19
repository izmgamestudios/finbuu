// reports.js
const DAYS_PER_MONTH = 30, MONTHS_PER_YEAR = 12, DAYS_PER_YEAR = DAYS_PER_MONTH * MONTHS_PER_YEAR;
const EXIT_CASH = 50000;
const blankDay = () => ({ revenue: 0, investment: 0, expenses: 0, losses: 0, dividends: 0, units: 0, km: 0, fuel: 0 });

function calendar(day) {
  const year = Math.floor((day - 1) / DAYS_PER_YEAR) + 1;
  const month = Math.floor(((day - 1) % DAYS_PER_YEAR) / DAYS_PER_MONTH) + 1;
  const quarter = Math.ceil(month / 3);
  return { day, year, month, quarter, monthKey: `Y${year}-M${String(month).padStart(2, '0')}`, quarterKey: `Y${year}-Q${quarter}`, yearKey: `Y${year}` };
}

function ensureFin(c) {
  c.fin ||= { today: blankDay(), daily: [], monthly: {}, foundedDay: null };
  return c.fin;
}
function track(c, type, amount) {
  const f = ensureFin(c);
  if (Object.hasOwn(f.today, type) && Number.isFinite(amount)) f.today[type] += amount;
}

// Called once per economy tick (1 tick = 1 game day), after costs are applied
function closeDay(st) {
  st.day = (st.day || 0) + 1;
  const cal = calendar(st.day);
  for (const c of Object.values(st.companies)) {
    const f = ensureFin(c);
    if (f.foundedDay == null) f.foundedDay = st.day;
    f.daily.push({ day: st.day, ...f.today, cash: c.cash, employees: c.employees.length });
    if (f.daily.length > 90) f.daily.shift();
    const m = f.monthly[cal.monthKey] ||= { key: cal.monthKey, year: cal.year, quarter: cal.quarter, month: cal.month, ...blankDay(), closingCash: 0, employees: 0, days: 0 };
    m.days = (m.days || 0) + 1;
    for (const k of Object.keys(blankDay())) m[k] += f.today[k];
    m.closingCash = c.cash;
    m.employees = c.employees.length;
    f.today = blankDay();
  }
  for (const p of Object.values(st.players)) {
    p.history ||= {};
    p.history[cal.monthKey] = { coins: p.coins, xp: Math.round(p.stats.xp), level: p.stats.level, knowledge: p.stats.knowledge,
      success: p.stats.success, performance: p.stats.performance, role: p.role };
  }
}

function aggregate(fin, period = 'month') {
  const groups = {};
  for (const m of Object.values(fin?.monthly || {}).sort((a, b) => a.key.localeCompare(b.key))) {
    const key = period === 'year' ? `Y${m.year}` : period === 'quarter' ? `Y${m.year}-Q${m.quarter}` : m.key;
    const g = groups[key] ||= { period: key, ...blankDay(), closingCash: 0, employees: 0 };
    for (const k of Object.keys(blankDay())) g[k] += m[k];
    g.closingCash = m.closingCash;
    g.employees = m.employees;
  }
  return Object.values(groups).map(g => ({ ...g, profit: g.revenue - g.expenses - g.losses }));
}

function analyze(c, currentDay) {
  // Only complete months (30 game days) are used for growth/profit, so a half-finished month doesn't skew the trend
  const months = Object.values(c.fin?.monthly || {}).sort((a, b) => a.key.localeCompare(b.key))
    .filter(m => (m.days || 0) >= DAYS_PER_MONTH).map(m => ({ ...m, profit: m.revenue - m.expenses - m.losses }));
  const last3 = months.slice(-3), prev3 = months.slice(-6, -3);
  const sum = (rows, k) => rows.reduce((s, r) => s + r[k], 0);
  const rev = sum(last3, 'revenue'), prevRev = sum(prev3, 'revenue');
  const growth = prevRev > 0 ? (rev - prevRev) / prevRev : rev > 0 ? 1 : 0;
  const profit = sum(last3, 'profit');
  const burn = last3.length ? -profit / last3.length : 0;
  const runwayMonths = burn > 0 ? Math.max(0, c.cash) / burn : Infinity;
  const ageDays = currentDay - (c.fin?.foundedDay ?? currentDay);

  let status;
  if (c.status === 'bankrupt') status = 'bankrupt';
  else if (c.crisis && c.crisis.until > currentDay) status = 'inCrisis';
  else if (c.cash >= EXIT_CASH && growth > 0) status = 'exitReady';
  else if (growth > 0.1 && profit > 0 && runwayMonths > 6) status = 'investable';
  else if (runwayMonths < 3) status = 'atRisk';
  else if (growth > 0) status = 'growing';
  else status = 'stable';

  const score = c.status === 'bankrupt' ? 0 : Math.round(Math.max(0, Math.min(100,
    40 + growth * 30 + (profit > 0 ? 15 : -15) + Math.min(15, (isFinite(runwayMonths) ? runwayMonths : 24) / 2) + Math.min(10, c.employees.length * 2))));

  return { status, score, growthPct: Math.round(growth * 100), profitLast3M: profit, burnPerMonth: Math.round(burn),
    runwayMonths: isFinite(runwayMonths) ? +runwayMonths.toFixed(1) : null, ageDays,
    investable: status === 'investable' || status === 'exitReady' };
}

function companyReport(st, c, period) {
  return { id: c.id, room: st.id, name: c.name, nameKey: c.nameKey, workspace: c.workspace, isNpc: c.isNpc,
    cash: c.cash, totalSales: c.sales, founders: c.founders.length, employees: c.employees.length,
    benefits: c.benefits, performance: c.performance, crisis: c.crisis || null, crisisCount: c.crisisCount || 0, foundedDay: c.fin?.foundedDay ?? null, closedDay: c.closedDay ?? null,
    analysis: analyze(c, st.day || 0), series: aggregate(c.fin, period) };
}

function employeeReport(st, p, online) {
  const employer = Object.values(st.companies).find(c => c.employees.includes(p.id));
  const founderOf = Object.values(st.companies).filter(c => c.founders.includes(p.id)).map(c => c.name || c.nameKey);
  const hist = Object.entries(p.history || {}).sort(([a], [b]) => a.localeCompare(b)).map(([period, v]) => ({ period, ...v }));
  const first = hist[0], last = hist.at(-1);
  return { id: p.id, room: st.id, name: p.name, role: p.role, online, coins: p.coins, stats: p.stats,
    employer: employer ? employer.name || employer.nameKey : null, founderOf,
    coinGrowth: first ? p.coins - first.coins : 0, xpGrowth: first && last ? last.xp - first.xp : 0, series: hist };
}

function fullReport(rooms, { roomId, period = 'month' } = {}) {
  const list = roomId ? [rooms[roomId]].filter(Boolean) : Object.values(rooms);
  const companies = [], employees = [];
  for (const st of list) {
    for (const c of [...Object.values(st.companies), ...(st.archive || [])]) companies.push(companyReport(st, c, period));
    for (const p of Object.values(st.players)) employees.push(employeeReport(st, p, true));
    for (const p of Object.values(st.pastPlayers || {})) employees.push(employeeReport(st, p, false));
  }
  const ranked = [...companies].sort((a, b) => b.analysis.score - a.analysis.score);
  ranked.forEach((c, i) => { c.rank = i + 1; c.percentile = Math.round(100 - (i / Math.max(1, ranked.length)) * 100); });

  const market = {};
  for (const c of companies) for (const s of c.series) {
    const m = market[s.period] ||= { period: s.period, revenue: 0, expenses: 0, investment: 0, losses: 0, profit: 0, companies: 0 };
    m.revenue += s.revenue; m.expenses += s.expenses; m.investment += s.investment; m.losses += s.losses; m.profit += s.profit; m.companies++;
  }
  const statusCounts = companies.reduce((acc, c) => ((acc[c.analysis.status] = (acc[c.analysis.status] || 0) + 1), acc), {});
  const day = Math.max(0, ...list.map(st => st.day || 0));
  return { generatedAt: new Date().toISOString(), calendar: day ? calendar(day) : null, period,
    summary: { companies: companies.length, employees: employees.length, statusCounts,
      totalCash: companies.reduce((s, c) => s + c.cash, 0), totalSales: companies.reduce((s, c) => s + c.totalSales, 0) },
    market: Object.values(market).sort((a, b) => a.period.localeCompare(b.period)),
    comparison: ranked.map(c => ({ rank: c.rank, percentile: c.percentile, id: c.id, room: c.room, name: c.name || c.nameKey,
      status: c.analysis.status, score: c.analysis.score, growthPct: c.analysis.growthPct, cash: c.cash, runwayMonths: c.analysis.runwayMonths })),
    companies: ranked, employees };
}

const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function toCSV(report) {
  const lines = [['type', 'room', 'name', 'status', 'score', 'period', 'revenue', 'investment', 'expenses', 'losses', 'dividends', 'profit', 'closingCash', 'employees', 'coins', 'xp', 'level', 'knowledge', 'success'].join(',')];
  for (const c of report.companies) for (const s of c.series)
    lines.push(['company', c.room, c.name || c.nameKey, c.analysis.status, c.analysis.score, s.period, s.revenue, s.investment, s.expenses, s.losses, s.dividends, s.profit, s.closingCash, s.employees, '', '', '', '', ''].map(csvCell).join(','));
  for (const e of report.employees) for (const s of e.series)
    lines.push(['employee', e.room, e.name, e.role, '', s.period, '', '', '', '', '', '', '', '', s.coins, s.xp, s.level, s.knowledge, s.success].map(csvCell).join(','));
  return '\uFEFF' + lines.join('\n');
}

// ---------- Session report (B2B: institution / incubator handout). Pure: server passes in pre-computed readiness. ----------
const esc = v => String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const tl = n => Math.round(n).toLocaleString('tr-TR');

// rows: [{ company, founders, employees, cash, sales, status, score, canvas, pitchWords, readiness, funded }]
function sessionData(st, rows) {
  const players = [...Object.values(st.players), ...Object.values(st.pastPlayers || {})];
  const polls = [...(st.presentation?.pollHistory || []), ...(st.presentation?.poll ? [st.presentation.poll] : [])].map(p => ({
    question: p.question, total: p.options.reduce((s, o) => s + o.votes, 0), options: p.options.map(o => ({ text: o.text, votes: o.votes })) }));
  const ranked = [...rows].sort((a, b) => b.readiness - a.readiness);
  return { generatedAt: new Date().toISOString(), room: st.id, mode: st.mode, day: st.day || 0, players: players.length,
    teams: Object.keys(st.teams || {}).length, companies: ranked, polls,
    kpi: { canvasComplete: rows.filter(r => r.canvas >= 9).length, pitchReady: rows.filter(r => r.pitchWords >= 40).length,
      funded: rows.filter(r => r.funded).length, avgReadiness: rows.length ? Math.round(rows.reduce((s, r) => s + r.readiness, 0) / rows.length) : 0 } };
}

function sessionHTML(d) {
  const pct = (n, t) => t ? Math.round(n / t * 100) + '%' : '-';
  const n = d.companies.length;
  return `<!doctype html><html lang="tr"><head><meta charset="utf-8"><title>Finbuu Oturum Raporu ${esc(d.room)}</title>
<style>body{font:14px/1.5 system-ui,sans-serif;max-width:900px;margin:24px auto;padding:0 16px;color:#111}h1{margin:0}h2{border-bottom:2px solid #111;padding-bottom:4px;margin-top:28px}
table{width:100%;border-collapse:collapse;margin:8px 0}th,td{border:1px solid #ccc;padding:5px 8px;text-align:left}th{background:#f2f2f2}td.n{text-align:right}
.kpi{display:flex;gap:12px;flex-wrap:wrap}.kpi div{flex:1;min-width:130px;border:1px solid #ccc;border-radius:8px;padding:10px}.kpi b{display:block;font-size:22px}
.bar{background:#eee;height:10px;border-radius:5px}.bar i{display:block;height:10px;border-radius:5px;background:#2a7}@media print{button{display:none}}</style></head><body>
<button onclick="print()">🖨 Yazdır / PDF</button>
<h1>🏙 Finbuu · Oturum Raporu</h1>
<p>Oda <b>${esc(d.room)}</b> (${esc(d.mode)}) · Oyun günü ${d.day} · ${esc(new Date(d.generatedAt).toLocaleString('tr-TR'))}</p>
<div class="kpi"><div><b>${d.players}</b>Katılımcı</div><div><b>${n}</b>Şirket</div><div><b>${d.teams}</b>Takım</div>
<div><b>${pct(d.kpi.canvasComplete, n)}</b>Kanvas 9/9</div><div><b>${pct(d.kpi.pitchReady, n)}</b>Pitch yazıldı</div><div><b>${d.kpi.funded}</b>Teklif alan</div><div><b>${d.kpi.avgReadiness}</b>Ort. hazırlık</div></div>
<h2>Yatırıma hazırlık sıralaması</h2>
<table><tr><th>#</th><th>Şirket</th><th>Kurucu</th><th>Kanvas</th><th>Pitch (kelime)</th><th>Kasa (c)</th><th>Satış</th><th>Durum</th><th>Hazırlık</th></tr>
${d.companies.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(r.company)}</td><td>${esc(r.founders)}</td><td class="n">${r.canvas}/9</td><td class="n">${r.pitchWords}</td><td class="n">${tl(r.cash)}</td><td class="n">${tl(r.sales)}</td><td>${esc(r.status)}</td><td><div class="bar"><i style="width:${r.readiness}%"></i></div>${r.readiness}</td></tr>`).join('') || '<tr><td colspan="9">Şirket yok.</td></tr>'}</table>
<h2>Anketler</h2>${d.polls.map(p => `<h3>${esc(p.question)} <small>(${p.total} oy)</small></h3><table>${p.options.map(o => `<tr><td>${esc(o.text)}</td><td class="n">${o.votes}</td><td class="n">${pct(o.votes, p.total)}</td></tr>`).join('')}</table>`).join('') || '<p>Anket yapılmadı.</p>'}
</body></html>`;
}

function sessionCSV(d) {
  const lines = [['room', 'company', 'founders', 'canvas', 'pitchWords', 'cash', 'sales', 'status', 'readiness', 'funded'].join(',')];
  for (const r of d.companies) lines.push([d.room, r.company, r.founders, r.canvas, r.pitchWords, r.cash, r.sales, r.status, r.readiness, r.funded ? 1 : 0].map(csvCell).join(','));
  for (const p of d.polls) for (const o of p.options) lines.push(['poll', p.question, o.text, o.votes].map(csvCell).join(','));
  return '﻿' + lines.join('\n');
}

module.exports = { sessionData, sessionHTML, sessionCSV, calendar, ensureFin, track, closeDay, aggregate, analyze, fullReport, toCSV, EXIT_CASH };
