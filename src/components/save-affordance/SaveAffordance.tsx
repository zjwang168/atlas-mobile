import Ionicons from '@expo/vector-icons/Ionicons';
import { ActivityIndicator, useColorScheme } from 'react-native';

import type { PlaceSaveOutcome } from '@/types/place';

/** Icons cannot read CSS variables (see THEME.md), so this one semantic colour
    is a literal. It lives here so the surfaces that show a save state cannot
    drift to different greens. */
const SAVED_GREEN = '#12C170';

type SaveAffordanceProps = {
  outcome: PlaceSaveOutcome | null;
  saving?: boolean;
  size?: number;
};

/**
 * The trailing save indicator on a searchable place row: add, in-flight,
 * newly saved, or already in My Places.
 */
export function SaveAffordance({ outcome, saving = false, size = 24 }: SaveAffordanceProps) {
  const scheme = useColorScheme();
  const neutral = scheme === 'dark' ? '#fafafa' : '#0a0a0a';

  if (saving) return <ActivityIndicator size="small" />;
  if (outcome === 'saved') {
    return <Ionicons name="checkmark-circle" size={size} color={SAVED_GREEN} />;
  }
  if (outcome === 'duplicate') {
    return <Ionicons name="checkmark-circle-outline" size={size} color={neutral} />;
  }
  return <Ionicons name="add-circle-outline" size={size} color={neutral} />;
}
