import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { mockUser } from '../../../mock-data/mockUser';
import ContentPanel from '../../components/content-panel/ContentPanel';
import { savePlaces } from '../../services/place/placeService';
import { Place } from '../../types/place';
import MyPlaces from '../my-places/MyPlaces';
import MyPlan from '../my-plan/MyPlan';
import HistoryPlacesPanel from './HistoryPlacesPanel';
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

export default function HomePanel({
  activeTab,
  visible,
  height,
  defaultSnapHeight,
  maxHeight,
  onHeightChange,
}: HomePanelProps) {
  const {
    activeHistoryItem,
    activeSidekick,
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
      height={height}
      snapState={activeTab === TAB_PLAN && isCreatingPlan ? 'full' : undefined}
      defaultSnapHeight={defaultSnapHeight}
      maxHeight={maxHeight}
      onHeightChange={onHeightChange}
      compactContent={activeTab === TAB_PLAN || activeHistoryItem ? undefined : (() =>
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
        <View style={{ flex: 1 }}>
          {activeTab === TAB_PLAN ? (
            <View style={{ flex: 1 }}>
              <MyPlan
                onScroll={reportScrollY}
                bottomInset={BOTTOM_BAR_CLEARANCE}
                onCreateModeChange={setIsCreatingPlan}
              />
            </View>
          ) : activeTab === TAB_PLACES && activeHistoryItem && activeSidekick !== 'aiChat' ? (
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
            <View style={{ flex: 1 }}>
              <MyPlaces
                onPlacePress={handlePlacePress}
                onScroll={reportScrollY}
                bottomInset={BOTTOM_BAR_CLEARANCE}
                avatarUri={mockUser.avatarUri}
                avatarFallback={mockUser.avatarFallback}
              />
            </View>
          )}
        </View>
      )}
    </ContentPanel>
  );
}
