import type { SavedPlace } from '@/services/place/placeService';
import { FOCUS_SAVED_PLACES_RADIUS_KM, PLANNING_HOURS } from './constants';
import type { DraftPlace, FocusArea } from './types';

export const normalize = (value: string) => value.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
export const timeRank = (day: number, time: string) => day * 24 + Math.max(0, PLANNING_HOURS.indexOf(time) + 7);
export const timeOfDayRank = (time: string) => Math.max(0, PLANNING_HOURS.indexOf(time));

// Let the editor commit its initial UI and Mapbox markers before kicking off
// location services or recommendation work on the native/JS bridge.
export const waitForFirstAtlasPaint = () => new Promise<void>((resolve) => {
  requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
});

export function boundsFromPolygon(polygon: Array<[number, number]>, padding = 0.06) {
  const minLng = Math.min(...polygon.map(([lng]) => lng));
  const maxLng = Math.max(...polygon.map(([lng]) => lng));
  const minLat = Math.min(...polygon.map(([, lat]) => lat));
  const maxLat = Math.max(...polygon.map(([, lat]) => lat));
  return { ne: [maxLng + padding, maxLat + padding] as [number, number], sw: [minLng - padding, minLat - padding] as [number, number] };
}

export function boundsFromRadius([longitude, latitude]: [number, number], radiusKm: number) {
  const latitudeRadius = radiusKm / 110.574;
  const longitudeRadius = radiusKm / Math.max(0.01, 111.320 * Math.cos((latitude * Math.PI) / 180));
  return {
    ne: [longitude + longitudeRadius, latitude + latitudeRadius] as [number, number],
    sw: [longitude - longitudeRadius, latitude - latitudeRadius] as [number, number],
  };
}

export function expandBounds(bounds: { ne: [number, number]; sw: [number, number] }, fraction = 0.1) {
  const longitudeSpan = Math.max(0.05, Math.abs(bounds.ne[0] - bounds.sw[0]));
  const latitudeSpan = Math.max(0.05, Math.abs(bounds.ne[1] - bounds.sw[1]));
  return {
    ne: [Math.min(180, bounds.ne[0] + longitudeSpan * fraction), Math.min(85, bounds.ne[1] + latitudeSpan * fraction)] as [number, number],
    sw: [Math.max(-180, bounds.sw[0] - longitudeSpan * fraction), Math.max(-85, bounds.sw[1] - latitudeSpan * fraction)] as [number, number],
  };
}

export function zoomForBounds(bounds: { ne: [number, number]; sw: [number, number] }, minimumZoom = 1.9) {
  const longitudeSpan = Math.max(0.05, Math.abs(bounds.ne[0] - bounds.sw[0]));
  const latitudeSpan = Math.max(0.05, Math.abs(bounds.ne[1] - bounds.sw[1]));
  const widthZoom = Math.log2((360 * 390) / (512 * longitudeSpan));
  const heightZoom = Math.log2((170 * 360) / (512 * latitudeSpan));
  return Math.max(minimumZoom, Math.min(14, Math.min(widthZoom, heightZoom) - 0.25));
}

export function acceptAiDescription(value?: string | null) {
  const description = value?.trim();
  if (!description || description.split(/\s+/).length > 4) return null;
  return description;
}

export function isLocalMatch(place: SavedPlace, query: string) {
  const terms = normalize(query).split(' ').filter(Boolean);
  if (!terms.length) return false;
  const haystack = normalize([place.name, place.subtitle, place.city, place.region, place.country].filter(Boolean).join(' '));
  if (terms.length > 1) return haystack.includes(terms.join(' '));
  return haystack.split(' ').some((word) => word === terms[0] || (terms[0].length >= 3 && word.startsWith(terms[0])));
}

export function isNearCoordinate(place: { latitude: number; longitude: number }, center: [number, number]) {
  const toRadians = (degrees: number) => (degrees * Math.PI) / 180;
  const latitudeDelta = toRadians(place.latitude - center[1]);
  const longitudeDelta = toRadians(place.longitude - center[0]);
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(toRadians(center[1])) * Math.cos(toRadians(place.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  const distanceKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return distanceKm <= FOCUS_SAVED_PLACES_RADIUS_KM;
}

export function centerOfBounds(bounds: { ne: [number, number]; sw: [number, number] }): [number, number] {
  return [(bounds.ne[0] + bounds.sw[0]) / 2, (bounds.ne[1] + bounds.sw[1]) / 2];
}

export function focusBoundsForSavedPlaces(center: [number, number], places: Array<{ latitude: number; longitude: number }>) {
  const coordinates = [center, ...places.map((place) => [place.longitude, place.latitude] as [number, number])];
  const longitudeSpan = Math.max(...coordinates.map(([longitude]) => longitude)) - Math.min(...coordinates.map(([longitude]) => longitude));
  const latitudeSpan = Math.max(...coordinates.map(([, latitude]) => latitude)) - Math.min(...coordinates.map(([, latitude]) => latitude));
  // The breathing room grows with the true footprint. This keeps a local
  // collection useful while allowing country-scale collections to zoom out.
  const padding = Math.max(0.06, Math.min(3, Math.max(longitudeSpan, latitudeSpan) * 0.12));
  return boundsFromPolygon(coordinates, padding);
}

export function uniquePlaces(places: SavedPlace[]) {
  return [...new Map(places.map((place) => [place.id, place])).values()];
}

export function clusterLocationNames(places: SavedPlace[]) {
  return new Set(
    places.map((place) => normalize(place.city ?? place.region ?? place.country ?? '')).filter(Boolean),
  );
}

export function savedPlacesMatchingAdministrativeFocus(place: DraftPlace, savedPlaces: SavedPlace[], featureType?: string) {
  const administrativeField = featureType === 'country' ? 'country' : 'region';
  const focusTerm = normalize(
    administrativeField === 'country'
      ? place.country ?? place.name
      : place.region ?? place.name,
  );
  if (!focusTerm) return [];
  return savedPlaces.filter((savedPlace) => (
    normalize(savedPlace[administrativeField] ?? '') === focusTerm
  ));
}

export function isWithinBounds(place: { latitude: number; longitude: number }, bounds?: { ne: [number, number]; sw: [number, number] }) {
  if (!bounds) return true;
  const [east, north] = bounds.ne;
  const [west, south] = bounds.sw;
  const withinLatitude = place.latitude >= south && place.latitude <= north;
  const withinLongitude = west <= east
    ? place.longitude >= west && place.longitude <= east
    : place.longitude >= west || place.longitude <= east;
  return withinLatitude && withinLongitude;
}

export function isMarkerOverlap(a: { latitude: number; longitude: number }, b: { latitude: number; longitude: number }) {
  const latitudeDistance = (a.latitude - b.latitude) * 111_320;
  const longitudeDistance = (a.longitude - b.longitude) * 111_320 * Math.cos((a.latitude + b.latitude) * Math.PI / 360);
  return Math.hypot(latitudeDistance, longitudeDistance) < 48;
}

export function deriveFocusAreas(places: SavedPlace[]): FocusArea[] {
  const areas = new Map<string, SavedPlace[]>();
  places.forEach((place) => {
    const label = [place.city, place.region, place.country].find((value) => value?.trim());
    if (!label) return;
    const key = normalize(label);
    areas.set(key, [...(areas.get(key) ?? []), place]);
  });
  return [...areas.values()]
    .map((group) => {
      const first = group[0];
      const scope: FocusArea['scope'] = first.city?.trim() ? 'city' : first.region?.trim() ? 'region' : 'country';
      const coordinate: [number, number] = [
        group.reduce((sum, place) => sum + place.longitude, 0) / group.length,
        group.reduce((sum, place) => sum + place.latitude, 0) / group.length,
      ];
      return {
        label: first.city || first.region || first.country || '',
        scope,
        photoUrl: group.find((place) => Boolean(place.photo_url))?.photo_url,
        places: group,
        coordinate,
        count: group.length,
        bounds: focusBoundsForSavedPlaces(coordinate, group),
      };
    })
    .filter((area) => Boolean(area.label))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

export function buildAtlasTitle(items: DraftPlace[]) {
  const categories = items.map((item) => normalize(item.category ?? item.name)).join(' ');
  const location = items.find((item) => item.city || item.region || item.country);
  const place = location?.city ?? location?.region ?? location?.country ?? items[0]?.name ?? 'Your Atlas';
  const slogan = /museum|gallery|art/.test(categories)
    ? 'Art Around Every Corner'
    : /park|trail|garden|nature/.test(categories)
      ? 'Wild At Heart'
      : /restaurant|cafe|food|bakery/.test(categories)
        ? 'Taste The Town'
        : 'Made To Wander';
  return `${place}: ${slogan}`;
}
