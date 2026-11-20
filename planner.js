// planner.js — Sprint 17b: Mini SaaS planner (task list, Gantt, calendar) for the IT department. Pure helpers; server.js owns I/O and rewards.
const MAX_TASKS = 20, MAX_DUR = 30, MAX_AHEAD = 90, NAME_MAX = 40;
const REWARD = { onTime: { xp: 3, k: 1 }, late: { xp: 1, k: 0.5 } };
const plan = c => (c.plan ||= { tasks: [], seq: 0 });
const statusOf = (tk, day) => (tk.done ? 'done' : day > tk.start + tk.dur ? 'overdue' : day >= tk.start ? 'active' : 'planned');

// returns { ok:true, task } or { ok:false, key }
function add(c, day, { name, start, dur }) {
  const p = plan(c), nm = String(name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, NAME_MAX);
  const s = Math.floor(Number(start)), d = Math.floor(Number(dur));
  if (!nm || !Number.isFinite(s) || !Number.isFinite(d) || d < 1 || d > MAX_DUR || s < day || s > day + MAX_AHEAD) return { ok: false, key: 'toast.planBad' };
  if (p.tasks.length >= MAX_TASKS) return { ok: false, key: 'toast.planFull' };
  const task = { id: ++p.seq, name: nm, start: s, dur: d, created: day, done: false, doneDay: null };
  p.tasks.push(task); return { ok: true, task };
}
// Completing is allowed once the task has started AND at least one game day has passed since it started (no instant farming).
function complete(c, day, id) {
  const tk = plan(c).tasks.find(x => x.id === id);
  if (!tk || tk.done) return { ok: false };
  if (day <= tk.start) return { ok: false, key: 'toast.planTooEarly' };
  tk.done = true; tk.doneDay = day;
  const onTime = day <= tk.start + tk.dur;
  return { ok: true, onTime, ...(onTime ? REWARD.onTime : REWARD.late) };
}
const remove = (c, id) => { const p = plan(c), n = p.tasks.length; p.tasks = p.tasks.filter(x => x.id !== id); return p.tasks.length < n; };
const view = (c, day) => plan(c).tasks.map(t => ({ ...t, status: statusOf(t, day) })).sort((a, b) => a.start - b.start || a.id - b.id);
module.exports = { MAX_TASKS, MAX_DUR, MAX_AHEAD, NAME_MAX, REWARD, statusOf, add, complete, remove, view, plan };
