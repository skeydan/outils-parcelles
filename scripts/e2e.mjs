// Browser checks: screenshots (desktop/phone × light/dark × fr/en), the tab
// bar and hash routing of the one-page app, the seeded two-commune example,
// JSON export/import (including malformed and missing entries), localStorage
// restore, a real cadastre lookup for Pouzols-Minervois (11296), the
// commune-name search, errors, the map popup, the shareable URL and the
// offline shell. Fails on any console error or warning, and on horizontal
// overflow.
//
//   npm i                                  (installs playwright, dev only)
//   npx playwright install chromium        (once, if no browser is cached)
//   python3 -m http.server 9437 --directory site &
//   BASE=http://localhost:9437 node scripts/e2e.mjs
//
// Screenshots go to $SHOTS (default /tmp/parcelles-shots).

import { chromium } from 'playwright';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { formatSelectionParam, parseSelectionJson } from '../site/tabs/parcels/js/selection.js';

const BASE = process.env.BASE || 'http://localhost:9437';
const SHOTS = process.env.SHOTS || '/tmp/parcelles-shots';
const TMP = mkdtempSync(join(tmpdir(), 'parcelles-e2e-'));
mkdirSync(SHOTS, { recursive: true });

// The example shipped in site/examples is also the first-visit default.
const SEED_NAME = 'Pouzols + Mailhac';
const SEED = parseSelectionJson(readFileSync(new URL('../site/examples/pouzols-mailhac.json', import.meta.url), 'utf8'));
const SEED_PARAM = formatSelectionParam(SEED.entries);
const SEED_HASH = `#/parcels?${new URLSearchParams({ p: SEED_PARAM, n: SEED_NAME })}`;
const hashFor = (entries, nom) => `#/parcels?${new URLSearchParams({ p: formatSelectionParam(entries), n: nom })}`;

const devices = {
  desktop: { viewport: { width: 1280, height: 900 }, deviceScaleFactor: 1 },
  phone: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

// The four references used throughout: three exist in 11296, one does not.
const REFS = ['B590', 'B593', 'B1137', 'B9999'];
const RESULT_HASH = `#/parcels?c=11296&p=${encodeURIComponent(REFS.join(','))}`;
const DATA_HOSTS = new Set([
  'cadastre.data.gouv.fr',
  'cadastre.s3.rbx.io.cloud.ovh.net',
  'geo.api.gouv.fr',
  'tile.openstreetmap.org',
]);

const browser = await chromium.launch();
const problems = [];
let checks = 0;
const ok = (cond, msg) => { checks += 1; if (!cond) problems.push(msg); };

async function newPage(device, scheme, lang, { blockData = false, allowNetworkErrors = false } = {}) {
  const ctx = await browser.newContext({
    ...devices[device],
    colorScheme: scheme,
    locale: lang === 'fr' ? 'fr-FR' : 'en-GB',
  });
  const page = await ctx.newPage();
  page.on('console', (m) => {
    if (!allowNetworkErrors && (m.type() === 'error' || m.type() === 'warning')) {
      problems.push(`[${device} ${scheme} ${lang}] console ${m.type()}: ${m.text()}`);
    }
  });
  page.on('pageerror', (e) => problems.push(`[${device} ${scheme} ${lang}] page error: ${e.message}`));
  if (blockData) {
    await page.route('**/*', (route) => {
      const host = new URL(route.request().url()).host;
      if (host && host !== new URL(BASE).host) return route.abort();
      return route.continue();
    });
  }
  return { ctx, page };
}

const settle = (page) => page.waitForTimeout(250);
const overflow = (page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const rows = (page) => page.locator('#pc-table tbody tr:not(.pc-detail-row)');
const waitRows = (page, n) => page.waitForFunction(
  (count) => document.querySelectorAll('#pc-table tbody tr:not(.pc-detail-row)').length === count,
  n,
  { timeout: 45000 },
);

// ---------------------------------------------------------------- screenshots
for (const device of Object.keys(devices)) {
  for (const scheme of ['light', 'dark']) {
    for (const lang of ['en', 'fr']) {
      const { ctx, page } = await newPage(device, scheme, lang);
      await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
      await waitRows(page, SEED.entries.length);
      await page.waitForSelector('#pc-map.leaflet-container', { timeout: 30000 });
      await settle(page);
      ok((await page.getAttribute('html', 'lang')) === lang, `start: browser language ${lang} not picked up`);
      const expected = lang === 'fr' ? 'Parcelles cadastrales' : 'Cadastre parcels';
      ok((await page.textContent('[role="tab"]')) === expected, `start ${lang}: tab label`);
      ok((await page.textContent('h1')) === expected, `start ${lang}: h1`);
      ok(new URL(page.url()).hash === SEED_HASH, `start: seeded route ${page.url()}`);
      ok((await rows(page).count()) === SEED.entries.length, `start ${lang}: seeded parcels`);
      const communeCells = await page.locator('#pc-table tbody tr:not(.pc-detail-row) td.pc-commune-cell').allTextContents();
      ok(communeCells.filter((c) => /Pouzols-Minervois/i.test(c)).length === 14, `start ${lang}: 14 Pouzols parcels`);
      ok(communeCells.filter((c) => /Mailhac/i.test(c)).length === 4, `start ${lang}: 4 Mailhac parcels`);
      ok((await overflow(page)) <= 0, `start ${device} ${lang}: horizontal overflow ${await overflow(page)}`);
      await page.screenshot({ path: `${SHOTS}/start-${device}-${scheme}-${lang}.png`, fullPage: true });
      await ctx.close();
    }
  }
}

// ---------------------------------------------------------------- tab bar and shell
{
  const { ctx, page } = await newPage('desktop', 'light', 'en');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await waitRows(page, SEED.entries.length);
  await settle(page);
  const tabs = page.locator('[role="tablist"] [role="tab"]');
  ok((await tabs.count()) === 1, `one tab, got ${await tabs.count()}`);
  ok((await page.getAttribute('[role="tablist"]', 'aria-label')) === 'Tools', 'tablist label');
  const tab = tabs.first();
  ok((await tab.getAttribute('aria-selected')) === 'true' && (await tab.getAttribute('tabindex')) === '0', 'tab selected and in the tab order');
  const panelId = await tab.getAttribute('aria-controls');
  ok((await page.getAttribute(`#${panelId}`, 'role')) === 'tabpanel', 'aria-controls points to the panel');
  ok((await page.getAttribute(`#${panelId}`, 'aria-labelledby')) === (await tab.getAttribute('id')), 'panel labelled by its tab');
  ok(await page.isVisible(`#${panelId} #pc-commune-search`), 'tool inside its panel');
  ok((await page.title()) === 'Cadastre parcels · outils-parcelles', `title: ${await page.title()}`);
  ok((await page.$$eval('a[href]', (as) => as.filter((a) => !/^(#|https?:)/.test(a.getAttribute('href'))).length)) === 0, 'no links to other pages of the site (one page)');
  // Unknown or empty routes fall back to the tab; the URL is rewritten. The
  // saved selection is what comes back, not an empty form.
  await page.goto(`${BASE}/#/nope?c=11296`, { waitUntil: 'domcontentloaded' });
  await waitRows(page, SEED.entries.length);
  await settle(page);
  ok(new URL(page.url()).hash === SEED_HASH, `unknown tab rewritten to the saved selection: ${page.url()}`);
  // FR/EN keeps the route; the theme follows the switch.
  await page.click('[data-lang-btn="fr"]');
  await settle(page);
  ok((await page.textContent('h1')) === 'Parcelles cadastrales', 'language toggle');
  ok((await page.title()) === 'Parcelles cadastrales · outils-parcelles', `French title: ${await page.title()}`);
  ok((await page.getAttribute('[role="tablist"]', 'aria-label')) === 'Outils', 'tablist label in French');
  ok(new URL(page.url()).hash === SEED_HASH, `language keeps the route: ${page.url()}`);
  await page.click('[data-theme-btn]');
  ok((await page.getAttribute('html', 'data-theme')) === 'dark', 'theme toggle');
  await page.click('[data-lang-btn="en"]');
  ok((await page.textContent('h1')) === 'Cadastre parcels', 'back to English');
  await ctx.close();
}

// ---------------------------------------------------------------- real cadastre lookup, shareable URL
{
  const { ctx, page } = await newPage('desktop', 'light', 'en');
  await page.goto(`${BASE}/${RESULT_HASH}`, { waitUntil: 'domcontentloaded' });
  await waitRows(page, 3);
  await settle(page);
  ok(new URL(page.url()).hash === RESULT_HASH, `route kept: ${page.url()}`);
  ok((await rows(page).count()) === 3, `three parcels, got ${await rows(page).count()}`);
  const table = await page.textContent('#pc-table');
  ok(/B/.test(table) && /590/.test(table), 'section and number shown');
  ok(table.includes('2,930') && table.includes('0 ha 29 a 30 ca'), 'B 590 in m² and ha/a/ca');
  ok(table.includes('7,560') && table.includes('0 ha 75 a 60 ca'), 'B 593 in m² and ha/a/ca');
  ok(table.includes('15,424') && table.includes('1 ha 54 a 24 ca'), 'B 1137 in m² and ha/a/ca');
  ok(/Surveyed/.test(table), 'arpente column shown');
  ok((await rows(page).first().locator('td').nth(5).textContent()) === 'No', 'arpente value shown');
  ok(/POUZOLS-MINERVOIS/i.test(table), 'commune name shown');
  ok(/Total/.test(table) && table.includes('25,914') && table.includes('2 ha 59 a 14 ca'), 'total in m² and ha/a/ca');
  ok(!/owner|address|tax value/i.test(await page.textContent('#pc-table tbody tr:not(.pc-detail-row)')), 'no owner/address/tax columns');

  const status = await page.textContent('#pc-status');
  ok(/3 of 4 parcels found/.test(status), `status: ${status}`);
  ok(status.includes('2 ha 59 a 14 ca'), `status total: ${status}`);
  const notFound = await page.textContent('#pc-notfound');
  ok(/B 9999/.test(notFound) && /not found/.test(notFound), `not-found report: ${notFound}`);

  await page.waitForSelector('#pc-map.leaflet-container', { timeout: 30000 });
  ok((await page.$$('#pc-map path.leaflet-interactive')).length === 3, 'three interactive parcels on the map');
  ok(/OpenStreetMap/.test(await page.textContent('.pc-attrib')), 'visible OSM attribution');
  ok(/Leaflet/.test(await page.textContent('.pc-attrib')), 'visible Leaflet attribution');
  // A parcel popup: section, number, m² and ha/a/ca.
  await page.locator('#pc-map path.leaflet-interactive').first().click({ force: true });
  await page.waitForSelector('.leaflet-popup-content', { timeout: 5000 });
  const pop = await page.textContent('.leaflet-popup-content');
  ok(/B 590/.test(pop) && pop.includes('2,930') && pop.includes('0 ha 29 a 30 ca'), `popup: ${pop}`);

  // The detail row carries every property, the source file and the caveat.
  await page.locator('#pc-table button.pc-linkbtn', { hasText: 'All fields' }).first().click();
  await settle(page);
  const detail = await page.textContent('#pc-detail-0');
  for (const field of ['Parcel ID', 'Commune', 'Prefix', 'Section', 'Number', 'Area', 'Surveyed', 'Created']) {
    ok(detail.includes(field), `detail row: ${field}`);
  }
  ok(detail.includes('112960000B0590'), 'detail row: full parcel id');
  ok(/no owner name, no postal address and no tax value/.test(detail), 'detail row: what the data lacks');
  ok(/cadastre-11296-parcelles\.json\.gz/.test(detail), 'detail row: source file');
  ok((await page.$$('.pc-sources, #pc-sources')).length === 1, 'sources at the bottom of the tab');
  ok((await page.$$('#pc-sources li')).length >= 8, `sources listed: ${(await page.$$('#pc-sources li')).length}`);
  await page.screenshot({ path: `${SHOTS}/result-desktop-light-en.png`, fullPage: true });

  // The URL is shareable: a fresh context rebuilds the same table.
  const { ctx: ctx2, page: page2 } = await newPage('desktop', 'dark', 'en');
  await page2.goto(`${BASE}/${RESULT_HASH}`, { waitUntil: 'domcontentloaded' });
  await waitRows(page2, 3);
  ok((await rows(page2).count()) === 3, 'shared URL reloads the same parcels');
  ok((await page2.getAttribute('html', 'data-theme')) === null && await page2.evaluate(() => matchMedia('(prefers-color-scheme: dark)').matches), 'system dark theme on a fresh page');
  await page2.screenshot({ path: `${SHOTS}/result-desktop-dark-en.png`, fullPage: true });
  await ctx2.close();

  // No cookies, and the only external hosts are the cited data sources.
  const hosts = new Set();
  page.on('request', (r) => hosts.add(new URL(r.url()).host));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await waitRows(page, 3);
  ok(await page.evaluate(() => document.cookie === ''), 'no cookies');
  const local = new URL(BASE).host;
  ok([...hosts].every((h) => h === local || DATA_HOSTS.has(h)), `requests only to the site and its cited sources: ${[...hosts]}`);
  await ctx.close();
}

// ---------------------------------------------------------------- seeded selection, export/import, two communes
{
  const { ctx, page } = await newPage('desktop', 'light', 'en');
  await page.goto(`${BASE}/`, { waitUntil: 'domcontentloaded' });
  await waitRows(page, SEED.entries.length);
  await page.waitForSelector('#pc-map.leaflet-container', { timeout: 30000 });
  await settle(page);

  ok(new URL(page.url()).hash === SEED_HASH, `first visit loads the example: ${page.url()}`);
  ok((await page.inputValue('#pc-selection-name')) === SEED_NAME, 'seed keeps its name');
  const table = await page.textContent('#pc-table');
  ok(/Pouzols-Minervois/i.test(table) && /Mailhac/i.test(table), 'both commune names in the table');
  const cells = await page.locator('#pc-table tbody tr:not(.pc-detail-row) td.pc-commune-cell').allTextContents();
  ok(cells.filter((c) => /Pouzols-Minervois/i.test(c)).length === 14, `14 parcels in Pouzols, got ${cells.filter((c) => /Pouzols-Minervois/i.test(c)).length}`);
  ok(cells.filter((c) => /Mailhac/i.test(c)).length === 4, `4 parcels in Mailhac, got ${cells.filter((c) => /Mailhac/i.test(c)).length}`);
  const summary = await page.textContent('#pc-summary');
  ok(/2 communes: .*11296.*11212/.test(summary), `multi-commune summary: ${summary}`);
  ok(summary.includes('8 ha 30 a 60 ca') && summary.includes('83,060'), 'seeded total in ha/a/ca and m²');
  ok(/18 (?:of|\/) 18 parcels found/.test(await page.textContent('#pc-status')), `seeded status: ${await page.textContent('#pc-status')}`);
  ok((await page.$$('#pc-map path.leaflet-interactive')).length === 18, '18 seeded parcels on one map');
  const sourceLinks = await page.locator('#pc-summary a').allTextContents();
  ok(sourceLinks.filter((t) => /Open the parcel file for/.test(t)).length === 2, `one source link per commune: ${sourceLinks}`);
  ok(sourceLinks.some((t) => /11296/.test(t)) && sourceLinks.some((t) => /11212/.test(t)), 'source links name both INSEE codes');
  ok(/no owner name.*no postal address.*no tax value/is.test(await page.textContent('#pc-about')), 'what the data lacks is stated');

  const stored = await page.evaluate(() => localStorage.getItem('outils-parcelles.selection.v1'));
  const storedJson = JSON.parse(stored);
  ok(storedJson.nom === SEED_NAME && storedJson.parcelles.length === 18, 'selection persisted in localStorage only');
  await page.screenshot({ path: `${SHOTS}/seed-two-communes.png`, fullPage: true });

  // Export downloads a local JSON file with every parcel and its name.
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#pc-export')]);
  ok(/^parcelles-pouzols-mailhac-\d{4}-\d{2}-\d{2}\.json$/.test(download.suggestedFilename()), `export filename: ${download.suggestedFilename()}`);
  const exportedPath = await download.path();
  const exported = JSON.parse(readFileSync(exportedPath, 'utf8'));
  const expectedParcels = SEED.entries.map(({ insee, section, numero }) => ({ commune: insee, section, numero }));
  ok(exported.nom === SEED_NAME, 'export keeps the name');
  ok(JSON.stringify(exported.parcelles) === JSON.stringify(expectedParcels), 'export has the 18 normalized parcels in order');

  // Clearing removes both the result and the saved copy.
  await page.click('#pc-clear');
  await page.waitForFunction(() => document.querySelectorAll('#pc-table tbody tr:not(.pc-detail-row)').length === 0, null, { timeout: 10000 });
  await settle(page);
  ok(new URL(page.url()).hash === '#/parcels', `clear empties the route: ${page.url()}`);
  ok((await page.evaluate(() => localStorage.getItem('outils-parcelles.selection.v1'))) === null, 'clear removes the stored selection');

  // Import the downloaded file: back to two communes and 18 parcels.
  await page.setInputFiles('#pc-import-file', exportedPath);
  await waitRows(page, SEED.entries.length);
  await settle(page);
  ok(new URL(page.url()).hash === SEED_HASH, `import restores the multi-commune route: ${page.url()}`);
  ok((await page.inputValue('#pc-selection-name')) === SEED_NAME, 'import restores the name');
  ok((await page.$$('#pc-map path.leaflet-interactive')).length === 18, 'import draws all 18 parcels');

  // A file with malformed entries: the valid entries still load, every bad
  // entry is reported with its 1-based line number.
  const mixed = {
    nom: 'Mixed import',
    parcelles: [
      { commune: '11296', section: 'B', numero: '590' },
      { commune: '123', section: 'B', numero: '1' },
      { commune: '11212', section: 'B', numero: '93' },
      { commune: '11296', section: 'B', numero: '0' },
    ],
  };
  const MIXED_HASH = hashFor([{ insee: '11296', section: 'B', numero: '590' }, { insee: '11212', section: 'B', numero: '93' }], mixed.nom);
  const mixedPath = join(TMP, 'mixed.json');
  writeFileSync(mixedPath, JSON.stringify(mixed));
  await page.setInputFiles('#pc-import-file', mixedPath);
  await waitRows(page, 2);
  await settle(page);
  const importErrors = await page.textContent('#pc-import-errors');
  ok(/Entry 2/.test(importErrors) && /INSEE/.test(importErrors), `import reports the bad commune: ${importErrors}`);
  ok(/Entry 4/.test(importErrors) && /numero/.test(importErrors), `import reports the bad number: ${importErrors}`);
  ok(new URL(page.url()).hash === MIXED_HASH, `import keeps only the valid entries: ${page.url()}`);
  ok((await rows(page).count()) === 2, 'two valid imported parcels drawn');
  ok(/2 communes/.test(await page.textContent('#pc-summary')), 'imported valid entries span two communes');
  await page.screenshot({ path: `${SHOTS}/import-report.png`, fullPage: true });

  // Well-formed but absent parcels are reported one by one, not dropped.
  const missing = {
    nom: 'Missing parcel',
    parcelles: [
      { commune: '11296', section: 'B', numero: '9999' },
      { commune: '11212', section: 'B', numero: '93' },
    ],
  };
  const missingPath = join(TMP, 'missing.json');
  writeFileSync(missingPath, JSON.stringify(missing));
  await page.setInputFiles('#pc-import-file', missingPath);
  await waitRows(page, 1);
  await page.waitForFunction(() => /B 9999/.test(document.querySelector('#pc-notfound')?.textContent ?? ''), null, { timeout: 30000 });
  await settle(page);
  ok(/1 of 2 parcels found/.test(await page.textContent('#pc-status')), `missing status: ${await page.textContent('#pc-status')}`);
  const notFound = await page.textContent('#pc-notfound');
  ok(/Pouzols-Minervois/i.test(notFound) && /B 9999/.test(notFound) && /not found/.test(notFound), `not-found report names the commune: ${notFound}`);

  // A bare route reload restores the locally saved selection, never the network.
  await page.goto(`${BASE}/#/parcels`, { waitUntil: 'domcontentloaded' });
  await waitRows(page, 1);
  await settle(page);
  ok(new URL(page.url()).hash === hashFor([{ insee: '11296', section: 'B', numero: '9999' }, { insee: '11212', section: 'B', numero: '93' }], missing.nom), `localStorage restores the selection: ${page.url()}`);

  // The example button loads the 18 seeded parcels again.
  await page.click('#pc-seed');
  await waitRows(page, SEED.entries.length);
  await settle(page);
  ok(new URL(page.url()).hash === SEED_HASH, 'example button restores the seeded route');
  ok((await page.inputValue('#pc-selection-name')) === SEED_NAME, 'example button restores the name');
  await ctx.close();
}

// ---------------------------------------------------------------- commune search by name
{
  const { ctx, page } = await newPage('desktop', 'light', 'fr');
  await page.goto(`${BASE}/#/parcels?c=11296`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#pc-commune-search', { timeout: 15000 });
  await page.fill('#pc-commune-search', 'Pouzols');
  await page.waitForSelector('#pc-commune-list li', { timeout: 20000 });
  const option = page.locator('#pc-commune-list li', { hasText: 'Pouzols-Minervois' }).first();
  ok((await option.count()) === 1, 'Pouzols-Minervois in the commune list');
  await option.click();
  await settle(page);
  const selected = await page.textContent('#pc-selected');
  ok(/Pouzols-Minervois/i.test(selected) && selected.includes('11296'), `commune selected: ${selected}`);
  await page.fill('#pc-input', 'B 590\nB 593');
  await page.click('#pc-run');
  await waitRows(page, 2);
  ok((await rows(page).count()) === 2, 'two parcels after the name search');
  ok(new URL(page.url()).hash === '#/parcels?c=11296&p=B590%2CB593', `route after search: ${page.url()}`);
  ok(/2 sur 2 parcelles trouvées/.test(await page.textContent('#pc-status')), `French status: ${await page.textContent('#pc-status')}`);
  ok((await page.textContent('#pc-table')).includes('1 ha 04 a 90 ca'), 'two-parcel total in ha/a/ca');
  await page.screenshot({ path: `${SHOTS}/search-fr.png`, fullPage: true });
  await ctx.close();
}

// ---------------------------------------------------------------- errors: unknown commune, unreadable lines, offline
{
  const { ctx, page } = await newPage('desktop', 'light', 'en', { allowNetworkErrors: true });
  await page.goto(`${BASE}/#/parcels?c=99999&p=B1`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#pc-error')?.textContent.trim().length > 0, null, { timeout: 30000 });
  const error = await page.textContent('#pc-error');
  ok(/No cadastre file|404|server answered/.test(error), `unknown commune error: ${error}`);
  await ctx.close();
}
{
  const { ctx, page } = await newPage('desktop', 'light', 'en', { blockData: true, allowNetworkErrors: true });
  await page.goto(`${BASE}/#/parcels`, { waitUntil: 'networkidle' });
  ok((await page.textContent('h1')) === 'Cadastre parcels', 'shell works offline');
  await page.locator('.pc-insee summary').click();
  await page.fill('#pc-insee', '11296');
  await page.click('.pc-insee button.pc-btn');
  await settle(page);
  await page.fill('#pc-input', 'B 590');
  await page.click('#pc-run');
  await page.waitForFunction(() => document.querySelector('#pc-error')?.textContent.trim().length > 0, null, { timeout: 30000 });
  ok(/Could not reach cadastre\.data\.gouv\.fr/.test(await page.textContent('#pc-error')), `offline error: ${await page.textContent('#pc-error')}`);
  // Unreadable lines are listed, not guessed.
  await page.fill('#pc-input', 'B 590\nsous-sol\nB 0');
  await page.click('#pc-run');
  await settle(page);
  const parse = await page.textContent('#pc-parse-errors');
  ok(/sous-sol/.test(parse) && /B 0/.test(parse), `unreadable lines: ${parse}`);
  await ctx.close();
}

// ---------------------------------------------------------------- phone
{
  const { ctx, page } = await newPage('phone', 'dark', 'fr');
  await page.goto(`${BASE}/${RESULT_HASH}`, { waitUntil: 'domcontentloaded' });
  await waitRows(page, 3);
  const box = await page.locator('[role="tab"]').first().boundingBox();
  ok(box.height >= 44 && box.x >= 0 && box.x + box.width <= 390, `phone tab: ${JSON.stringify(box)}`);
  ok((await overflow(page)) <= 0, `phone overflow: ${await overflow(page)}`);
  await page.locator('#pc-table').scrollIntoViewIfNeeded();
  await settle(page);
  await page.screenshot({ path: `${SHOTS}/result-phone-dark-fr.png`, fullPage: true });
  await ctx.close();
}

await browser.close();
if (problems.length) {
  console.error(`FAILED ${problems.length} of ${checks} checks:\n- ${problems.join('\n- ')}`);
  process.exit(1);
}
console.log(`OK: ${checks} checks, no console errors. Screenshots in ${SHOTS}`);
