// Cadastre parcel references: parse the flexible text a user pastes, give a
// canonical token for the URL, and match the references against the features
// of one commune's parcel file. Pure (no DOM, no network), unit-tested.
//
// A reference is a section (one or two letters) and a number (1 to 4 digits),
// optionally preceded by the 3-digit prefix and the 5-character INSEE code:
//
//   AB 1   AB1   AB-1   ab 1   AB.1   AB/1
//   0001                            (number only, matched across sections)
//   000 AB 1                        (prefix + section + number)
//   50353 AB 1   50353AB1           (INSEE + section + number)
//   50353000AB0001                  (full parcel id: INSEE + prefix + section + number)
//
// The data sometimes zero-pads the number ("0002") and sometimes not ("2"),
// so both sides are compared on the number without leading zeros.

export const MAX_PARCELS = 100;

const INSEE = '(?:\\d{5}|2[AB]\\d{3})';
const SEP = '[\\s._/\\-]*';
// Real parcel ids write the section as two characters, zero-padded ("0B"),
// while the GeoJSON property strips that zero ("B"). Accept both.
const SECTION = '0?[A-Z]{1,2}';
const NUM = '\\d{1,4}';

const FULL_ID_RE = new RegExp(`^(${INSEE})(\\d{3})(${SECTION})(${NUM})$`);
const INSEE_FULL_ID_RE = new RegExp(`^(${INSEE})[\\s._/\\-]+(\\d{3})${SEP}(${SECTION})${SEP}(${NUM})$`);
const INSEE_SEC_NUM_RE = new RegExp(`^(${INSEE})${SEP}(${SECTION})${SEP}(${NUM})$`);
const PRE_SEC_NUM_RE = new RegExp(`^(\\d{3})${SEP}(${SECTION})${SEP}(${NUM})$`);
const SEC_NUM_RE = new RegExp(`^(${SECTION})${SEP}(${NUM})$`);
const NUM_ONLY_RE = new RegExp(`^(${NUM})$`);

/** Uppercase, trim, drop a label and a trailing note, collapse spaces. */
export function cleanToken(raw) {
  let s = String(raw ?? '').normalize('NFC').replace(/ /g, ' ').trim().toUpperCase();
  s = s.replace(/^#+\s*/, '');
  s = s.replace(/^(?:PARCELLE|PARCEL|LOT|NUM[ÉE]RO)\b\s*[:.\-]?\s*/, '');
  s = s.replace(/^N[°º]\s*/, '');
  s = s.replace(/\s*\([^)]*\)\s*$/, '');
  s = s.replace(/[.,;:]+$/, '');
  return s.replace(/\s+/g, ' ').trim();
}

/** A cadastre number without leading zeros, or null when not 1–9999. */
export function normalizeNumero(value) {
  const s = String(value ?? '').trim();
  if (!/^\d{1,4}$/.test(s)) return null;
  const n = Number(s);
  return n > 0 ? String(n) : null;
}

/** A section without the zero padding the raw id uses: "0B" -> "B". */
export function normalizeSection(value) {
  const s = String(value ?? '').trim().toUpperCase().replace(/^0+(?=[A-Z])/, '');
  return /^[A-Z]{1,2}$/.test(s) ? s : null;
}

export function normalizeInsee(value) {
  return String(value ?? '').trim().toUpperCase();
}

/**
 * Parse one reference. Returns an object with ok: true and the normalized
 * fields, or ok: false and a machine-readable code:
 *   unreadable, bad-numero, other-commune.
 * `commune` may be {insee} or an INSEE string; when given, an explicit INSEE
 * that differs is an error.
 */
export function parseParcelToken(raw, { commune = null } = {}) {
  const text = cleanToken(raw);
  if (!text) return { ok: false, raw: String(raw ?? ''), code: 'unreadable' };

  let m;
  let insee = null;
  let prefixe = null;
  let section = null;
  let numeroRaw = null;

  if ((m = text.match(FULL_ID_RE))) {
    [, insee, prefixe, section, numeroRaw] = m;
  } else if ((m = text.match(INSEE_FULL_ID_RE))) {
    [, insee, prefixe, section, numeroRaw] = m;
  } else if ((m = text.match(INSEE_SEC_NUM_RE))) {
    [, insee, section, numeroRaw] = m;
  } else if ((m = text.match(PRE_SEC_NUM_RE))) {
    [, prefixe, section, numeroRaw] = m;
  } else if ((m = text.match(SEC_NUM_RE))) {
    [, section, numeroRaw] = m;
  } else if ((m = text.match(NUM_ONLY_RE))) {
    [, numeroRaw] = m;
  } else {
    return { ok: false, raw: String(raw ?? ''), code: 'unreadable' };
  }

  const numero = normalizeNumero(numeroRaw);
  if (!numero) return { ok: false, raw: String(raw ?? ''), code: 'bad-numero' };

  const expected = (typeof commune === 'string' ? commune : commune?.insee) ?? null;
  if (insee && expected && normalizeInsee(insee) !== normalizeInsee(expected)) {
    return {
      ok: false,
      raw: String(raw ?? ''),
      code: 'other-commune',
      insee: normalizeInsee(insee),
      expected: normalizeInsee(expected),
    };
  }

  const normalizedSection = section ? normalizeSection(section) : null;
  if (section && !normalizedSection) {
    return { ok: false, raw: String(raw ?? ''), code: 'unreadable' };
  }

  return {
    ok: true,
    raw: String(raw ?? ''),
    insee: insee ? normalizeInsee(insee) : null,
    prefixe: prefixe ?? '000',
    hasPrefixe: prefixe !== null,
    section: normalizedSection,
    numero,
    numeroPad: numeroRaw.padStart(4, '0'),
  };
}

/** A stable, compact token for the route: the prefix only when it was given. */
export function canonicalToken(item) {
  const prefixe = item.hasPrefixe ? item.prefixe : '';
  return `${prefixe}${item.section ?? ''}${item.numero}`;
}

/** A human reference: "B 590", "AB 12", "N° 590" (or "No. 590" in English). */
export function refText(item, lang = 'en') {
  if (!item) return '';
  if (!item.section) return lang === 'fr' ? `N° ${item.numero}` : `No. ${item.numero}`;
  const prefixe = item.prefixe && item.prefixe !== '000' ? `${item.prefixe} ` : '';
  return `${prefixe}${item.section} ${item.numero}`;
}

/**
 * Parse a pasted list: one reference per line, or separated by commas or
 * semicolons. Duplicates are dropped. Returns {items, errors}; errors carry
 * the raw text and the code returned by parseParcelToken.
 */
export function parseParcelList(text, { commune = null } = {}) {
  const items = [];
  const errors = [];
  const seen = new Set();
  for (const raw of String(text ?? '').split(/[\n\r;,]+/)) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const parsed = parseParcelToken(trimmed, { commune });
    if (!parsed.ok) {
      errors.push({ raw: trimmed, code: parsed.code, insee: parsed.insee, expected: parsed.expected });
      continue;
    }
    const key = `${parsed.insee ?? '?'}|${canonicalToken(parsed)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(parsed);
  }
  return { items, errors };
}

/** Index one commune's features for fast lookup (build once per file). */
export function indexParcels(features) {
  const list = Array.isArray(features) ? features : [];
  const byFull = new Map();
  const bySectionNum = new Map();
  const byNum = new Map();
  const sections = new Set();
  for (const feature of list) {
    const p = feature?.properties ?? {};
    const section = normalizeSection(p.section);
    const prefixe = String(p.prefixe ?? '000');
    const numero = normalizeNumero(p.numero);
    if (!numero) continue;
    if (section) {
      sections.add(section);
      const fullKey = `${prefixe}|${section}|${numero}`;
      if (!byFull.has(fullKey)) byFull.set(fullKey, feature);
      const sectionKey = `${section}|${numero}`;
      if (!bySectionNum.has(sectionKey)) bySectionNum.set(sectionKey, []);
      bySectionNum.get(sectionKey).push(feature);
    }
    if (!byNum.has(numero)) byNum.set(numero, []);
    byNum.get(numero).push(feature);
  }
  return {
    features: list,
    byFull,
    bySectionNum,
    byNum,
    sections: [...sections].sort(),
  };
}

/**
 * Match parsed references against an index. Returns found [{item, feature}]
 * (in input order, one per feature) and notFound [{item, reason, candidates}]
 * with reason 'not-in-commune' or 'ambiguous'.
 */
export function matchParcels(items, index) {
  const found = [];
  const notFound = [];
  const seen = new Set();
  for (const item of items) {
    let exact = null;
    let candidates = [];
    if (item.hasPrefixe && item.section) {
      exact = index.byFull.get(`${item.prefixe}|${item.section}|${item.numero}`) ?? null;
      if (!exact) candidates = index.bySectionNum.get(`${item.section}|${item.numero}`) ?? [];
    } else if (item.section) {
      candidates = index.bySectionNum.get(`${item.section}|${item.numero}`) ?? [];
    } else {
      candidates = index.byNum.get(item.numero) ?? [];
    }
    const feature = exact ?? (!item.hasPrefixe && candidates.length === 1 ? candidates[0] : null);
    if (feature) {
      const id = feature.properties?.id ?? feature.id ?? feature;
      if (seen.has(id)) continue;
      seen.add(id);
      found.push({ item, feature });
    } else if (candidates.length > 1) {
      notFound.push({
        item,
        reason: 'ambiguous',
        candidates: candidates.map((f) => f.properties ?? {}),
      });
    } else {
      notFound.push({ item, reason: 'not-in-commune', candidates: [] });
    }
  }
  return { found, notFound };
}
