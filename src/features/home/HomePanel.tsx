import { useState } from 'react';
import { View } from 'react-native';
import { mockUser } from '../../../mock-data/mockUser';
import ContentPanel from '../../components/content-panel/ContentPanel';
import { Place } from '../../types/place';
import MyPlaces from '../my-places/MyPlaces';
import MyPlan from '../my-plan/MyPlan';
import { useHome } from './HomeContext';
import { TAB_PLAN } from './HomeTabBar';

const BOTTOM_BAR_CLEARANCE = 84;

type HomePanelProps = {
  activeTab: string;
  visible: boolean;
};

export default function HomePanel({ activeTab, visible }: HomePanelProps) {
  const { setOverlay } = useHome();
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);

  return (
    <ContentPanel
      initialSnap="default"
      visible={visible}
      snapState={activeTab === TAB_PLAN && isCreatingPlan ? 'full' : undefined}
      compactContent={({ snapTo }) =>
        activeTab !== TAB_PLAN ? (
          <MyPlaces
            compact
            avatarUri={mockUser.avatarUri}
            avatarFallback={mockUser.avatarFallback}
          />
        ) : (
          <MyPlan compact />
        )
      }
    >
      {({ reportScrollY, bottomInset }) => (
        <>
          <View style={{ display: activeTab !== TAB_PLAN ? 'flex' : 'none', flex: 1 }}>
            <MyPlaces
              onPlacePress={(place: Place) =>
                setOverlay({ kind: 'placeDetail', placeName: place.name })
              }
              onScroll={reportScrollY}
              bottomInset={BOTTOM_BAR_CLEARANCE}
              avatarUri={mockUser.avatarUri}
              avatarFallback={mockUser.avatarFallback}
            />
          </View>
          <View style={{ display: activeTab === TAB_PLAN ? 'flex' : 'none', flex: 1 }}>
            <MyPlan
              onScroll={reportScrollY}
              bottomInset={BOTTOM_BAR_CLEARANCE}
              onCreateModeChange={setIsCreatingPlan}
            />
          </View>
        </>
      )}
    </ContentPanel>
  );
}
