import { ViewStyle } from 'react-native';

/**
 * Elevation tokens — the shadows that have been signed off. Same idea as
 * `typography.ts`: spread a token instead of writing shadow values inline, so
 * retuning a level is one edit rather than a search across features.
 *
 * Usage:
 *   import { elevation } from '@/theme/elevation';
 *   card: { borderRadius: 20, ...elevation.card }
 *
 * Only ratified levels belong here. A surface that needs something else keeps
 * its own value locally until that value has been agreed on — see DESIGN-SPEC.md.
 */
export const elevation = {
  /** Resting surfaces — list rows, detail cards, stat tiles. */
  card: {
    boxShadow: '0 7px 14px rgba(0,0,0,0.02)',
  },
  /**
   * Circular controls floating over a map or a photo.
   *
   * Legacy shadow props rather than a `boxShadow` string, deliberately: RN's CSS
   * blur radius is roughly twice the legacy `shadowRadius`, so the string form
   * renders this at about half the softness it was tuned at. Do not "modernise"
   * it without re-tuning against the buttons in ProfileSettings.
   */
  floatingButton: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
  },
} satisfies Record<string, ViewStyle>;

export type ElevationToken = keyof typeof elevation;
