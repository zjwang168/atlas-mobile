function normalizeLabel(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9\s]/g, '').replace(/\s+/g, ' ');
}

function normalizeStableCategory(value?: string | null): string {
  const normalized = normalizeLabel(value || '');
  return normalized === 'place' ? '' : normalized;
}

export function buildPlaceStableKey(place: {
  name: string;
  latitude: number;
  longitude: number;
  category?: string | null;
}): string {
  return [
    normalizeLabel(place.name || ''),
    normalizeStableCategory(place.category || ''),
    place.latitude.toFixed(5),
    place.longitude.toFixed(5),
  ].filter(Boolean).join('|');
}
