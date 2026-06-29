import React, { createContext, useContext, useRef, useState } from 'react';
import { View } from 'react-native';
import { useSharedValue, useAnimatedStyle } from 'react-native-reanimated';
import { NativeOnlyAnimatedView } from '@/components/ui/native-only-animated-view';
import type { PlannedPlace, SlotKey } from '../types';
import { slotKeyToString } from '../types';

// Forward declaration to avoid circular import — PlaceSlotCard imports useDragCard which imports DndProvider
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PlaceSlotCardComponent: React.ComponentType<any> | null = null;
export function registerPlaceSlotCard(c: React.ComponentType<any>) {
  PlaceSlotCardComponent = c;
}

type DropZoneEntry = {
  slotKey: SlotKey;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ref: React.RefObject<any>;
};

export type DropZoneRect = {
  key: string;
  slotKey: SlotKey;
  y: number;
  height: number;
};

export type DndContextValue = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  isDragging: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  activeZoneKey: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ghostY: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  dropZonesSnap: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  scrollOffset: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  containerScreenY: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerDropZone: (slotKey: SlotKey, ref: React.RefObject<any>) => void;
  unregisterDropZone: (slotKey: SlotKey) => void;
  startDrag: (place: PlannedPlace, sourceSlot: SlotKey) => void;
  finishDrag: (zoneKey: string | null) => void;
};

const DndContext = createContext<DndContextValue | null>(null);

export function useDndContext(): DndContextValue {
  const ctx = useContext(DndContext);
  if (!ctx) throw new Error('useDndContext must be used inside DndProvider');
  return ctx;
}

type DndProviderProps = {
  children: React.ReactNode;
  onDrop: (from: SlotKey, to: SlotKey, place: PlannedPlace, targetIndex?: number) => void;
  reportScrollYToPanel: (y: number) => void;
};

export function DndProvider({ children, onDrop, reportScrollYToPanel }: DndProviderProps) {
  const isDragging = useSharedValue(false);
  const activeZoneKey = useSharedValue('');
  const ghostY = useSharedValue(0);
  const dropZonesSnap = useSharedValue<DropZoneRect[]>([]);
  const scrollOffset = useSharedValue(0);
  const containerScreenY = useSharedValue(0);

  const containerRef = useRef<View>(null);
  const zonesRef = useRef<Map<string, DropZoneEntry>>(new Map());
  const ghostPlaceRef = useRef<PlannedPlace | null>(null);
  const ghostSourceSlotRef = useRef<SlotKey | null>(null);

  const [ghostPlace, setGhostPlace] = useState<PlannedPlace | null>(null);

  const registerDropZone = (slotKey: SlotKey, ref: React.RefObject<any>) => {
    zonesRef.current.set(slotKeyToString(slotKey), { slotKey, ref });
  };

  const unregisterDropZone = (slotKey: SlotKey) => {
    zonesRef.current.delete(slotKeyToString(slotKey));
  };

  const startDrag = (place: PlannedPlace, sourceSlot: SlotKey) => {
    ghostPlaceRef.current = place;
    ghostSourceSlotRef.current = sourceSlot;
    setGhostPlace(place);

    const entries = [...zonesRef.current.entries()];
    reportScrollYToPanel(1);

    if (entries.length === 0) {
      dropZonesSnap.value = [];
      return;
    }

    const snaps: DropZoneRect[] = [];
    let remaining = entries.length;
    for (const [key, { slotKey: sk, ref }] of entries) {
      ref.current?.measureInWindow((x: number, y: number, w: number, h: number) => {
        snaps.push({ key, slotKey: sk, y, height: h });
        remaining--;
        if (remaining === 0) {
          dropZonesSnap.value = [...snaps];
        }
      });
    }
  };

  const finishDrag = (zoneKey: string | null) => {
    reportScrollYToPanel(scrollOffset.value);

    if (zoneKey && ghostSourceSlotRef.current && ghostPlaceRef.current) {
      const entry = zonesRef.current.get(zoneKey);
      if (entry) {
        onDrop(ghostSourceSlotRef.current, entry.slotKey, ghostPlaceRef.current);
      }
    }

    setGhostPlace(null);
    ghostPlaceRef.current = null;
    ghostSourceSlotRef.current = null;
  };

  const ghostStyle = useAnimatedStyle(() => ({
    position: 'absolute' as const,
    left: 16,
    right: 16,
    top: ghostY.value - 28,
    opacity: isDragging.value ? 0.9 : 0,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 8,
    zIndex: 100,
  }));

  return (
    <DndContext.Provider
      value={{
        isDragging,
        activeZoneKey,
        ghostY,
        dropZonesSnap,
        scrollOffset,
        containerScreenY,
        registerDropZone,
        unregisterDropZone,
        startDrag,
        finishDrag,
      }}
    >
      <View
        ref={containerRef}
        style={{ flex: 1 }}
        onLayout={() => {
          containerRef.current?.measureInWindow((_x: number, y: number) => {
            containerScreenY.value = y;
          });
        }}
      >
        {children}
        <NativeOnlyAnimatedView pointerEvents="none" style={ghostStyle}>
          {ghostPlace && PlaceSlotCardComponent && (
            <PlaceSlotCardComponent
              place={ghostPlace}
              slotKey={{ kind: 'free' }}
              onRemove={() => {}}
              isGhost
            />
          )}
        </NativeOnlyAnimatedView>
      </View>
    </DndContext.Provider>
  );
}
