// Commune codes, cadastre URLs and the commune-name lookup. The pure helpers
// are unit-tested; the network calls live in cadastre.js and app.js.
//
// Commune name -> INSEE code: geo.api.gouv.fr (official, free, no key, CORS
// open) returns a few KB. The cadastre alternatives were measured: the
// France-wide communes file is 234 MB gzipped, and a single department's
// communes file is 2.1 MB gzipped for the Aude (geometry included). Neither
// is a sensible name index for a static page, so the small API is used for
// the lookup and cadastre.data.gouv.fr for every parcel.
//
// Why the bundler endpoint: the advertised `latest/...json.gz` path answers
// with a 302 to the S3 bucket, and that redirect carries no
// Access-Control-Allow-Origin, so a browser cannot fetch it cross-origin
// (curl follows it happily). Etalab's official bundler API on the same host
// serves the same per-commune GeoJSON with CORS and no key:
//   https://cadastre.data.gouv.fr/bundler/cadastre-etalab/communes/{insee}/geojson/{layer}
// The dated object still lives in the public S3 bucket; its listing (CORS *)
// gives the current edition without a redirect.

const CADASTRE_BASE = 'https://cadastre.data.gouv.fr/data/etalab-cadastre/latest/geojson';
const BUNDLER_BASE = 'https://cadastre.data.gouv.fr/bundler/cadastre-etalab';
const S3_BUCKET = 'https://cadastre.s3.rbx.io.cloud.ovh.net';
const GEO_API = 'https://geo.api.gouv.fr/communes';

/** The public bucket listing, used only to read the current edition date. */
export const LATEST_LISTING_URL = `${S3_BUCKET}/?list-type=2&prefix=etalab-cadastre/&delimiter=/`;

const INSEE_RE = /^(?:\d{5}|2[AB]\d{3})$/;

export function normalizeInsee(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function isValidInsee(value) {
  return INSEE_RE.test(normalizeInsee(value));
}

/**
 * Department part of an INSEE code: the first two characters, or the first
 * three for the overseas departments (971–976); Corsica keeps 2A or 2B.
 */
export function departmentOf(value) {
  const insee = normalizeInsee(value);
  if (!isValidInsee(insee)) return null;
  if (insee.startsWith('97') || insee.startsWith('98')) return insee.slice(0, 3);
  return insee.slice(0, 2);
}

/** Per-commune cadastre file, e.g. cadastre-50353-parcelles.json.gz. */
export function communeFileUrl(insee, layer) {
  const code = normalizeInsee(insee);
  const dep = departmentOf(code);
  if (!dep || !layer) return null;
  return `${CADASTRE_BASE}/communes/${dep}/${code}/cadastre-${code}-${layer}.json.gz`;
}

/**
 * The same file through the official bundler API, which CORS allows a static
 * page to fetch. `layer` is parcelles, communes, sections, …
 */
export function bundlerUrl(insee, layer) {
  const code = normalizeInsee(insee);
  if (!isValidInsee(code) || !layer) return null;
  return `${BUNDLER_BASE}/communes/${code}/geojson/${layer}`;
}

export function parcelUrl(insee) {
  return communeFileUrl(insee, 'parcelles');
}

export function communeOutlineUrl(insee) {
  return communeFileUrl(insee, 'communes');
}

/** What the app fetches: CORS-enabled, same data as the dated S3 object. */
export function parcelFetchUrl(insee) {
  return bundlerUrl(insee, 'parcelles');
}

export function communeOutlineFetchUrl(insee) {
  return bundlerUrl(insee, 'communes');
}

/**
 * The newest dated edition in an S3 ListObjectsV2 response, e.g. "2026-09-01".
 * Regexes keep this independent of DOMParser (and easy to unit-test).
 */
export function parseLatestEdition(xml) {
  const text = String(xml ?? '');
  let latest = null;
  for (const m of text.matchAll(/<Prefix>etalab-cadastre\/(\d{4}-\d{2}-\d{2})\/<\/Prefix>/g)) {
    if (!latest || m[1] > latest) latest = m[1];
  }
  return latest;
}

/** Directory listing with every layer for the commune. */
export function communeDirectoryUrl(insee) {
  const code = normalizeInsee(insee);
  const dep = departmentOf(code);
  if (!dep) return null;
  return `${CADASTRE_BASE}/communes/${dep}/${code}/`;
}

/** Smallest name index: the official commune search API. */
export function communeSearchUrl(query, { limit = 8 } = {}) {
  const url = new URL(GEO_API);
  url.searchParams.set('nom', String(query ?? '').trim());
  url.searchParams.set('fields', 'nom,code,codeDepartement,codesPostaux');
  url.searchParams.set('boost', 'population');
  url.searchParams.set('limit', String(limit));
  return url.href;
}

/** Normalize a name for comparison (accents, case, punctuation). */
export function normalizeName(value) {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Keep the valid, unique communes of a geo.api.gouv.fr response. Returns
 * [{insee, name, dep, postal}] in the API's order (by population).
 */
export function parseCommuneSearch(json) {
  const rows = Array.isArray(json) ? json : Array.isArray(json?.data) ? json.data : [];
  const out = [];
  const seen = new Set();
  for (const row of rows) {
    const insee = normalizeInsee(row?.code);
    if (!isValidInsee(insee) || seen.has(insee)) continue;
    seen.add(insee);
    out.push({
      insee,
      name: String(row?.nom ?? '').trim(),
      dep: String(row?.codeDepartement ?? departmentOf(insee) ?? ''),
      postal: Array.isArray(row?.codesPostaux) ? row.codesPostaux.slice(0, 3) : [],
    });
  }
  return out;
}

/** Name of the single feature of a per-commune communes.json.gz file. */
export function nameFromOutline(outline) {
  const name = outline?.features?.[0]?.properties?.nom;
  return typeof name === 'string' && name.trim() ? name.trim() : null;
}

/**
 * The cadastre publishes Paris, Lyon and Marseille by arrondissement, under
 * their own INSEE codes, not under 75056, 69123 and 13055. Give one worked
 * example so the user can pick another arrondissement.
 */
const ARRONDISSEMENTS = {
  '75056': { example: '75101', label: 'Paris 1er' },
  '69123': { example: '69381', label: 'Lyon 1er' },
  '13055': { example: '13201', label: 'Marseille 1er' },
};

export function arrondissementHint(value) {
  return ARRONDISSEMENTS[normalizeInsee(value)] ?? null;
}

/** The dated edition in a cadastre URL, e.g. "2026-09-01"; null otherwise. */
export function editionFromUrl(url) {
  const m = String(url ?? '').match(/\/etalab-cadastre\/(\d{4}-\d{2}-\d{2})\//);
  return m ? m[1] : null;
}
