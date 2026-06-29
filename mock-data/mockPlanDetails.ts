import { seedPlan } from '../src/features/create-plan/savePlan';
import type { SavedPlan } from '../src/features/create-plan/savePlan';

function pp(placeId: string, name: string, subtitle: string, idx: number) {
  return { id: `seed-${placeId}-${idx}`, placeId, name, subtitle };
}

const p = {
  noma: (i: number) => pp('1', 'Noma Restaurant', 'Nordic tasting menu · Downtown', i),
  sushi: (i: number) => pp('2', 'Hidden Sushi', 'Omakase · Belltown', i),
  coffee: (i: number) => pp('3', 'Coffee Corner', 'Cafe · Pioneer Square', i),
  gastropub: (i: number) => pp('4', 'The Long Name Gastropub & Provisions', 'Gastropub · Capitol Hill', i),
  ramen: (i: number) => pp('5', 'Sakura Ramen', 'Ramen · International District', i),
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
        slots: {
          morning: [p.coffee(0), p.sushi(0)],
          noon: [p.ramen(0)],
          afternoon: [p.noma(0)],
          night: [p.gastropub(0)],
        },
      },
      {
        date: '2026-05-02',
        slots: {
          morning: [p.sushi(1)],
          noon: [p.ramen(1), p.coffee(1)],
          night: [p.noma(1), p.gastropub(1)],
        },
      },
      {
        date: '2026-05-03',
        slots: {
          morning: [p.coffee(2), p.ramen(2)],
          afternoon: [p.gastropub(2)],
        },
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
        slots: {
          morning: [p.coffee(3)],
          noon: [p.sushi(2), p.ramen(3)],
          night: [p.noma(2), p.gastropub(3)],
        },
      },
      {
        date: '2026-06-15',
        slots: {
          morning: [p.coffee(4), p.sushi(3)],
          afternoon: [p.ramen(4)],
        },
      },
    ],
  },
  {
    id: 'p3',
    title: 'NYC Favorites',
    location: 'New York, USA',
    dateRange: { start: null, end: null },
    placeCount: 5,
    freePlaces: [p.noma(3), p.sushi(4), p.coffee(5), p.gastropub(4), p.ramen(5)],
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
        slots: {
          morning: [p.coffee(6)],
          noon: [p.ramen(6)],
          night: [p.noma(4)],
        },
      },
      {
        date: '2026-07-05',
        slots: {
          morning: [p.sushi(5), p.coffee(7)],
          night: [p.gastropub(5)],
        },
      },
      {
        date: '2026-07-06',
        slots: {
          noon: [p.ramen(7), p.sushi(6)],
        },
      },
      {
        date: '2026-07-07',
        slots: {
          morning: [p.coffee(8)],
          afternoon: [p.noma(5)],
        },
      },
    ],
  },
];

export function seedMockPlanDetails(): void {
  PLANS.forEach(seedPlan);
}
