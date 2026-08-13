import Ionicons from '@expo/vector-icons/Ionicons';
import { useCallback, useEffect, useRef } from 'react';
import { Image, ScrollView, TouchableOpacity, View } from 'react-native';
import { Text } from '@/components/ui/text';
import { styles } from './styles';
import type { FocusArea } from './types';

export function FocusAreas({ areas, onFocus, disabled, autoScroll = true }: { areas: FocusArea[]; onFocus: (area: FocusArea) => void; disabled?: boolean; autoScroll?: boolean }) {
  const scrollRef = useRef<ScrollView>(null);
  const stoppedRef = useRef(false);
  const offsetRef = useRef(0);
  const contentHeightRef = useRef(0);
  const viewportHeightRef = useRef(0);
  const loopAreas = areas.length > 1 ? [...areas, ...areas] : areas;
  const stopAutoScroll = useCallback(() => {
    stoppedRef.current = true;
  }, []);

  useEffect(() => {
    stoppedRef.current = false;
    offsetRef.current = 0;
    if (!autoScroll) {
      stoppedRef.current = true;
      return;
    }
    const timer = setInterval(() => {
      if (stoppedRef.current) return;
      const cycleHeight = areas.length > 1 ? contentHeightRef.current / 2 : contentHeightRef.current - viewportHeightRef.current;
      if (cycleHeight <= 8) return;
      const nextOffset = offsetRef.current + 0.72;
      offsetRef.current = nextOffset >= cycleHeight ? 0 : nextOffset;
      scrollRef.current?.scrollTo({ y: offsetRef.current, animated: false });
    }, 70);
    return () => clearInterval(timer);
  }, [areas.length, autoScroll]);

  return <ScrollView
    ref={scrollRef}
    style={styles.focusList}
    contentContainerStyle={styles.focusListContent}
    showsVerticalScrollIndicator={false}
    nestedScrollEnabled
    onLayout={(event) => { viewportHeightRef.current = event.nativeEvent.layout.height; }}
    onContentSizeChange={(_, height) => { contentHeightRef.current = height; }}
    onTouchStart={stopAutoScroll}
    onScrollBeginDrag={stopAutoScroll}
  >
    {loopAreas.map((area, index) => <TouchableOpacity disabled={disabled} key={`${area.label}-${index}`} onPress={() => { stopAutoScroll(); onFocus(area); }} style={styles.focusRow}><View style={styles.focusImageWrap}>{area.photoUrl ? <Image source={{ uri: area.photoUrl }} style={styles.focusImage} /> : <View style={styles.focusImageFallback}><Ionicons name="image-outline" size={17} color="#4F6B68" /></View>}</View><View style={styles.focusRowCopy}><Text numberOfLines={1} style={styles.focusText}>Plan {area.label}</Text><Text numberOfLines={1} style={styles.focusMeta}>{area.count} saved place{area.count === 1 ? '' : 's'}</Text></View><Ionicons name="arrow-forward" size={17} color="#6B807E" /></TouchableOpacity>)}
  </ScrollView>;
}
