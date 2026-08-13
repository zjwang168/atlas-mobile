/**
 * savePlan.ts — plan persistence service
 *
 * All writes go through savePlan(); all reads through findSavedPlan().
 * Backed by the real `plans` / `plan_itinerary_place_flexible` /
 * `plan_itinerary_days` / `plan_itinerary_places` Supabase tables via
 * `services/plan/planService.ts` and `services/plan/planItineraryService.ts`
 * — this module just adapts between the wizard's `PlacesState` shape and
 * those DB-row-shaped services.
 */

import { fetchSavedPlaces, resolvePlaceThumbnail, type SavedPlace } from '../../../services/place/placeService';
import {
  addFlexiblePlaces,
  addScheduledPlaceToDay,
  ensurePlanItineraryDay,
  fetchFlexiblePlaces,
  fetchPlanItinerary,
  fetchPlanSummaries,
} from '../../../services/plan/planItineraryService';
import { createPlan, deletePlan, fetchPlans, findPlan } from '../../../services/plan/planService';
import type { DateRange } from './createPlanState';
import { enumerateDates } from './plan-place/utils';
import type { PlacesState, PlannedPlace } from './plan-place/types';

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export type PlanInput = {
  location: string;
  range: DateRange;
  places: PlacesState;
};

export type PlanDateSlot = {
  date: string; // 'YYYY-MM-DD'
  places: PlannedPlace[];
};

export type SavedPlan = {
  id: string;
  title: string;
  location: string;
  dateRange: DateRange;
  placeCount: number;
  imageUrl?: string;
  freePlaces: PlannedPlace[];
  schedule: PlanDateSlot[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Resolve place_id -> display fields from the user's real saved places (offline-first cache). */
async function fetchPlaceLookup(): Promise<Map<string, SavedPlace>> {
  const saved = await fetchSavedPlaces();
  return new Map(saved.map((place) => [place.id, place]));
}

function toPlannedPlace(instanceId: string, placeId: string, lookup: Map<string, SavedPlace>): PlannedPlace {
  const place = lookup.get(placeId);
  return {
    id: instanceId,
    placeId,
    name: place?.name ?? 'Unknown place',
    subtitle: place?.subtitle ?? '',
    // No static-map fallback here, unlike the plan cover below: a plan place is
    // rendered by FlexiblePlaceCard, which draws a PlaceCover when there is no
    // image. Leaving the fallback on would make the same place look different
    // depending on whether it arrived through this path or PlanPlace's.
    imageUrl: place ? resolvePlaceThumbnail(place, { fallback: 'none' }) || undefined : undefined,
    category: place?.category ?? undefined,
  };
}

async function buildSavedPlan(planId: string): Promise<SavedPlan | undefined> {
  const plan = await findPlan(planId);
  if (!plan) return undefined;

  const [flexibleRows, itinerary, lookup] = await Promise.all([
    fetchFlexiblePlaces(planId),
    fetchPlanItinerary(planId),
    fetchPlaceLookup(),
  ]);

  const freePlaces = flexibleRows.map((row) => toPlannedPlace(row.id, row.place_id, lookup));
  const schedule: PlanDateSlot[] = itinerary.map(({ day, items }) => ({
    date: day.date,
    places: items.map((item) => ({
      ...toPlannedPlace(item.id, item.place_id, lookup),
      timeSlot: item.visit_slot ?? undefined,
    })),
  }));

  return {
    id: plan.id,
    title: plan.title,
    location: plan.destination ?? '',
    dateRange: { start: plan.start_date, end: plan.end_date },
    placeCount: freePlaces.length + schedule.reduce((acc, day) => acc + day.places.length, 0),
    imageUrl: plan.image_url ?? undefined,
    freePlaces,
    schedule,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Persist a new plan. Returns the saved plan with a generated id. */
export async function savePlan(input: PlanInput): Promise<SavedPlan> {
  const plan = await createPlan({
    title: input.location || 'Untitled Plan',
    destination: input.location || null,
    startDate: input.range.start,
    endDate: input.range.end,
  });

  if (input.places.free.length > 0) {
    await addFlexiblePlaces(plan.id, input.places.free.map((place) => place.placeId));
  }

  const dates = Object.keys(input.places.byDate).filter((date) => (input.places.byDate[date] ?? []).length > 0);
  const dateIndex = new Map(enumerateDates(input.range).map((date, index) => [date, index]));
  for (const date of dates) {
    const places = input.places.byDate[date] ?? [];
    const day = await ensurePlanItineraryDay(plan.id, date, dateIndex.get(date) ?? 0);
    let sortOrder = 0;
    for (const place of places) {
      await addScheduledPlaceToDay(day.id, place.placeId, place.timeSlot ?? 'morning', sortOrder++);
    }
  }

  const saved = await buildSavedPlan(plan.id);
  if (!saved) throw new Error(`Failed to load newly created plan ${plan.id}`);
  return saved;
}

/** Look up a saved plan by id. Returns undefined if not found. */
export async function findSavedPlan(id: string): Promise<SavedPlan | undefined> {
  return buildSavedPlan(id);
}

/** List saved plans for the MyPlan grid, with real place counts and a default cover image. */
export async function listSavedPlans(): Promise<SavedPlan[]> {
  const plans = await fetchPlans();
  if (plans.length === 0) return [];

  const [summaries, lookup] = await Promise.all([
    fetchPlanSummaries(plans.map((plan) => plan.id)),
    fetchPlaceLookup(),
  ]);

  return plans.map((plan) => {
    const summary = summaries[plan.id];
    // plan.image_url is an explicit cover the user set; fall back to the first
    // added place's thumbnail (real photo, or a generated Mapbox static-map
    // pin when the place has no photo — same fallback toPlaceDetail() uses)
    // when unset.
    const coverPlace = summary?.coverPlaceId ? lookup.get(summary.coverPlaceId) : undefined;
    const coverThumbnail = coverPlace ? resolvePlaceThumbnail(coverPlace) || undefined : undefined;
    return {
      id: plan.id,
      title: plan.title,
      location: plan.destination ?? '',
      dateRange: { start: plan.start_date, end: plan.end_date },
      placeCount: summary?.placeCount ?? 0,
      imageUrl: plan.image_url ?? coverThumbnail,
      freePlaces: [],
      schedule: [],
    };
  });
}

/** Delete a saved plan. */
export async function deleteSavedPlan(id: string): Promise<void> {
  await deletePlan(id);
}
