// Cadastre-parcels tab: choose a commune, paste a list of parcel references,
// draw them on an OpenStreetMap map and show every attribute the open
// cadastre publishes, with the area in m² and in ha/a/ca. Mounted by the
// one-page shell (site/app/main.js); the state is kept in the route
// (#/parcels?c=11296&p=B11,B1).
import { lang } from '../../../assets/site.js';
import { h, citer } from '../../../assets/ui.js';
import { SOURCES } from './sources.js';
import {
  MAX_PARCELS,
  parseParcelList,
  matchParcels,
  indexParcels,
  canonicalToken,
  refText,
  normalizeNumero,
} from './parcel-id.js';
import { formatHaCa, formatM2, sumContenances } from './units.js';
import {
  isValidInsee,
  normalizeInsee,
  normalizeName,
  departmentOf,
  parcelUrl,
  communeDirectoryUrl,
  communeSearchUrl,
  parseCommuneSearch,
  nameFromOutline,
  arrondissementHint,
} from './commune.js';
import {
  fetchParcels,
  fetchCommuneOutline,
  fetchLatestEdition,
  HttpError,
  NoDecompressionError,
  BadFileError,
} from './cadastre.js';
import { bboxOfGeoJSON, parcelColor } from './geo.js';

const T = (en, fr) => (lang() === 'fr' ? fr : en);
const tr = (o) => o?.[lang()] ?? o?.en ?? '';
const { cite, list: sourceList } = citer(SOURCES, 'p-');
const LEAFLET_JS = new URL('../../../vendor/leaflet/leaflet.js', import.meta.url).href;
const OSM_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

let ctx = null;
const els = {};
const state = {
  commune: null, // {insee, name, dep}
  input: '',
  lastTokens: [],
  result: null,
  loading: false,
  loadingName: '',
  parseErrors: [],
  errorInfo: null,
  sig: '',
  paramsRaw: '',
  // map
  map: null,
  L: null,
  groups: null,
  layers: [],
  labels: true,
  view: null,
  mapInit: null,
  leafletPromise: null,
  tileWarned: false,
  // commune search
  search: { q: '', items: [], active: -1, open: false, loading: false, error: null, token: 0 },
  outline: null,
  outlineToken: 0,
  runToken: 0,
  mapToken: 0,
  searchCache: new Map(),
  searchTimer: 0,
  searchAbort: null,
};

const smooth = () => (matchMedia('(prefers-reduced-motion: no-preference)').matches ? 'smooth' : 'auto');

// ---------------------------------------------------------------- small builders
const code = (text) => h('code', { text });
const fact = (term, body) => [h('dt', { text: term }), h('dd', {}, ...body)];

function communeName() {
  if (!state.commune) return '';
  return state.commune.name || nameFromOutline(state.outline?.data) || state.commune.insee;
}

function communeLabel() {
  if (!state.commune) return '';
  return `${communeName()} (${state.commune.insee})`;
}

function loadingText() {
  const name = state.loadingName || T('this commune', 'cette commune');
  return `${T('Loading the cadastre for', 'Chargement du cadastre de')} ${name}… ${T('The compressed file can be several MB; it is fetched once per commune and kept in memory.', 'Le fichier compressé peut peser plusieurs Mo ; il est téléchargé une fois par commune et gardé en mémoire.')}`;
}

function setStatus(text) {
  if (els.status) els.status.textContent = text;
}

function resultStatusText() {
  const r = state.result;
  if (!r) return '';
  const totals = sumContenances(r.found.map(({ feature }) => feature));
  return `${r.found.length} ${T('of', 'sur')} ${r.requested.length} ${T('parcels found', 'parcelles trouvées')} · ${T('total', 'total')} ${formatHaCa(totals.total)}`;
}

function renderStatus() {
  if (!els.status) return;
  if (state.loading) setStatus(loadingText());
  else setStatus(resultStatusText());
}

function fetchErrorInfo(error, insee) {
  if (error instanceof HttpError) return { kind: 'http', status: error.status, insee };
  if (error instanceof NoDecompressionError) return { kind: 'no-decompression' };
  if (error instanceof BadFileError) return { kind: 'bad-file' };
  return { kind: 'network', insee };
}

function errorMessage(info) {
  if (!info) return '';
  switch (info.kind) {
    case 'http': {
      if (info.status === 404) {
        let message = T(
          `No cadastre file for commune ${info.insee} (404). Check the code: the commune may be new, merged, or not covered by the PCI.`,
          `Aucun fichier cadastre pour la commune ${info.insee} (404). Vérifiez le code : la commune peut être nouvelle, fusionnée ou non couverte par le PCI.`,
        );
        const hint = arrondissementHint(info.insee);
        if (hint) {
          message += ` ${T(
            `Paris, Lyon and Marseille are published by arrondissement: try ${hint.example} (${hint.label}) or another arrondissement code.`,
            `Paris, Lyon et Marseille sont publiées par arrondissement : essayez ${hint.example} (${hint.label}) ou un autre code d’arrondissement.`,
          )}`;
        }
        return message;
      }
      return T(
        `The cadastre server answered ${info.status}. Try again in a moment.`,
        `Le serveur du cadastre a répondu ${info.status}. Réessayez dans un instant.`,
      );
    }
    case 'no-decompression':
      return T(
        'This browser cannot decompress gzip files (DecompressionStream is missing). Use a recent Chrome, Firefox, Edge or Safari.',
        'Ce navigateur ne sait pas décompresser les fichiers gzip (DecompressionStream manque). Utilisez une version récente de Chrome, Firefox, Edge ou Safari.',
      );
    case 'bad-file':
      return T(
        'The downloaded file could not be read as gzip-compressed GeoJSON. The server may have returned an error page; try again.',
        'Le fichier téléchargé n’a pas pu être lu comme du GeoJSON compressé en gzip. Le serveur a peut-être renvoyé une page d’erreur ; réessayez.',
      );
    case 'network':
      return T(
        'Could not reach cadastre.data.gouv.fr. Check the connection. The server allows cross-origin requests (CORS), so an offline browser, a proxy or a blocking extension is the likely cause.',
        'Impossible de joindre cadastre.data.gouv.fr. Vérifiez la connexion. Le serveur autorise les requêtes cross-origin (CORS) ; un navigateur hors ligne, un proxy ou une extension bloquante est la cause probable.',
      );
    case 'no-commune':
      return T('Choose a commune first.', 'Choisissez d’abord une commune.');
    case 'empty':
      return T(
        'Enter at least one parcel reference (for example B 590).',
        'Saisissez au moins une référence de parcelle (par exemple B 590).',
      );
    case 'all-unreadable':
      return T(
        'None of the lines could be read for this commune. See the list of unreadable lines above.',
        'Aucune ligne n’a pu être lue pour cette commune. Voir la liste des lignes illisibles ci-dessus.',
      );
    case 'too-many':
      return T(
        `Too many parcels (${info.count}). Keep the list to ${MAX_PARCELS} or fewer.`,
        `Trop de parcelles (${info.count}). Limitez la liste à ${MAX_PARCELS} ou moins.`,
      );
    case 'mixed':
      return T(
        `The list mixes several communes (${info.codes.join(', ')}). Use one commune at a time.`,
        `La liste mélange plusieurs communes (${info.codes.join(', ')}). Traitez une commune à la fois.`,
      );
    default:
      return info.message || '';
  }
}

function setError(info) {
  state.errorInfo = info;
  renderError();
}

function renderError() {
  if (els.error) els.error.textContent = errorMessage(state.errorInfo);
}

// ---------------------------------------------------------------- Leaflet
function loadLeaflet() {
  if (globalThis.L) return Promise.resolve(globalThis.L);
  if (state.leafletPromise) return state.leafletPromise;
  state.leafletPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => (globalThis.L ? resolve(globalThis.L) : reject(new Error('Leaflet loaded without L')));
    script.onerror = () => reject(new Error('Could not load Leaflet'));
    document.head.append(script);
  }).catch((error) => {
    state.leafletPromise = null;
    throw error;
  });
  return state.leafletPromise;
}

function saveView(map = state.map) {
  if (map && state.map === map) {
    const center = map.getCenter();
    state.view = { center: [center.lat, center.lng], zoom: map.getZoom() };
  }
}

function destroyMap() {
  state.mapToken += 1;
  if (state.map) {
    saveView(state.map);
    state.map.remove();
  }
  state.map = null;
  state.L = null;
  state.groups = null;
  state.layers = [];
}

async function ensureMap() {
  if (state.map) return state.map;
  if (state.mapInit) return state.mapInit;
  state.mapInit = (async () => {
    const L = await loadLeaflet();
    if (!els.map) throw new Error('No map container');
    els.map.replaceChildren();
    const map = L.map(els.map, {
      zoomControl: true,
      attributionControl: true,
      minZoom: 3,
      maxZoom: 19,
      worldCopyJump: true,
    });
    const tiles = L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_ATTRIBUTION });
    tiles.addTo(map);
    tiles.on('tileerror', () => {
      if (state.tileWarned) return;
      state.tileWarned = true;
      if (els.tileNote) els.tileNote.hidden = false;
    });
    // No default view: the first render fits the commune or the parcels. A
    // temporary country-wide view would load tiles that are then thrown away.
    map.on('moveend zoomend', () => saveView(map));
    state.map = map;
    state.L = L;
    state.groups = {
      outline: L.layerGroup().addTo(map),
      casing: L.layerGroup().addTo(map),
      parcels: L.layerGroup().addTo(map),
    };
    state.layers = [];
    if (els.tileNote) els.tileNote.hidden = true;
    requestAnimationFrame(() => map.invalidateSize());
    return map;
  })().finally(() => {
    state.mapInit = null;
  });
  return state.mapInit;
}

function showMapPlaceholder() {
  if (!els.map || state.map) return;
  els.map.replaceChildren(h('div', { class: 'pc-map-empty' },
    h('p', { text: T('Choose a commune and press “Show parcels” to see the map.', 'Choisissez une commune et cliquez sur « Afficher les parcelles » pour voir la carte.') })));
  if (els.legend) els.legend.hidden = true;
}

function showMapError() {
  if (!els.map) return;
  if (state.map) return;
  els.map.replaceChildren(h('div', { class: 'pc-map-empty' },
    h('p', { class: 'err', text: T('The map library could not be loaded. The table below still has the parcel data.', 'La bibliothèque de carte n’a pas pu être chargée. Le tableau ci-dessous contient toujours les données des parcelles.') })));
  if (els.legend) els.legend.hidden = true;
}

function clearParcelLayers() {
  state.groups?.casing.clearLayers();
  state.groups?.parcels.clearLayers();
  state.layers = [];
  renderLegend();
}

function popupContent(feature) {
  const p = feature.properties ?? {};
  const rows = [
    [T('Commune', 'Commune'), communeName()],
    [T('Area', 'Surface'), `${formatM2(p.contenance, lang())} m² · ${formatHaCa(p.contenance)}`],
    [T('Surveyed', 'Arpentée'), p.arpente ? T('Yes', 'Oui') : T('No', 'Non')],
    [T('Parcel ID', 'Identifiant'), String(p.id ?? '')],
  ];
  return h('div', { class: 'pc-pop' },
    h('p', { class: 'pc-pop-title', text: refText({
      section: String(p.section ?? '').toUpperCase() || null,
      numero: normalizeNumero(p.numero) ?? String(p.numero ?? ''),
      prefixe: p.prefixe ?? '000',
    }, lang()) }),
    h('dl', {}, ...rows.flatMap(([term, value]) => [h('dt', { text: term }), h('dd', { text: value })])));
}

function drawLayers() {
  const L = state.L;
  const map = state.map;
  state.groups.outline.clearLayers();
  state.groups.casing.clearLayers();
  state.groups.parcels.clearLayers();
  state.layers = [];

  let communeBounds = null;
  const outline = state.outline?.data;
  if (outline) {
    const layer = L.geoJSON(outline, {
      style: { color: '#3b4a44', weight: 2, opacity: 0.85, dashArray: '6 6', fill: false },
      interactive: false,
    });
    state.groups.outline.addLayer(layer);
    if (layer.getBounds().isValid()) communeBounds = layer.getBounds();
  }

  const parcels = state.result?.found ?? [];
  const foundBounds = L.latLngBounds([]);
  parcels.forEach(({ feature }, i) => {
    const color = parcelColor(i);
    const casing = L.geoJSON(feature, {
      style: { color: '#ffffff', weight: 7, opacity: 0.85, fill: false },
      interactive: false,
    });
    const layer = L.geoJSON(feature, {
      style: { color, weight: 2.5, opacity: 1, fillColor: color, fillOpacity: 0.32 },
    });
    layer.bindPopup(popupContent(feature), { minWidth: 220, maxWidth: 320, autoPanPadding: [24, 24] });
    if (state.labels) {
      const p = feature.properties ?? {};
      layer.bindTooltip(`${p.section ?? ''} ${p.numero ?? ''}`.trim(), {
        permanent: true,
        direction: 'center',
        className: 'pc-map-label',
        opacity: 0.95,
      });
    }
    layer.on('mouseover', () => layer.setStyle({ weight: 4, fillOpacity: 0.5 }));
    layer.on('mouseout', () => layer.setStyle({ weight: 2.5, fillOpacity: 0.32 }));
    state.groups.casing.addLayer(casing);
    state.groups.parcels.addLayer(layer);
    state.layers.push(layer);
    if (layer.getBounds().isValid()) foundBounds.extend(layer.getBounds());
  });

  if (!communeBounds && state.result?.features?.length) {
    const bbox = bboxOfGeoJSON({ type: 'FeatureCollection', features: state.result.features });
    if (bbox) communeBounds = L.latLngBounds(bbox);
  }
  return { foundBounds: foundBounds.isValid() ? foundBounds : null, communeBounds };
}

function renderLegend() {
  if (!els.legend) return;
  const found = state.result?.found ?? [];
  if (!found.length) {
    els.legend.hidden = true;
    els.legend.replaceChildren();
    return;
  }
  els.legend.hidden = false;
  els.legend.setAttribute('aria-label', T('Parcels on the map', 'Parcelles sur la carte'));
  els.legend.replaceChildren(...found.map(({ feature }, i) => {
    const p = feature.properties ?? {};
    const item = {
      section: String(p.section ?? '').toUpperCase() || null,
      numero: normalizeNumero(p.numero) ?? String(p.numero ?? ''),
      prefixe: p.prefixe ?? '000',
    };
    return h('button', {
      type: 'button',
      class: 'pc-legend-chip',
      title: T('Show on the map', 'Voir sur la carte'),
      onclick: () => focusParcel(i),
    }, h('span', { class: 'pc-swatch', 'aria-hidden': 'true', style: `--pc-c:${parcelColor(i)}` }),
    h('span', { text: refText(item, lang()) }));
  }));
}

async function renderMap({ fit = false, restoreView = false } = {}) {
  const token = ++state.mapToken;
  if (!state.result && !state.outline) {
    showMapPlaceholder();
    return;
  }
  let map;
  try {
    map = await ensureMap();
  } catch {
    showMapError();
    return;
  }
  if (token !== state.mapToken || !state.map) return;
  try {
    const { foundBounds, communeBounds } = drawLayers();
    renderLegend();
    if (restoreView && state.view) {
      map.setView(state.view.center, state.view.zoom);
    } else if (fit) {
      const bounds = foundBounds ?? communeBounds;
      if (bounds) map.fitBounds(bounds, { padding: [28, 28], maxZoom: 18 });
    }
    map.invalidateSize();
  } catch {
    showMapError();
  }
}

async function focusParcel(i) {
  const layer = state.layers?.[i];
  if (!layer) return;
  let map;
  try {
    map = await ensureMap();
  } catch {
    return;
  }
  els.mapCard?.scrollIntoView({ block: 'start', behavior: smooth() });
  map.fitBounds(layer.getBounds(), { padding: [40, 40], maxZoom: 18 });
  layer.openPopup();
  layer.bringToFront();
}

function fitParcels() {
  if (!state.map || !state.layers.length) return;
  const L = state.L;
  const bounds = L.latLngBounds([]);
  for (const layer of state.layers) if (layer.getBounds().isValid()) bounds.extend(layer.getBounds());
  if (bounds.isValid()) state.map.fitBounds(bounds, { padding: [28, 28], maxZoom: 18 });
}

function fitCommune() {
  if (!state.map) return;
  const L = state.L;
  let bounds = null;
  const outline = state.outline?.data;
  if (outline) {
    const layer = L.geoJSON(outline);
    if (layer.getBounds().isValid()) bounds = layer.getBounds();
  }
  if (!bounds && state.result?.features?.length) {
    const bbox = bboxOfGeoJSON({ type: 'FeatureCollection', features: state.result.features });
    if (bbox) bounds = L.latLngBounds(bbox);
  }
  if (bounds) state.map.fitBounds(bounds, { padding: [28, 28], maxZoom: 18 });
}

// ---------------------------------------------------------------- commune search
function renderSearch() {
  if (!els.list || !els.search) return;
  const s = state.search;
  const hasItems = s.items.length > 0;
  els.list.hidden = !(s.open && hasItems);
  els.search.setAttribute('aria-expanded', String(s.open && hasItems));
  if (s.open && hasItems && s.active >= 0) els.search.setAttribute('aria-activedescendant', `pc-opt-${s.active}`);
  else els.search.removeAttribute('aria-activedescendant');
  els.list.replaceChildren(...s.items.map((c, i) => h('li', {
    role: 'option',
    id: `pc-opt-${i}`,
    'aria-selected': String(i === s.active),
    class: i === s.active ? 'is-active' : '',
    onpointerdown: (e) => e.preventDefault(),
    onclick: () => selectSearchResult(c),
  },
  h('span', { class: 'pc-opt-name', text: c.name || c.insee }),
  h('span', { class: 'pc-opt-meta', text: `${c.insee} · ${c.dep}${c.postal.length ? ` · ${c.postal.join(', ')}` : ''}` }))));
  if (s.open && s.active >= 0) document.getElementById(`pc-opt-${s.active}`)?.scrollIntoView({ block: 'nearest' });

  if (els.searchStatus) {
    const selectedQuery = state.commune
      && (normalizeName(state.commune.name ?? '') === normalizeName(s.q) || state.commune.insee === normalizeInsee(s.q));
    if (s.loading) els.searchStatus.textContent = T('Searching…', 'Recherche…');
    else if (s.error) els.searchStatus.textContent = s.error;
    else if (s.q.trim().length >= 2 && !hasItems && !s.open && !selectedQuery) {
      els.searchStatus.textContent = T('No commune found. Add a letter or use the INSEE code below.', 'Aucune commune trouvée. Ajoutez une lettre ou utilisez le code INSEE ci-dessous.');
    } else if (hasItems) {
      els.searchStatus.textContent = T(`${s.items.length} communes found. Use the arrow keys, then Enter.`, `${s.items.length} communes trouvées. Utilisez les flèches, puis Entrée.`);
    } else {
      els.searchStatus.textContent = '';
    }
  }
}

async function doSearch(query) {
  state.searchAbort?.abort();
  state.searchAbort = new AbortController();
  const token = ++state.search.token;
  state.search.loading = true;
  state.search.error = null;
  renderSearch();
  try {
    const response = await fetch(communeSearchUrl(query), { signal: state.searchAbort.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const json = await response.json();
    if (token !== state.search.token) return;
    const items = parseCommuneSearch(json);
    state.searchCache.set(normalizeName(query), items);
    state.search.items = items;
    state.search.loading = false;
    state.search.active = -1;
    state.search.open = document.activeElement === els.search && items.length > 0;
    renderSearch();
  } catch (error) {
    if (error.name === 'AbortError' || token !== state.search.token) return;
    state.search.loading = false;
    state.search.items = [];
    state.search.active = -1;
    state.search.open = false;
    state.search.error = T(
      'Commune search is unavailable (network or API error). Enter the INSEE code below instead.',
      'La recherche de commune est indisponible (réseau ou API). Saisissez plutôt le code INSEE ci-dessous.',
    );
    renderSearch();
  }
}

function onSearchInput() {
  state.search.q = els.search.value;
  state.search.active = -1;
  state.search.error = null;
  if (state.searchTimer) clearTimeout(state.searchTimer);
  const query = state.search.q.trim();
  if (query.length < 2) {
    state.search.items = [];
    state.search.open = false;
    state.search.loading = false;
    state.searchAbort?.abort();
    renderSearch();
    return;
  }
  const cached = state.searchCache.get(normalizeName(query));
  if (cached) {
    state.search.items = cached;
    state.search.loading = false;
    state.search.open = true;
    renderSearch();
    return;
  }
  state.search.items = [];
  state.search.open = false;
  state.search.loading = true;
  renderSearch();
  state.searchTimer = setTimeout(() => doSearch(query), 250);
}

function onSearchKey(e) {
  const s = state.search;
  if (e.key === 'ArrowDown') {
    if (!s.items.length) return;
    e.preventDefault();
    s.open = true;
    s.active = Math.min(s.active + 1, s.items.length - 1);
    renderSearch();
  } else if (e.key === 'ArrowUp') {
    if (!s.items.length) return;
    e.preventDefault();
    s.open = true;
    s.active = Math.max(s.active - 1, 0);
    renderSearch();
  } else if (e.key === 'Enter') {
    if (s.open && s.active >= 0 && s.items[s.active]) {
      e.preventDefault();
      selectSearchResult(s.items[s.active]);
    } else if (s.items.length === 1) {
      e.preventDefault();
      selectSearchResult(s.items[0]);
    }
  } else if (e.key === 'Escape') {
    if (s.open) {
      e.preventDefault();
      s.open = false;
      s.active = -1;
      renderSearch();
    }
  }
}

function selectSearchResult(commune) {
  if (state.searchTimer) clearTimeout(state.searchTimer);
  state.searchAbort?.abort();
  state.search.q = commune.name || commune.insee;
  if (els.search) els.search.value = state.search.q;
  state.search.items = [];
  state.search.active = -1;
  state.search.open = false;
  state.search.error = null;
  state.search.loading = false;
  applyCommune({ insee: commune.insee, name: commune.name || null, dep: commune.dep || departmentOf(commune.insee) });
}

function useManualInsee() {
  if (!els.insee || !els.inseeMsg) return;
  const raw = normalizeInsee(els.insee.value);
  if (!isValidInsee(raw)) {
    els.inseeMsg.textContent = T(
      'A commune INSEE code has 5 characters (for example 11296, 2A004 or 97101).',
      'Un code INSEE de commune a 5 caractères (par exemple 11296, 2A004 ou 97101).',
    );
    return;
  }
  els.inseeMsg.textContent = '';
  els.insee.value = '';
  if (els.inseeDetails) els.inseeDetails.open = false;
  state.search.q = '';
  if (els.search) els.search.value = '';
  applyCommune({ insee: raw, name: null, dep: departmentOf(raw) });
}

function applyCommune(commune) {
  if (state.searchTimer) clearTimeout(state.searchTimer);
  state.searchAbort?.abort();
  state.commune = commune;
  state.outline = null;
  state.result = null;
  state.lastTokens = [];
  state.parseErrors = [];
  state.errorInfo = null;
  state.view = null;
  state.loading = false;
  state.loadingName = '';
  state.runToken += 1;
  state.outlineToken += 1;
  state.search.items = [];
  state.search.active = -1;
  state.search.open = false;
  state.search.error = null;
  state.search.loading = false;
  renderSearch();
  renderCommune();
  renderParseErrors();
  renderError();
  renderStatus();
  renderResults();
  clearParcelLayers();
  if (els.legend) els.legend.hidden = true;
  state.groups?.outline.clearLayers();
  writeRoute();
  void previewCommune();
}

function clearCommune() {
  if (state.searchTimer) clearTimeout(state.searchTimer);
  state.searchAbort?.abort();
  state.commune = null;
  state.outline = null;
  state.result = null;
  state.lastTokens = [];
  state.parseErrors = [];
  state.errorInfo = null;
  state.loading = false;
  state.runToken += 1;
  state.outlineToken += 1;
  state.search = { q: '', items: [], active: -1, open: false, loading: false, error: null, token: state.search.token + 1 };
  state.view = null;
  destroyMap();
  state.view = null;
  if (els.search) els.search.value = '';
  renderSearch();
  renderCommune();
  renderParseErrors();
  renderError();
  renderStatus();
  renderResults();
  writeRoute();
  showMapPlaceholder();
  els.search?.focus();
}

function clearParcels() {
  state.input = '';
  state.lastTokens = [];
  state.result = null;
  state.parseErrors = [];
  state.errorInfo = null;
  state.loading = false;
  state.runToken += 1;
  if (els.input) els.input.value = '';
  renderParseErrors();
  renderError();
  renderStatus();
  renderResults();
  clearParcelLayers();
  writeRoute();
}

function renderCommune() {
  if (!els.selected) return;
  if (state.commune) {
    els.selected.hidden = false;
    els.selected.replaceChildren(
      h('span', { class: 'pc-selected-kicker', text: T('Commune', 'Commune') }),
      h('strong', { text: communeName() }),
      h('span', { class: 'pc-selected-code', text: `(${state.commune.insee})` }),
      h('button', {
        type: 'button',
        class: 'pc-linkbtn',
        onclick: clearCommune,
        text: T('Change', 'Changer'),
      }),
    );
  } else {
    els.selected.hidden = true;
    els.selected.replaceChildren();
  }
  if (els.search && els.search !== document.activeElement && state.search.q !== undefined) {
    els.search.value = state.search.q;
  }
}

// ---------------------------------------------------------------- load the commune and the parcels
async function previewCommune({ quiet = false } = {}) {
  const commune = state.commune;
  if (!commune) return;
  const token = ++state.outlineToken;
  try {
    const res = await fetchCommuneOutline(commune.insee);
    if (token !== state.outlineToken || state.commune?.insee !== commune.insee) return;
    state.outline = res;
    if (!state.commune.name) {
      const name = nameFromOutline(res.data);
      if (name) {
        state.commune.name = name;
        if (!state.search.q) state.search.q = name;
      }
    }
    renderCommune();
    if (!state.loading) {
      if (state.result) await renderMap({ fit: false, restoreView: true });
      else await renderMap({ fit: true });
    }
  } catch (error) {
    if (token !== state.outlineToken || state.commune?.insee !== commune.insee) return;
    if (!quiet || (error instanceof HttpError && error.status === 404)) {
      setError(fetchErrorInfo(error, commune.insee));
    }
  }
}

async function run() {
  if (!els.input) return;
  state.input = els.input.value;
  state.errorInfo = null;
  renderError();
  const parsed = parseParcelList(state.input, { commune: state.commune });
  state.parseErrors = parsed.errors;
  renderParseErrors();
  const items = parsed.items;

  if (!items.length) {
    setError({ kind: parsed.errors.length ? 'all-unreadable' : 'empty' });
    renderStatus();
    return;
  }
  if (items.length > MAX_PARCELS) {
    setError({ kind: 'too-many', count: items.length });
    renderStatus();
    return;
  }

  if (!state.commune) {
    const codes = [...new Set(items.map((item) => item.insee).filter(Boolean))];
    if (codes.length > 1) {
      setError({ kind: 'mixed', codes });
      renderStatus();
      return;
    }
    if (codes.length === 1) {
      state.commune = { insee: codes[0], name: null, dep: departmentOf(codes[0]) };
      state.search.q = '';
      renderCommune();
      void previewCommune({ quiet: true });
    } else {
      setError({ kind: 'no-commune' });
      renderStatus();
      return;
    }
  }

  const insee = state.commune.insee;
  const name = communeName();
  state.lastTokens = items.map(canonicalToken);
  state.result = null;
  state.loading = true;
  state.loadingName = name;
  state.runToken += 1;
  const token = state.runToken;
  state.errorInfo = null;
  renderError();
  renderStatus();
  renderResults();
  clearParcelLayers();
  if (state.outline) void renderMap({ fit: false, restoreView: true });
  writeRoute();

  const outlinePromise = fetchCommuneOutline(insee).catch(() => null);
  const editionPromise = fetchLatestEdition().catch(() => null);
  let res;
  try {
    res = await fetchParcels(insee);
  } catch (error) {
    if (token !== state.runToken) return;
    state.loading = false;
    state.result = null;
    renderStatus();
    renderResults();
    setError(fetchErrorInfo(error, insee));
    clearParcelLayers();
    return;
  }
  if (token !== state.runToken) return;

  const features = Array.isArray(res.data?.features) ? res.data.features : [];
  const index = indexParcels(features);
  const { found, notFound } = matchParcels(items, index);
  const outline = await outlinePromise;
  const latestEdition = await editionPromise;
  if (token !== state.runToken) return;
  if (outline) {
    state.outline = outline;
    if (!state.commune.name) {
      const official = nameFromOutline(outline.data);
      if (official) {
        state.commune.name = official;
        if (!state.search.q) state.search.q = official;
      }
    }
  }
  state.result = {
    insee,
    edition: res.edition || outline?.edition || latestEdition || null,
    sourceUrl: parcelUrl(insee),
    directoryUrl: communeDirectoryUrl(insee),
    requested: items,
    features,
    index,
    found,
    notFound,
  };
  state.loading = false;
  renderStatus();
  renderCommune();
  renderResults();
  writeRoute();
  void renderMap({ fit: true });
}

// ---------------------------------------------------------------- rendering
function renderParseErrors() {
  if (!els.parseErrors) return;
  if (!state.parseErrors.length) {
    els.parseErrors.replaceChildren();
    return;
  }
  els.parseErrors.replaceChildren(h('div', { class: 'pc-parse-errors' },
    h('p', { class: 'pc-subhead', text: T('Lines that could not be read', 'Lignes illisibles') }),
    h('ul', {}, ...state.parseErrors.map((error) => {
      let reason;
      if (error.code === 'bad-numero') {
        reason = T('the number must be from 1 to 9999.', 'le numéro doit aller de 1 à 9999.');
      } else if (error.code === 'other-commune') {
        reason = T(
          `this line names commune ${error.insee}, but ${error.expected} is selected.`,
          `cette ligne nomme la commune ${error.insee}, mais ${error.expected} est sélectionnée.`,
        );
      } else {
        reason = T(
          'not a section and number (try B 590, B590, 0590 or the full parcel id).',
          'ce n’est pas une section et un numéro (essayez B 590, B590, 0590 ou l’identifiant complet).',
        );
      }
      return h('li', {}, h('code', { text: error.raw }), ' — ', reason);
    }))));
}

function fieldValue(feature) {
  const p = feature.properties ?? {};
  const ordered = ['id', 'commune', 'prefixe', 'section', 'numero', 'contenance', 'arpente', 'created', 'updated'];
  const keys = [...ordered.filter((key) => key in p), ...Object.keys(p).filter((key) => !ordered.includes(key)).sort()];
  const labels = {
    id: T('Parcel ID', 'Identifiant'),
    commune: T('Commune', 'Commune'),
    prefixe: T('Prefix', 'Préfixe'),
    section: T('Section', 'Section'),
    numero: T('Number', 'Numéro'),
    contenance: T('Area', 'Surface'),
    arpente: T('Surveyed', 'Arpentée'),
    created: T('Created', 'Créée'),
    updated: T('Updated', 'Mise à jour'),
  };
  return keys.map((key) => {
    const value = p[key];
    let shown;
    if (key === 'commune') shown = `${communeName()} (${value})`;
    else if (key === 'contenance') shown = `${formatM2(value, lang())} m² · ${formatHaCa(value)}`;
    else if (key === 'arpente') shown = value ? T('Yes', 'Oui') : T('No', 'Non');
    else shown = value === null || value === undefined ? '–' : String(value);
    return [labels[key] ?? key, shown, key === 'id'];
  });
}

function detailRow(feature, i) {
  const fields = fieldValue(feature);
  return h('tr', { class: 'pc-detail-row', id: `pc-detail-${i}`, hidden: true },
    h('td', { colspan: '8' },
      h('dl', { class: 'pc-fields' }, ...fields.flatMap(([term, value, mono]) => [
        h('dt', { text: term }),
        h('dd', {}, mono ? h('code', { text: value }) : value),
      ])),
      h('p', { class: 'small muted' }, T('Source file: ', 'Fichier source : '),
      h('a', { href: state.result?.sourceUrl ?? '', target: '_blank', rel: 'noopener' }, state.result?.sourceUrl?.replace(/^https?:\/\//, '') ?? '')),
      h('p', { class: 'note small' }, T(
        'The open cadastre has no owner name, no postal address and no tax value for this parcel.',
        'Le cadastre ouvert ne contient ni nom de propriétaire, ni adresse postale, ni valeur fiscale pour cette parcelle.',
      ), ' ', ...cite('pcidgfip'))));
}

function table(found) {
  const totals = sumContenances(found.map(({ feature }) => feature));
  const head = h('thead', {}, h('tr', {},
    h('th', { scope: 'col' }, h('span', { class: 'visually-hidden', text: T('Colour', 'Couleur') })),
    h('th', { scope: 'col', text: T('Section', 'Section') }),
    h('th', { scope: 'col', text: T('Number', 'Numéro') }),
    h('th', { scope: 'col', class: 'num', text: T('Area (m²)', 'Surface (m²)') }),
    h('th', { scope: 'col', text: 'ha · a · ca' }),
    h('th', { scope: 'col', text: T('Surveyed', 'Arpentée') }),
    h('th', { scope: 'col', text: T('Commune', 'Commune') }),
    h('th', { scope: 'col' }, h('span', { class: 'visually-hidden', text: T('Actions', 'Actions') }))));

  const rows = [];
  found.forEach(({ feature }, i) => {
    const p = feature.properties ?? {};
    const item = {
      section: String(p.section ?? '').toUpperCase() || null,
      numero: normalizeNumero(p.numero) ?? String(p.numero ?? ''),
      prefixe: p.prefixe ?? '000',
    };
    const ref = refText(item, lang());
    const detailButton = h('button', {
      type: 'button',
      class: 'pc-linkbtn',
      'aria-expanded': 'false',
      'aria-controls': `pc-detail-${i}`,
      text: T('All fields', 'Tous les champs'),
    });
    const showButton = h('button', {
      type: 'button',
      class: 'pc-linkbtn',
      'aria-label': T(`Show parcel ${ref} on the map`, `Voir la parcelle ${ref} sur la carte`),
      onclick: () => focusParcel(i),
      text: T('Show', 'Voir'),
    });
    const row = h('tr', {},
      h('td', { class: 'pc-c' }, h('span', { class: 'pc-swatch', 'aria-hidden': 'true', style: `--pc-c:${parcelColor(i)}` })),
      h('td', { text: String(p.section ?? '') }),
      h('td', { class: 'num', text: normalizeNumero(p.numero) ?? String(p.numero ?? '') }),
      h('td', { class: 'num', text: formatM2(p.contenance, lang()) }),
      h('td', { class: 'pc-haca', text: formatHaCa(p.contenance) }),
      h('td', { text: p.arpente ? T('Yes', 'Oui') : T('No', 'Non') }),
      h('td', { class: 'pc-commune-cell', text: communeName() }),
      h('td', { class: 'pc-actions-cell' }, showButton, ' ', detailButton));
    const detail = detailRow(feature, i);
    detailButton.addEventListener('click', () => {
      const open = detail.hidden;
      detail.hidden = !open;
      detailButton.setAttribute('aria-expanded', String(open));
      detailButton.textContent = open ? T('Hide fields', 'Masquer les champs') : T('All fields', 'Tous les champs');
    });
    rows.push(row, detail);
  });

  const foot = h('tfoot', {}, h('tr', {},
    h('td', { colspan: '3', text: `${T('Total', 'Total')} (${found.length})` }),
    h('td', { class: 'num', text: formatM2(totals.total, lang()) }),
    h('td', { text: formatHaCa(totals.total) }),
    h('td', {}),
    h('td', {}),
    h('td', {})));

  return { node: h('table', { class: 'pc-table' },
    h('caption', { class: 'visually-hidden', text: T('Parcels found in ', 'Parcelles trouvées à ') + communeName() }),
    head, h('tbody', {}, ...rows), foot), totals };
}

function renderResults() {
  if (!els.results || !els.summary || !els.table || !els.notfound) return;
  els.results.setAttribute('aria-busy', String(state.loading));
  if (state.loading) {
    els.summary.replaceChildren(h('p', { class: 'pc-loading' }, h('span', { class: 'pc-spinner', 'aria-hidden': 'true' }), ' ', loadingText()));
    els.table.replaceChildren();
    els.notfound.replaceChildren();
    return;
  }
  if (!state.result) {
    els.summary.replaceChildren(h('p', { class: 'muted', text: state.commune
      ? T(`Commune ${communeName()} selected. Enter parcel references and press “Show parcels”.`, `Commune ${communeName()} sélectionnée. Saisissez les références des parcelles et cliquez sur « Afficher les parcelles ».`)
      : T('Choose a commune, then enter parcel references.', 'Choisissez une commune, puis saisissez les références des parcelles.') }));
    els.table.replaceChildren();
    els.notfound.replaceChildren();
    return;
  }

  const { found, notFound, edition } = state.result;
  const { node, totals } = table(found);
  const summary = [];
  summary.push(h('p', { class: 'pc-count' }, h('strong', { text: `${found.length} / ${state.result.requested.length}` }), ' ', T('parcels found', 'parcelles trouvées')));
  summary.push(h('p', { class: 'small muted', text: `${T('Total area', 'Surface totale')}: ${formatHaCa(totals.total)} (${formatM2(totals.total, lang())} m²)` }));
  if (totals.missing) summary.push(h('p', { class: 'small muted', text: T(`${totals.missing} parcel(s) have no contenance and are left out of the total.`, `${totals.missing} parcelle(s) sans contenance sont exclues du total.`) }));
  if (notFound.length) summary.push(h('p', { class: 'small muted', text: T(`${notFound.length} requested parcel(s) not found.`, `${notFound.length} parcelle(s) demandée(s) introuvable(s).`) }));
  if (state.parseErrors.length) summary.push(h('p', { class: 'small muted', text: T(`${state.parseErrors.length} line(s) could not be read.`, `${state.parseErrors.length} ligne(s) illisible(s).`) }));
  if (edition) summary.push(h('p', { class: 'small muted' }, T('Cadastre edition: ', 'Édition du cadastre : '), h('strong', { text: edition }), ' ', ...cite('cadastre')));
  summary.push(h('p', { class: 'small' }, h('a', { href: state.result.sourceUrl, target: '_blank', rel: 'noopener' }, T('Open this commune’s parcel file (json.gz)', 'Ouvrir le fichier des parcelles de cette commune (json.gz)')), ' ', ...cite('cadastre')));
  if (!found.length) summary.push(h('p', { class: 'note', text: T('None of the requested parcels were found; the map is fitted to the commune.', 'Aucune des parcelles demandées n’a été trouvée ; la carte est cadrée sur la commune.') }));
  els.summary.replaceChildren(...summary);
  els.table.replaceChildren(found.length ? node : h('p', { class: 'muted', text: T('No parcel drawn.', 'Aucune parcelle dessinée.') }));

  if (!notFound.length) {
    els.notfound.replaceChildren();
  } else {
    els.notfound.replaceChildren(h('div', { class: 'pc-notfound' },
      h('h3', { text: T('Not found in this commune', 'Introuvables dans cette commune') }),
      h('ul', {}, ...notFound.map(({ item, reason, candidates }) => {
        const ref = refText(item, lang());
        let message;
        if (reason === 'ambiguous') {
          const ids = candidates.slice(0, 5).map((p) => `${p.id} (${T('prefix', 'préfixe')} ${p.prefixe ?? '000'})`).join(', ');
          message = T(
            `matches ${candidates.length} parcels: ${ids}. Paste the full parcel id to choose one.`,
            `correspond à ${candidates.length} parcelles : ${ids}. Collez l’identifiant complet pour en choisir une.`,
          );
        } else if (!item.section) {
          message = T(
            'not found. The number alone matches no parcel here; add the section letter.',
            'introuvable. Le numéro seul ne correspond à aucune parcelle ici ; ajoutez la lettre de section.',
          );
        } else {
          message = T(
            'not found. Check the section letter and number; the parcel may belong to a neighbouring commune.',
            'introuvable. Vérifiez la lettre de section et le numéro ; la parcelle peut appartenir à une commune voisine.',
          );
        }
        return h('li', {}, h('strong', { text: ref }), ' — ', message);
      })),
      state.result.index.sections.length
        ? h('p', { class: 'small muted', text: T('Sections present in this commune: ', 'Sections présentes dans cette commune : ') + state.result.index.sections.join(', ') })
        : null));
  }
}

// ---------------------------------------------------------------- page structure
function introSection() {
  return h('div', { class: 'pc-intro' },
    h('h1', { text: T('Cadastre parcels', 'Parcelles cadastrales') }),
    h('p', { class: 'lead muted' }, T(
      'Look up several French cadastre parcels at once. Choose a commune, paste a list of section and number, and see the parcels on a map with their area in m² and in hectares–ares–centiares.',
      'Retrouvez plusieurs parcelles cadastrales françaises à la fois. Choisissez une commune, collez une liste de sections et de numéros, et voyez les parcelles sur une carte avec leur surface en m² et en hectares–ares–centiares.',
    ), ' ', ...cite('cadastre')),
    h('p', { class: 'small muted' }, T('Data: etalab-cadastre (DGFiP PCI), Licence Ouverte 2.0. Map: OpenStreetMap.', 'Données : etalab-cadastre (PCI de la DGFiP), Licence Ouverte 2.0. Carte : OpenStreetMap.'), ' ', ...cite('license', 'osm', 'bundler')));
}

function controlsSection() {
  const search = h('input', {
    id: 'pc-commune-search',
    type: 'search',
    role: 'combobox',
    autocomplete: 'off',
    spellcheck: 'false',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': 'pc-commune-list',
    'aria-describedby': 'pc-search-hint',
    placeholder: T('Pouzols-Minervois, Ajaccio…', 'Pouzols-Minervois, Ajaccio…'),
  });
  search.value = state.search.q;
  search.addEventListener('input', onSearchInput);
  search.addEventListener('keydown', onSearchKey);
  search.addEventListener('focus', () => {
    if (state.search.items.length) {
      state.search.open = true;
      renderSearch();
    }
  });
  search.addEventListener('blur', () => {
    setTimeout(() => {
      if (document.activeElement !== search) {
        state.search.open = false;
        renderSearch();
      }
    }, 150);
  });

  const list = h('ul', { id: 'pc-commune-list', class: 'pc-list', role: 'listbox', 'aria-label': T('Communes', 'Communes'), hidden: true });
  const searchStatus = h('p', { id: 'pc-search-status', class: 'hint', role: 'status', 'aria-live': 'polite' });

  const insee = h('input', {
    id: 'pc-insee',
    type: 'text',
    inputmode: 'text',
    maxlength: '5',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: '11296',
    'aria-describedby': 'pc-insee-hint',
  });
  insee.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); useManualInsee(); } });
  const inseeDetails = h('details', { class: 'pc-insee' },
    h('summary', { text: T('Enter an INSEE code instead', 'Saisir un code INSEE à la place') }),
    h('div', { class: 'pc-insee-row' },
      h('label', { for: 'pc-insee', text: T('INSEE code', 'Code INSEE') }),
      insee,
      h('button', { type: 'button', class: 'pc-btn small', onclick: useManualInsee, text: T('Use', 'Utiliser') })),
    h('p', { id: 'pc-insee-hint', class: 'hint', text: T('For example 11296 (Pouzols-Minervois), 2A004 (Ajaccio), 97101 (Les Abymes).', 'Par exemple 11296 (Pouzols-Minervois), 2A004 (Ajaccio), 97101 (Les Abymes).') }),
    h('p', { id: 'pc-insee-msg', class: 'err', role: 'alert' }),
    h('p', { class: 'hint' }, T('Paris, Lyon and Marseille are published by arrondissement (for example 75101, 69381, 13201).', 'Paris, Lyon et Marseille sont publiées par arrondissement (par exemple 75101, 69381, 13201).'), ' ', ...cite('insee')));

  const input = h('textarea', {
    id: 'pc-input',
    rows: '8',
    spellcheck: 'false',
    autocomplete: 'off',
    placeholder: 'B 590\nB 593\nB594',
    'aria-describedby': 'pc-format-hint',
  });
  input.value = state.input;
  input.addEventListener('input', () => {
    state.input = input.value;
    if (state.parseErrors.length) {
      state.parseErrors = [];
      renderParseErrors();
    }
  });

  return h('section', { class: 'card pc-controls', 'aria-labelledby': 'pc-commune-h' },
    h('h2', { id: 'pc-commune-h', text: T('1. Commune', '1. Commune') }),
    h('div', { class: 'pc-search' },
      h('label', { for: 'pc-commune-search', class: 'pc-label', text: T('Search a commune by name', 'Rechercher une commune par nom') }),
      search,
      list),
    h('p', { id: 'pc-search-hint', class: 'hint', text: T('Type at least two letters, then choose the commune in the list.', 'Tapez au moins deux lettres, puis choisissez la commune dans la liste.') }),
    searchStatus,
    h('div', { id: 'pc-selected', class: 'pc-selected', hidden: true }),
    inseeDetails,
    h('h2', { id: 'pc-parcels-h', text: T('2. Parcels', '2. Parcelles') }),
    h('label', { for: 'pc-input', class: 'pc-label', text: T('Section and number, one per line', 'Section et numéro, un par ligne') }),
    input,
    h('p', { id: 'pc-format-hint', class: 'hint' }, T('Formats: ', 'Formats : '), code('B 590'), ', ', code('B590'), ', ', code('B-590'), ', ', code('0590'), T(' (number only), ', ' (numéro seul), '), code('11296 B 590'), T(' or the full id ', ' ou l’identifiant complet '), code('112960000B0590'), T('. Separate by a new line, comma or semicolon. Up to 100 parcels.', '. Séparez par un retour à la ligne, une virgule ou un point-virgule. Jusqu’à 100 parcelles.')),
    h('div', { class: 'pc-actions' },
      h('button', { id: 'pc-run', type: 'button', class: 'pc-btn primary', onclick: () => void run(), text: T('Show parcels', 'Afficher les parcelles') }),
      h('button', { id: 'pc-clear', type: 'button', class: 'pc-btn', onclick: clearParcels, text: T('Clear parcels', 'Vider la liste') })),
    h('div', { id: 'pc-parse-errors' }),
    h('p', { id: 'pc-status', class: 'pc-status', role: 'status', 'aria-live': 'polite' }),
    h('p', { id: 'pc-error', class: 'err', role: 'alert' }));
}

function mapSection() {
  const labelToggle = h('input', { type: 'checkbox', checked: state.labels });
  labelToggle.addEventListener('change', () => {
    state.labels = labelToggle.checked;
    if (state.result) void renderMap({ fit: false, restoreView: true });
  });
  return h('section', { class: 'card pc-map-card', 'aria-labelledby': 'pc-map-h' },
    h('div', { class: 'pc-map-head' },
      h('h2', { id: 'pc-map-h', text: T('Map', 'Carte') }),
      h('div', { class: 'pc-map-tools' },
        h('label', { class: 'pc-check' }, labelToggle, h('span', { text: T('Labels', 'Étiquettes') })),
        h('button', { type: 'button', class: 'pc-btn small', onclick: fitParcels, text: T('Fit parcels', 'Ajuster aux parcelles') }),
        h('button', { type: 'button', class: 'pc-btn small', onclick: fitCommune, text: T('Fit commune', 'Ajuster à la commune') }))),
    h('div', { id: 'pc-map', class: 'pc-map', role: 'region', 'aria-label': T('Map of the selected parcels', 'Carte des parcelles sélectionnées') }),
    h('p', { class: 'pc-attrib small muted' }, '© ',
    h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, 'OpenStreetMap'), ' contributors · ',
    h('a', { href: 'https://leafletjs.com/', target: '_blank', rel: 'noopener' }, 'Leaflet'), ' · ',
    T('parcel outlines: etalab-cadastre', 'contours : etalab-cadastre')),
    h('p', { class: 'pc-tile-note', hidden: true, text: T('Map tiles could not be loaded (offline?). The parcel outlines still come from the cadastre.', 'Le fond de carte n’a pas pu être chargé (hors ligne ?). Les contours des parcelles viennent toujours du cadastre.') }),
    h('div', { id: 'pc-legend', class: 'pc-legend', hidden: true }));
}

function resultsSection() {
  return h('section', { class: 'card pc-results', id: 'pc-results', 'aria-labelledby': 'pc-results-h' },
    h('h2', { id: 'pc-results-h', text: T('Parcels found', 'Parcelles trouvées') }),
    h('div', { id: 'pc-summary', class: 'pc-summary' }),
    h('div', { id: 'pc-table', class: 'pc-table-wrap' }),
    h('div', { id: 'pc-notfound' }));
}

function aboutSection() {
  return h('section', { class: 'card', id: 'pc-about', 'aria-labelledby': 'pc-about-h' },
    h('h2', { id: 'pc-about-h', text: T('What the open data contains — and what it does not', 'Ce que contiennent les données ouvertes — et ce qu’elles ne contiennent pas') }),
    h('dl', { class: 'pc-facts' },
      ...fact(T('In each parcel feature', 'Dans chaque parcelle'),
        [T('Geometry, id, commune, prefixe, section, numero, contenance (m²), arpente, created and updated.', 'Géométrie, id, commune, prefixe, section, numero, contenance (m²), arpente, created et updated.'), ' ', ...cite('cadastre')]),
      ...fact(T('Not in the open data', 'Absent des données ouvertes'),
        [h('strong', { text: T('No owner name, no postal address, no tax value.', 'Ni nom de propriétaire, ni adresse postale, ni valeur fiscale.') }), ' ',
          T('Those data are not part of the published layers; this tool cannot show them.', 'Ces données ne font pas partie des couches publiées ; cet outil ne peut pas les afficher.'), ' ', ...cite('pcidgfip')]),
      ...fact(T('Area', 'Surface'),
        [T('The figure is the cadastral contenance in m², converted to ha/a/ca (1 ha = 10 000 m², 1 a = 100 m², 1 ca = 1 m²). It is not computed from the outline.', 'Le chiffre est la contenance cadastrale en m², convertie en ha/a/ca (1 ha = 10 000 m², 1 a = 100 m², 1 ca = 1 m²). Elle n’est pas calculée à partir du contour.'), ' ', ...cite('units', 'cadastre')]),
      ...fact(T('Surveyed (arpente)', 'Arpentée (arpente)'),
        [T('Yes means the area comes from a survey (document d’arpentage) rather than from the fiscal plan; it is generally more reliable.', 'Oui signifie que la surface vient d’un arpentage (document d’arpentage) plutôt que du plan fiscal ; elle est en général plus fiable.'), ' ', ...cite('arpente')]),
      ...fact(T('Geometry', 'Géométrie'),
        [T('Polygon or MultiPolygon in WGS84 (longitude, latitude).', 'Polygone ou multi-polygone en WGS84 (longitude, latitude).'), ' ', ...cite('cadastre')]),
      ...fact(T('Commune lookup', 'Recherche de commune'),
        [T('The name is resolved to an INSEE code by geo.api.gouv.fr; the parcels always come from cadastre.data.gouv.fr.', 'Le nom est résolu en code INSEE par geo.api.gouv.fr ; les parcelles viennent toujours de cadastre.data.gouv.fr.'), ' ', ...cite('geoapi', 'insee')])));
}

function sourcesSection() {
  return h('section', { class: 'card sources', id: 'pc-sources' },
    h('h2', { text: 'Sources' }),
    sourceList(),
    h('p', { class: 'small muted' }, T(
      'Texts and code are our own. The facts, field names and data come from the sources listed; no text or table was copied. The parcel geometry is drawn as delivered; the area shown is the cadastre’s contenance, not a calculation from that geometry.',
      'Les textes et le code sont les nôtres. Les faits, les noms de champs et les données viennent des sources listées ; aucun texte ni tableau n’a été recopié. La géométrie est dessinée telle que livrée ; la surface affichée est la contenance du cadastre, pas un calcul à partir de cette géométrie.',
    )));
}

// ---------------------------------------------------------------- build and route
function build() {
  destroyMap();
  state.tileWarned = false;
  ctx.root.replaceChildren(h('div', { class: 'pc' },
    introSection(),
    h('div', { class: 'pc-grid' },
      controlsSection(),
      mapSection(),
      resultsSection(),
      aboutSection(),
      sourcesSection())));

  Object.assign(els, {
    search: document.getElementById('pc-commune-search'),
    list: document.getElementById('pc-commune-list'),
    searchStatus: document.getElementById('pc-search-status'),
    selected: document.getElementById('pc-selected'),
    insee: document.getElementById('pc-insee'),
    inseeMsg: document.getElementById('pc-insee-msg'),
    inseeDetails: document.querySelector('.pc-insee'),
    input: document.getElementById('pc-input'),
    parseErrors: document.getElementById('pc-parse-errors'),
    status: document.getElementById('pc-status'),
    error: document.getElementById('pc-error'),
    map: document.getElementById('pc-map'),
    mapCard: document.querySelector('.pc-map-card'),
    tileNote: document.querySelector('.pc-tile-note'),
    legend: document.getElementById('pc-legend'),
    results: document.getElementById('pc-results'),
    summary: document.getElementById('pc-summary'),
    table: document.getElementById('pc-table'),
    notfound: document.getElementById('pc-notfound'),
  });

  renderSearch();
  renderCommune();
  renderParseErrors();
  renderError();
  renderStatus();
  renderResults();
  if (state.result) void renderMap({ fit: !state.view, restoreView: !!state.view });
  else if (state.outline) void renderMap({ fit: !state.view, restoreView: !!state.view });
  else showMapPlaceholder();
}

function readParams(params) {
  if (state.searchTimer) clearTimeout(state.searchTimer);
  state.searchAbort?.abort();
  const c = normalizeInsee(params.get('c') ?? '');
  const tokens = (params.get('p') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  const previous = state.commune;
  const same = previous && previous.insee === c;
  state.commune = isValidInsee(c) ? { insee: c, name: same ? previous.name : null, dep: departmentOf(c) } : null;
  state.input = tokens.join('\n');
  state.lastTokens = tokens;
  state.result = null;
  state.outline = null;
  state.parseErrors = [];
  state.errorInfo = null;
  state.loading = false;
  state.search.q = state.commune?.name ?? '';
  state.search.items = [];
  state.search.active = -1;
  state.search.open = false;
  state.search.loading = false;
  state.search.error = null;
  state.view = null;
  state.runToken += 1;
  state.outlineToken += 1;
}

function writeRoute() {
  const params = new URLSearchParams();
  if (state.commune) {
    params.set('c', state.commune.insee);
    if (state.lastTokens.length) params.set('p', state.lastTokens.join(','));
  }
  state.paramsRaw = params.toString();
  ctx.setParams(params);
}

export function mount(root, { params, setParams }) {
  ctx = { root, setParams };
  state.commune = null;
  state.input = '';
  state.lastTokens = [];
  state.result = null;
  state.loading = false;
  state.parseErrors = [];
  state.errorInfo = null;
  state.view = null;
  state.outline = null;
  state.search = { q: '', items: [], active: -1, open: false, loading: false, error: null, token: state.search.token + 1 };
  state.searchCache = new Map();
  state.paramsRaw = '';
  readParams(params);
  build();
  writeRoute();
  if (state.commune) {
    void previewCommune({ quiet: true });
    if (state.lastTokens.length) void run();
  }

  return {
    show(next) {
      if (next.toString() === state.paramsRaw) return;
      readParams(next);
      if (els.input) els.input.value = state.input;
      renderSearch();
      renderCommune();
      renderParseErrors();
      renderError();
      renderStatus();
      renderResults();
      clearParcelLayers();
      state.groups?.outline.clearLayers();
      if (els.legend) els.legend.hidden = true;
      writeRoute();
      if (state.commune) {
        void previewCommune({ quiet: true });
        if (state.lastTokens.length) void run();
      } else {
        destroyMap();
        state.view = null;
        showMapPlaceholder();
      }
    },
    relang() {
      build();
    },
  };
}
