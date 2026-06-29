export type VisitSlot = 'morning' | 'noon' | 'afternoon' | 'night';

export const VISIT_SLOTS: VisitSlot[] = ['morning', 'noon', 'afternoon', 'night'];

export type PlannedPlace = {
  id: string;
  placeId: string;
  name: string;
  subtitle: string;
};

export type SlotKey =
  | { kind: 'free' }
  | { kind: 'dated'; date: string; slot: VisitSlot };

export type PlacesState = {
  free: PlannedPlace[];
  byDate: Record<string, Record<VisitSlot, PlannedPlace[]>>;
};

export function slotKeyToString(key: SlotKey): string {
  if (key.kind === 'free') return 'free';
  return `dated:${key.date}:${key.slot}`;
}

function generateId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function newPlannedPlace(place: { id: string; name: string; subtitle: string }): PlannedPlace {
  return {
    id: generateId(),
    placeId: place.id,
    name: place.name,
    subtitle: place.subtitle,
  };
}
