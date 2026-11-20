// events.js — Sprint 26c: room-wide market events. One may start at each week boundary (chance set by admin); sector multipliers apply to all player companies' income.
'use strict';
const SECTORS = ['sector.food', 'sector.service', 'sector.tech', 'sector.retail', 'sector.health', 'sector.education', 'sector.creative', 'sector.auto', 'sector.transport'];
// income: sector -> multiplier ('*' = every sector); bills: multiplier for utility bills; days: duration; tone: good | bad
const EVENTS = {
  inflation:   { days: 14, tone: 'bad',  income: { '*': 0.9 },  bills: 1.25 },
  recession:   { days: 21, tone: 'bad',  income: { '*': 0.85 }, bills: 1 },
  energyHike:  { days: 10, tone: 'bad',  income: {},            bills: 1.5 },
  supplyCrisis:{ days: 10, tone: 'bad',  income: { 'sector.retail': 0.7, 'sector.food': 0.7, 'sector.auto': 0.75 }, bills: 1 },
  fuelSpike:   { days: 10, tone: 'bad',  income: { 'sector.transport': 0.75, 'sector.auto': 0.8 }, bills: 1.1 },
  fair:        { days: 7,  tone: 'good', income: { 'sector.retail': 1.3, 'sector.food': 1.3, 'sector.creative': 1.3 }, bills: 1 },
  techBoom:    { days: 14, tone: 'good', income: { 'sector.tech': 1.35, 'sector.education': 1.2 }, bills: 1 },
  holiday:     { days: 7,  tone: 'good', income: { 'sector.food': 1.4, 'sector.retail': 1.3, 'sector.service': 1.3 }, bills: 1 },
  healthWave:  { days: 10, tone: 'good', income: { 'sector.health': 1.4, 'sector.education': 0.85 }, bills: 1 },
  stimulus:    { days: 7,  tone: 'good', income: { '*': 1.1 },  bills: 0.8 }
};
const CFG = { enabled: 1, chance: 0.5, intensity: 1 };           // chance per week (0..1); intensity scales the deviation from 1 (0.5 = half as strong)
const DISABLED = new Set();                                      // event ids the admin switched off
const RANGES = { enabled: [0, 1], chance: [0, 1], intensity: [0, 2] };
const scale = m => 1 + (m - 1) * CFG.intensity;
function setConfig(patch) {
  for (const [k, [lo, hi]] of Object.entries(RANGES)) { const v = Number(patch?.[k]); if (patch && patch[k] !== undefined && Number.isFinite(v)) CFG[k] = Math.max(lo, Math.min(hi, v)); }
  if (Array.isArray(patch?.disabled)) { DISABLED.clear(); patch.disabled.filter(id => EVENTS[id]).forEach(id => DISABLED.add(id)); }
  return state();
}
const state = () => ({ ...CFG, disabled: [...DISABLED] });
// pick an event for the room, never the same one twice in a row; returns null when nothing happens this week
function roll(st, rnd = Math.random) {
  if (!CFG.enabled || rnd() >= CFG.chance) return null;
  const pool = Object.keys(EVENTS).filter(id => !DISABLED.has(id) && id !== st.event?.id && id !== st.lastEventId);
  if (!pool.length) return null;
  const id = pool[Math.floor(rnd() * pool.length)];
  return { id, until: (st.day || 0) + EVENTS[id].days, start: st.day || 0 };
}
const active = st => (st.event && st.event.until > (st.day || 0) && EVENTS[st.event.id]) ? st.event : null;
function incomeMult(st, c) {
  const e = active(st); if (!e || c.isNpc) return 1;
  const inc = EVENTS[e.id].income, m = inc[c.sector] ?? inc['*'] ?? 1;
  return scale(m);
}
function billMult(st) { const e = active(st); return e ? scale(EVENTS[e.id].bills) : 1; }
module.exports = { EVENTS, SECTORS, CFG, RANGES, setConfig, state, roll, active, incomeMult, billMult };
