import { DaySchedule, PlaceDetail } from '../types/place';

const weekdayLunchDinner: DaySchedule[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
].map((day) => ({
  day: day as DaySchedule['day'],
  slots: [
    { open: '11:30', close: '14:00' },
    { open: '17:00', close: '22:00' },
  ],
}));

const alwaysOpenCafe: DaySchedule[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
].map((day) => ({
  day: day as DaySchedule['day'],
  slots: [{ open: '06:00', close: '22:00' }],
}));

const allClosed: DaySchedule[] = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
].map((day) => ({
  day: day as DaySchedule['day'],
  slots: [],
}));

export const mockPlaceDetails: PlaceDetail[] = [
  {
    id: '1',
    name: 'Noma Restaurant',
    subtitle: 'Nordic tasting menu · Downtown',
    latitude: 47.6095,
    longitude: -122.3419,
    address: '2319 2nd Ave, Seattle, WA',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1000&q=80&auto=format&fit=crop',
    schedule: [
      { day: 'monday', slots: [{ open: '09:00', close: '23:00' }] },
      { day: 'tuesday', slots: [{ open: '09:00', close: '23:00' }] },
      { day: 'wednesday', slots: [{ open: '09:00', close: '23:00' }] },
      { day: 'thursday', slots: [{ open: '09:00', close: '23:00' }] },
      { day: 'friday', slots: [{ open: '09:00', close: '23:00' }] },
      { day: 'saturday', slots: [] },
      { day: 'sunday', slots: [] },
    ],
    tags: [
      { id: 'nordic', label: 'Nordic' },
      { id: 'tasting', label: 'Tasting Menu' },
      { id: 'date-night', label: 'Date Night' },
      { id: 'reservation', label: 'Reservation' },
    ],
    summary:
      'A polished tasting-menu room with precise seafood, fermented accents, and a calm service rhythm suited to a longer evening.',
    visitStrategy:
      'Book ahead, arrive a little early, and leave the rest of the night unscheduled.',
    phoneNumber: '+1 206-555-0138',
    links: [
      { label: 'Official Website', url: 'https://example.com/noma' },
      { label: 'Reservations', url: 'https://example.com/noma/reservations' },
    ],
  },
  {
    id: '2',
    name: 'Hidden Sushi',
    subtitle: 'Omakase · Belltown',
    latitude: 47.6131,
    longitude: -122.345,
    address: '89 Bell St, Seattle, WA',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=1000&q=80&auto=format&fit=crop',
    schedule: weekdayLunchDinner,
    tags: [
      { id: 'japanese', label: 'Japanese' },
      { id: 'sushi', label: 'Sushi' },
      { id: 'omakase', label: 'Omakase' },
      { id: 'counter', label: 'Counter' },
      { id: 'lunch', label: 'Lunch' },
      { id: 'seafood', label: 'Seafood' },
      { id: 'quiet', label: 'Quiet' },
    ],
    summary: 'A compact sushi counter with split lunch and dinner services.',
    visitStrategy:
      'Choose lunch for a lower-key visit. Dinner is better for the full chef-led pace. Counter seats go first, so reserve before planning around it.',
    links: [],
  },
  {
    id: '3',
    name: 'Coffee Corner',
    subtitle: 'Cafe · Pioneer Square',
    latitude: 47.6019,
    longitude: -122.3343,
    address: '110 Yesler Way, Seattle, WA',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1000&q=80&auto=format&fit=crop',
    schedule: alwaysOpenCafe,
    tags: [],
    summary:
      'A simple all-day cafe for espresso, pastries, and a reliable seat between errands.',
    visitStrategy: 'Drop in before midmorning for the quietest tables.',
  },
  {
    id: '4',
    name: 'The Long Name Gastropub & Provisions',
    subtitle: 'Gastropub · Capitol Hill',
    latitude: 47.623,
    longitude: -122.3207,
    address: '1401 E Madison St, Seattle, WA',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=1000&q=80&auto=format&fit=crop',
    schedule: allClosed,
    tags: [
      { id: 'pub', label: 'Pub' },
      { id: 'beer', label: 'Beer' },
      { id: 'comfort', label: 'Comfort Food' },
      { id: 'groups', label: 'Groups' },
      { id: 'closed', label: 'Temporarily Closed' },
    ],
    summary:
      'A neighborhood pub concept with a long name and an even longer menu. The listing is intentionally closed across the week to exercise the all-closed schedule state. It still carries enough descriptive text to show how a denser detail panel reads. Use it for overflow checks before trusting shorter names.',
    visitStrategy:
      'Do not plan a visit until hours return. Keep it saved for group dinners. Watch the social feed for reopening notes.',
    links: [{ label: 'Instagram', url: 'https://example.com/gastropub/instagram' }],
  },
  {
    id: '5',
    name: 'Sakura Ramen',
    subtitle: 'Ramen · International District',
    latitude: 47.5983,
    longitude: -122.3262,
    address: '512 S King St, Seattle, WA',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=1000&q=80&auto=format&fit=crop',
    schedule: [
      { day: 'monday', slots: [] },
      { day: 'tuesday', slots: [] },
      { day: 'wednesday', slots: [{ open: '11:00', close: '20:30' }] },
      { day: 'thursday', slots: [{ open: '11:00', close: '21:00' }] },
      { day: 'friday', slots: [{ open: '11:00', close: '22:30' }] },
      { day: 'saturday', slots: [{ open: '12:00', close: '22:30' }] },
      { day: 'sunday', slots: [{ open: '12:00', close: '20:00' }] },
    ],
    tags: [
      { id: 'ramen', label: 'Ramen' },
      { id: 'japanese', label: 'Japanese' },
      { id: 'casual', label: 'Casual' },
      { id: 'noodles', label: 'Noodles' },
      { id: 'solo', label: 'Solo' },
      { id: 'rainy-day', label: 'Rainy Day' },
    ],
    summary:
      'A casual ramen shop with irregular weekly hours and a concise menu focused on broth and noodles.',
    visitStrategy:
      'Go Wednesday or Thursday for shorter waits; weekend dinner is the busiest window.',
    links: [{ label: 'Menu', url: 'https://example.com/sakura-ramen/menu' }],
  },
];

export function findPlaceDetail(name: string): PlaceDetail | undefined {
  return mockPlaceDetails.find((place) => place.name === name);
}
