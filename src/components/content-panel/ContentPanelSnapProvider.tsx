import { createContext, useCallback, useContext, useMemo, useRef, useSyncExternalStore } from 'react';
import type { SnapState } from './ContentPanel';

type Listener = () => void;

type ContentPanelSnapStore = {
  getState: (group: string, fallback: SnapState) => SnapState;
  setState: (group: string, state: SnapState) => void;
  subscribe: (group: string, listener: Listener) => () => void;
};

const createContentPanelSnapStore = (): ContentPanelSnapStore => {
  const states = new Map<string, SnapState>();
  const listeners = new Map<string, Set<Listener>>();

  return {
    getState: (group, fallback) => states.get(group) ?? fallback,
    setState: (group, state) => {
      if (states.get(group) === state) return;
      states.set(group, state);
      listeners.get(group)?.forEach((listener) => listener());
    },
    subscribe: (group, listener) => {
      let groupListeners = listeners.get(group);
      if (!groupListeners) {
        groupListeners = new Set();
        listeners.set(group, groupListeners);
      }
      groupListeners.add(listener);
      return () => {
        groupListeners?.delete(listener);
        if (groupListeners?.size === 0) listeners.delete(group);
      };
    },
  };
};

const ContentPanelSnapContext = createContext<ContentPanelSnapStore | null>(null);

export function ContentPanelSnapProvider({ children }: { children: React.ReactNode }) {
  const storeRef = useRef<ContentPanelSnapStore | null>(null);
  if (storeRef.current === null) {
    storeRef.current = createContentPanelSnapStore();
  }

  return (
    <ContentPanelSnapContext.Provider value={storeRef.current}>
      {children}
    </ContentPanelSnapContext.Provider>
  );
}

export function useContentPanelSnapGroup(
  group: string | undefined,
  fallback: SnapState,
): [SnapState, (state: SnapState) => void] {
  const contextStore = useContext(ContentPanelSnapContext);
  const fallbackStore = useMemo(createContentPanelSnapStore, []);
  const store = contextStore ?? fallbackStore;

  const subscribe = useCallback(
    (listener: Listener) => (group ? store.subscribe(group, listener) : () => {}),
    [group, store],
  );
  const getSnapshot = useCallback(
    () => (group ? store.getState(group, fallback) : fallback),
    [fallback, group, store],
  );
  const state = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const setState = useCallback(
    (next: SnapState) => {
      if (group) store.setState(group, next);
    },
    [group, store],
  );

  return [state, setState];
}
