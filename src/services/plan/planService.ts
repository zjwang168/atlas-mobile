/**
 * Persistence for plans, backed by the Supabase `plans` table and a
 * read-through local cache (see `../local/`). Mirrors `atlas/atlasService.ts`,
 * except writes are online-first for now — no offline write-queue
 * integration yet.
 */

import type { PlanRow } from '@/types/plan';
import { createLocalId, LOCAL_CACHE_KEYS } from '../local/cacheKeys';
import { getCached, getCurrentUserId, setCached, updateCached } from '../local/localStore';
import { withTimeout } from '../local/syncQueue';
import { supabase } from '../supabase/supabaseClient';
import { PLAN_SELECT_COLUMNS } from './planShared';

type PlanListener = (plans: PlanRow[]) => void;

const planListeners = new Set<PlanListener>();

export function subscribePlans(listener: PlanListener): () => void {
  planListeners.add(listener);
  return () => planListeners.delete(listener);
}

function notifyPlans(plans: PlanRow[]): void {
  planListeners.forEach((listener) => listener(plans));
}

async function setPlansCache(userId: string, plans: PlanRow[]): Promise<void> {
  await setCached<PlanRow[]>(userId, LOCAL_CACHE_KEYS.planRows, plans);
  notifyPlans(plans);
}

async function updatePlansCache(userId: string, update: (plans: PlanRow[]) => PlanRow[]): Promise<PlanRow[]> {
  const next = await updateCached<PlanRow[]>(userId, LOCAL_CACHE_KEYS.planRows, (current) => update(current ?? []));
  notifyPlans(next);
  return next;
}

/** Fetch plans, newest first, for the MyPlan grid. */
export async function fetchPlans(): Promise<PlanRow[]> {
  const userId = await getCurrentUserId();
  if (!userId) return [];

  const cached = await getCached<PlanRow[]>(userId, LOCAL_CACHE_KEYS.planRows);
  const fetchFresh = async () => {
    const { data, error } = await supabase
      .from('plans')
      .select(PLAN_SELECT_COLUMNS)
      .order('created_at', { ascending: false });
    if (error) throw new Error(`Failed to fetch plans: ${error.message}`);
    const fresh = (data ?? []) as PlanRow[];
    await setPlansCache(userId, fresh);
    return fresh;
  };

  if (cached) {
    fetchFresh().catch((error) => console.warn('[planService] background refresh failed:', error));
    return cached;
  }

  return fetchFresh();
}

/** Look up a single plan by id (cache-then-revalidate against the current list). */
export async function findPlan(id: string): Promise<PlanRow | undefined> {
  const plans = await fetchPlans();
  return plans.find((plan) => plan.id === id);
}

export type CreatePlanInput = {
  title: string;
  destination: string | null;
  startDate: string | null;
  endDate: string | null;
  imageUrl?: string | null;
};

/**
 * Create a new plan. Writes an optimistic local row immediately so the UI
 * reflects it before the network round-trip, then syncs to Supabase. If the
 * write fails, the optimistic row is rolled back and the error rethrown —
 * there's no offline retry queue for plans yet (v1 scope).
 */
export async function createPlan(input: CreatePlanInput): Promise<PlanRow> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Cannot create a plan before auth is ready');

  const now = new Date().toISOString();
  const localRow: PlanRow = {
    id: createLocalId(),
    owner_id: null,
    user_id: userId,
    title: input.title,
    destination: input.destination,
    start_date: input.startDate,
    end_date: input.endDate,
    description: null,
    visibility: 'private',
    image_url: input.imageUrl ?? null,
    created_at: now,
    updated_at: now,
  };

  await updatePlansCache(userId, (current) => [localRow, ...current]);

  try {
    const { data, error } = await withTimeout(
      supabase
        .from('plans')
        .insert({
          title: input.title,
          destination: input.destination,
          start_date: input.startDate,
          end_date: input.endDate,
          image_url: input.imageUrl ?? null,
        })
        .select(PLAN_SELECT_COLUMNS)
        .single(),
      'Creating plan timed out',
    );
    if (error) throw new Error(`Failed to create plan: ${error.message}`);

    const savedRow = data as PlanRow;
    await updatePlansCache(userId, (current) => current.map((row) => (row.id === localRow.id ? savedRow : row)));
    return savedRow;
  } catch (error) {
    await updatePlansCache(userId, (current) => current.filter((row) => row.id !== localRow.id));
    throw error;
  }
}

/** Delete a plan. `plan_itinerary_place_flexible`/`plan_itinerary_days` cascade server-side (`ON DELETE CASCADE`). */
export async function deletePlan(id: string): Promise<void> {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error('Cannot delete a plan before auth is ready');

  await updatePlansCache(userId, (current) => current.filter((row) => row.id !== id));

  const { error } = await withTimeout(supabase.from('plans').delete().eq('id', id), 'Deleting plan timed out');
  if (error) throw new Error(`Failed to delete plan: ${error.message}`);
}
