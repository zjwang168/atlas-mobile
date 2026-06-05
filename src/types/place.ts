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
  summary: string;
  visitStrategy: string;
  phoneNumber?: string;
  links?: PlaceLink[];
};
