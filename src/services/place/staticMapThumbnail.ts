import Constants from 'expo-constants';

const MAPBOX_TOKEN: string =
  (Constants.expoConfig?.extra?.mapboxAccessToken as string) ||
  (process.env.MAPBOX_ACCESS_TOKEN as string) ||
  '';

/** Return a static map centered on a place's coordinates, or an empty string
 * when Mapbox is not configured. */
export function staticMapThumbnail(latitude: number, longitude: number): string {
  if (!MAPBOX_TOKEN) return '';
  return (
    'https://api.mapbox.com/styles/v1/mapbox/streets-v12/static/' +
    `pin-s+3b82f6(${longitude},${latitude})/${longitude},${latitude},14,0/200x200@2x` +
    `?access_token=${MAPBOX_TOKEN}`
  );
}
