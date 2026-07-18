export type Place = {
  id: string;
  name: string;
  subtitle: string;
  latitude: number;
  longitude: number;
};

export type DayOfWeek =
  | 'monday'
  | 'tuesday'
  | 'wednesday'
  | 'thursday'
  | 'friday'
  | 'saturday'
  | 'sunday';

export type TimeSlot = {
  open: string;
  close: string;
};

export type DaySchedule = {
  day: DayOfWeek;
  slots: TimeSlot[];
};

export type PlaceTag = {
  id: string;
  label: string;
};

export type PlaceLink = {
  label: string;
  url: string;
};

export type PlaceDetail = Place & {
  address: string;
  thumbnailUrl: string;
  schedule: DaySchedule[];
  tags: PlaceTag[];
  collections?: PlaceTag[];
  summary: string;
  visitStrategy: string;
  note?: string;
  phoneNumber?: string;
  links?: PlaceLink[];
  savedAt: string;
  // Below: mirror `places` table columns not yet surfaced by any UI — optional
  // and unwired until a feature needs them.
  category?: string;
  description?: string;
  aiSummary?: string;
  city?: string;
  region?: string;
  country?: string;
  visibility?: string;
  recommended?: boolean;
  externalPlaceId?: string;
  externalSource?: string;
  createdBy?: string;
  updatedAt?: string;
};

/** Row shape of the Supabase `atlas_places` join table (renamed from `collection_places`). */
export type AtlasPlace = {
  id: string;
  atlasId: string;
  placeId: string;
  addedBy: string | null;
  note: string | null;
  sortOrder: number;
  createdAt: string;
};
