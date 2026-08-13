import { Host } from '@expo/ui';
import {
  BottomSheet,
  Group,
  Overlay,
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
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Keyboard, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

import type { SnapState } from '@/components/content-panel/ContentPanel';
import { useContentPanelSnapGroup } from '@/components/content-panel/ContentPanelSnapProvider';
import TopBlurFade from '@/components/ui/top-blur-fade';
import type { TopMode } from '@/components/top-nav/TopNav';
import type { Place, PlaceDetail } from '@/types/place';
import Discover from '../discover/Discover';
import MyPlaces, { type PlacesView } from '../my-places/MyPlaces';
import MyPlan from '../my-plan/MyPlan';
import { TAB_PLAN } from './HomeTabBar';

const SHORT_DETENT = { fraction: 0.30 } as const;
const DEFAULT_DETENT = { fraction: 0.60 } as const;
const TALL_DETENT = 'large' as const;
const DETENTS: PresentationDetent[] = [SHORT_DETENT, DEFAULT_DETENT, TALL_DETENT];
// Edit this number to tune the 40% / 54% card transparency.
// 0 = fully transparent, 1 = solid white.
const SHEET_BACKGROUND_OPACITY = 0.6;
const BOTTOM_BAR_CLEARANCE = 84;
const TAB_BAR_BOTTOM_OFFSET = 16;
const TAB_BAR_WIDTH = 248;
const TAB_BAR_HEIGHT = 52;

type PlacesBottomSheetProps = {
  visible: boolean;
  activeTab: string;
  topMode?: TopMode;
  snapGroup?: string;
  activeView: PlacesView;
  onPlacePress: (place: Place) => void;
  onHeightChange?: (height: number) => void;
  onDismissed?: () => void;
  onSearchPress?: () => void;
  onDeleteInitiated?: (place: PlaceDetail) => void;
  /** MyPlan opens the Atlas builder only while its tab is active, and it
      defaults to inactive — without this the plan tab renders an empty view. */
  isActive?: boolean;
  onExitPlan?: () => void;
  bottomBar?: ReactNode;
};

function detentForSnapState(state: SnapState): PresentationDetent {
  if (state === 'compact' || state === 'short') return SHORT_DETENT;
  if (state === 'full' || state === 'tall') return TALL_DETENT;
  return DEFAULT_DETENT;
}

function fractionForDetent(detent: PresentationDetent): number {
  if (typeof detent === 'object' && 'fraction' in detent) return detent.fraction;
  if (detent === 'medium') return 0.5;
  return 0.94;
}

function snapStateForDetent(detent: PresentationDetent): SnapState {
  const fraction = fractionForDetent(detent);
  if (fraction < 0.47) return 'short';
  if (fraction > 0.75) return 'tall';
  return 'default';
}

function PlacesBottomSheet({
  visible,
  activeTab,
  topMode = 'saved',
  snapGroup,
  activeView,
  onPlacePress,
  onHeightChange,
  onDismissed,
  onSearchPress,
  onDeleteInitiated,
  isActive = true,
  onExitPlan,
  bottomBar,
}: PlacesBottomSheetProps) {
  const { width, height } = useWindowDimensions();
  const [isPresented, setIsPresented] = useState(visible);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardWillShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener('keyboardWillHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);
  const [groupSnapState, setGroupSnapState] = useContentPanelSnapGroup(
    snapGroup,
    'default',
  );
  const selection = detentForSnapState(groupSnapState);

  useEffect(() => {
    setIsPresented(visible);
  }, [visible]);

  const handleDetentChange = useCallback((detent: PresentationDetent) => {
    setGroupSnapState(snapStateForDetent(detent));
    onHeightChange?.(height * fractionForDetent(detent));
  }, [height, onHeightChange, setGroupSnapState]);

  const handleSnapTo = useCallback((state: SnapState) => {
    setGroupSnapState(state);
  }, [setGroupSnapState]);

  const modifiers = useMemo(() => [
    ignoreSafeArea({ regions: 'container', edges: 'bottom' }),
    presentationDetents(DETENTS, {
      selection,
      onSelectionChange: handleDetentChange,
    }),
    presentationDragIndicator('hidden'),
    presentationBackgroundInteraction({
      type: 'enabledUpThrough',
      detent: DEFAULT_DETENT,
    }),
    interactiveDismissDisabled(true),
    presentationBackground('#FAFAFA'),
  ], [handleDetentChange, selection]);

  return (
    <Host style={[styles.host, { width }]} pointerEvents="none">
      <BottomSheet
        isPresented={isPresented}
        onIsPresentedChange={setIsPresented}
        onDismiss={onDismissed}
      >
        <Group modifiers={modifiers}>
          {/* `Overlay` maps to SwiftUI's own `.overlay(alignment:)` — the tab
              bar is composited above the sheet's content by the native
              layout engine in the same pass that drives the sheet's detent
              animation, instead of as an RN child inside the content's own
              (live-resizing) frame. That's what keeps it from lagging behind
              a drag/snap: positioning is native, not bridged through RN
              layout on every frame. It also keeps it genuinely stacked above
              the content (unlike `BottomSheet`'s `anchor` slot, which renders
              *underneath* the presented sheet — it's meant for the trigger
              view, not an overlay). */}
          <Overlay alignment="bottom">
            <RNHostView>
              <View style={styles.content}>
                {activeTab === TAB_PLAN ? (
                  <MyPlan
                    snapTo={handleSnapTo}
                    active={isActive}
                    onExit={onExitPlan}
                  />
                ) : (
                  <>
                    <View
                      collapsable={false}
                      pointerEvents={topMode === 'saved' ? 'auto' : 'none'}
                      style={[
                        styles.modePane,
                        topMode !== 'saved' && styles.modePaneHidden,
                      ]}
                    >
                      <MyPlaces
                        active={topMode === 'saved'}
                        onPlacePress={onPlacePress}
                        bottomInset={BOTTOM_BAR_CLEARANCE}
                        onDeleteInitiated={onDeleteInitiated}
                        activeView={activeView}
                        verticalScrollEnabled={
                          groupSnapState === 'tall' || groupSnapState === 'full'
                        }
                      />
                    </View>
                    <View
                      collapsable={false}
                      pointerEvents={topMode === 'discover' ? 'auto' : 'none'}
                      style={[
                        styles.modePane,
                        topMode !== 'discover' && styles.modePaneHidden,
                      ]}
                    >
                      <Discover
                        active={topMode === 'discover'}
                        // The sheet does not resize for the keyboard, so the
                        // list has to clear it itself or its last results sit
                        // under it with no way to scroll them up.
                        bottomInset={BOTTOM_BAR_CLEARANCE + keyboardHeight}
                        snapTo={handleSnapTo}
                        onSearchPress={onSearchPress}
                        verticalScrollEnabled={
                          groupSnapState === 'tall' || groupSnapState === 'full'
                        }
                      />
                    </View>
                  </>
                )}
                {/* <TopBlurFade
                  edge="bottom"
                  height={120}
                  intensity={80}
                  tint="systemUltraThinMaterialLight"
                  scrim={0}
                /> */}
              </View>
            </RNHostView>
            {bottomBar ? (
              <Overlay.Content>
                {/* `matchContents` sizes this RNHostView to the RN tree's own
                    measured size instead of stretching to the base content's
                    (detent-sized) frame — needed since `HomeTabBar`'s own
                    root is absolutely positioned (out of flow), which reports
                    zero intrinsic size on its own. Wrapping it in an
                    explicit-size box gives SwiftUI a concrete, non-zero size
                    to align at the bottom. */}
                <RNHostView matchContents>
                  <View
                    style={[
                      styles.bottomBarWrap,
                      keyboardHeight > 0 && { transform: [{ translateY: keyboardHeight }] },
                    ]}
                    pointerEvents="box-none"
                  >
                    {bottomBar}
                  </View>
                </RNHostView>
              </Overlay.Content>
            ) : null}
          </Overlay>
        </Group>
      </BottomSheet>
    </Host>
  );
}

export default memo(PlacesBottomSheet);

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
  modePane: {
    position: 'absolute',
    top: 12,
    right: 0,
    bottom: 0,
    left: 0,
  },
  modePaneHidden: {
    opacity: 0,
  },
  // Fixed-size box (not measured from resizing content) so `HomeTabBar`'s own
  // absolutely-positioned root — placed via its `bottomOffset` prop — has a
  // concrete height to resolve `bottom` against.
  bottomBarWrap: {
    width: TAB_BAR_WIDTH,
    height: TAB_BAR_HEIGHT + TAB_BAR_BOTTOM_OFFSET,
    zIndex: 30,
  },
});
