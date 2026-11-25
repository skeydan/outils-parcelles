# outils-parcelles

Look up several French cadastre parcels at once: choose a commune, paste a
list of section + number references, and see each parcel on an
OpenStreetMap map with every attribute the open cadastre publishes — the
area in m² and in hectares / ares / centiares (`1 ha 07 a 00 ca`).

A selection can span **several communes**: each line then starts with its
5-character INSEE code, and every commune is fetched once and drawn on the
same map and table. A selection can also be exported to a small JSON file,
imported back, and kept in `localStorage`; all of that stays in the browser.

Static site, one page, no backend, no build step, no account, no key, no
tracking, no cookies. French and English, light and dark, keyboard and
phone. The URL carries the state, so a result is shareable and bookmarkable.

```
#/parcels?c=50353&p=AB1%2CAB6%2CAB129
#/parcels?p=50353-AB1%2C46235-AB318&n=Deux+communes
```

## Run it

```sh
npm run serve          # python3 -m http.server 9437 --directory site
open http://localhost:9437/
```

Open `site/index.html` through a static server, not with `file://`: ES
modules and `fetch` need HTTP.

```sh
npm test               # pure logic, no network
npm run e2e            # browser checks; needs Playwright + chromium
```

`npm run e2e` starts no server of its own; run `npm run serve` first, then
`BASE=http://localhost:9437 node scripts/e2e.mjs`. It writes screenshots to
`/tmp/parcelles-shots`. The tool is also a normal Docker static site:
`docker build -t outils-parcelles .`.

## Input

One reference per line, or separated by commas or semicolons. Case, accents
and common separators do not matter.

| Input | Meaning |
| --- | --- |
| `AB 1`, `AB1`, `AB-1`, `AB.1`, `ab_0001` | section + number |
| `0001`, `1` | number only; matched across the commune's sections |
| `000 AB 1`, `001AB1` | prefix + section + number |
| `50353 AB 1`, `50353AB1` | INSEE + section + number (the commune is checked) |
| `50353000AB0001` | full parcel id (14 characters: INSEE + 3-digit prefix + 2-character section + 4-digit number) |

A full id from the data contains the section **zero-padded** (`0B`), while
the GeoJSON `section` property is `B`; both are accepted and normalized.
Numbers are compared without leading zeros (`0002` = `2`). Duplicates are
dropped. The limit is 100 references per lookup.

If no commune is selected yet but every reference carries the same INSEE
code, that commune is used. A list may mix communes as long as **every line
starts with its INSEE code** (`50353 AB 1`, `46235 AB 318`); bare references
still use the commune selected above. Each commune is fetched once, and the
table and map show the parcels together. Lines that cannot be read are
listed one by one, with the reason, and never guessed.

Paris, Lyon and Marseille are published by arrondissement (`75101`,
`69381`, `13201`, …), not under `75056`, `69123`, `13055`. A 404 on those
codes says so and gives a worked example.

## JSON selection (export, import, saved copy)

**Export (.json)** downloads the current list as a local file. **Import
(.json)** reads a file chosen on your device, validates every entry, keeps
the valid ones, and reports each malformed entry with its 1-based position.
The selection is also written to `localStorage` after a successful run, so
returning to the site restores it; **Clear parcels** removes that copy and
returns to the empty first-visit form.

Nothing is uploaded: the export is a `Blob` written by the browser, the
import uses the File API, and the saved copy is `localStorage` only. There
is no server to send it to.

Format:

```json
{
  "nom": "Le Mont-Saint-Michel",
  "parcelles": [
    { "commune": "50353", "section": "AB", "numero": "1", "nom": "the field by the road", "couleur": "#e6194b" },
    { "commune": "50353", "section": "AB", "numero": "6" }
  ]
}
```

- `nom` is optional; it is shown as the selection name and reused in the
  export filename (`parcelles-le-mont-saint-michel-2026-11-24.json`).
- `commune` is the 5-character INSEE code. `section` is one or two letters;
  `numero` may be zero-padded (`"0590"` = `"590"`). Both are normalized.
- Each parcel may add a `nom` (a short label shown on the map, in the legend
  and in the popup) and a `couleur` (any CSS colour, e.g. `#e6194b` or
  `red`); both are optional and override the automatic label and colour.
- A bare array is accepted instead of the object. Unknown fields are
  ignored, so a newer file with extra group/colour fields still imports;
  duplicates are dropped.
- Entries that are well formed but absent from the commune are listed in
  the not-found report (with the commune name), not silently dropped.

The example **Le Mont-Saint-Michel** (3 parcels in `50353`) lives in
[`site/examples/demo.json`](site/examples/demo.json). A first visit now
opens on an empty form with a “get started” card (type references, or load
a file); the **Example: Le Mont-Saint-Michel** button loads the demo again.

## What it shows

For each found parcel:

| Field | Meaning |
| --- | --- |
| `id` | parcel id, e.g. `50353000AB0001` |
| `commune` | INSEE code of the commune |
| `prefixe` | 3-digit prefix (usually `000`) |
| `section` | section letter(s), `A`, `B`, `AB`, … |
| `numero` | parcel number |
| `contenance` | cadastral area in m², shown also as ha / a / ca |
| `arpente` | `true` when the area comes from a survey (`document d'arpentage`), not the fiscal plan |
| `created`, `updated` | dates carried by the source file |
| geometry | Polygon or MultiPolygon, WGS84 (longitude, latitude) |

The area is the cadastre's **contenance**, not a calculation from the
drawn geometry. `1 ha = 10 000 m²`, `1 a = 100 m²`, `1 ca = 1 m²`.

The open data has **no owner name, no postal address and no tax value**.
Those layers are not published; the tool says so in each parcel's detail
row and in the "what the open data contains" section, and does not invent
them.

## Data source and licence

The parcels come from **etalab-cadastre**, the consolidated cadastre
dataset published by **Etalab** on
[cadastre.data.gouv.fr](https://cadastre.data.gouv.fr/datasets/cadastre-etalab),
built from the **DGFiP** *Plan Cadastral Informatisé* (PCI) vecteur.

- Licence: **Licence Ouverte / Open Licence 2.0 (Etalab)**, licence code
  `fr-lo` on data.gouv.fr. Reuse, including commercial reuse, is allowed
  with attribution. The app states the licence and links the dataset.
- Provenance: DGFiP PCI, parsed and consolidated by Etalab. The Etalab
  version keeps the parcel division and buildings and leaves out the
  fiscal and decorative elements of the full EDIGÉO product.

The advertised per-commune file is:

```
https://cadastre.data.gouv.fr/data/etalab-cadastre/latest/geojson/communes/{dep}/{insee}/cadastre-{insee}-{layer}.json.gz
```

`{dep}` is the first two characters of the INSEE code, or the first three
for overseas departments (971–976); Corsica uses `2A`/`2B`. `latest`
redirects to the current dated edition in the public OVH S3 bucket.

### Why the app fetches through the bundler

The `latest/...json.gz` URL answers with a **302 to the S3 bucket, and that
302 has no `Access-Control-Allow-Origin` header**. A browser therefore
blocks the cross-origin fetch before following the redirect (curl follows
it happily, which makes the problem easy to miss). The app uses Etalab's
official, documented **cadastre-bundler-api** on the same host instead:

```
https://cadastre.data.gouv.fr/bundler/cadastre-etalab/communes/{insee}/geojson/{layer}
```

It returns the same per-commune GeoJSON with CORS, no key and no account.
The OpenAPI definition is in
[`datagouv/cadastre-bundler-api`](https://github.com/datagouv/cadastre-bundler-api)
(`/cadastre-etalab/communes/{codeCommune}/{format}/{layer}`, formats
`geojson`, `geojson-gz`, `shp`). The S3 bucket still sends
`Access-Control-Allow-Origin: *`; its public listing is used once to read
the current edition date (`2026-09-01` at the time of writing). If that
cosmetic request fails, the tool still works and simply omits the edition.

The "open this commune's parcel file" link points at the advertised
`.json.gz` download, so a reader can fetch the exact dated object by hand.

## Commune name → INSEE code

The smallest correct reference is used, on demand and cached in memory:

1. **Name search**: `geo.api.gouv.fr/communes?nom=…` returns a few KB with
   the name, 5-character INSEE code, department and postal codes. It is the
   official French administrative API (Etalab), free, no key, CORS open.
   Requests are debounced (250 ms), aborted when superseded, and cached by
   normalized name.
2. **Manual fallback**: type the INSEE code directly. This works when the
   search API is down and for communes whose name is ambiguous.
3. **Official name and outline**: one per-commune `communes` layer (about
   3 KB gzipped for 50353) gives the spelling used in the table and the
   dashed commune outline; it also provides the fallback zoom when none of
   the requested parcels is found.

Measured alternatives, rejected because they are too large for a static
page that must stay light (sizes gzipped, measured 2026-11-24):

- France-wide communes file: ~234 MB.
- One department's communes file (Aude, 11): ~2.1 MB of geometry.
- One commune's outline: ~3.3 KB; one commune's parcels (50353): ~40 KB,
  260 features.

Nothing is bundled: every reference is fetched on demand. The parcel file
is cached per commune in memory for the life of the page (a promise cache
deduplicates concurrent requests; failures are evicted so a retry works).
A multi-commune selection requests each missing commune once, in parallel,
with the commune outlines; one failed commune does not hide the others, and
its error is shown under the sources of the fetched groups.

## Map

[Leaflet](https://leafletjs.com/) 1.9.4, **vendored** in
`site/vendor/leaflet/` (JS, CSS, marker images and the BSD-2-Clause
licence). Reasons:

- the shell must work offline; a CDN script would fail with the rest of the
  network, and a third-party origin would need a wider CSP;
- no supply-chain surprise from a moving CDN version;
- the whole app, map library included, is served by the same static host
  and the CSP can keep `script-src 'self'`.

The basemap is the OpenStreetMap standard tile layer
(`https://tile.openstreetmap.org/{z}/{x}/{y}.png`), with the visible
attribution **© OpenStreetMap contributors** and Leaflet. OSM data is under
the ODbL and the tiles under the OSM Foundation tile usage policy; this is
a low-volume personal tool. Tiles are the only map resource that needs the
network: if they fail, the parcel outlines and the table still work and a
note says the basemap could not load.

Each found parcel gets a distinct colour (or its `couleur` from the imported
file), a permanent label (its `nom`, or section/number — switchable), a click
popup with section, number, m², ha/a/ca, `arpente` and the full id, and a
legend chip that zooms to it. Hovering (or focusing) a legend chip highlights
the matching parcel on the map. The map fits the
found parcels; when none is found it fits the commune outline. The detail
row shows every source property and links the source file.

## URL state

Only non-default state is written, canonicalized with `URLSearchParams`:

- `c` — selected commune INSEE code (kept for bare references);
- `p` — comma-separated preferences. One commune: bare canonical tokens
  (`AB1`, `001AB1`, …) with `c`; several communes: every token carries its
  INSEE code, `50353-AB1,46235-AB318`;
- `n` — optional selection name.

Examples:

```
#/parcels
#/parcels?c=50353
#/parcels?c=50353&p=AB1%2CAB6%2CAB129
#/parcels?p=50353-AB1%2C46235-AB318&n=Deux+communes
```

The hash router is `#/<tab>?<state>`. Unknown routes and untidy hashes fall
back to the parcels tab and are rewritten. Opening a result URL loads the
commune(s) and the parcels immediately. Old single-commune links with bare
`p` tokens still work. `?lang=fr` / `?lang=en` is read before the saved
language and the browser preference; the FR/EN switch keeps the route.
Theme follows the system, with a switch. The language, theme and current
selection are stored in `localStorage`; nothing else is.

## Files

```
site/index.html                  shell, tab bar, footer
site/app/main.js                 ARIA tabs, hash routing, tab module loader
site/app/router.js               pure hash parser/formatter
site/app/tabs.js                 tab registry (one tab: parcels)
site/assets/site.js              language + theme shell
site/assets/ui.js                DOM helpers, numbered citations
site/assets/site.css             shell styles
site/tabs/parcels/js/app.js      the tool: commune search, run, map, table,
                                 export/import, saved selection
site/tabs/parcels/js/selection.js  JSON validation, grouping, URL form,
                                 localStorage
site/tabs/parcels/js/parcel-id.js  flexible reference parsing + matching
site/tabs/parcels/js/units.js    m² ↔ ha/a/ca
site/tabs/parcels/js/commune.js  INSEE, URLs, geo API parsing, edition
site/tabs/parcels/js/cadastre.js fetch + decompress + cache
site/tabs/parcels/js/geo.js      colours and bounding boxes
site/tabs/parcels/js/sources.js  the cited sources
site/tabs/parcels/css/parcels.css
site/examples/demo.json             the Mont-Saint-Michel example (3 parcels)
site/vendor/leaflet/             Leaflet 1.9.4 + licence
tests/*.test.mjs                 node:test, pure functions only
scripts/e2e.mjs                  Playwright, real endpoint, screenshots
deploy/default.conf.template     nginx + CSP for the data sources and tiles
```

## Tests

`npm test` runs `node --test tests/*.test.mjs` with no network:

- parcel references: every accepted format, invalid lines, other-commune
  errors, full ids with a zero-padded section, number normalization,
  duplicate removal, section/number/prefix matching, ambiguity, the
  100-parcel limit;
- selection JSON: documented shape, bare array, optional/missing name,
  unknown fields, malformed entries and 1-based indices, bad JSON/shape,
  the 100-parcel limit, normalization, duplicate removal, serialization
  round-trip, textarea lines, grouping by INSEE, fallback commune,
  fully-qualified URL round-trip (old bare links still read), export
  filename, and localStorage failures;
- units: m² → ha/a/ca, locale separators, missing areas, totals;
- commune: INSEE validation, department extraction (overseas, Corsica),
  download and bundler URLs, geo API URL and response, outline name,
  arrondissement hints, edition parsing;
- map helpers: distinct colours, bounding boxes;
- router: round-trip, canonical form, anchors, fallbacks, tab keys, tab
  registry, vendored Leaflet files.

`npm run e2e` drives Chromium against the real cadastre endpoint: the
Mont-Saint-Michel example (empty first visit with the get-started card,
then the demo); export/import round-trip, malformed-entry report, not-found
report, localStorage restore, and the example button; a two-commune import;
then a real lookup for commune 50353 (parcels AB 1, AB 6, AB 129 and a
missing AB 9999):
table values in m² and ha/a/ca, total, not-found report, popup, detail row,
shareable URL, commune search by name, 404 and offline errors,
language/theme, phone tab targets, no horizontal overflow and no console
errors. The two negative scenarios (deliberate 404, deliberately blocked
network) allow the browser's own resource-error messages; uncaught page
errors still fail the run.

## Licence

Code and texts: MIT (`LICENSE`). Data: Licence Ouverte 2.0 (Etalab).
OpenStreetMap data: ODbL. Leaflet: BSD-2-Clause. The cited sources are
listed at the bottom of the tool with links.
