import { mockPlaceDetails } from './mockPlaceDetails';

export type MockPlan = {
  id: string;
  title: string;
  placeCount: number;
  imageUrl?: string;
};

export const mockPlans: MockPlan[] = [
  { id: 'p1', title: 'Tokyo Trip', placeCount: 12, imageUrl: mockPlaceDetails[0]?.thumbnailUrl },
  { id: 'p2', title: 'Paris Weekend', placeCount: 8, imageUrl: mockPlaceDetails[1]?.thumbnailUrl },
  { id: 'p3', title: 'NYC Favorites', placeCount: 5, imageUrl: mockPlaceDetails[2]?.thumbnailUrl },
  { id: 'p4', title: 'Road Trip', placeCount: 9, imageUrl: mockPlaceDetails[3]?.thumbnailUrl },
];
