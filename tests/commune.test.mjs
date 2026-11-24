// Commune codes, cadastre URLs, the name search and the dated edition.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeInsee,
  isValidInsee,
  departmentOf,
  parcelUrl,
  parcelFetchUrl,
  communeOutlineUrl,
  communeOutlineFetchUrl,
  bundlerUrl,
  LATEST_LISTING_URL,
  parseLatestEdition,
  communeFileUrl,
  communeDirectoryUrl,
  communeSearchUrl,
  normalizeName,
  parseCommuneSearch,
  nameFromOutline,
  arrondissementHint,
  editionFromUrl,
} from '../site/tabs/parcels/js/commune.js';

test('INSEE codes: metropolitan, Corsica, overseas', () => {
  for (const code of ['11296', '2A004', '2B123', '97101', '97411', '75056']) {
    assert.equal(isValidInsee(code), true, code);
    assert.equal(isValidInsee(code.toLowerCase()), true, code);
  }
  for (const code of ['', '1234', '123456', 'ABCDE', '2C004', '97A01']) {
    assert.equal(isValidInsee(code), false, code);
  }
  assert.equal(normalizeInsee(' 2a004 '), '2A004');
});

test('department: first two characters, three for overseas, 2A/2B', () => {
  assert.equal(departmentOf('11296'), '11');
  assert.equal(departmentOf('75056'), '75');
  assert.equal(departmentOf('2A004'), '2A');
  assert.equal(departmentOf('2B123'), '2B');
  assert.equal(departmentOf('97101'), '971');
  assert.equal(departmentOf('97411'), '974');
  assert.equal(departmentOf('nope'), null);
});

test('cadastre URLs use the department, then the commune', () => {
  assert.equal(
    parcelUrl('11296'),
    'https://cadastre.data.gouv.fr/data/etalab-cadastre/latest/geojson/communes/11/11296/cadastre-11296-parcelles.json.gz',
  );
  assert.equal(
    communeOutlineUrl('11296'),
    'https://cadastre.data.gouv.fr/data/etalab-cadastre/latest/geojson/communes/11/11296/cadastre-11296-communes.json.gz',
  );
  assert.equal(
    communeOutlineUrl('2A004'),
    'https://cadastre.data.gouv.fr/data/etalab-cadastre/latest/geojson/communes/2A/2A004/cadastre-2A004-communes.json.gz',
  );
  assert.equal(
    communeFileUrl('97101', 'parcelles'),
    'https://cadastre.data.gouv.fr/data/etalab-cadastre/latest/geojson/communes/971/97101/cadastre-97101-parcelles.json.gz',
  );
  assert.equal(
    communeDirectoryUrl('11296'),
    'https://cadastre.data.gouv.fr/data/etalab-cadastre/latest/geojson/communes/11/11296/',
  );
  assert.equal(parcelUrl('nope'), null);
});

test('the app fetches through the CORS-enabled bundler, not the redirect', () => {
  assert.equal(
    parcelFetchUrl('11296'),
    'https://cadastre.data.gouv.fr/bundler/cadastre-etalab/communes/11296/geojson/parcelles',
  );
  assert.equal(
    communeOutlineFetchUrl('2A004'),
    'https://cadastre.data.gouv.fr/bundler/cadastre-etalab/communes/2A004/geojson/communes',
  );
  assert.equal(
    bundlerUrl('97411', 'sections'),
    'https://cadastre.data.gouv.fr/bundler/cadastre-etalab/communes/97411/geojson/sections',
  );
  assert.equal(bundlerUrl('nope', 'parcelles'), null);
  assert.equal(bundlerUrl('11296', ''), null);
  assert.equal(
    LATEST_LISTING_URL,
    'https://cadastre.s3.rbx.io.cloud.ovh.net/?list-type=2&prefix=etalab-cadastre/&delimiter=/',
  );
});

test('the latest edition is the greatest dated prefix in the listing', () => {
  const xml = `<?xml version="1.0"?><ListBucketResult>
    <CommonPrefixes><Prefix>etalab-cadastre/2017-07-06/</Prefix></CommonPrefixes>
    <CommonPrefixes><Prefix>etalab-cadastre/2026-09-01/</Prefix></CommonPrefixes>
    <CommonPrefixes><Prefix>etalab-cadastre/2024-01-01/</Prefix></CommonPrefixes>
  </ListBucketResult>`;
  assert.equal(parseLatestEdition(xml), '2026-09-01');
  assert.equal(parseLatestEdition('<Prefix>etalab-cadastre/latest/</Prefix>'), null);
  assert.equal(parseLatestEdition(''), null);
  assert.equal(parseLatestEdition(null), null);
});

test('commune search URL asks the official API for the fields we show', () => {
  const url = new URL(communeSearchUrl('Pouzols-Minervois'));
  assert.equal(url.origin + url.pathname, 'https://geo.api.gouv.fr/communes');
  assert.equal(url.searchParams.get('nom'), 'Pouzols-Minervois');
  assert.equal(url.searchParams.get('fields'), 'nom,code,codeDepartement,codesPostaux');
  assert.equal(url.searchParams.get('boost'), 'population');
  assert.equal(url.searchParams.get('limit'), '8');
});

test('search results: valid and unique, in API order', () => {
  const rows = [
    { nom: 'Pouzols', code: '34215', codeDepartement: '34', codesPostaux: ['34230'] },
    { nom: 'Pouzols-Minervois', code: '11296', codeDepartement: '11', codesPostaux: ['11120'] },
    { nom: 'Pouzols-Minervois', code: '11296', codeDepartement: '11', codesPostaux: ['11120'] },
    { nom: 'Bad', code: '123', codeDepartement: '12' },
    { nom: 'No code' },
  ];
  assert.deepEqual(parseCommuneSearch(rows), [
    { insee: '34215', name: 'Pouzols', dep: '34', postal: ['34230'] },
    { insee: '11296', name: 'Pouzols-Minervois', dep: '11', postal: ['11120'] },
  ]);
  assert.deepEqual(parseCommuneSearch({ data: rows }).length, 2);
  assert.deepEqual(parseCommuneSearch(null), []);
});

test('the commune outline gives the official name', () => {
  const outline = { type: 'FeatureCollection', features: [{ properties: { nom: 'POUZOLS-MINERVOIS' } }] };
  assert.equal(nameFromOutline(outline), 'POUZOLS-MINERVOIS');
  assert.equal(nameFromOutline({ features: [] }), null);
  assert.equal(nameFromOutline(null), null);
});

test('Paris, Lyon and Marseille point to an arrondissement code', () => {
  assert.deepEqual(arrondissementHint('75056'), { example: '75101', label: 'Paris 1er' });
  assert.deepEqual(arrondissementHint('69123'), { example: '69381', label: 'Lyon 1er' });
  assert.deepEqual(arrondissementHint('13055'), { example: '13201', label: 'Marseille 1er' });
  assert.equal(arrondissementHint('11296'), null);
});

test('the dated edition is read from the redirect target', () => {
  assert.equal(
    editionFromUrl('https://cadastre.s3.rbx.io.cloud.ovh.net/etalab-cadastre/2026-09-01/geojson/communes/11/11296/cadastre-11296-parcelles.json.gz'),
    '2026-09-01',
  );
  assert.equal(
    editionFromUrl('https://cadastre.data.gouv.fr/data/etalab-cadastre/latest/geojson/communes/11/11296/x.json.gz'),
    null,
  );
  assert.equal(editionFromUrl(null), null);
});

test('names are compared without accents or punctuation', () => {
  assert.equal(normalizeName('Pouzols-Minervois'), 'pouzols minervois');
  assert.equal(normalizeName('  Saint-Étienne  '), 'saint etienne');
  assert.equal(normalizeName("L'Isle-sur-la-Sorgue"), 'l isle sur la sorgue');
});
