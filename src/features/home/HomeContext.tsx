import { createContext, useContext, useState } from 'react';
import { Dimensions } from 'react-native';
import type { PlannedPlace } from '../create-plan/plan-place/types';

// --- Panel height constants ---

const SCREEN_HEIGHT = Dimensions.get('window').height;

export const PANEL_HEIGHT = {
  default: SCREEN_HEIGHT * 0.55,
  createPlan: SCREEN_HEIGHT * 0.7,
} as const;

// --- Overlay ---

export type Overlay =
  | { kind: 'none' }
  | { kind: 'placeDetail'; placeName: string }
  | { kind: 'planDetail'; planId: string }
  | { kind: 'addPlace'; onSelect: (places: PlannedPlace[]) => void };

type HomeContextValue = {
  overlay: Overlay;
  setOverlay: (overlay: Overlay) => void;
};

const HomeContext = createContext<HomeContextValue>({
  overlay: { kind: 'none' },
  setOverlay: () => {},
});

export function useHome() {
  return useContext(HomeContext);
}

export function HomeProvider({ children }: { children: React.ReactNode }) {
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });
  return (
    <HomeContext.Provider value={{ overlay, setOverlay }}>
      {children}
    </HomeContext.Provider>
  );
}
