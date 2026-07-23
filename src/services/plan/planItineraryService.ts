/**
 * Persistence for a plan's places — `plan_itinerary_place_flexible` (flexible,
 * unscheduled) and `plan_itinerary_days` + `plan_itinerary_places` (scheduled
 * onto a day + visit slot). Online-first, no offline write-queue yet. A place
 * only ever lands in one of the two: flexible places are written to
 * `plan_itinerary_place_flexible` only, scheduled places to
 * `plan_itinerary_places` only — there's no row-level link between them.
 */

import type { PlanItineraryDayRow, PlanItineraryPlaceFlexibleRow, PlanItineraryPlaceRow, VisitSlot } from '@/types/plan';
import { withTimeout } from '../local/syncQueue';
import { supabase } from '../supabase/supabaseClient';
import {
  PLAN_ITINERARY_DAYS_SELECT_COLUMNS,
  PLAN_ITINERARY_PLACES_SELECT_COLUMNS,
  PLAN_ITINERARY_PLACE_FLEXIBLE_SELECT_COLUMNS,
} from './planShared';

/** Fetch every `plan_itinerary_place_flexible` row (the flexible list) for a plan. */
export async function fetchFlexiblePlaces(planId: string): Promise<PlanItineraryPlaceFlexibleRow[]> {
  const { data, error } = await supabase
    .from('plan_itinerary_place_flexible')
    .select(PLAN_ITINERARY_PLACE_FLEXIBLE_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .order('created_at', { ascending: true });
  if (error) throw new Error(`Failed to fetch flexible places: ${error.message}`);
  return (data ?? []) as PlanItineraryPlaceFlexibleRow[];
}

/** Add places to a plan's flexible list. The same place id may be added more than once. */
export async function addFlexiblePlaces(planId: string, placeIds: string[]): Promise<PlanItineraryPlaceFlexibleRow[]> {
  if (placeIds.length === 0) return [];
  const rows = placeIds.map((placeId) => ({ plan_id: planId, place_id: placeId }));
  const { data, error } = await withTimeout(
    supabase.from('plan_itinerary_place_flexible').insert(rows).select(PLAN_ITINERARY_PLACE_FLEXIBLE_SELECT_COLUMNS),
    'Adding places to plan timed out',
  );
  if (error) throw new Error(`Failed to add places to plan: ${error.message}`);
  return (data ?? []) as PlanItineraryPlaceFlexibleRow[];
}

/** Remove a place from a plan's flexible list — deletes the `plan_itinerary_place_flexible` row only. */
export async function removeFlexiblePlace(joinRowId: string): Promise<void> {
  const { error } = await withTimeout(
    supabase.from('plan_itinerary_place_flexible').delete().eq('id', joinRowId),
    'Removing place from plan timed out',
  );
  if (error) throw new Error(`Failed to remove place from plan: ${error.message}`);
}

/** Fetch a plan's full day-by-day itinerary, days sorted by date, places sorted by their slot order. */
export async function fetchPlanItinerary(planId: string): Promise<{ day: PlanItineraryDayRow; items: PlanItineraryPlaceRow[] }[]> {
  const { data: days, error: daysError } = await supabase
    .from('plan_itinerary_days')
    .select(PLAN_ITINERARY_DAYS_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .order('date', { ascending: true });
  if (daysError) throw new Error(`Failed to fetch itinerary days: ${daysError.message}`);
  const dayRows = (days ?? []) as PlanItineraryDayRow[];
  if (dayRows.length === 0) return [];

  const dayIds = dayRows.map((day) => day.id);
  const { data: items, error: itemsError } = await supabase
    .from('plan_itinerary_places')
    .select(PLAN_ITINERARY_PLACES_SELECT_COLUMNS)
    .in('itinerary_day_id', dayIds)
    .order('sort_order', { ascending: true });
  if (itemsError) throw new Error(`Failed to fetch itinerary places: ${itemsError.message}`);
  const itemRows = (items ?? []) as PlanItineraryPlaceRow[];

  return dayRows.map((day) => ({
    day,
    items: itemRows.filter((item) => item.itinerary_day_id === day.id),
  }));
}

/** Find (or create) the `plan_itinerary_days` row for a plan + date. Exported
    so callers scheduling multiple places on the same date (e.g. `savePlan.ts`)
    can resolve the day once and reuse it via `addScheduledPlaceToDay`, rather
    than re-resolving it (and re-running its lookup query) per place. */
export async function ensurePlanItineraryDay(planId: string, date: string, sortOrder: number): Promise<PlanItineraryDayRow> {
  const { data: existing, error: findError } = await supabase
    .from('plan_itinerary_days')
    .select(PLAN_ITINERARY_DAYS_SELECT_COLUMNS)
    .eq('plan_id', planId)
    .eq('date', date)
    .maybeSingle();
  if (findError) throw new Error(`Failed to look up itinerary day: ${findError.message}`);
  if (existing) return existing as PlanItineraryDayRow;

  const { data, error } = await withTimeout(
    supabase
      .from('plan_itinerary_days')
      .insert({ plan_id: planId, date, sort_order: sortOrder })
      .select(PLAN_ITINERARY_DAYS_SELECT_COLUMNS)
      .single(),
    'Creating itinerary day timed out',
  );
  if (error) throw new Error(`Failed to create itinerary day: ${error.message}`);
  return data as PlanItineraryDayRow;
}

/** Schedule a place onto an already-resolved `plan_itinerary_days` row + visit slot. */
export async function addScheduledPlaceToDay(
  dayId: string,
  placeId: string,
  visitSlot: VisitSlot,
  sortOrder: number,
): Promise<PlanItineraryPlaceRow> {
  const { data, error } = await withTimeout(
    supabase
      .from('plan_itinerary_places')
      .insert({ itinerary_day_id: dayId, place_id: placeId, visit_slot: visitSlot, sort_order: sortOrder })
      .select(PLAN_ITINERARY_PLACES_SELECT_COLUMNS)
      .single(),
    'Scheduling place timed out',
  );
  if (error) throw new Error(`Failed to schedule place: ${error.message}`);
  return data as PlanItineraryPlaceRow;
}

/** Remove a scheduled place — deletes the `plan_itinerary_places` row only. */
export async function removeScheduledPlace(itemId: string): Promise<void> {
  const { error } = await withTimeout(
    supabase.from('plan_itinerary_places').delete().eq('id', itemId),
    'Removing scheduled place timed out',
  );
  if (error) throw new Error(`Failed to remove scheduled place: ${error.message}`);
}

export type PlanSummary = {
  placeCount: number;
  /** The place_id of the earliest-added place across both tables (flexible or scheduled) — used as the grid card's default cover. */
  coverPlaceId: string | null;
};

/**
 * Batch-fetch a lightweight place-count + cover-candidate summary for many
 * plans at once (for the `MyPlan` grid) — three queries total regardless of
 * plan count, rather than one round-trip per plan.
 */
export async function fetchPlanSummaries(planIds: string[]): Promise<Record<string, PlanSummary>> {
  if (planIds.length === 0) return {};

  const [{ data: flexRows, error: flexError }, { data: dayRows, error: dayError }] = await Promise.all([
    supabase.from('plan_itinerary_place_flexible').select('plan_id, place_id, created_at').in('plan_id', planIds),
    supabase.from('plan_itinerary_days').select('id, plan_id').in('plan_id', planIds),
  ]);
  if (flexError) throw new Error(`Failed to fetch flexible place summaries: ${flexError.message}`);
  if (dayError) throw new Error(`Failed to fetch itinerary day summaries: ${dayError.message}`);

  const dayToPlan = new Map((dayRows ?? []).map((day) => [day.id as string, day.plan_id as string]));
  const dayIds = [...dayToPlan.keys()];

  let itemRows: { itinerary_day_id: string; place_id: string; created_at: string }[] = [];
  if (dayIds.length > 0) {
    const { data, error } = await supabase
      .from('plan_itinerary_places')
      .select('itinerary_day_id, place_id, created_at')
      .in('itinerary_day_id', dayIds);
    if (error) throw new Error(`Failed to fetch scheduled place summaries: ${error.message}`);
    itemRows = data ?? [];
  }

  const byPlan = new Map<string, { placeId: string; createdAt: string }[]>();
  const push = (planId: string, placeId: string, createdAt: string) => {
    const list = byPlan.get(planId) ?? [];
    list.push({ placeId, createdAt });
    byPlan.set(planId, list);
  };
  for (const row of flexRows ?? []) push(row.plan_id, row.place_id, row.created_at);
  for (const row of itemRows) {
    const planId = dayToPlan.get(row.itinerary_day_id);
    if (planId) push(planId, row.place_id, row.created_at);
  }

  const summaries: Record<string, PlanSummary> = {};
  for (const planId of planIds) {
    const entries = (byPlan.get(planId) ?? []).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    summaries[planId] = { placeCount: entries.length, coverPlaceId: entries[0]?.placeId ?? null };
  }
  return summaries;
}
