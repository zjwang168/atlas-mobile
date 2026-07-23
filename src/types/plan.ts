/** Row shapes for the Supabase `plans` / `plan_itinerary_place_flexible` / `plan_itinerary_days` / `plan_itinerary_places` tables. */

export type PlanRow = {
  id: string;
  owner_id: string | null;
  user_id: string | null;
  title: string;
  destination: string | null;
  start_date: string | null; // 'YYYY-MM-DD'
  end_date: string | null; // 'YYYY-MM-DD'
  description: string | null;
  visibility: string;
  image_url: string | null;
  created_at: string;
  updated_at: string;
};

/** A place saved to a plan but not yet scheduled onto a day (the "flexible" list). Mirrors `plan_itinerary_place_flexible`. */
export type PlanItineraryPlaceFlexibleRow = {
  id: string;
  plan_id: string;
  place_id: string;
  added_by: string | null;
  status: string;
  note: string | null;
  created_at: string;
};

/** Mirrors `plan_itinerary_days`. */
export type PlanItineraryDayRow = {
  id: string;
  plan_id: string;
  date: string; // 'YYYY-MM-DD'
  title: string | null;
  sort_order: number;
  created_at: string;
};

export type VisitSlot = 'morning' | 'noon' | 'afternoon' | 'night';

/** A place scheduled onto a specific day + visit slot. Mirrors `plan_itinerary_places`. */
export type PlanItineraryPlaceRow = {
  id: string;
  itinerary_day_id: string;
  place_id: string;
  visit_slot: VisitSlot | null;
  note: string | null;
  sort_order: number;
  created_at: string;
};
