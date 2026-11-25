// refdata.js — Sprint 36: official reference lists used by the Open Source building (NACE Rev.2.1, İŞKUR occupations, HS) and the
// virtual company documents. The lists are static files in public/data (served to the client for searching); the server loads the same
// files only to validate codes and fetch canonical descriptions, so a client can never invent a code.
'use strict';
const fs = require('fs'), path = require('path');
const DIR = path.join(__dirname, 'public', 'data');
const KINDS = { nace: 'nace.json', jobs: 'meslek.json', hs: 'hs.json' };
const maps = {};
for (const [kind, file] of Object.entries(KINDS)) {
  maps[kind] = new Map();
  try {
    const doc = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
    for (const it of doc.items || []) maps[kind].set(String(it[0]), String(it[1]));
  } catch (e) { console.warn(`refdata: ${file} not loaded (${e.message})`); }
}
const has = (kind, code) => !!maps[kind]?.has(String(code));
const desc = (kind, code) => maps[kind]?.get(String(code)) || null;
// keep only known codes, unique, at most `max`
function pick(kind, codes, max) {
  const out = [];
  for (const c of Array.isArray(codes) ? codes : []) { const s = String(c).trim(); if (has(kind, s) && !out.includes(s)) out.push(s); if (out.length >= max) break; }
  return out;
}
module.exports = { KINDS, has, desc, pick, size: kind => maps[kind]?.size || 0 };
