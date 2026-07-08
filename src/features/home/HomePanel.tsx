import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { mockUser } from '../../../mock-data/mockUser';
import ContentPanel from '../../components/content-panel/ContentPanel';
import { savePlaces } from '../../services/place/placeService';
import { Place } from '../../types/place';
import MyPlaces from '../my-places/MyPlaces';
import MyPlan from '../my-plan/MyPlan';
import HistoryPlacesPanel from './HistoryPlacesPanel';
import { useHome } from './HomeContext';
import { TAB_PLAN } from './HomeTabBar';

const BOTTOM_BAR_CLEARANCE = 84;

type HomePanelProps = {
  activeTab: string;
  visible: boolean;
  defaultSnapHeight?: number;
  maxHeight?: number;
  onHeightChange?: (height: number) => void;
};

export default function HomePanel({
  activeTab,
  visible,
  defaultSnapHeight,
  maxHeight,
  onHeightChange,
}: HomePanelProps) {
  const {
    activeHistoryItem,
    refreshSavedPlaces,
    selectedPlaceId,
    setActiveHistoryItem,
    setOverlay,
    setParsedPlaces,
    setSelectedPlaceCoordinate,
    setSelectedPlaceId,
  } = useHome();
  const [isCreatingPlan, setIsCreatingPlan] = useState(false);

  const handlePlacePress = useCallback((place: Place) => {
    const nextCoordinate: [number, number] | null =
      selectedPlaceId === place.id ? null : [place.longitude, place.latitude];
    setSelectedPlaceCoordinate(nextCoordinate);
    setSelectedPlaceId(selectedPlaceId === place.id ? null : place.id);
  }, [selectedPlaceId, setSelectedPlaceCoordinate, setSelectedPlaceId]);

  const handleHistoryPlacePress = useCallback((placeId: string) => {
    const place = activeHistoryItem?.places.find((candidate) => candidate.id === placeId);
    if (!place) return;
    setSelectedPlaceId(place.id);
    setSelectedPlaceCoordinate([place.longitude, place.latitude]);
  }, [activeHistoryItem, setSelectedPlaceCoordinate, setSelectedPlaceId]);

  const handleSaveHistoryPlaces = useCallback(async (selectedIds: string[]) => {
    if (!activeHistoryItem || selectedIds.length === 0) return;
    try {
      const selectedPlaces = activeHistoryItem.places.filter((p) => selectedIds.includes(p.id));
      await savePlaces(selectedPlaces, {
        url: activeHistoryItem.sourceUrl,
      });
      await refreshSavedPlaces();
    } catch (error) {
      console.error('[HomePanel] save history places failed:', error);
    }
  }, [activeHistoryItem, refreshSavedPlaces]);

  return (
    <ContentPanel
      initialSnap="default"
      visible={visible}
      snapState={activeTab === TAB_PLAN && isCreatingPlan ? 'full' : undefined}
      defaultSnapHeight={defaultSnapHeight}
      maxHeight={maxHeight}
      onHeightChange={onHeightChange}
      compactContent={activeHistoryItem ? undefined : (() =>
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
      {({ reportScrollY, bottomInset }) => (
        <>
          {activeHistoryItem ? (
            <HistoryPlacesPanel
              item={activeHistoryItem}
              selectedPlaceId={selectedPlaceId}
              onClose={() => {
                setActiveHistoryItem(null);
                setParsedPlaces([]);
                setSelectedPlaceCoordinate(null);
                setSelectedPlaceId(null);
              }}
              onPlacePress={handleHistoryPlacePress}
              onSavePlaces={handleSaveHistoryPlaces}
              onScroll={reportScrollY}
              bottomInset={bottomInset}
            />
          ) : (
            <>
          <View style={{ display: activeTab !== TAB_PLAN ? 'flex' : 'none', flex: 1 }}>
            <MyPlaces
              onPlacePress={handlePlacePress}
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
        </>
      )}
    </ContentPanel>
  );
}
