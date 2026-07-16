import { memo, useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { mockUser } from '../../../mock-data/mockUser';
import ContentPanel from '../../components/content-panel/ContentPanel';
import { Place } from '../../types/place';
import MyPlaces from '../my-places/MyPlaces';
import MyPlan from '../my-plan/MyPlan';
import AccountModal from '../auth/AccountModal';
import { useHome } from './HomeContext';
import { TAB_PLAN, TAB_PLACES } from './HomeTabBar';

const BOTTOM_BAR_CLEARANCE = 84;

type HomePanelProps = {
  activeTab: string;
  visible: boolean;
  height?: number;
  defaultSnapHeight?: number;
  maxHeight?: number;
  onHeightChange?: (height: number) => void;
};

function HomePanel({
  activeTab,
  visible,
  height,
  defaultSnapHeight,
  maxHeight,
  onHeightChange,
}: HomePanelProps) {
  const {
    selectedPlaceId,
    setSelectedPlaceCoordinate,
    setSelectedPlaceId,
  } = useHome();
  const [accountOpen, setAccountOpen] = useState(false);
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);
  const handlePlacePress = useCallback((place: Place) => {
    const nextCoordinate: [number, number] | null =
      selectedPlaceId === place.id ? null : [place.longitude, place.latitude];
    setSelectedPlaceCoordinate(nextCoordinate);
    setSelectedPlaceId(selectedPlaceId === place.id ? null : place.id);
  }, [selectedPlaceId, setSelectedPlaceCoordinate, setSelectedPlaceId]);

  return (
    <>
    <ContentPanel
      initialSnap="default"
      visible={visible}
      height={height}
      snapState={activeTab === TAB_PLAN && isCreatingPlan ? 'full' : undefined}
      defaultSnapHeight={defaultSnapHeight}
      maxHeight={maxHeight}
      onHeightChange={onHeightChange}
      compactContent={activeTab === TAB_PLAN ? undefined : (() =>
        activeTab !== TAB_PLAN ? (
          <MyPlaces
            compact
            avatarUri={mockUser.avatarUri}
            avatarFallback={mockUser.avatarFallback}
          />
        ) : (
          <MyPlan compact />
        )
      )}
    >
      {({ reportScrollY }) => (
        <View style={{ flex: 1 }}>
          {activeTab === TAB_PLAN ? (
            <View style={{ flex: 1 }}>
              <MyPlan
                onScroll={reportScrollY}
                bottomInset={BOTTOM_BAR_CLEARANCE}
                onCreateModeChange={setIsCreatingPlan}
              />
            </View>
          ) : (
            <View style={{ flex: 1 }}>
              <MyPlaces
                onPlacePress={handlePlacePress}
                onScroll={reportScrollY}
                bottomInset={BOTTOM_BAR_CLEARANCE}
                avatarUri={mockUser.avatarUri}
                avatarFallback={mockUser.avatarFallback}
                onAvatarPress={() => setAccountOpen(true)}
              />
            </View>
          )}
        </View>
      )}
    </ContentPanel>
    <AccountModal visible={accountOpen} onClose={() => setAccountOpen(false)} />
    </>
  );
}

export default memo(HomePanel);
