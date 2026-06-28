import { useState } from 'react';
import { View } from 'react-native';
import { mockUser } from '../../../mock-data/mockUser';
import ContentPanel from '../../components/content-panel/ContentPanel';
import { Place } from '../../types/place';
import { ChatMessage, ParseResult } from '../../types/route';
import MyPlaces from '../my-places/MyPlaces';
import MyPlan from '../my-plan/MyPlan';
import { CREATE_PLAN_HEIGHT } from '../create-plan/CreatePlan';

const BOTTOM_BAR_CLEARANCE = 84;

type HomePanelProps = {
  activeTab: 'myPlaces' | 'travelPlan';
  parseResult: ParseResult | null;
  isLoading: boolean;
  loadingMessage?: string;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  error: string | null;
  onPlacePress?: (place: Place) => void;
  visible?: boolean;
};

export default function HomePanel({
  activeTab,
  onPlacePress,
  visible,
}: HomePanelProps) {
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);

  return (
    <ContentPanel
      initialSnap="default"
      zIndex={30}
      visible={visible}
      defaultSnapHeight={activeTab === 'travelPlan' && isCreatingPlan ? CREATE_PLAN_HEIGHT : undefined}
      compactContent={({ snapTo }) =>
        activeTab === 'myPlaces' ? (
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
          <View style={{ display: activeTab === 'myPlaces' ? 'flex' : 'none', flex: 1 }}>
            <MyPlaces
              onPlacePress={onPlacePress}
              onScroll={reportScrollY}
              bottomInset={BOTTOM_BAR_CLEARANCE}
              avatarUri={mockUser.avatarUri}
              avatarFallback={mockUser.avatarFallback}
            />
          </View>
          <View style={{ display: activeTab === 'travelPlan' ? 'flex' : 'none', flex: 1 }}>
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
