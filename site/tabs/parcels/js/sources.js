// Sources of the cadastre-parcels tab, in the order they are first cited.
// Descriptions are our own summaries; no text or table was copied.

export const SOURCES = [
  {
    id: 'cadastre',
    text: 'etalab-cadastre, the consolidated cadastre dataset published by Etalab on cadastre.data.gouv.fr. Per-commune GeoJSON layers: parcelles, communes, sections, feuilles, lieux_dits, batiments, prefixes_sections and subdivisions_fiscales. A parcel feature has the properties id, commune, prefixe, section, numero, contenance (m²), arpente, created and updated, and a Polygon or MultiPolygon geometry in WGS84 (longitude, latitude).',
    url: 'https://cadastre.data.gouv.fr/datasets/cadastre-etalab',
  },
  {
    id: 'bundler',
    text: 'Etalab cadastre-bundler-api: the official cadastre download API on cadastre.data.gouv.fr. Its route /bundler/cadastre-etalab/communes/{insee}/geojson/{layer} returns one commune’s layer as GeoJSON with CORS and no key. This tool fetches through it because the advertised latest/…json.gz URL redirects to the S3 bucket, and that redirect carries no Access-Control-Allow-Origin header, so a browser cannot follow it cross-origin.',
    url: 'https://github.com/datagouv/cadastre-bundler-api',
  },
  {
    id: 'pcidgfip',
    text: 'DGFiP, Plan Cadastral Informatisé (PCI) vecteur, the source of the parcel plan: the cadastre divides the territory into parcels for the calculation of certain taxes. The Etalab version keeps the parcel division and the buildings and leaves out the fiscal and decorative elements of the full EDIGÉO product. Its layers contain no owner name, no postal address and no tax value.',
    url: 'https://www.data.gouv.fr/datasets/cadastre',
  },
  {
    id: 'license',
    text: 'Licence Ouverte / Open Licence 2.0 (Etalab), recorded as the licence code `fr-lo` on data.gouv.fr: reuse is allowed, including commercial reuse, with attribution.',
    url: 'https://www.data.gouv.fr/datasets/cadastre',
  },
  {
    id: 'arpente',
    text: 'Etalab/cadastre, issue #80, “Indiquer si les parcelles ont fait l’objet d’un arpentage”: the boolean `arpente` is true when the parcel carries the EDIGÉO COAR code “A”, meaning its area comes from a survey (document d’arpentage) rather than from a measurement on the fiscal plan.',
    url: 'https://github.com/datagouv/cadastre/issues/80',
  },
  {
    id: 'geoapi',
    text: 'geo.api.gouv.fr, the official French administrative API (Etalab): commune search by name, returning the name, the 5-character INSEE code, the department and the postal codes. Free, no key, CORS open. Used only to turn a commune name into a code; the parcel geometry and attributes always come from cadastre.data.gouv.fr.',
    url: 'https://geo.api.gouv.fr/',
  },
  {
    id: 'insee',
    text: 'INSEE, Code officiel géographique: the 5-character commune code (code INSEE); the department is the first two characters, or the first three for the overseas departments (971–976); Corsica uses 2A and 2B.',
    url: 'https://www.insee.fr/fr/information/8740222',
  },
  {
    id: 'units',
    text: 'Hectare, are and centiare: 1 ha = 10 000 m², 1 a = 100 m², 1 ca = 1 m².',
    url: 'https://en.wikipedia.org/wiki/Hectare',
  },
  {
    id: 'osm',
    text: 'OpenStreetMap: map data under the Open Database Licence (ODbL), tiles served under the OSM Foundation tile usage policy, attribution “© OpenStreetMap contributors”.',
    url: 'https://www.openstreetmap.org/copyright',
  },
  {
    id: 'leaflet',
    text: 'Leaflet 1.9.4, a JavaScript library for interactive maps, BSD 2-Clause licence, vendored in site/vendor/leaflet/ so the page loads no third-party script.',
    url: 'https://leafletjs.com/',
  },
];
