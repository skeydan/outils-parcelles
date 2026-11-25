// Saved selections: JSON validation, serialization, commune grouping, URL
// form and localStorage. Pure functions only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_SELECTION,
  parseSelectionJson,
  serializeSelection,
  formatEntryLine,
  groupByCommune,
  resolveItems,
  formatSelectionParam,
  parseSelectionParam,
  exportFilename,
  readStoredSelection,
  writeStoredSelection,
  clearStoredSelection,
  SELECTION_STORAGE_KEY,
} from '../site/tabs/parcels/js/selection.js';

const entry = (insee, section, numero) => ({ insee, section, numero });

test('JSON import: the documented shape, optional name, unknown fields', () => {
  const r = parseSelectionJson(JSON.stringify({
    nom: '  Le Mont-Saint-Michel  ',
    future: { anything: true },
    parcelles: [
      { commune: '11296', section: 'b', numero: '0590', future: 'x' },
      { commune: '11212', section: 'B', numero: 93 },
    ],
  }));
  assert.equal(r.ok, true);
  assert.equal(r.nom, 'Le Mont-Saint-Michel');
  assert.deepEqual(r.entries, [entry('11296', 'B', '590'), entry('11212', 'B', '93')]);
  assert.deepEqual(r.errors, []);
});

test('JSON import: a bare array and a missing name are accepted', () => {
  const r = parseSelectionJson('[{"commune":"2a004","section":"0B","numero":"0007"}]');
  assert.equal(r.ok, true);
  assert.equal(r.nom, '');
  assert.deepEqual(r.entries, [entry('2A004', 'B', '7')]);
});

test('JSON import: malformed entries are reported and the rest kept', () => {
  const r = parseSelectionJson(JSON.stringify({
    parcelles: [
      { commune: '11296', section: 'B', numero: '590' },
      null,
      { commune: '123', section: 'B', numero: '1' },
      { commune: '11296', section: '', numero: '2' },
      { commune: '11296', section: 'B', numero: '0' },
      { commune: '11212', section: 'B', numero: '93' },
      { commune: '11296', section: 'B', numero: '0590' },
    ],
  }));
  assert.equal(r.ok, true);
  assert.deepEqual(r.entries, [entry('11296', 'B', '590'), entry('11212', 'B', '93')]);
  assert.deepEqual(r.errors.map((e) => e.code), ['bad-entry', 'bad-commune', 'bad-section', 'bad-numero']);
  assert.deepEqual(r.errors.map((e) => e.index), [2, 3, 4, 5]);
});

test('JSON import: bad JSON, bad shape, too many, nothing valid', () => {
  assert.equal(parseSelectionJson('{').errors[0].code, 'bad-json');
  assert.equal(parseSelectionJson('{"parcelles": "nope"}').errors[0].code, 'bad-shape');
  assert.equal(parseSelectionJson('{}').errors[0].code, 'bad-shape');
  const many = { parcelles: Array.from({ length: MAX_SELECTION + 1 }, () => ({ commune: '11296', section: 'B', numero: '1' })) };
  assert.equal(parseSelectionJson(JSON.stringify(many)).errors[0].code, 'too-many');
  const none = parseSelectionJson('{"parcelles":[]}');
  assert.equal(none.ok, false);
  assert.deepEqual(none.entries, []);
});

test('serialization: canonical shape, accents kept in nom, trailing newline', () => {
  const text = serializeSelection({
    nom: "  L'Isle-sur-la-Sorgue  ",
    entries: [
      { insee: '11212', section: 'b', numero: '0093' },
      { commune: '11296', section: 'B', numero: '590' },
      { insee: 'nope', section: 'B', numero: '1' },
    ],
  });
  assert.ok(text.endsWith('\n'));
  const back = JSON.parse(text);
  assert.equal(back.nom, "L'Isle-sur-la-Sorgue");
  assert.deepEqual(back.parcelles, [
    { commune: '11212', section: 'B', numero: '93' },
    { commune: '11296', section: 'B', numero: '590' },
  ]);
  assert.deepEqual(parseSelectionJson(text).entries, [
    entry('11212', 'B', '93'),
    entry('11296', 'B', '590'),
  ]);
});

test('textarea lines and commune grouping', () => {
  assert.equal(formatEntryLine({ insee: '11296', section: 'B', numero: '590' }), '11296 B 590');
  assert.equal(formatEntryLine({ insee: '11212', section: null, numero: '93' }), '11212 93');
  const groups = groupByCommune([
    entry('11296', 'B', '1'),
    entry('11212', 'B', '2'),
    entry('11296', 'B', '3'),
    entry('nope', 'B', '4'),
  ]);
  assert.deepEqual(groups.map((g) => [g.insee, g.items.length]), [['11296', 2], ['11212', 1]]);
});

test('resolving items: explicit commune, fallback commune, no-commune', () => {
  const items = [
    { raw: 'B 590', insee: '11296', section: 'B', numero: '590', hasPrefixe: false, prefixe: '000' },
    { raw: 'B 93', insee: null, section: 'B', numero: '93', hasPrefixe: false, prefixe: '000' },
    { raw: 'B 94', insee: null, section: 'B', numero: '94', hasPrefixe: false, prefixe: '000' },
  ];
  const withFallback = resolveItems(items, '11212');
  assert.deepEqual(withFallback.items.map((i) => [i.insee, i.numero]), [['11296', '590'], ['11212', '93'], ['11212', '94']]);
  assert.deepEqual(withFallback.errors, []);
  const without = resolveItems(items.slice(1), null);
  assert.deepEqual(without.items, []);
  assert.deepEqual(without.errors.map((e) => e.code), ['no-commune', 'no-commune']);
  const deduped = resolveItems([...items, items[2]], '11212');
  assert.equal(deduped.items.length, 3);
});

test('URL form: fully qualified round-trip and old bare links', () => {
  const entries = [entry('11296', 'B', '590'), entry('11212', 'B', '93')];
  assert.equal(formatSelectionParam(entries), '11296-B590,11212-B93');
  const back = parseSelectionParam('11296-B590,11212-B93');
  assert.deepEqual(back.items.map((i) => [i.insee, i.section, i.numero]), [['11296', 'B', '590'], ['11212', 'B', '93']]);
  assert.deepEqual(back.errors, []);
  const oldTilde = parseSelectionParam('11296~B590');
  assert.deepEqual(oldTilde.items.map((i) => [i.insee, i.numero]), [['11296', '590']]);

  const old = parseSelectionParam('B590,B593', '11296');
  assert.deepEqual(old.items.map((i) => [i.insee, i.numero]), [['11296', '590'], ['11296', '593']]);
  const orphan = parseSelectionParam('B590');
  assert.equal(orphan.items[0].insee, null);
  const bad = parseSelectionParam('11296~nope,11212~B93', '11296');
  assert.equal(bad.items.length, 1);
  assert.equal(bad.errors[0].code, 'unreadable');
});

test('export filename: slug, date, fallback', () => {
  const day = new Date('2026-11-24T12:00:00Z');
  assert.equal(exportFilename('Le Mont-Saint-Michel', day), 'parcelles-le-mont-saint-michel-2026-11-24.json');
  assert.equal(exportFilename('Saint-Étienne', day), 'parcelles-saint-etienne-2026-11-24.json');
  assert.equal(exportFilename('', day), 'parcelles-selection-2026-11-24.json');
  assert.equal(exportFilename('***', day), 'parcelles-selection-2026-11-24.json');
});

test('localStorage helpers fail quietly', () => {
  const map = new Map();
  const storage = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
  assert.equal(readStoredSelection(storage), null);
  assert.equal(writeStoredSelection('{"parcelles":[]}', storage), true);
  assert.equal(map.get(SELECTION_STORAGE_KEY), '{"parcelles":[]}');
  assert.equal(readStoredSelection(storage), '{"parcelles":[]}');
  assert.equal(clearStoredSelection(storage), true);
  assert.equal(readStoredSelection(storage), null);
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.equal(readStoredSelection(broken), null);
  assert.equal(writeStoredSelection('x', broken), false);
  assert.equal(clearStoredSelection(broken), false);
  assert.equal(readStoredSelection(undefined), null);
});
