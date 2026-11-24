// Areas: square metres to hectares, ares and centiares, and the totals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitArea, formatHaCa, formatM2, sumContenances } from '../site/tabs/parcels/js/units.js';

const normal = (s) => s.replace(/\s/g, ' ');

test('split: 1 ha = 10 000 m², 1 a = 100 m², 1 ca = 1 m²', () => {
  assert.deepEqual(splitArea(0), { total: 0, ha: 0, a: 0, ca: 0 });
  assert.deepEqual(splitArea(1), { total: 1, ha: 0, a: 0, ca: 1 });
  assert.deepEqual(splitArea(100), { total: 100, ha: 0, a: 1, ca: 0 });
  assert.deepEqual(splitArea(10000), { total: 10000, ha: 1, a: 0, ca: 0 });
  assert.deepEqual(splitArea(32050), { total: 32050, ha: 3, a: 20, ca: 50 });
  assert.deepEqual(splitArea(1070000), { total: 1070000, ha: 107, a: 0, ca: 0 });
  assert.deepEqual(splitArea(1234567), { total: 1234567, ha: 123, a: 45, ca: 67 });
});

test('format ha/a/ca, always three units with two digits on a and ca', () => {
  assert.equal(formatHaCa(0), '0 ha 00 a 00 ca');
  assert.equal(formatHaCa(1), '0 ha 00 a 01 ca');
  assert.equal(formatHaCa(100), '0 ha 01 a 00 ca');
  assert.equal(formatHaCa(32050), '3 ha 20 a 50 ca');
  assert.equal(formatHaCa(1070000), '107 ha 00 a 00 ca');
  assert.equal(formatHaCa(1234567), '123 ha 45 a 67 ca');
  assert.equal(formatHaCa(null), '–');
  assert.equal(formatHaCa('nope'), '–');
  assert.equal(formatHaCa(-5), '0 ha 00 a 00 ca');
});

test('square metres with the locale separator', () => {
  assert.equal(normal(formatM2(32050, 'fr')), '32 050');
  assert.equal(formatM2(32050, 'en'), '32,050');
  assert.equal(formatM2(0, 'fr'), '0');
  assert.equal(formatM2(null, 'fr'), '–');
  assert.equal(formatM2('1234567', 'en'), '1,234,567');
});

test('totals skip features without a contenance and count them', () => {
  const features = [
    { properties: { contenance: 32050 } },
    { properties: { contenance: 1000 } },
    { properties: {} },
    { properties: { contenance: null } },
  ];
  assert.deepEqual(sumContenances(features), { total: 33050, missing: 2 });
  assert.deepEqual(sumContenances([]), { total: 0, missing: 0 });
});
