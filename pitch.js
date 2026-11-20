// pitch.js — sales roleplay: customer personas, scripted rounds and scoring. The server runs the conversation, so rewards cannot be forged.
// Each round has three authored replies (1, 2, 3); the table says which one is best / okay / poor for that persona and round.
const SCORE = { best: 20, ok: 8, poor: -12 };
const ROUNDS = 3;
const PERSONAS = {
  friendly:  { emoji: '😀', mood: 'positive', base: 52, rounds: [{ best: 1, ok: 2, poor: 3 }, { best: 3, ok: 1, poor: 2 }, { best: 2, ok: 3, poor: 1 }] },
  impatient: { emoji: '⏱', mood: 'neutral',  base: 38, rounds: [{ best: 2, ok: 1, poor: 3 }, { best: 1, ok: 3, poor: 2 }, { best: 3, ok: 2, poor: 1 }] },
  thrifty:   { emoji: '🧐', mood: 'negative', base: 32, rounds: [{ best: 2, ok: 3, poor: 1 }, { best: 3, ok: 1, poor: 2 }, { best: 1, ok: 2, poor: 3 }] },
  skeptical: { emoji: '🤨', mood: 'negative', base: 30, rounds: [{ best: 3, ok: 1, poor: 2 }, { best: 2, ok: 3, poor: 1 }, { best: 1, ok: 3, poor: 2 }] }
};
// Final interest decides the deal. mult = how many normal "clicks" of income the conversation is worth.
const outcomeOf = interest => (interest >= 80 ? 'big' : interest >= 55 ? 'normal' : interest >= 35 ? 'partial' : 'lost');
const REWARD = { big: { mult: 60, units: 5, xp: 12, k: 3 }, normal: { mult: 30, units: 3, xp: 6, k: 2 }, partial: { mult: 12, units: 1, xp: 2, k: 1 }, lost: { mult: 0, units: 0, xp: 1, k: 0.5 } };
// Your own skill helps: level, knowledge and a discount on the product make the customer warmer from the start
const startInterest = (persona, { level = 1, knowledge = 0, discount = 0, bonus = 0 } = {}) =>
  Math.max(5, Math.min(70, PERSONAS[persona].base + Math.min(6, level - 1) + Math.min(8, Math.floor(knowledge / 25)) + (discount > 0 ? 5 : 0) + bonus));
const qualityOf = (persona, round, option) => { const r = PERSONAS[persona].rounds[round]; return option === r.best ? 'best' : option === r.ok ? 'ok' : 'poor'; };
module.exports = { SCORE, ROUNDS, PERSONAS, REWARD, outcomeOf, startInterest, qualityOf };
