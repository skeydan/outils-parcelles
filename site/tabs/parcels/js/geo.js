// Pure map helpers: a bounding box for GeoJSON and a distinct colour per
// parcel. No Leaflet here, so they run in Node and are unit-tested.

export const PARCEL_PALETTE = [
  '#1f78b4', // blue
  '#e31a1c', // red
  '#33a02c', // green
  '#ff7f00', // orange
  '#6a3d9a', // purple
  '#b15928', // brown
  '#00838f', // teal
  '#c2185b', // magenta
  '#5d4037', // dark brown
  '#3949ab', // indigo
  '#f9a825', // amber
  '#8e24aa', // violet
  '#00897b', // green-teal
  '#d81b60', // pink
  '#546e7a', // blue-grey
  '#afb42b', // olive
];

/**
 * A distinct colour for the i-th parcel. The first sixteen colours are a
 * fixed palette; after that, a golden-angle hue keeps neighbours apart.
 */
export function parcelColor(i) {
  const n = Math.max(0, Math.trunc(Number(i) || 0));
  if (n < PARCEL_PALETTE.length) return PARCEL_PALETTE[n];
  return `hsl(${Math.round((n * 137.508) % 360)} 65% 40%)`;
}

function walkCoords(coords, visit) {
  if (!Array.isArray(coords)) return;
  if (typeof coords[0] === 'number') {
    visit(coords);
    return;
  }
  for (const part of coords) walkCoords(part, visit);
}

/**
 * Bounding box of a FeatureCollection (or Feature) as Leaflet bounds,
 * [[south, west], [north, east]], or null when there is no geometry.
 * GeoJSON positions are [longitude, latitude].
 */
export function bboxOfGeoJSON(input) {
  const features = input?.type === 'FeatureCollection'
    ? input.features ?? []
    : input?.type === 'Feature'
      ? [input]
      : [];
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const feature of features) {
    walkCoords(feature?.geometry?.coordinates, ([lng, lat]) => {
      if (!Number.isFinite(lng) || !Number.isFinite(lat)) return;
      if (lng < west) west = lng;
      if (lng > east) east = lng;
      if (lat < south) south = lat;
      if (lat > north) north = lat;
    });
  }
  if (!Number.isFinite(west) || !Number.isFinite(south)) return null;
  return [[south, west], [north, east]];
}
