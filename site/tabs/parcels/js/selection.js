// The saved selection: JSON import/export, commune grouping, URL form and
// localStorage. Pure (no DOM, no network), unit-tested. The JSON shape is
// deliberately small and forward-compatible: unknown fields are ignored on
// import, so a later name/group/colour feature can add fields without
// breaking older files.
//
// {
//   "nom": "Pouzols + Mailhac",          // optional
//   "parcelles": [
//     { "commune": "11296", "section": "B", "numero": "590" }
//   ]
// }
//
// `commune` is the 5-character INSEE code. `numero` may be zero-padded.
// Entries are normalized (INSEE uppercase, section without leading zero,
// number without leading zeros) and duplicates are dropped.

import {
  MAX_PARCELS,
  canonicalToken,
  normalizeNumero,
  normalizeSection,
  parseParcelToken,
} from './parcel-id.js';
import { isValidInsee, normalizeInsee } from './commune.js';

export const MAX_SELECTION = MAX_PARCELS;
export const SELECTION_STORAGE_KEY = 'outils-parcelles.selection.v1';

const INSEE_RE = /^(?:\d{5}|2[AB]\d{3})$/;

/** Validate a parsed selection file. Returns {ok, nom, entries, errors}. */
export function parseSelectionJson(text) {
  const fail = (code, extra = {}) => ({ ok: false, nom: '', entries: [], errors: [{ index: null, code, ...extra }] });
  let data;
  try {
    data = JSON.parse(String(text ?? '').replace(/^﻿/, ''));
  } catch {
    return fail('bad-json');
  }
  if (Array.isArray(data)) data = { parcelles: data };
  if (!data || typeof data !== 'object' || !Array.isArray(data.parcelles)) return fail('bad-shape');
  if (data.parcelles.length > MAX_SELECTION) {
    return fail('too-many', { count: data.parcelles.length });
  }
  const nom = typeof data.nom === 'string' ? data.nom.trim() : '';
  const entries = [];
  const errors = [];
  const seen = new Set();
  data.parcelles.forEach((row, i) => {
    const index = i + 1;
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      errors.push({ index, code: 'bad-entry', raw: row });
      return;
    }
    const commune = normalizeInsee(row.commune);
    const section = normalizeSection(row.section);
    const numero = normalizeNumero(row.numero);
    if (!INSEE_RE.test(commune) || !isValidInsee(commune)) {
      errors.push({ index, code: 'bad-commune', raw: row.commune });
      return;
    }
    if (!section) {
      errors.push({ index, code: 'bad-section', raw: row.section });
      return;
    }
    if (!numero) {
      errors.push({ index, code: 'bad-numero', raw: row.numero });
      return;
    }
    const key = `${commune}|${section}|${numero}`;
    if (seen.has(key)) return;
    seen.add(key);
    entries.push({ insee: commune, section, numero });
  });
  return { ok: entries.length > 0, nom, entries, errors };
}

/** The canonical JSON text for a selection (pretty, trailing newline). */
export function serializeSelection({ nom = '', entries = [] } = {}) {
  const parcelles = (Array.isArray(entries) ? entries : [])
    .map((entry) => ({
      commune: normalizeInsee(entry?.insee ?? entry?.commune),
      section: normalizeSection(entry?.section),
      numero: normalizeNumero(entry?.numero),
    }))
    .filter((entry) => INSEE_RE.test(entry.commune) && entry.section && entry.numero);
  const out = {};
  const label = String(nom ?? '').trim();
  if (label) out.nom = label;
  out.parcelles = parcelles;
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** One line for the textarea: "11296 B 590". */
export function formatEntryLine(entry) {
  const insee = normalizeInsee(entry?.insee ?? entry?.commune);
  const section = normalizeSection(entry?.section);
  const numero = normalizeNumero(entry?.numero);
  return [insee, section, numero].filter(Boolean).join(' ');
}

/** Group resolved items by INSEE, in first-seen order. */
export function groupByCommune(items) {
  const groups = [];
  const by = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const insee = normalizeInsee(item?.insee ?? '');
    if (!isValidInsee(insee)) continue;
    let group = by.get(insee);
    if (!group) {
      group = { insee, items: [] };
      by.set(insee, group);
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups;
}

/**
 * Give every parsed item its INSEE code (explicit, else the selected
 * commune), drop duplicates and report the lines that have no commune.
 */
export function resolveItems(items, fallbackInsee = null) {
  const out = [];
  const errors = [];
  const seen = new Set();
  const fallback = isValidInsee(fallbackInsee) ? normalizeInsee(fallbackInsee) : null;
  for (const item of Array.isArray(items) ? items : []) {
    const insee = normalizeInsee(item?.insee || fallback || '');
    if (!isValidInsee(insee)) {
      errors.push({ raw: String(item?.raw ?? ''), code: 'no-commune' });
      continue;
    }
    const key = `${insee}|${canonicalToken(item)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...item, insee });
  }
  return { items: out, errors };
}

/** URL form: "11296-B590,11212-B93" (always fully qualified). */
export function formatSelectionParam(entries) {
  return (Array.isArray(entries) ? entries : [])
    .map((entry) => `${normalizeInsee(entry?.insee ?? entry?.commune)}-${canonicalToken(entry)}`)
    .join(',');
}

/**
 * Read the URL form. A token without a separator inherits `fallbackInsee`,
 * so old "#/parcels?c=11296&p=B590,B593" links keep working. "-" is the
 * canonical separator; "~" and ":" from earlier drafts are still accepted.
 */
export function parseSelectionParam(value, fallbackInsee = null) {
  const items = [];
  const errors = [];
  const fallback = isValidInsee(fallbackInsee) ? normalizeInsee(fallbackInsee) : null;
  for (const raw of String(value ?? '').split(',')) {
    const token = raw.trim();
    if (!token) continue;
    const m = token.match(/^((?:\d{5}|2[AB]\d{3}))[~:-](.*)$/i);
    const insee = m ? normalizeInsee(m[1]) : fallback;
    const ref = m ? m[2] : token;
    const parsed = parseParcelToken(ref);
    if (!parsed.ok) {
      errors.push({ raw: token, code: parsed.code });
      continue;
    }
    items.push({ ...parsed, insee: insee || null });
  }
  return { items, errors };
}

/** "parcelles-pouzols-mailhac-2026-11-24.json" */
export function exportFilename(nom, date = new Date()) {
  const slug = String(nom ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'selection';
  const day = date instanceof Date ? date.toISOString().slice(0, 10) : String(date).slice(0, 10);
  return `parcelles-${slug}-${day}.json`;
}

export function readStoredSelection(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(SELECTION_STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

export function writeStoredSelection(text, storage = globalThis.localStorage) {
  try {
    storage?.setItem(SELECTION_STORAGE_KEY, String(text));
    return true;
  } catch {
    return false;
  }
}

export function clearStoredSelection(storage = globalThis.localStorage) {
  try {
    storage?.removeItem(SELECTION_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}
