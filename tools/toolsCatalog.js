// game/toolsCatalog.js
// Finbuu — "Açık Kaynak Teknoloji Pazarı": companies install open-source tools as upgrades.
// Lesson baked into the mechanic: license = 0, but setup effort + monthly hosting are real costs.
'use strict';

const path = require('path');
const catalog = require(path.join(__dirname, '..', 'data', 'open-source-tools.json'));

const TOOLS_BY_ID = new Map(catalog.tools.map((t) => [t.id, t]));
const MAX_EFFECT_PER_STAT = 0.35; // cap stacking so tools can't trivialize the economy

/** Public, client-safe catalog (optionally filtered). */
function listTools({ category, maxLevel } = {}) {
  return catalog.tools.filter(
    (t) =>
      (!category || t.category === category) &&
      (maxLevel === undefined || t.game.unlockLevel <= maxLevel)
  );
}

function getTool(id) {
  return TOOLS_BY_ID.get(id) || null;
}

/**
 * Install a tool on a company.
 * company: { id, coins, level, installedTools: string[] }
 * Returns { ok, error?, company, tool? } — never throws on game-rule violations.
 */
function installTool(company, toolId) {
  const tool = getTool(toolId);
  if (!tool) return { ok: false, error: 'TOOL_NOT_FOUND', company };
  if (!Array.isArray(company.installedTools)) company.installedTools = [];
  if (company.installedTools.includes(toolId)) return { ok: false, error: 'ALREADY_INSTALLED', company };
  if ((company.level || 1) < tool.game.unlockLevel) return { ok: false, error: 'LEVEL_TOO_LOW', company };
  if (company.coins < tool.game.setupCost) return { ok: false, error: 'INSUFFICIENT_COINS', company };

  company.coins -= tool.game.setupCost;
  company.installedTools.push(toolId);
  company.xp = (company.xp || 0) + tool.game.xpReward;
  return { ok: true, company, tool };
}

function uninstallTool(company, toolId) {
  if (!Array.isArray(company.installedTools) || !company.installedTools.includes(toolId)) {
    return { ok: false, error: 'NOT_INSTALLED', company };
  }
  company.installedTools = company.installedTools.filter((id) => id !== toolId);
  return { ok: true, company };
}

/** Aggregated stat bonuses for a company, capped per stat. */
function getCompanyEffects(company) {
  const effects = {};
  for (const id of company.installedTools || []) {
    const tool = getTool(id);
    if (!tool) continue;
    const { stat, value } = tool.game.effect;
    effects[stat] = (effects[stat] || 0) + value;
  }
  for (const stat of Object.keys(effects)) {
    effects[stat] = stat === 'onlineSalesChannel' ? Math.min(effects[stat], 1) : Math.min(effects[stat], MAX_EFFECT_PER_STAT);
  }
  return effects;
}

/** Monthly hosting bill — call from the existing monthly tick (rent/bills/salaries). */
function getMonthlyHostingCost(company) {
  return (company.installedTools || []).reduce((sum, id) => {
    const tool = getTool(id);
    return sum + (tool ? tool.game.monthlyHostingCost : 0);
  }, 0);
}

/** Socket.io wiring. getCompany(socket) must return the caller's company object or null. */
function registerToolSocketHandlers(io, socket, { getCompany, roomOf }) {
  socket.on('tools:list', (filter, ack) => {
    if (typeof ack !== 'function') return;
    const safe = {
      category: typeof filter?.category === 'string' ? filter.category : undefined,
      maxLevel: Number.isInteger(filter?.maxLevel) ? filter.maxLevel : undefined,
    };
    ack({ ok: true, categories: catalog.categories, effectStats: catalog.effectStats, tools: listTools(safe) });
  });

  socket.on('tools:install', (payload, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    const company = getCompany(socket);
    if (!company) return respond({ ok: false, error: 'NO_COMPANY' });
    const toolId = typeof payload?.toolId === 'string' ? payload.toolId : '';
    const result = installTool(company, toolId);
    if (result.ok) {
      const room = roomOf(socket);
      if (room) {
        io.to(room).emit('street:event', {
          type: 'TOOL_INSTALLED',
          companyId: company.id,
          toolId,
          toolName: result.tool.name,
        });
      }
    }
    respond({
      ok: result.ok,
      error: result.error,
      coins: company.coins,
      xp: company.xp,
      installedTools: company.installedTools,
      effects: getCompanyEffects(company),
    });
  });

  socket.on('tools:uninstall', (payload, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {};
    const company = getCompany(socket);
    if (!company) return respond({ ok: false, error: 'NO_COMPANY' });
    const toolId = typeof payload?.toolId === 'string' ? payload.toolId : '';
    const result = uninstallTool(company, toolId);
    respond({ ok: result.ok, error: result.error, installedTools: company.installedTools, effects: getCompanyEffects(company) });
  });
}

module.exports = {
  catalog,
  listTools,
  getTool,
  installTool,
  uninstallTool,
  getCompanyEffects,
  getMonthlyHostingCost,
  registerToolSocketHandlers,
};
