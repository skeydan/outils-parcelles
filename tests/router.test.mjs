// Hash routes of the one-page app, the tab registry and the vendored map.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { parseHash, formatHash, tabKeyTarget } from '../site/app/router.js';
import { TABS, DEFAULT_TAB } from '../site/app/tabs.js';

const IDS = TABS.map((t) => t.id);

test('routes: commune and parcel list round-trip, anchors are not routes', () => {
  const r = parseHash('#/parcels?c=11296&p=B590%2CB593', IDS);
  assert.equal(r.tab, 'parcels');
  assert.equal(r.params.get('c'), '11296');
  assert.equal(r.params.get('p'), 'B590,B593');
  assert.equal(r.canonical, true);
  assert.equal(formatHash(r.tab, r.params), '#/parcels?c=11296&p=B590%2CB593');
  assert.equal(formatHash('parcels', new URLSearchParams()), '#/parcels');
  assert.equal(formatHash('parcels', { c: '11296' }), '#/parcels?c=11296');
  // A literal comma parses, but the canonical form is percent-encoded.
  assert.equal(parseHash('#/parcels?c=11296&p=B590,B593', IDS).params.get('p'), 'B590,B593');
  assert.equal(parseHash('#/parcels?c=11296&p=B590,B593', IDS).canonical, false);
  // In-page anchors (citations) leave the route alone.
  assert.equal(parseHash('#p-src-cadastre', IDS), null);
  assert.equal(parseHash('#main', IDS), null);
});

test('routes: empty, unknown and untidy hashes fall back to the default tab', () => {
  for (const hash of ['', '#', '#/', '#/nope?c=11296', '#/PARCELS']) {
    const r = parseHash(hash, IDS);
    assert.equal(r.tab, 'parcels', hash);
    assert.equal([...r.params].length, 0, hash);
    assert.equal(r.canonical, false, hash);
  }
  const trailing = parseHash('#/parcels/?c=11296', IDS);
  assert.equal(trailing.tab, 'parcels');
  assert.equal(trailing.canonical, false);
  assert.equal(parseHash('', IDS, 'parcels').tab, 'parcels');
});

test('tab bar keys: arrows wrap, Home and End, other keys ignored', () => {
  assert.equal(tabKeyTarget('ArrowRight', 0, 2), 1);
  assert.equal(tabKeyTarget('ArrowRight', 1, 2), 0);
  assert.equal(tabKeyTarget('ArrowLeft', 0, 2), 1);
  assert.equal(tabKeyTarget('Home', 1, 2), 0);
  assert.equal(tabKeyTarget('End', 0, 2), 1);
  assert.equal(tabKeyTarget('ArrowRight', 0, 1), 0);
  assert.equal(tabKeyTarget('Enter', 0, 2), -1);
  assert.equal(tabKeyTarget('Home', 0, 0), -1);
});

test('tab registry: one parcels tab, both languages, files exist', () => {
  assert.equal(TABS.length, 1);
  assert.equal(DEFAULT_TAB, 'parcels');
  for (const tab of TABS) {
    assert.match(tab.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(tab.label.en && tab.label.fr, tab.id);
    assert.ok(existsSync(new URL(`../site/${tab.module}`, import.meta.url)), tab.module);
    assert.ok(existsSync(new URL(`../site/${tab.css}`, import.meta.url)), tab.css);
  }
  assert.equal(TABS[0].label.fr, 'Parcelles cadastrales');
});

test('the map library is vendored with its licence', () => {
  for (const file of ['leaflet.js', 'leaflet.css', 'LICENSE', 'images/marker-icon.png']) {
    assert.ok(existsSync(new URL(`../site/vendor/leaflet/${file}`, import.meta.url)), file);
  }
});
