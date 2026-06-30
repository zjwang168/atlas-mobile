import { seedPlan } from '../src/features/my-plan/create-plan/savePlan';
import type { SavedPlan } from '../src/features/my-plan/create-plan/savePlan';
import type { PlannedPlace, TimeSlot } from '../src/features/my-plan/create-plan/plan-place/types';

function pp(placeId: string, name: string, subtitle: string, idx: number, timeSlot: TimeSlot): PlannedPlace {
  return { id: `seed-${placeId}-${idx}`, placeId, name, subtitle, timeSlot };
}

const p = {
  noma:      (i: number, slot: TimeSlot) => pp('1', 'Noma Restaurant', 'Nordic tasting menu · Downtown', i, slot),
  sushi:     (i: number, slot: TimeSlot) => pp('2', 'Hidden Sushi', 'Omakase · Belltown', i, slot),
  coffee:    (i: number, slot: TimeSlot) => pp('3', 'Coffee Corner', 'Cafe · Pioneer Square', i, slot),
  gastropub: (i: number, slot: TimeSlot) => pp('4', 'The Long Name Gastropub & Provisions', 'Gastropub · Capitol Hill', i, slot),
  ramen:     (i: number, slot: TimeSlot) => pp('5', 'Sakura Ramen', 'Ramen · International District', i, slot),
};

const PLANS: SavedPlan[] = [
  {
    id: 'p1',
    title: 'Tokyo Trip',
    location: 'Tokyo, Japan',
    dateRange: { start: '2026-05-01', end: '2026-05-03' },
    placeCount: 12,
    freePlaces: [],
    schedule: [
      {
        date: '2026-05-01',
        places: [
          p.coffee(0, 'morning'),
          p.sushi(0, 'noon'),
          p.ramen(0, 'noon'),
          p.noma(0, 'afternoon'),
          p.gastropub(0, 'night'),
        ],
      },
      {
        date: '2026-05-02',
        places: [
          p.sushi(1, 'morning'),
          p.ramen(1, 'noon'),
          p.coffee(1, 'afternoon'),
          p.noma(1, 'night'),
          p.gastropub(1, 'night'),
        ],
      },
      {
        date: '2026-05-03',
        places: [
          p.coffee(2, 'morning'),
          p.ramen(2, 'noon'),
          p.gastropub(2, 'afternoon'),
        ],
      },
    ],
  },
  {
    id: 'p2',
    title: 'Paris Weekend',
    location: 'Paris, France',
    dateRange: { start: '2026-06-14', end: '2026-06-15' },
    placeCount: 8,
    freePlaces: [],
    schedule: [
      {
        date: '2026-06-14',
        places: [
          p.coffee(3, 'morning'),
          p.sushi(2, 'noon'),
          p.ramen(3, 'afternoon'),
          p.noma(2, 'night'),
          p.gastropub(3, 'night'),
        ],
      },
      {
        date: '2026-06-15',
        places: [
          p.coffee(4, 'morning'),
          p.sushi(3, 'noon'),
          p.ramen(4, 'afternoon'),
        ],
      },
    ],
  },
  {
    id: 'p3',
    title: 'NYC Favorites',
    location: 'New York, USA',
    dateRange: { start: null, end: null },
    placeCount: 5,
    freePlaces: [
      p.noma(3, 'morning'),
      p.sushi(4, 'morning'),
      p.coffee(5, 'morning'),
      p.gastropub(4, 'morning'),
      p.ramen(5, 'morning'),
    ],
    schedule: [],
  },
  {
    id: 'p4',
    title: 'Road Trip',
    location: 'Pacific Coast Highway, CA',
    dateRange: { start: '2026-07-04', end: '2026-07-07' },
    placeCount: 9,
    freePlaces: [],
    schedule: [
      {
        date: '2026-07-04',
        places: [
          p.coffee(6, 'morning'),
          p.ramen(6, 'noon'),
          p.noma(4, 'night'),
        ],
      },
      {
        date: '2026-07-05',
        places: [
          p.sushi(5, 'morning'),
          p.coffee(7, 'noon'),
          p.gastropub(5, 'night'),
        ],
      },
      {
        date: '2026-07-06',
        places: [
          p.ramen(7, 'noon'),
          p.sushi(6, 'afternoon'),
        ],
      },
      {
        date: '2026-07-07',
        places: [
          p.coffee(8, 'morning'),
          p.noma(5, 'afternoon'),
        ],
      },
    ],
  },
];

export function seedMockPlanDetails(): void {
  PLANS.forEach(seedPlan);
}
