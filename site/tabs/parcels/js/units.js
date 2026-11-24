// Areas: the cadastre gives `contenance` in square metres; French land
// practice writes it in hectares, ares and centiares. Pure, unit-tested.
//
//   1 ha = 10 000 m²
//   1 a  =    100 m²
//   1 ca =      1 m²

/** Split square metres into whole hectares, ares and centiares. */
export function splitArea(value) {
  const n = Number(value);
  const total = Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
  return {
    total,
    ha: Math.floor(total / 10000),
    a: Math.floor((total % 10000) / 100),
    ca: total % 100,
  };
}

/** "3 ha 20 a 50 ca"; 0 m² gives "0 ha 00 a 00 ca"; a missing area gives "–". */
export function formatHaCa(value) {
  if (value === null || value === undefined || value === '') return '–';
  const n = Number(value);
  if (!Number.isFinite(n)) return '–';
  const { ha, a, ca } = splitArea(n);
  return `${ha} ha ${String(a).padStart(2, '0')} a ${String(ca).padStart(2, '0')} ca`;
}

/** Square metres with the locale's thousands separator; "–" when missing. */
export function formatM2(value, lang = 'en') {
  if (value === null || value === undefined || value === '') return '–';
  const n = Number(value);
  if (!Number.isFinite(n)) return '–';
  return new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-GB', {
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  }).format(Math.round(n));
}

/** Sum the `contenance` of features, counting those without one. */
export function sumContenances(features) {
  let total = 0;
  let missing = 0;
  for (const feature of features ?? []) {
    const value = feature?.properties?.contenance;
    if (value === null || value === undefined || value === '') {
      missing += 1;
      continue;
    }
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0) total += Math.round(n);
    else missing += 1;
  }
  return { total, missing };
}
