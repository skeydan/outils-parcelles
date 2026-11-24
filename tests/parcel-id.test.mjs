// Parcel references: flexible input, canonical tokens, matching against the
// features of one commune's parcel file. Pure functions only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanToken,
  normalizeNumero,
  parseParcelToken,
  parseParcelList,
  canonicalToken,
  refText,
  indexParcels,
  matchParcels,
  MAX_PARCELS,
} from '../site/tabs/parcels/js/parcel-id.js';

const feature = (section, numero, prefixe = '000', extra = {}) => ({
  type: 'Feature',
  geometry: null,
  properties: { id: `11296${prefixe}${section}${String(numero).padStart(4, '0')}`, commune: '11296', prefixe, section, numero, contenance: 1000, arpente: false, ...extra },
});

test('formats: section and number, with flexible separators and case', () => {
  for (const raw of ['B 590', 'B590', 'B-590', 'b590', 'B.590', 'B_590', 'B/590', '  B 590  ', 'B 590.', 'B - 590']) {
    const p = parseParcelToken(raw);
    assert.equal(p.ok, true, raw);
    assert.equal(p.section, 'B', raw);
    assert.equal(p.numero, '590', raw);
    assert.equal(p.prefixe, '000', raw);
    assert.equal(p.hasPrefixe, false, raw);
    assert.equal(canonicalToken(p), 'B590', raw);
  }
});

test('formats: number only, prefix, INSEE and full parcel id', () => {
  const n = parseParcelToken('0590');
  assert.equal(n.ok, true);
  assert.equal(n.section, null);
  assert.equal(n.numero, '590');
  assert.equal(canonicalToken(n), '590');

  const pre = parseParcelToken('000 B 590');
  assert.equal(pre.ok, true);
  assert.equal(pre.prefixe, '000');
  assert.equal(pre.hasPrefixe, true);
  assert.equal(canonicalToken(pre), '000B590');

  const pre2 = parseParcelToken('001B590');
  assert.equal(pre2.prefixe, '001');
  assert.equal(pre2.hasPrefixe, true);

  const insee = parseParcelToken('11296 B 590');
  assert.equal(insee.insee, '11296');
  assert.equal(insee.section, 'B');
  const insee2 = parseParcelToken('11296b590');
  assert.equal(insee2.insee, '11296');
  assert.equal(insee2.numero, '590');

  const full = parseParcelToken('112960000B0590');
  assert.equal(full.insee, '11296');
  assert.equal(full.prefixe, '000');
  assert.equal(full.section, 'B');
  assert.equal(full.numero, '590');
  assert.equal(full.numeroPad, '0590');

  // Real ids zero-pad the two-character section ("0B"), unlike the property.
  for (const [raw, section] of [['112960000B0590', 'B'], ['112960000A1219', 'A']]) {
    const p = parseParcelToken(raw);
    assert.equal(p.ok, true, raw);
    assert.equal(p.insee, '11296', raw);
    assert.equal(p.section, section, raw);
  }
  const paddedSection = parseParcelToken('0B 590');
  assert.equal(paddedSection.section, 'B');
  assert.equal(canonicalToken(paddedSection), 'B590');

  const corsica = parseParcelToken('2A004B12');
  assert.equal(corsica.insee, '2A004');
  assert.equal(corsica.section, 'B');
  assert.equal(corsica.numero, '12');

  const sections = parseParcelToken('AB 12');
  assert.equal(sections.section, 'AB');
  assert.equal(sections.numero, '12');
});

test('formats: section N is not eaten as a label; N° is', () => {
  const n = parseParcelToken('N 590');
  assert.equal(n.section, 'N');
  assert.equal(n.numero, '590');
  const no = parseParcelToken('N° 590');
  assert.equal(no.section, null);
  assert.equal(no.numero, '590');
  const labeled = parseParcelToken('Parcelle B 590 (25 a)');
  assert.equal(labeled.section, 'B');
  assert.equal(labeled.numero, '590');
  const cleaned = cleanToken('  parcelle : b-0590.  ');
  assert.equal(cleaned, 'B-0590');
});

test('invalid references are reported, not guessed', () => {
  for (const raw of ['', 'X', '12345', 'B 0', 'B 0000', 'B 10000', 'ABC 12', '12 B', 'B-']) {
    const p = parseParcelToken(raw);
    assert.equal(p.ok, false, raw);
    assert.ok(['unreadable', 'bad-numero'].includes(p.code), `${raw}: ${p.code}`);
  }
  assert.equal(parseParcelToken('B 0').code, 'bad-numero');
  assert.equal(parseParcelToken('B 10000').code, 'unreadable');
});

test('an explicit INSEE that differs from the selected commune is an error', () => {
  const p = parseParcelToken('34172 B 590', { commune: { insee: '11296' } });
  assert.equal(p.ok, false);
  assert.equal(p.code, 'other-commune');
  assert.equal(p.insee, '34172');
  assert.equal(p.expected, '11296');
  const same = parseParcelToken('11296 B 590', { commune: '11296' });
  assert.equal(same.ok, true);
});

test('a pasted list: lines, commas, semicolons, duplicates', () => {
  const { items, errors } = parseParcelList('B 590\nB593, b-590; B 594\n\nB 0590');
  assert.deepEqual(items.map(canonicalToken), ['B590', 'B593', 'B594']);
  assert.equal(errors.length, 0);

  const mixed = parseParcelList('11296 B 590\n34172 B 593', { commune: { insee: '11296' } });
  assert.deepEqual(mixed.items.map(canonicalToken), ['B590']);
  assert.equal(mixed.errors.length, 1);
  assert.equal(mixed.errors[0].code, 'other-commune');

  const bad = parseParcelList('B 590\nsous-sol\nB 0');
  assert.equal(bad.items.length, 1);
  assert.deepEqual(bad.errors.map((e) => e.code), ['unreadable', 'bad-numero']);
});

test('numbers are compared without leading zeros', () => {
  assert.equal(normalizeNumero('0002'), '2');
  assert.equal(normalizeNumero('0590'), '590');
  assert.equal(normalizeNumero('1219'), '1219');
  assert.equal(normalizeNumero('0000'), null);
  assert.equal(normalizeNumero('12a'), null);
});

test('matching: exact section and number, section-only, number-only', () => {
  const features = [feature('B', '0011'), feature('B', '0001'), feature('B', '1137'), feature('A', '1219')];
  const index = indexParcels(features);
  assert.deepEqual(index.sections, ['A', 'B']);

  const one = matchParcels(parseParcelList('B 11').items, index);
  assert.equal(one.found.length, 1);
  assert.equal(one.found[0].feature.properties.numero, '0011');

  const byNumber = matchParcels(parseParcelList('11').items, index);
  assert.equal(byNumber.found.length, 1);

  const missing = matchParcels(parseParcelList('B 9999').items, index);
  assert.equal(missing.found.length, 0);
  assert.equal(missing.notFound[0].reason, 'not-in-commune');

  const unknownSection = matchParcels(parseParcelList('Z 11').items, index);
  assert.equal(unknownSection.notFound[0].reason, 'not-in-commune');
});

test('matching: same section and number under two prefixes is ambiguous', () => {
  const features = [feature('B', '0590', '000'), feature('B', '0590', '001'), feature('A', '0590', '000')];
  const index = indexParcels(features);

  const plain = matchParcels(parseParcelList('B 590').items, index);
  assert.equal(plain.found.length, 0);
  assert.equal(plain.notFound[0].reason, 'ambiguous');
  assert.equal(plain.notFound[0].candidates.length, 2);

  const exact0 = matchParcels(parseParcelList('000B590').items, index);
  assert.equal(exact0.found.length, 1);
  assert.equal(exact0.found[0].feature.properties.prefixe, '000');

  const exact1 = matchParcels(parseParcelList('001B590').items, index);
  assert.equal(exact1.found.length, 1);
  assert.equal(exact1.found[0].feature.properties.prefixe, '001');

  const numberOnly = matchParcels(parseParcelList('590').items, index);
  assert.equal(numberOnly.notFound[0].reason, 'ambiguous');
  assert.equal(numberOnly.notFound[0].candidates.length, 3);
});

test('matching: a wrong explicit prefix is not silently replaced', () => {
  const index = indexParcels([feature('B', '0590', '001')]);
  const wrong = matchParcels(parseParcelList('000B590').items, index);
  assert.equal(wrong.found.length, 0);
  assert.equal(wrong.notFound[0].reason, 'not-in-commune');
});

test('matching: duplicate references give one parcel', () => {
  const index = indexParcels([feature('B', '0590')]);
  const { items } = parseParcelList('B590\nB 590\n0590');
  const result = matchParcels(items, index);
  assert.equal(result.found.length, 1);
});

test('human references and the parcel limit', () => {
  assert.equal(refText({ section: 'B', numero: '590', prefixe: '000' }, 'fr'), 'B 590');
  assert.equal(refText({ section: 'B', numero: '590', prefixe: '001' }, 'en'), '001 B 590');
  assert.equal(refText({ section: null, numero: '590', prefixe: '000' }, 'fr'), 'N° 590');
  assert.equal(refText({ section: null, numero: '590', prefixe: '000' }, 'en'), 'No. 590');
  assert.equal(MAX_PARCELS, 100);
});
