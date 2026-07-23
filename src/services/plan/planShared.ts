/** Shared between `planService.ts` and `planItineraryService.ts` — kept in its
    own module so neither has to import the other (mirrors `atlasShared.ts`). */

export const PLAN_SELECT_COLUMNS =
  'id, owner_id, user_id, title, destination, start_date, end_date, description, visibility, image_url, created_at, updated_at';

export const PLAN_ITINERARY_PLACE_FLEXIBLE_SELECT_COLUMNS = 'id, plan_id, place_id, added_by, status, note, created_at';

export const PLAN_ITINERARY_DAYS_SELECT_COLUMNS = 'id, plan_id, date, title, sort_order, created_at';

export const PLAN_ITINERARY_PLACES_SELECT_COLUMNS = 'id, itinerary_day_id, place_id, visit_slot, note, sort_order, created_at';
