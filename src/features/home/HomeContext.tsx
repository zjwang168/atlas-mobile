import { createContext, useContext, useState } from 'react';
import type { PlannedPlace } from '../my-plan/create-plan/plan-place/types';

// --- Overlay ---

export type Overlay =
  | { kind: 'none' }
  | { kind: 'placeDetail'; placeName: string }
  | { kind: 'planDetail'; planId: string }
  | { kind: 'addPlaceToPlan'; onSelect: (places: PlannedPlace[]) => void };

type HomeContextValue = {
  overlay: Overlay;
  setOverlay: (overlay: Overlay) => void;
  tabBarVisible: boolean;
  setTabBarVisible: (visible: boolean) => void;
};

const HomeContext = createContext<HomeContextValue>({
  overlay: { kind: 'none' },
  setOverlay: () => {},
  tabBarVisible: true,
  setTabBarVisible: () => {},
});

export function useHome() {
  return useContext(HomeContext);
}

export function HomeProvider({ children }: { children: React.ReactNode }) {
  const [overlay, setOverlay] = useState<Overlay>({ kind: 'none' });
  const [tabBarVisible, setTabBarVisible] = useState(true);
  return (
    <HomeContext.Provider value={{ overlay, setOverlay, tabBarVisible, setTabBarVisible }}>
      {children}
    </HomeContext.Provider>
  );
}
