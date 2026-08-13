/**
 * Fetches and filters the Discover browse list.
 *
 * Split of work between server and client is deliberate. The **timeframe**
 * refetches, because deciding whether a season-long festival is on this
 * weekend needs the curated layer's annual windows, which only the backend
 * has. **Category and sort** are applied here, so those two filters are
 * instant and cost no request.
 *
 * Farmers markets are the exception the UI has to live with: USDA publishes no
 * opening hours by any route, so a market has no date to test and appears
 * under every timeframe. Narrowing to a category other than `market` is the
 * way past it.
 */

import {
  fetchEvents,
  isAbortError,
  isEmptyAwayFromCoverage,
  failedSources,
} from '@/services/events/eventsService';
import type { EventCategory, LocalEvent } from '@/types/event';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type EventTimeframe = 'weekend' | 'week' | 'month';
export type EventsStatus = 'idle' | 'loading' | 'ready' | 'error';

/** Asked for generously: filters run on the client, so the list is only as
    good as what one request brought back. */
const FETCH_LIMIT = 200;

/** How many cards the featured strip shows before it stops being a highlight. */
const MAX_FEATURED = 8;

function windowDaysFor(timeframe: EventTimeframe): number {
  if (timeframe === 'week') return 7;
  if (timeframe === 'month') return 30;
  // "This weekend" means through the end of Sunday. On a Sunday that is today,
  // so the window never collapses to nothing.
  const day = new Date().getDay();
  return Math.max(1, 7 - day);
}

type Options = {
  /** `[lng, lat]`, straight from `HomeContext.userLocation`. */
  coordinate: [number, number];
  /** The pane is kept mounted while hidden; nothing is fetched until visible. */
  active: boolean;
};

export function useLocalEvents({ coordinate, active }: Options) {
  const [status, setStatus] = useState<EventsStatus>('idle');
  const [allEvents, setAllEvents] = useState<LocalEvent[]>([]);
  const [outOfCoverage, setOutOfCoverage] = useState(false);
  const [degradedSources, setDegradedSources] = useState<string[]>([]);

  const [timeframe, setTimeframe] = useState<EventTimeframe>('month');
  const [category, setCategory] = useState<'all' | EventCategory>('all');
  const [sortMode, setSortMode] = useState<'distance' | 'soonest'>('distance');

  const abortRef = useRef<AbortController | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const [lng, lat] = coordinate;

  useEffect(() => {
    if (!active) return;

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus('loading');
    fetchEvents(
      {
        coordinate: [lng, lat],
        windowDays: windowDaysFor(timeframe),
        limit: FETCH_LIMIT,
      },
      controller.signal,
    )
      .then((result) => {
        if (controller.signal.aborted) return;
        setAllEvents(result.events);
        setOutOfCoverage(isEmptyAwayFromCoverage(result));
        setDegradedSources(failedSources(result));
        setStatus('ready');
      })
      .catch((error) => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setStatus('error');
      });

    return () => controller.abort();
    // `coordinate` is destructured so a new array with the same numbers does
    // not refetch — HomeContext hands out a fresh tuple on every render.
  }, [active, lng, lat, timeframe, reloadToken]);

  const reload = useCallback(() => setReloadToken((n) => n + 1), []);

  const events = useMemo(() => {
    const filtered =
      category === 'all'
        ? allEvents
        : allEvents.filter((event) => event.category === category);

    if (sortMode === 'soonest') {
      // Undated rows sort last rather than being dropped: "every Saturday" is
      // less urgent than "this Friday" but still worth showing.
      return [...filtered].sort((a, b) => {
        if (!a.starts_at && !b.starts_at) return a.distance_km - b.distance_km;
        if (!a.starts_at) return 1;
        if (!b.starts_at) return -1;
        return a.starts_at.localeCompare(b.starts_at);
      });
    }
    return [...filtered].sort((a, b) => a.distance_km - b.distance_km);
  }, [allEvents, category, sortMode]);

  /**
   * Signature events, pulled out for the strip. They stay in `events` too —
   * the strip is a shortcut to them, not a separate section of the feed.
   *
   * Curated entries lead regardless of distance. Both layers set `featured`,
   * but they do not mean the same thing: the curated flag is a deliberate
   * "this is why you would plan a weekend around it", while NPS marks a third
   * of its feed `Special Event`, routine ranger talks included. Sorting on
   * distance alone would bury the Renaissance Festival under them.
   */
  const featured = useMemo(
    () =>
      events
        .filter((event) => event.featured)
        .sort((a, b) => {
          const curatedFirst =
            Number(b.source === 'curated') - Number(a.source === 'curated');
          return curatedFirst || a.distance_km - b.distance_km;
        })
        .slice(0, MAX_FEATURED),
    [events],
  );

  return {
    status,
    events,
    featured,
    outOfCoverage,
    degradedSources,
    timeframe,
    setTimeframe,
    category,
    setCategory,
    sortMode,
    setSortMode,
    reload,
  };
}
