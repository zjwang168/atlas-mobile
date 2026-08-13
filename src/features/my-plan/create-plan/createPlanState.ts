import type { PlacesState } from './plan-place/types';

export type DateRange = { start: string | null; end: string | null };

export const createPlanCache: {
  location: string;
  range: DateRange;
  places: PlacesState;
} = {
  location: '',
  range: { start: null, end: null },
  places: { free: [], byDate: {} },
};
