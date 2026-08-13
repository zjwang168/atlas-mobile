import type { MapMarker } from './MapboxMap';

export type MapBounds = { ne: [number, number]; sw: [number, number] };

export type AtlasCameraPresentation = {
  markers: MapMarker[];
  centerCoordinate: [number, number];
  /** Stable overview zoom derived from the orange-pin footprint. */
  zoomLevel: number;
  bounds: MapBounds;
};

type AtlasStop = {
  id: string;
  latitude: number;
  longitude: number;
  title?: string;
  description?: string;
};

export function atlasBoundsFromCoordinates(coordinates: ReadonlyArray<[number, number]>): MapBounds | undefined {
  const valid = coordinates.filter(([longitude, latitude]) => (
    Number.isFinite(longitude)
    && Number.isFinite(latitude)
    && longitude >= -180
    && longitude <= 180
    && latitude >= -90
    && latitude <= 90
  ));
  if (!valid.length) return undefined;

  const longitudes = valid.map(([longitude]) => longitude);
  const latitudes = valid.map(([, latitude]) => latitude);
  const minimumLongitude = Math.min(...longitudes);
  const maximumLongitude = Math.max(...longitudes);
  const minimumLatitude = Math.min(...latitudes);
  const maximumLatitude = Math.max(...latitudes);
  const longitudePadding = Math.max(0.025, (maximumLongitude - minimumLongitude) * 0.16);
  const latitudePadding = Math.max(0.02, (maximumLatitude - minimumLatitude) * 0.16);

  return {
    ne: [maximumLongitude + longitudePadding, maximumLatitude + latitudePadding],
    sw: [minimumLongitude - longitudePadding, minimumLatitude - latitudePadding],
  };
}

export function atlasCameraFromStops(stops: ReadonlyArray<AtlasStop>): AtlasCameraPresentation | undefined {
  const bounds = atlasBoundsFromCoordinates(stops.map((stop) => [stop.longitude, stop.latitude]));
  if (!bounds) return undefined;

  const longitudeSpan = Math.max(0.00001, bounds.ne[0] - bounds.sw[0]);
  const latitudeSpan = Math.max(0.00001, bounds.ne[1] - bounds.sw[1]);
  // Leave practical room around the pins for the completed Atlas sheet. This
  // is deliberately independent of the sheet's first layout callback, which
  // can briefly report an unusable viewport to native Mapbox.
  // Keep the full orange-pin footprint visible, but avoid the loose
  // continent-scale framing that makes a city Atlas read as one tiny cluster.
  const zoomLevel = Math.max(3, Math.min(16, Math.log2(360 / Math.max(longitudeSpan, latitudeSpan)) - 0.3));

  return {
    markers: stops.map((stop, index) => ({
      id: stop.id,
      latitude: stop.latitude,
      longitude: stop.longitude,
      title: stop.title,
      description: stop.description,
      tone: 'atlas',
      order: index + 1,
    })),
    centerCoordinate: [
      (bounds.ne[0] + bounds.sw[0]) / 2,
      (bounds.ne[1] + bounds.sw[1]) / 2,
    ],
    zoomLevel,
    bounds,
  };
}
