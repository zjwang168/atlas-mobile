/**
 * savePlan.ts — plan persistence service
 *
 * All writes go through savePlan(); all reads through findSavedPlan().
 * Swap the two implementations below for real API calls when the server is ready.
 */

import { mockPlans } from '../../../../mock-data/mockPlans';
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
// Mock store (replace with server state when ready)
// ---------------------------------------------------------------------------

const savedPlans = new Map<string, SavedPlan>();

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

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Persist a new plan. Returns the saved plan with a generated id. */
export async function savePlan(input: PlanInput): Promise<SavedPlan> {
  // --- swap this block for fetch('/api/plans', { method: 'POST', body: JSON.stringify(input) }) ---
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

  savedPlans.set(id, plan);

  // Keep the card list in sync
  mockPlans.push({ id, title: plan.title, placeCount: plan.placeCount, imageUrl: plan.imageUrl });

  return plan;
  // --- end mock block ---
}

/** Look up a saved plan by id. Returns undefined if not found. */
export async function findSavedPlan(id: string): Promise<SavedPlan | undefined> {
  // --- swap for fetch(`/api/plans/${id}`) ---
  return savedPlans.get(id);
  // --- end mock block ---
}

/** Directly seed a plan into the store (used by mock data initialisation). */
export function seedPlan(plan: SavedPlan): void {
  savedPlans.set(plan.id, plan);
}
