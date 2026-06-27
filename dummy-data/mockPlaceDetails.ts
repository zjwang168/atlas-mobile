import { DaySchedule, PlaceDetail } from '@/types/place';

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
    { open: '17:30', close: '22:00' },
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
  slots: [{ open: '06:30', close: '21:00' }],
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
    address: '2319 2nd Ave, Seattle, WA 98121',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=1000&q=80&auto=format&fit=crop',
    schedule: [
      { day: 'monday', slots: [] },
      { day: 'tuesday', slots: [{ open: '18:00', close: '23:00' }] },
      { day: 'wednesday', slots: [{ open: '18:00', close: '23:00' }] },
      { day: 'thursday', slots: [{ open: '18:00', close: '23:00' }] },
      { day: 'friday', slots: [{ open: '17:30', close: '23:30' }] },
      { day: 'saturday', slots: [{ open: '17:30', close: '23:30' }] },
      { day: 'sunday', slots: [] },
    ],
    tags: [
      { id: 'nordic', label: 'Nordic' },
      { id: 'tasting-menu', label: 'Tasting Menu' },
      { id: 'fine-dining', label: 'Fine Dining' },
      { id: 'date-night', label: 'Date Night' },
      { id: 'reservation', label: 'Reservation Required' },
      { id: 'seafood', label: 'Seafood' },
    ],
    collections: [
      { id: 'c-special', label: 'Special Occasions' },
      { id: 'c-date', label: 'Date Night' },
      { id: 'c-seattle-best', label: 'Best of Seattle' },
    ],
    summary:
      'A refined tasting-menu room that draws on Nordic technique — fermented elements, precise seafood preparations, and foraged garnishes that change with the season. The room is calm and unhurried; service moves at a deliberate pace that suits a long evening rather than a quick dinner.\n\nThe kitchen uses local Pacific Northwest produce as a base, then applies Scandinavian preservation and fermentation methods to push each dish past the obvious. Portions are small, courses are many, and the cumulative effect is more memorable than any single plate.',
    visitStrategy:
      'Reserve the Tuesday or Wednesday seating for a quieter room and more attentive pacing — weekend slots fill weeks out and the energy shifts toward celebratory groups.\n\nArrive five minutes early; the host stands and the bar is not designed for waiting. Leave the rest of the evening unscheduled. The tasting runs around two and a half hours and a rushed departure undercuts it.',
    note: 'Tried the spring menu in April — the smoked mussel course was the standout. Wine pairing is worth adding; the sommelier matched the fermented dishes unusually well. Ask for the corner table when booking.',
    phoneNumber: '+1 206-555-0138',
    links: [
      { label: 'Official Website', url: 'https://example.com/noma' },
      { label: 'Reservations', url: 'https://example.com/noma/reservations' },
      { label: 'Sample Menu', url: 'https://example.com/noma/menu' },
    ],
  },
  {
    id: '2',
    name: 'Hidden Sushi',
    subtitle: 'Omakase · Belltown',
    latitude: 47.6131,
    longitude: -122.345,
    address: '89 Bell St, Seattle, WA 98121',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1579871494447-9811cf80d66c?w=1000&q=80&auto=format&fit=crop',
    schedule: weekdayLunchDinner,
    tags: [
      { id: 'japanese', label: 'Japanese' },
      { id: 'sushi', label: 'Sushi' },
      { id: 'omakase', label: 'Omakase' },
      { id: 'counter', label: 'Counter Seating' },
      { id: 'lunch', label: 'Lunch' },
      { id: 'seafood', label: 'Seafood' },
      { id: 'quiet', label: 'Quiet' },
    ],
    collections: [
      { id: 'c-solo', label: 'Solo Dining' },
      { id: 'c-hidden', label: 'Hidden Gems' },
      { id: 'c-japanese', label: 'Japanese Spots' },
    ],
    summary:
      'A twelve-seat counter tucked behind an unmarked door on Bell Street. The chef runs two omakase services daily — a shorter lunch format and a longer dinner sequence. There is no printed menu and no à la carte; you eat what the chef selects, in the order it is served.\n\nFish arrives each morning from the Tsukiji network and a single local dockside contact in Bellingham. The room is deliberately small, which keeps the experience personal without being performative.',
    visitStrategy:
      'Choose lunch if you want a lower-key visit and a shorter commitment — the midday format runs about seventy minutes and the price is roughly half of dinner. Counter seats by the pass offer the best view of the prep work, so request them when you book.\n\nCall on the day of to ask about the morning catch before deciding between services. Avoid Friday and Saturday dinner unless you booked at least two weeks out.',
    note: 'The uni course at dinner is exceptional when available — worth asking about when you call. Lunch is the better value by a wide margin.',
    phoneNumber: '+1 206-555-0274',
    links: [],
  },
  {
    id: '3',
    name: 'Coffee Corner',
    subtitle: 'Cafe · Pioneer Square',
    latitude: 47.6019,
    longitude: -122.3343,
    address: '110 Yesler Way, Seattle, WA 98104',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1000&q=80&auto=format&fit=crop',
    schedule: alwaysOpenCafe,
    tags: [],
    collections: [
      { id: 'c-work', label: 'Good for Work' },
      { id: 'c-coffee', label: 'Coffee Spots' },
      { id: 'c-neighborhood', label: 'Neighborhood Gems' },
    ],
    summary:
      'A relaxed all-day cafe on the corner of Yesler and Occidental that has held the same format for years — espresso, drip, a short pastry case, and a handful of counter seats facing the street.\n\nThe space is small enough to feel lived-in but large enough that a solo visitor with a laptop does not feel like an imposition. Beans rotate quarterly from two regional roasters. Nothing on the menu requires an explanation.',
    visitStrategy:
      'Drop in before ten in the morning for the quietest tables and the freshest pastries. The corner window seat opens up most weekday mornings around nine when the early crowd moves on.\n\nAvoid the noon hour on weekdays — the lunch rush from the surrounding offices fills the counter quickly and service slows noticeably.',
    note: 'The oat milk flat white is consistently good. Pastries sell out by 10:30 most days — the almond croissant goes first.',
  },
  {
    id: '4',
    name: 'The Long Name Gastropub & Provisions',
    subtitle: 'Gastropub · Capitol Hill',
    latitude: 47.623,
    longitude: -122.3207,
    address: '1401 E Madison St, Seattle, WA 98122',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1514933651103-005eec06c04b?w=1000&q=80&auto=format&fit=crop',
    schedule: allClosed,
    tags: [
      { id: 'pub', label: 'Pub' },
      { id: 'craft-beer', label: 'Craft Beer' },
      { id: 'comfort', label: 'Comfort Food' },
      { id: 'groups', label: 'Good for Groups' },
      { id: 'closed', label: 'Temporarily Closed' },
    ],
    collections: [
      { id: 'c-groups', label: 'Group Dinners' },
      { id: 'c-beer', label: 'Beer Bars' },
    ],
    summary:
      'A Capitol Hill institution with a name that does not fit on most receipts and a menu that follows the same principle — broad, generous, and slightly overcommitted. The tap list runs twenty-four handles with a bias toward Pacific Northwest craft breweries, plus a short list of ciders and low-ABV options.\n\nThe kitchen runs pub standards — burgers, fish and chips, a rotating soup — with enough care that none of it reads as an afterthought. The room is loud on weekends and perfectly comfortable on a Tuesday. Currently closed for a kitchen renovation with no confirmed reopen date.',
    visitStrategy:
      'Hold off on planning a visit until hours are confirmed again — check Instagram for renovation updates before showing up.\n\nWhen it does reopen, this is best as a group venue: the long communal tables accommodate six to eight comfortably and the tab splits easily. Reserve the back room for larger gatherings. Tuesday and Wednesday evenings are the sweet spot for service quality without the weekend noise.',
    note: 'The back room is worth requesting for groups of five or more — much quieter than the main floor. The fish and chips were the kitchen\'s strongest dish before the closure.',
    links: [
      { label: 'Instagram', url: 'https://example.com/gastropub/instagram' },
      { label: 'Newsletter', url: 'https://example.com/gastropub/newsletter' },
    ],
  },
  {
    id: '5',
    name: 'Sakura Ramen',
    subtitle: 'Ramen · International District',
    latitude: 47.5983,
    longitude: -122.3262,
    address: '512 S King St, Seattle, WA 98104',
    thumbnailUrl:
      'https://images.unsplash.com/photo-1569718212165-3a8278d5f624?w=1000&q=80&auto=format&fit=crop',
    schedule: [
      { day: 'monday', slots: [] },
      { day: 'tuesday', slots: [] },
      { day: 'wednesday', slots: [{ open: '11:00', close: '15:00' }, { open: '17:00', close: '20:30' }] },
      { day: 'thursday', slots: [{ open: '11:00', close: '15:00' }, { open: '17:00', close: '21:00' }] },
      { day: 'friday', slots: [{ open: '11:00', close: '22:30' }] },
      { day: 'saturday', slots: [{ open: '12:00', close: '22:30' }] },
      { day: 'sunday', slots: [{ open: '12:00', close: '20:00' }] },
    ],
    tags: [
      { id: 'ramen', label: 'Ramen' },
      { id: 'japanese', label: 'Japanese' },
      { id: 'casual', label: 'Casual' },
      { id: 'noodles', label: 'Noodles' },
      { id: 'solo', label: 'Solo Friendly' },
      { id: 'rainy-day', label: 'Rainy Day' },
      { id: 'no-reservations', label: 'Walk-in Only' },
    ],
    collections: [
      { id: 'c-rainy', label: 'Rainy Day Spots' },
      { id: 'c-solo', label: 'Solo Dining' },
      { id: 'c-id', label: 'International District' },
      { id: 'c-quick', label: 'Quick Lunch' },
    ],
    summary:
      'A focused ramen shop on South King Street with a menu that stays deliberately short — four broths, two noodle gauges, and a handful of toppings. The tonkotsu is the anchor: cloudy, rich, and simmered longer than most kitchens are willing to commit to. The shoyu is lighter and better suited to lunch.\n\nThe room fits about twenty people across a counter and four small tables; turnover is fast and the staff does not hover. Closed Monday and Tuesday, which makes the mid-week lunch slots on Wednesday and Thursday the quietest entry point.',
    visitStrategy:
      'Go Wednesday or Thursday for the shortest waits and the most relaxed pacing — the kitchen is fully rested after the weekend and the lunch crowd clears by half past one.\n\nFriday and Saturday dinner is the busiest window and the wait can reach forty minutes. Sit at the counter if eating alone; it is the best seat for watching the broth work. Order the soft-boiled egg regardless of which bowl you choose.',
    note: 'Tonkotsu with extra firm noodles and a side of chashu is the move. The Wednesday lunch split shift means the kitchen is fresh — noticeably better broth clarity than on weekend nights.',
    phoneNumber: '+1 206-555-0391',
    links: [
      { label: 'Menu', url: 'https://example.com/sakura-ramen/menu' },
      { label: 'Instagram', url: 'https://example.com/sakura-ramen/instagram' },
    ],
  },
];

export function findPlaceDetail(name: string): PlaceDetail | undefined {
  return mockPlaceDetails.find((place) => place.name === name);
}
