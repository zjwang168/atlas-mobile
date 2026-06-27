import { mockUser } from '../../../mock-data/mockUser';
import ContentPanel from '../../components/content-panel/ContentPanel';
import { Place } from '../../types/place';
import { ChatMessage, ParseResult } from '../../types/route';
import MyPlaces from '../my-places/MyPlaces';
import MyPlan from '../my-plan/MyPlan';

const BOTTOM_BAR_CLEARANCE = 88;

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
  parseResult,
  isLoading,
  loadingMessage,
  messages,
  onSendMessage,
  error,
  onPlacePress,
  visible,
}: HomePanelProps) {
  return (
    <ContentPanel
      initialSnap="default"
      zIndex={30}
      visible={visible}
      compactContent={() =>
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
      {({ snapState, reportScrollY, bottomInset }) =>
        activeTab === 'myPlaces' ? (
          <MyPlaces
            onPlacePress={onPlacePress}
            onScroll={reportScrollY}
            bottomInset={bottomInset + BOTTOM_BAR_CLEARANCE}
            avatarUri={mockUser.avatarUri}
            avatarFallback={mockUser.avatarFallback}
          />
        ) : (
          <MyPlan
            onScroll={reportScrollY}
            bottomInset={bottomInset + BOTTOM_BAR_CLEARANCE}
          />
        )
      }
    </ContentPanel>
  );
}
