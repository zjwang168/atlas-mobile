import { Host } from '@expo/ui';
import {
  BottomSheet,
  Group,
  RNHostView,
} from '@expo/ui/swift-ui';
import {
  ignoreSafeArea,
  interactiveDismissDisabled,
  presentationBackground,
  presentationBackgroundInteraction,
  presentationDetents,
  presentationDragIndicator,
  type PresentationDetent,
} from '@expo/ui/swift-ui/modifiers';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Dimensions, StyleSheet, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useContentPanelSnapGroup } from './ContentPanelSnapProvider';

export type SnapState = 'compact' | 'short' | 'default' | 'tall' | 'full';

export type ContentPanelRenderProps = {
  snapState: SnapState;
  snapTo: (state: SnapState, animated?: boolean) => void;
  setCompactHeight: (height: number) => void;
  reportScrollY: (y: number) => void;
  bottomInset: number;
};

type CompactContentRenderProps = {
  snapTo: (state: SnapState, animated?: boolean) => void;
};

type ContentPanelProps = {
  children: (props: ContentPanelRenderProps) => React.ReactNode;
  compactContent?: (props: CompactContentRenderProps) => React.ReactNode;
  initialSnap?: SnapState;
  snapGroup?: string;
  snapState?: SnapState;
  onSnapStateChange?: (state: SnapState) => void;
  visible?: boolean;
  onHidden?: () => void;
  zIndex?: number;
  height?: number;
  defaultSnapHeight?: number;
  maxHeight?: number;
  onHeightChange?: (height: number) => void;
  frosted?: boolean;
  showHandle?: boolean;
  allowedSnaps?: SnapState[];
  snapPointHeights?: Partial<Record<SnapState, number>>;
  edgeToEdgeHeight?: number;
  preserveTopRadius?: boolean;
  minSnap?: SnapState;
};

const SCREEN_HEIGHT = Dimensions.get('window').height;
const HANDLE_HEIGHT = 24;
const SHORT_DETENT = { fraction: 0.30 } as const;
const DEFAULT_DETENT = { fraction: 0.60 } as const;
const TALL_DETENT = 'large' as const;
const SNAP_STATES: SnapState[] = ['short', 'default', 'tall'];
const SNAP_ORDER: SnapState[] = ['compact', 'short', 'default', 'tall', 'full'];

export const SNAP_HEIGHTS: Record<SnapState, number> = {
  compact: HANDLE_HEIGHT + 40,
  short: SCREEN_HEIGHT * SHORT_DETENT.fraction,
  default: SCREEN_HEIGHT * DEFAULT_DETENT.fraction,
  tall: SCREEN_HEIGHT * 0.94,
  full: SCREEN_HEIGHT * 0.94,
};

function snapRank(state: SnapState): number {
  return SNAP_ORDER.indexOf(state);
}

function toPanelSnapState(state: SnapState): SnapState {
  if (state === 'compact') return 'short';
  if (state === 'full') return 'tall';
  return state;
}

function normalizeToAllowedSnap(state: SnapState, allowedSnaps: SnapState[]): SnapState {
  const normalized = toPanelSnapState(state);
  if (allowedSnaps.includes(normalized)) return normalized;
  return allowedSnaps.reduce((nearest, candidate) => {
    const nearestDistance = Math.abs(snapRank(nearest) - snapRank(normalized));
    const candidateDistance = Math.abs(snapRank(candidate) - snapRank(normalized));
    return candidateDistance < nearestDistance ? candidate : nearest;
  });
}

function resolveAllowedSnaps(allowedSnaps?: SnapState[], minSnap?: SnapState): SnapState[] {
  const floor = toPanelSnapState(minSnap ?? 'short');
  const requested = allowedSnaps?.map(toPanelSnapState) ?? SNAP_STATES;
  const states = SNAP_STATES.filter(
    (state) => requested.includes(state) && snapRank(state) >= snapRank(floor),
  );
  return states.length > 0 ? states : SNAP_STATES;
}

function detentForSnapState(state: SnapState): PresentationDetent {
  if (state === 'short') return SHORT_DETENT;
  if (state === 'tall') return TALL_DETENT;
  return DEFAULT_DETENT;
}

function fractionForDetent(detent: PresentationDetent): number {
  if (typeof detent === 'object' && 'fraction' in detent) return detent.fraction;
  return 0.94;
}

function snapStateForDetent(detent: PresentationDetent, allowedSnaps: SnapState[]): SnapState {
  const fraction = fractionForDetent(detent);
  const raw = fraction < 0.47 ? 'short' : fraction > 0.75 ? 'tall' : 'default';
  return normalizeToAllowedSnap(raw, allowedSnaps);
}

export default function ContentPanel({
  children,
  initialSnap = 'default',
  snapGroup,
  snapState: controlledSnapState,
  onSnapStateChange,
  visible = true,
  onHidden,
  zIndex,
  height,
  onHeightChange,
  showHandle = false,
  allowedSnaps,
  minSnap,
}: ContentPanelProps) {
  const { width, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [isPresented, setIsPresented] = useState(visible);
  const [localSnapState, setLocalSnapState] = useState<SnapState>(toPanelSnapState(initialSnap));
  const activeSnapGroup = controlledSnapState === undefined ? snapGroup : undefined;
  const [groupSnapState, setGroupSnapState] = useContentPanelSnapGroup(activeSnapGroup, toPanelSnapState(initialSnap));

  useEffect(() => {
    setIsPresented(visible);
  }, [visible]);

  const resolvedSnaps = useMemo(
    () => (height === undefined ? resolveAllowedSnaps(allowedSnaps, minSnap) : (['default'] as SnapState[])),
    [allowedSnaps, height, minSnap],
  );

  const currentSnapState = useMemo(() => {
    const inherited = controlledSnapState ?? (activeSnapGroup ? groupSnapState : localSnapState);
    return normalizeToAllowedSnap(inherited, resolvedSnaps);
  }, [activeSnapGroup, controlledSnapState, groupSnapState, localSnapState, resolvedSnaps]);

  const detents = useMemo<PresentationDetent[]>(
    () => resolvedSnaps.map(detentForSnapState),
    [resolvedSnaps],
  );
  const selection = detentForSnapState(currentSnapState);

  const updateSnapState = useCallback((state: SnapState) => {
    const normalized = normalizeToAllowedSnap(state, resolvedSnaps);
    setLocalSnapState(normalized);
    setGroupSnapState(normalized);
    onSnapStateChange?.(normalized);
    onHeightChange?.(windowHeight * fractionForDetent(detentForSnapState(normalized)));
  }, [onHeightChange, onSnapStateChange, resolvedSnaps, setGroupSnapState, windowHeight]);

  const handleDetentChange = useCallback((detent: PresentationDetent) => {
    updateSnapState(snapStateForDetent(detent, resolvedSnaps));
  }, [resolvedSnaps, updateSnapState]);

  const snapTo = useCallback((state: SnapState) => {
    updateSnapState(state);
  }, [updateSnapState]);

  const modifiers = useMemo(() => [
    ignoreSafeArea({ regions: 'container', edges: 'bottom' }),
    presentationDetents(detents, {
      selection,
      onSelectionChange: handleDetentChange,
    }),
    presentationDragIndicator(showHandle ? 'visible' : 'hidden'),
    presentationBackgroundInteraction({
      type: 'enabledUpThrough',
      detent: DEFAULT_DETENT,
    }),
    interactiveDismissDisabled(true),
    presentationBackground('#FAFAFA'),
  ], [detents, handleDetentChange, selection, showHandle]);

  return (
    <Host style={[styles.host, { width, zIndex }]} pointerEvents="none">
      <BottomSheet
        isPresented={isPresented}
        onIsPresentedChange={setIsPresented}
        onDismiss={onHidden}
      >
        <Group modifiers={modifiers}>
          <RNHostView>
            <View style={styles.content}>
              {children({
                snapState: currentSnapState,
                snapTo,
                setCompactHeight: () => {},
                reportScrollY: () => {},
                bottomInset: insets.bottom,
              })}
            </View>
          </RNHostView>
        </Group>
      </BottomSheet>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
  },
  content: {
    flexGrow: 1,
    height: 0,
    paddingTop: 12,
    backgroundColor: 'transparent',
  },
});
