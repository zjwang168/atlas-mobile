import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Text } from '@/components/ui/text';
import { useHomeAtlases, useHomeChatHistory, useHomeLocation, useHomeOverlayActions } from '@/features/home/HomeContext';
import { atlasCameraFromStops } from '@/features/map/atlasCamera';
import { createChatSession } from '@/services/api/apiService';
import { mockUser } from '../../../mock-data/mockUser';
import type { SnapState } from '../../components/content-panel/ContentPanel';
import AtlasBuilder from './atlas-builder/AtlasBuilder';
import type { AtlasSavedMapView, DraftPlace } from './atlas-builder/AtlasBuilder';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { TouchableOpacity, View } from 'react-native';

type MyPlanProps = {
  onAvatarPress?: () => void;
  compact?: boolean;
  snapTo?: (state: SnapState, animated?: boolean) => void;
  active?: boolean;
  onExit?: () => void;
};

function MyPlan({ onAvatarPress, compact = false, snapTo, active = false, onExit }: MyPlanProps) {
  const { atlases } = useHomeAtlases();
  const { setAtlasMapState, setOverlay, setActiveSidekick } = useHomeOverlayActions();
  const { addChatHistoryItem, replaceChatHistoryItem, setActiveHistoryItem } = useHomeChatHistory();
  const { userLocation } = useHomeLocation();
  const [builderVisible, setBuilderVisible] = useState(false);
  const [buildSeed, setBuildSeed] = useState<DraftPlace[] | null>(null);
  const [draftItems, setDraftItems] = useState<DraftPlace[]>([]);
  const [buildCenter, setBuildCenter] = useState<[number, number] | undefined>();
  const [buildBounds, setBuildBounds] = useState<{ ne: [number, number]; sw: [number, number] } | undefined>();
  const [buildLocation, setBuildLocation] = useState<string | undefined>();
  const [autoFocusCreateSearch, setAutoFocusCreateSearch] = useState(false);
  const [builderKey, setBuilderKey] = useState(0);
  const editorWasEligibleRef = useRef(false);

  const openBuilder = useCallback(() => {
    // Keep the shared map visible above the Atlas editor rather than turning
    // the editor into a full-screen white page.
    snapTo?.('default');
    setBuildSeed(null);
    setDraftItems([]);
    setBuildCenter(undefined);
    setBuildBounds(undefined);
    setBuildLocation(undefined);
    setAutoFocusCreateSearch(false);
    setBuilderKey((value) => value + 1);
    setBuilderVisible(true);
  }, [snapTo]);
  const closeBuilder = useCallback(() => {
    setBuilderVisible(false);
    setBuildSeed(null);
    setDraftItems([]);
    setBuildCenter(undefined);
    setBuildBounds(undefined);
    setBuildLocation(undefined);
    setAutoFocusCreateSearch(false);
    snapTo?.('default');
    onExit?.();
  }, [onExit, snapTo]);
  const returnToCreateSearch = useCallback(() => {
    // This is only passed to provisional editors opened from Create Atlas.
    // Re-mounting clears their temporary recommendations and camera state.
    setBuildSeed(null);
    setDraftItems([]);
    setBuildCenter(undefined);
    setBuildBounds(undefined);
    setBuildLocation(undefined);
    setAutoFocusCreateSearch(true);
    setBuilderKey((value) => value + 1);
    setBuilderVisible(true);
  }, []);
  const openBuildPlan = useCallback((_location: string, candidates: DraftPlace[], center?: [number, number], bounds?: { ne: [number, number]; sw: [number, number] }) => {
    setBuildLocation(_location);
    setBuildSeed(candidates);
    setBuildCenter(center);
    setBuildBounds(bounds);
    setBuilderVisible(true);
  }, []);
  const openSavedAtlasChat = useCallback(async (atlasId: string, mapView?: AtlasSavedMapView) => {
    if (!mapView) return;
    const title = mapView.title || atlases.find((atlas) => atlas.id === atlasId)?.title || 'New Atlas';
    const atlasChatPlaces = mapView.places.map((place) => ({
      name: place.name,
      latitude: place.latitude,
      longitude: place.longitude,
      full_address: place.subtitle,
      description: place.note || place.subtitle,
      category: place.category || 'Place',
      photo_url: place.photo_url || null,
      city: place.city || null,
      region: place.region || null,
      country: place.country || null,
      timeline_day: place.timeline_day ?? null,
      timeline_time: place.timeline_time ?? null,
      transport: place.transport ?? null,
    }));
    const places = mapView.places.map((place) => ({
      id: place.id,
      name: place.name,
      subtitle: place.subtitle,
      type: place.category || 'Place',
      latitude: place.latitude,
      longitude: place.longitude,
      imageUri: place.photo_url || undefined,
      city: place.city || undefined,
      country: place.country || undefined,
    }));
    try {
      const created = await createChatSession({
        title,
        source_url: `atlas:${atlasId}`,
        source_type: 'atlas_edit',
        locations: atlasChatPlaces,
        user_location: userLocation,
      });
      const conversationId = created.conversation_id || created.session_id;
      const createdAt = new Date().toISOString();
      const temporaryId = addChatHistoryItem({ title, sourceUrl: `atlas:${atlasId}`, sourceType: 'atlas_edit', locationCount: places.length, messageCount: 0, places, updatedAt: createdAt });
      const historyItem = { id: conversationId, title, sourceUrl: `atlas:${atlasId}`, sourceType: 'atlas_edit', locationCount: places.length, messageCount: 0, places, createdAt, updatedAt: createdAt, atlasWelcome: { places: atlasChatPlaces } };
      replaceChatHistoryItem(temporaryId, historyItem);
      setActiveHistoryItem(historyItem);
      setActiveSidekick('aiChat');
    } catch (error) {
      console.warn('[MyPlan] could not start Atlas AI chat:', error);
    }
  }, [addChatHistoryItem, atlases, replaceChatHistoryItem, setActiveHistoryItem, setActiveSidekick, userLocation]);
  useEffect(() => {
    const editorEligible = !compact && active;
    const justBecameEligible = editorEligible && !editorWasEligibleRef.current;
    editorWasEligibleRef.current = editorEligible;
    if (justBecameEligible) openBuilder();
  }, [active, compact, openBuilder]);

  if (compact) {
    return <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingVertical: 8 }}><Text style={{ fontSize: 18, fontWeight: '600', color: '#09090b' }}>Atlas</Text><TouchableOpacity onPress={onAvatarPress}><Avatar alt={mockUser.avatarFallback} style={{ width: 32, height: 32 }}>{mockUser.avatarUri ? <AvatarImage source={{ uri: mockUser.avatarUri }} /> : null}<AvatarFallback><Text style={{ fontSize: 11 }}>{mockUser.avatarFallback}</Text></AvatarFallback></Avatar></TouchableOpacity></View>;
  }

  if (builderVisible) {
    return <AtlasBuilder key={builderKey} initialCandidates={buildSeed ?? undefined} initialItems={draftItems} initialCenter={buildCenter} initialBounds={buildBounds} initialLocation={buildLocation} started={buildSeed !== null} autoFocusCreateSearch={autoFocusCreateSearch} onItemsChange={setDraftItems} onClose={closeBuilder} onBuildPlan={openBuildPlan} onReturnToCreateSearch={returnToCreateSearch} onSaved={(atlasId, askAI, mapView) => {
      // Saving transitions directly into the completed Atlas. Do not use
      // closeBuilder here: it calls onExit and visibly returns to My Places.
      const completedCamera = mapView ? atlasCameraFromStops(mapView.markers.map((marker) => ({
        id: marker.id,
        latitude: marker.latitude,
        longitude: marker.longitude,
        title: marker.title,
        description: marker.description,
      }))) : undefined;
      if (mapView && completedCamera) {
        // Keep only the final Atlas orange pins from this exact synchronous
        // state update. Mapbox derives its Web Mercator center and zoom from
        // these bounds plus the completed sheet's live bottom padding.
        setAtlasMapState({
          markers: completedCamera.markers,
          centerCoordinate: completedCamera.centerCoordinate,
          zoomLevel: mapView.zoomLevel,
          bounds: completedCamera.bounds,
          cameraKey: `atlas-save-${atlasId}-${Date.now()}`,
          cameraVerticalOffset: 28,
          cameraAnimationDurationMs: 0,
          selectedMarkerId: null,
          markerPopup: null,
          overlay: null,
        });
      }
      setBuilderVisible(false);
      setBuildSeed(null);
      setDraftItems([]);
      setBuildCenter(undefined);
      setBuildBounds(undefined);
      setBuildLocation(undefined);
      setAutoFocusCreateSearch(false);
      if (askAI) void openSavedAtlasChat(atlasId, mapView);
      else setOverlay({ kind: 'atlasDetail', atlasId });
    }} />;
  }

  return <View style={{ flex: 1 }} />;
}

export default memo(MyPlan);
