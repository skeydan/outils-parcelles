// Map helpers: distinct parcel colours and a GeoJSON bounding box.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PARCEL_PALETTE, parcelColor, categoryColor, bboxOfGeoJSON } from '../site/tabs/parcels/js/geo.js';

test('parcel colours are distinct and stable', () => {
  assert.equal(parcelColor(0), PARCEL_PALETTE[0]);
  assert.equal(parcelColor(15), PARCEL_PALETTE[15]);
  assert.notEqual(parcelColor(16), parcelColor(15));
  assert.match(parcelColor(16), /^hsl\(\d+ 65% 40%\)$/);
  const colours = Array.from({ length: 40 }, (_, i) => parcelColor(i));
  assert.equal(new Set(colours).size, 40);
  assert.equal(parcelColor(-2), PARCEL_PALETTE[0]);
  assert.equal(parcelColor(3.9), PARCEL_PALETTE[3]);
});

test('category colours are stable, case-insensitive, and null when empty', () => {
  assert.equal(categoryColor(''), null);
  assert.equal(categoryColor('   '), null);
  assert.equal(categoryColor(null), null);
  assert.equal(categoryColor(undefined), null);
  assert.equal(categoryColor('vines'), categoryColor('VINES'));
  assert.equal(categoryColor('vines'), categoryColor('  vines  '));
  assert.ok(PARCEL_PALETTE.includes(categoryColor('vines')));
  assert.ok(PARCEL_PALETTE.includes(categoryColor('oliviers')));
});

const polygon = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'Polygon',
    coordinates: [[[2.0, 43.0], [2.1, 43.0], [2.1, 43.2], [2.0, 43.2], [2.0, 43.0]]],
  },
};

const multipolygon = {
  type: 'Feature',
  properties: {},
  geometry: {
    type: 'MultiPolygon',
    coordinates: [
      [[[1.8, 42.8], [1.9, 42.8], [1.9, 42.9], [1.8, 42.8]]],
      [[[2.2, 43.3], [2.4, 43.3], [2.4, 43.5], [2.2, 43.3]]],
    ],
  },
};

test('bounding box: longitude/latitude becomes Leaflet south-west/north-east', () => {
  assert.deepEqual(bboxOfGeoJSON({ type: 'FeatureCollection', features: [polygon] }), [[43.0, 2.0], [43.2, 2.1]]);
  assert.deepEqual(bboxOfGeoJSON(polygon), [[43.0, 2.0], [43.2, 2.1]]);
  assert.deepEqual(bboxOfGeoJSON({ type: 'FeatureCollection', features: [polygon, multipolygon] }), [[42.8, 1.8], [43.5, 2.4]]);
});

test('bounding box: empty or missing geometry gives null', () => {
  assert.equal(bboxOfGeoJSON({ type: 'FeatureCollection', features: [] }), null);
  assert.equal(bboxOfGeoJSON({ type: 'FeatureCollection', features: [{ geometry: null }] }), null);
  assert.equal(bboxOfGeoJSON(null), null);
});
