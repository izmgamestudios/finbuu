// balance.js — Sprint 25: admin-tunable game-balance knobs (price elasticity, level-up rewards, weekly race). Persisted in data/balance-config.json.
'use strict';
const CFG = {
  elasticity: 1,        // 1 = on, 0 = off (price above the sector's sweet spot loses customers)
  optMult: 1.5,         // sweet spot = typical sector price x this
  overExp: 0.5,         // extra penalty exponent above the sweet spot (revenue ~ price^-overExp)
  levelCoins: 20,       // level-up reward = levelCoins x new level (personal coins)
  goalOn: 1,            // monthly shared room goal on/off
  goalDifficulty: 1,    // multiplies the per-player target
  goalReward: 150,      // coins per contributing player when the goal is met (x1.5 if 150% reached)
  raceFirst: 200, raceSecond: 120, raceThird: 60,   // weekly race rewards (multiplayer, coins); solo: personal-best bonus = raceFirst / 2
};
const RANGES = { elasticity: [0, 1], optMult: [1, 3], overExp: [0, 2], levelCoins: [0, 200], goalOn: [0, 1], goalDifficulty: [0.2, 3], goalReward: [0, 2000], raceFirst: [0, 2000], raceSecond: [0, 2000], raceThird: [0, 2000] };
const SECTOR_REF = { 'sector.food': 14, 'sector.service': 22, 'sector.tech': 38, 'sector.retail': 16, 'sector.health': 30, 'sector.education': 26, 'sector.creative': 30, 'sector.auto': 50, 'sector.transport': 10 };
const refPrice = (templatePrice, sector) => Math.max(1, templatePrice || SECTOR_REF[sector] || 20);
// revenue multiplier for selling at `price` where `ref` is the typical price of the sector
function demandMult(price, ref) {
  if (!CFG.elasticity) return 1;
  const opt = ref * CFG.optMult, p = Math.max(1, price);
  return p <= opt ? Math.min(1.2, (opt / p) ** 0.25) : Math.max(0.1, (opt / p) ** (1 + CFG.overExp));
}
function setConfig(patch) { for (const [k, [lo, hi]] of Object.entries(RANGES)) { const v = Number(patch?.[k]); if (patch && patch[k] !== undefined && Number.isFinite(v)) CFG[k] = Math.max(lo, Math.min(hi, v)); } return { ...CFG }; }
module.exports = { CFG, RANGES, SECTOR_REF, refPrice, demandMult, setConfig };
