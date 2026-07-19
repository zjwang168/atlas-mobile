import type { Atlas } from '@/types/atlas';
import type { AtlasPlace } from '@/types/place';

/** `AtlasPlace` plus the display fields `Atlas.tsx` needs — a real fetch
    would resolve these via a join against `places`/`savedPlaces`; this mock
    embeds them directly so the UI can render without any service call. */
export type MockAtlasPlace = AtlasPlace & { name: string; thumbnailUrl: string };

const NOW = new Date().toISOString();

export const mockAtlases: Atlas[] = [
  {
    id: 'atlas-mock-1',
    owner_id: null,
    title: 'New York Museum',
    description: null,
    visibility: 'private',
    created_at: NOW,
    updated_at: NOW,
  },
];

// Real saved places (ids/names/photos pulled from the `places` table) tagged
// `category: 'Museums & Exhibitions'` and `region: 'New York City'`.
export const mockAtlasPlaces: MockAtlasPlace[] = [
  {
    id: 'atlas-place-mock-1',
    atlasId: 'atlas-mock-1',
    placeId: 'f8d3660f-1a53-4bfd-9021-725314c4543f',
    addedBy: null,
    note: null,
    sortOrder: 0,
    createdAt: NOW,
    name: 'The Metropolitan Museum of Art',
    thumbnailUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/3/30/Metropolitan_Museum_of_Art_%28The_Met%29_-_Central_Park%2C_NYC.jpg/960px-Metropolitan_Museum_of_Art_%28The_Met%29_-_Central_Park%2C_NYC.jpg',
  },
  {
    id: 'atlas-place-mock-2',
    atlasId: 'atlas-mock-1',
    placeId: '260886e1-3094-42f2-8b08-2d70bb59d997',
    addedBy: null,
    note: null,
    sortOrder: 1,
    createdAt: NOW,
    name: 'Museum of the City of New York',
    thumbnailUrl:
      'https://upload.wikimedia.org/wikipedia/commons/thumb/d/d3/Museum_of_the_City_of_New_York_logo.svg/960px-Museum_of_the_City_of_New_York_logo.svg.png',
  },
];
