// Fetch and parse the cadastre's GeoJSON, once per commune, through the
// official bundler API (CORS-enabled). The advertised `latest/...json.gz`
// redirect has no CORS headers, so a browser cannot follow it cross-origin;
// the bundler serves the same per-commune object with CORS and no key.
// Depending on the proxy, the body is either decoded by the browser
// (Content-Encoding: gzip) or still compressed (the S3 object): handle both.

import {
  editionFromUrl,
  parcelFetchUrl,
  communeOutlineFetchUrl,
  LATEST_LISTING_URL,
  parseLatestEdition,
} from './commune.js';

export class HttpError extends Error {
  constructor(status, url, bytes = null) {
    super(`HTTP ${status} for ${url}`);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.bytes = bytes;
  }
}

export class NoDecompressionError extends Error {
  constructor() {
    super('This browser has no DecompressionStream');
    this.name = 'NoDecompressionError';
  }
}

export class BadFileError extends Error {
  constructor(cause) {
    super('The file could not be read as gzip-compressed GeoJSON');
    this.name = 'BadFileError';
    this.cause = cause;
  }
}

const cache = new Map();

/**
 * GET a cadastre .json.gz and parse it. Returns {data, edition, url} where
 * url is the final URL after the `latest` redirect and edition is its date.
 */
export async function fetchGzipJson(url, { signal } = {}) {
  const response = await fetch(url, { signal, mode: 'cors', credentials: 'omit' });
  if (!response.ok) {
    throw new HttpError(response.status, url, Number(response.headers.get('content-length')) || null);
  }
  const finalUrl = response.url || url;
  const edition = editionFromUrl(finalUrl);
  const encoding = (response.headers.get('content-encoding') || '').toLowerCase();
  const type = (response.headers.get('content-type') || '').toLowerCase();

  try {
    if (encoding.includes('gzip')) {
      // A proxy or server added Content-Encoding: the browser already inflated it.
      return { data: await response.json(), edition, url: finalUrl };
    }
    if (/[+/]json/.test(type)) {
      // Plain JSON served without Content-Encoding.
      return { data: await response.json(), edition, url: finalUrl };
    }
    if (!response.body) throw new Error('empty response body');
    if (typeof DecompressionStream !== 'function') throw new NoDecompressionError();
    const stream = response.body.pipeThrough(new DecompressionStream('gzip'));
    const text = new Response(stream, { headers: { 'content-type': 'application/json' } });
    return { data: await text.json(), edition, url: finalUrl };
  } catch (error) {
    if (error instanceof NoDecompressionError) throw error;
    throw new BadFileError(error);
  }
}

function cached(key, load) {
  if (!cache.has(key)) {
    const promise = load().catch((error) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, promise);
  }
  return cache.get(key);
}

/** One commune's parcel FeatureCollection (fetched once, kept in memory). */
export function fetchParcels(insee, { signal } = {}) {
  const url = parcelFetchUrl(insee);
  return cached(`parcelles:${insee}`, () => fetchGzipJson(url, { signal }));
}

/** One commune's outline and official name (a few KB). */
export function fetchCommuneOutline(insee, { signal } = {}) {
  const url = communeOutlineFetchUrl(insee);
  return cached(`communes:${insee}`, () => fetchGzipJson(url, { signal }));
}

/**
 * The current cadastre edition ("2026-09-01"), read once from the public S3
 * listing. Cosmetic: a failure resolves to null, never blocks the tool.
 */
export function fetchLatestEdition({ signal } = {}) {
  return cached('edition', async () => {
    try {
      const response = await fetch(LATEST_LISTING_URL, { signal, mode: 'cors', credentials: 'omit' });
      if (!response.ok) return null;
      return parseLatestEdition(await response.text());
    } catch {
      return null;
    }
  });
}

/** Forget the cached files (used when the page is told to reload data). */
export function clearCache() {
  cache.clear();
}
