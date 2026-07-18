import { memo, useCallback, useState } from 'react';
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
  const { setSelectedPlaceCoordinate, setSelectedPlaceId, panelSnapState, setPanelSnapState } = useHome();
  const [accountOpen, setAccountOpen] = useState(false);
  const handlePlacePress = useCallback((place: Place) => {
    setSelectedPlaceCoordinate([place.longitude, place.latitude]);
    setSelectedPlaceId(place.id);
  }, [setSelectedPlaceCoordinate, setSelectedPlaceId]);

  return (
    <>
    <ContentPanel
      snapState={panelSnapState}
      onSnapStateChange={setPanelSnapState}
      visible={visible}
      height={height}
      defaultSnapHeight={defaultSnapHeight}
      maxHeight={maxHeight}
      onHeightChange={onHeightChange}
      compactContent={() =>
        activeTab === TAB_PLAN ? (
          <MyPlan compact />
        ) : (
          <MyPlaces
            compact
            avatarUri={mockUser.avatarUri}
            avatarFallback={mockUser.avatarFallback}
          />
        )
      }
    >
      {({ reportScrollY, snapTo }) => (
        <View style={{ flex: 1 }}>
          {activeTab === TAB_PLAN ? (
            <View style={{ flex: 1 }}>
              <MyPlan
                onScroll={reportScrollY}
                bottomInset={BOTTOM_BAR_CLEARANCE}
                snapTo={snapTo}
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
