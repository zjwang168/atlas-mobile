export type TimeSlot = 'morning' | 'noon' | 'afternoon' | 'night';

export const TIME_SLOTS: TimeSlot[] = ['morning', 'noon', 'afternoon', 'night'];

export const TIME_SLOT_LABELS: Record<TimeSlot, string> = {
  morning: 'Morning',
  noon: 'Noon',
  afternoon: 'Afternoon',
  night: 'Night',
};

export type PlannedPlace = {
  id: string;
  placeId: string;
  name: string;
  subtitle: string;
  imageUrl?: string;
  /** Drives the `PlaceCover` shown when there is no `imageUrl`. */
  category?: string;
  timeSlot?: TimeSlot;
};

export type SlotKey =
  | { kind: 'free' }
  | { kind: 'dated'; date: string; timeSlot: TimeSlot };

export type PlacesState = {
  free: PlannedPlace[];
  byDate: Record<string, PlannedPlace[]>;
};

export function slotKeyToString(key: SlotKey): string {
  if (key.kind === 'free') return 'free';
  return `dated:${key.date}:${key.timeSlot}`;
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function newPlannedPlace(
  place: { id: string; name: string; subtitle: string; imageUrl?: string; category?: string },
): PlannedPlace {
  return {
    id: generateId(),
    placeId: place.id,
    name: place.name,
    subtitle: place.subtitle,
    imageUrl: place.imageUrl,
    category: place.category,
  };
}
