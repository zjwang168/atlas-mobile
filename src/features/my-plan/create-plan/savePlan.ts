/**
 * savePlan.ts — plan persistence service
 *
 * All writes go through savePlan(); all reads through findSavedPlan().
 * Swap the two implementations below for real API calls when the server is ready.
 */

import { mockPlans } from '../../../../mock-data/mockPlans';
import { LOCAL_CACHE_KEYS } from '../../../services/local/cacheKeys';
import { getCached, getCurrentUserId, setCached } from '../../../services/local/localStore';
import type { DateRange } from './CreatePlan';
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
// Local store (replace with server state when ready)
// ---------------------------------------------------------------------------

const seededPlans = new Map<string, SavedPlan>();

function generateId(): string {
  return `plan-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function countPlaces(places: PlacesState): number {
  const datedCount = Object.values(places.byDate).reduce((acc, arr) => acc + arr.length, 0);
  return places.free.length + datedCount;
}

function buildSchedule(byDate: PlacesState['byDate']): PlanDateSlot[] {
  return Object.entries(byDate)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, places]) => ({ date, places }))
    .filter((day) => day.places.length > 0);
}

async function readPlans(): Promise<SavedPlan[]> {
  const userId = await getCurrentUserId();
  const cached = userId ? await getCached<SavedPlan[]>(userId, LOCAL_CACHE_KEYS.plans) : null;
  const merged = new Map<string, SavedPlan>();
  for (const plan of seededPlans.values()) merged.set(plan.id, plan);
  for (const plan of cached ?? []) merged.set(plan.id, plan);
  return [...merged.values()];
}

async function writePlans(plans: SavedPlan[]): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) return;
  await setCached<SavedPlan[]>(userId, LOCAL_CACHE_KEYS.plans, plans);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Persist a new plan. Returns the saved plan with a generated id. */
export async function savePlan(input: PlanInput): Promise<SavedPlan> {
  const id = generateId();
  const plan: SavedPlan = {
    id,
    title: input.location || 'Untitled Plan',
    location: input.location,
    dateRange: input.range,
    placeCount: countPlaces(input.places),
    freePlaces: input.places.free,
    schedule: buildSchedule(input.places.byDate),
  };

  const plans = await readPlans();
  await writePlans([plan, ...plans.filter((existing) => existing.id !== id)]);

  // Keep the card list in sync
  mockPlans.push({ id, title: plan.title, placeCount: plan.placeCount, imageUrl: plan.imageUrl });

  return plan;
}

/** Look up a saved plan by id. Returns undefined if not found. */
export async function findSavedPlan(id: string): Promise<SavedPlan | undefined> {
  const plans = await readPlans();
  return plans.find((plan) => plan.id === id);
}

/** List saved plans for local plan grids until the server-backed plans API is ready. */
export async function listSavedPlans(): Promise<SavedPlan[]> {
  return readPlans();
}

/** Directly seed a plan into the store (used by mock data initialisation). */
export function seedPlan(plan: SavedPlan): void {
  seededPlans.set(plan.id, plan);
}
