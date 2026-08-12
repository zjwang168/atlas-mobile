import { memo, useCallback, type ReactNode } from 'react';
import { Platform, View } from 'react-native';
import type { TopMode } from '../../components/top-nav/TopNav';
import ContentPanel from '../../components/content-panel/ContentPanel';
import { Place, PlaceDetail } from '../../types/place';
import { type PlacesView } from '../my-places/MyPlaces';
import MyPlan from '../my-plan/MyPlan';
import { useHome } from './HomeContext';
import PlacesBottomSheet from './places-bottom-sheet';
import { TAB_PLAN, TAB_PLACES } from './HomeTabBar';

const BOTTOM_BAR_CLEARANCE = 84;

type HomePanelProps = {
  activeTab: string;
  topMode?: TopMode;
  snapGroup?: string;
  visible: boolean;
  height?: number;
  defaultSnapHeight?: number;
  maxHeight?: number;
  onHeightChange?: (height: number) => void;
  onDismissed?: () => void;
  onSearchPress?: () => void;
  onDeleteInitiated?: (place: PlaceDetail) => void;
  placesView?: PlacesView;
  bottomBar?: ReactNode;
};

function HomePanel({
  activeTab,
  topMode = 'saved',
  snapGroup,
  visible,
  height,
  defaultSnapHeight,
  maxHeight,
  onHeightChange,
  onDismissed,
  onSearchPress,
  onDeleteInitiated,
  placesView = 'all',
  bottomBar,
}: HomePanelProps) {
  const { setSelectedPlaceCoordinate, setSelectedPlaceId } = useHome();
  const handlePlacePress = useCallback((place: Place) => {
    setSelectedPlaceCoordinate([place.longitude, place.latitude]);
    setSelectedPlaceId(place.id);
  }, [setSelectedPlaceCoordinate, setSelectedPlaceId]);

  if (Platform.OS === 'ios' && (activeTab === TAB_PLACES || activeTab === TAB_PLAN)) {
    return (
      <PlacesBottomSheet
        visible={visible}
        activeTab={activeTab}
        topMode={topMode}
        snapGroup={snapGroup}
        activeView={placesView}
        onPlacePress={handlePlacePress}
        onHeightChange={onHeightChange}
        onDismissed={onDismissed}
        onSearchPress={onSearchPress}
        onDeleteInitiated={onDeleteInitiated}
        bottomBar={bottomBar}
      />
    );
  }

  if (activeTab === TAB_PLACES) {
    return (
      <PlacesBottomSheet
        visible={visible}
        activeTab={activeTab}
        topMode={topMode}
        snapGroup={snapGroup}
        activeView={placesView}
        onPlacePress={handlePlacePress}
        onHeightChange={onHeightChange}
        onDismissed={onDismissed}
        onSearchPress={onSearchPress}
        onDeleteInitiated={onDeleteInitiated}
        bottomBar={bottomBar}
      />
    );
  }

  return (
    <ContentPanel
      snapGroup={snapGroup}
      visible={visible}
      height={height}
      defaultSnapHeight={defaultSnapHeight}
      maxHeight={maxHeight}
      onHeightChange={onHeightChange}
      compactContent={activeTab === TAB_PLAN ? () => <MyPlan compact /> : undefined}
    >
      {({ reportScrollY, snapTo }) => (
        <View style={{ flex: 1 }}>
          <MyPlan
            onScroll={reportScrollY}
            bottomInset={BOTTOM_BAR_CLEARANCE}
            snapTo={snapTo}
          />
        </View>
      )}
    </ContentPanel>
  );
}

export default memo(HomePanel);
