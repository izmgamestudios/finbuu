// goals.js — Sprint 26a: one shared goal per room per month (30 days). Everyone's progress counts; reward goes to players who contributed.
'use strict';
// per-player target for one month (scaled by player count x admin difficulty). metric = player counter name
const TYPES = [
  { id: 'revenue', metric: 'revenue', perPlayer: 2500 },
  { id: 'sales',   metric: 'sales',   perPlayer: 120 },
  { id: 'quests',  metric: 'quests',  perPlayer: 4 }
];
const MIN_SHARE = 0.1;   // a player must deliver >= 10% of the per-player target to receive the reward (no free-riding)
const LEN = 30;
const humans = st => Object.values(st.players).filter(p => !p.isNpc);
function start(st, difficulty = 1) {
  const n = Math.floor((st.day || 0) / LEN), type = TYPES[n % TYPES.length], ps = humans(st), count = Math.max(1, ps.length);
  st.goal = { n: n + 1, type: type.id, target: Math.max(1, Math.round(type.perPlayer * count * difficulty)), perPlayer: Math.max(1, Math.round(type.perPlayer * difficulty)), startDay: st.day || 0, endDay: (n + 1) * LEN, base: Object.fromEntries(ps.map(p => [p.id, p.counters?.[type.metric] || 0])) };
  return st.goal;
}
const typeOf = g => TYPES.find(t => t.id === g.type);
const contrib = (st, g) => Object.fromEntries(humans(st).map(p => [p.id, Math.max(0, Math.round((p.counters?.[typeOf(g).metric] || 0) - (g.base[p.id] || 0)))]));
function progress(st, g = st.goal) { if (!g) return 0; return Object.values(contrib(st, g)).reduce((a, b) => a + b, 0); }
module.exports = { TYPES, LEN, MIN_SHARE, start, contrib, progress, typeOf };
