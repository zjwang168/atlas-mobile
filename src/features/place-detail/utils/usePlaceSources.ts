import { useEffect, useState } from 'react';

import { fetchPlaceSources, type PlaceSource } from '../../../services/place/placeService';

/**
 * Every recorded origin for a place, newest first — the posts it was parsed
 * out of, each with that post's own AI summary.
 *
 * Starts empty and fills in when the read lands, so a section rendering these
 * should treat `[]` as "nothing to show" rather than "still loading":
 * `fetchPlaceSources` never throws and returns `[]` for a place that genuinely
 * has no provenance, which is the common case for anything saved before it was
 * recorded.
 */
export function usePlaceSources(placeId: string | null): PlaceSource[] {
  const [sources, setSources] = useState<PlaceSource[]>([]);

  useEffect(() => {
    if (!placeId) {
      setSources([]);
      return;
    }
    // Clear first: without this the previous place's sources stay on screen
    // under the new place's name until the next read resolves.
    setSources([]);
    let cancelled = false;
    fetchPlaceSources(placeId)
      .then((rows) => {
        if (!cancelled) setSources(rows);
      })
      .catch((error) => console.warn('[usePlaceSources] load failed:', error));
    return () => {
      cancelled = true;
    };
  }, [placeId]);

  return sources;
}
