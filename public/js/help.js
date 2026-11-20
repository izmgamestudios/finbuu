// public/js/help.js
// Sprint 15: in-game help. Rule-based (zero API cost): FAQ topics scored by keyword match, tutorial checklist, place/player search.
// Pure functions; all texts come from the locale files (help.faq.<id>.{q,a,kw}).

export const FAQ_IDS = ['move', 'found', 'sell', 'hire', 'money', 'tax', 'speed', 'ads', 'vehicle', 'travel', 'home', 'chat', 'quests', 'save', 'pitch', 'premium'];

// Tutorial checklist: each step is derived from the public state, so it ticks by itself.
export const TUTORIAL_STEPS = [
  { id: 'move',    done: ({ flags }) => !!flags.moved },
  { id: 'enter',   done: ({ flags }) => !!flags.entered },
  { id: 'found',   done: ({ me, companies }) => companies.some(c => c.founders.includes(me.id) || c.employees.includes(me.id)) },
  { id: 'sell',    done: ({ me }) => (me.counters?.sales || 0) >= 1 },
  { id: 'hire',    done: ({ me }) => (me.counters?.hire || 0) >= 1 || (me.badges || []).includes('firstHire') },
  { id: 'finance', done: ({ flags }) => !!flags.finance },
];
export function tutorialState(ctx) { const steps = TUTORIAL_STEPS.map(s => ({ id: s.id, done: !!s.done(ctx) })); return { steps, doneCount: steps.filter(s => s.done).length, total: steps.length }; }

const norm = s => String(s || '').toLocaleLowerCase('tr').replace(/[ıİ]/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9\s]/g, ' ');
const words = s => norm(s).split(/\s+/).filter(w => w.length > 1);

// Returns FAQ ids ranked by relevance (empty array when nothing matches).
export function rankFaq(query, t) {
  const qw = words(query); if (!qw.length) return [];
  const scored = FAQ_IDS.map(id => {
    const kws = words(t(`help.faq.${id}.kw`)), title = words(t(`help.faq.${id}.q`));
    let score = 0;
    for (const w of qw) {
      if (kws.some(k => k === w)) score += 3;
      else if (w.length >= 4 && kws.some(k => k.startsWith(w) || w.startsWith(k.slice(0, Math.max(4, k.length - 2))))) score += 2;
      if (title.includes(w)) score += 1;
    }
    return { id, score };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  return scored.map(x => x.id);
}

// Substring search over named things (companies, products, players); items: [{ name, ... }]
export function searchItems(query, items, limit = 6) {
  const q = norm(query).trim(); if (q.length < 2) return [];
  return items.filter(i => norm(i.name).includes(q)).slice(0, limit);
}
