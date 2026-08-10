/**
 * Place search as a hook: one Mapbox session, debounced queries, and the
 * outcome each picked suggestion settles into once it has been saved.
 *
 * This is the one React module under `services/`. It lives here rather than
 * beside a screen because the search *session* is the thing being owned, and
 * two features now need it: Mapbox bills a session rather than the keystrokes,
 * so the token has to outlive every request in a typing burst and be dropped
 * when that burst ends. `placeSearchService`'s stateless functions cannot hold
 * that lifetime; a component can, and copying the discipline into each
 * consumer is how one of the copies quietly starts billing per keystroke.
 *
 * Deliberately takes `proximity` and `onSaved` as arguments instead of reading
 * `HomeContext` itself — a service that imports a feature inverts the
 * dependency the rest of `services/` keeps.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { PlaceSaveOutcome } from '@/types/place';
import type { PlaceSuggestion } from '@/types/route';

import {
  createSearchSession,
  isAbortError,
  MIN_QUERY_LENGTH,
  resolvePlace,
  suggestPlaces,
} from './placeSearchService';
import { isSameProviderPlace, savePlaces, type SavedPlace } from './placeService';

/** Long enough that a normal typing burst is one request, short enough that
    the list still feels live. */
const DEBOUNCE_MS = 300;

export type PlaceSearchStatus = 'idle' | 'searching' | 'ready' | 'error';

export type UsePlaceSearchOptions = {
  /** Biases suggestions toward the user; pass `useHome().userLocation`. */
  proximity?: [number, number];
  /** Awaited after a save or dedup match, before the suggestion settles. */
  onSaved?: () => void | Promise<void>;
  /** Marks suggestions already in My Places before the user taps them. */
  savedPlaces?: SavedPlace[];
};

export type UsePlaceSearchResult = {
  query: string;
  setQuery: (query: string) => void;
  suggestions: PlaceSuggestion[];
  status: PlaceSearchStatus;
  /** `external_id` of the suggestion currently being resolved and saved. */
  savingId: string | null;
  /** What this suggestion's row should show: what a tap did, or, before any
      tap, `'duplicate'` if `savedPlaces` already contains it. */
  outcomeFor: (suggestion: PlaceSuggestion) => PlaceSaveOutcome | null;
  pick: (suggestion: PlaceSuggestion) => Promise<void>;
  /** Clears the query, results, and outcomes, and starts a new billing
      session. Call it when the surface holding this hook stops being a live
      typing session but stays mounted. */
  reset: () => void;
};

export function usePlaceSearch({
  proximity,
  onSaved,
  savedPlaces,
}: UsePlaceSearchOptions = {}): UsePlaceSearchResult {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<PlaceSuggestion[]>([]);
  const [status, setStatus] = useState<PlaceSearchStatus>('idle');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [outcomes, setOutcomes] = useState<Record<string, PlaceSaveOutcome>>({});

  // One token for this hook's whole lifetime. Every keystroke and the final
  // retrieve must share it; mounting a new consumer is what starts a new
  // session.
  const sessionRef = useRef<string>(createSearchSession());
  const inFlightRef = useRef<AbortController | null>(null);

  const trimmed = query.trim();

  useEffect(() => {
    if (trimmed.length < MIN_QUERY_LENGTH) {
      inFlightRef.current?.abort();
      setSuggestions([]);
      setStatus('idle');
      return;
    }

    setStatus('searching');
    const timer = setTimeout(async () => {
      // Cancel whatever the previous keystroke started: its results are stale
      // and could otherwise land after these ones.
      inFlightRef.current?.abort();
      const controller = new AbortController();
      inFlightRef.current = controller;

      try {
        const results = await suggestPlaces(
          trimmed,
          sessionRef.current,
          { proximity },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        setSuggestions(results);
        setStatus('ready');
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) return;
        console.warn('[usePlaceSearch] search failed:', error);
        setSuggestions([]);
        setStatus('error');
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [trimmed, proximity]);

  useEffect(() => () => inFlightRef.current?.abort(), []);

  const pick = useCallback(
    async (suggestion: PlaceSuggestion) => {
      setSavingId(suggestion.external_id);
      try {
        const place = await resolvePlace(suggestion, sessionRef.current);
        if (!place) throw new Error('Suggestion resolved to no place');
        // An empty `inserted` means the dedup matched something already saved —
        // the tap succeeded but created nothing, so don't claim it did.
        const { inserted } = await savePlaces([place]);
        await onSaved?.();
        setOutcomes((current) => ({
          ...current,
          [suggestion.external_id]: inserted.length > 0 ? 'saved' : 'duplicate',
        }));
      } catch (error) {
        console.warn('[usePlaceSearch] save failed:', error);
      } finally {
        setSavingId(null);
      }
    },
    [onSaved],
  );

  const outcomeFor = useCallback(
    (suggestion: PlaceSuggestion): PlaceSaveOutcome | null => {
      const settled = outcomes[suggestion.external_id];
      if (settled) return settled;
      if (!savedPlaces?.length) return null;
      // Suggestions have no coordinates, so the provider id is the only half of
      // place identity available here. It misses saved places that carry no id
      // — imports don't set one — which is why this only ever adds a
      // 'duplicate' hint and never suppresses a save: savePlaces()'s full
      // dedup still has the last word on tap.
      const identity = {
        externalId: suggestion.external_id,
        externalSource: suggestion.source,
      };
      return savedPlaces.some((saved) => isSameProviderPlace(identity, saved))
        ? 'duplicate'
        : null;
    },
    [outcomes, savedPlaces],
  );

  const reset = useCallback(() => {
    inFlightRef.current?.abort();
    sessionRef.current = createSearchSession();
    setQuery('');
    setSuggestions([]);
    setStatus('idle');
    setSavingId(null);
    setOutcomes({});
  }, []);

  return { query, setQuery, suggestions, status, savingId, outcomeFor, pick, reset };
}
