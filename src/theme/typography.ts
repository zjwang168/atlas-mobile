import { TextStyle } from 'react-native';

/**
 * Typography tokens — mirror the text styles defined in the SPARC Figma file.
 *
 * Font family: SF Pro, which is the iOS system font — so we don't bundle any
 * font files or set `fontFamily`; React Native's default on iOS already renders
 * SF Pro. Weight maps to fontWeight: Regular → '400', Medium → '500',
 * Semibold → '600'.
 *
 * Usage:
 *   import { typography } from '@/theme/typography';
 *   <Text style={typography.body}>Hello</Text>
 *   <Text style={[typography.caption, { color: '#717171' }]}>Subtitle</Text>
 */
export const typography = {
  /** Display — Semibold 28/34 */
  display: { fontSize: 28, fontWeight: '600', lineHeight: 34 },
  /** Heading/H2 — Semibold 22/28, -0.5% tracking */
  h2: { fontSize: 22, fontWeight: '600', lineHeight: 28, letterSpacing: -0.11 },
  /** Heading/H3 — Semibold 17/22 */
  h3: { fontSize: 17, fontWeight: '600', lineHeight: 22 },
  /** Heading/Subheader — Semibold 15/20 */
  subheader: { fontSize: 15, fontWeight: '600', lineHeight: 20 },
  /** Body — Regular 16/24 */
  body: { fontSize: 16, fontWeight: '400', lineHeight: 24 },
  /** Body Emphasis — Semibold 16/24 */
  bodyEmphasis: { fontSize: 16, fontWeight: '600', lineHeight: 24 },
  /** Body Small — Regular 14/20 */
  bodySmall: { fontSize: 14, fontWeight: '400', lineHeight: 20 },
  /** Body Small Emphasis — Semibold 14/20 */
  bodySmallEmphasis: { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  /** Caption — Regular 13/18 */
  caption: { fontSize: 13, fontWeight: '400', lineHeight: 18 },
  /** Caption Emphasis — Semibold 13/18 */
  captionEmphasis: { fontSize: 13, fontWeight: '600', lineHeight: 18 },
  /** Label/Tab — Medium 11/14 */
  labelTab: { fontSize: 11, fontWeight: '500', lineHeight: 14 },
} satisfies Record<string, TextStyle>;

export type TypographyToken = keyof typeof typography;
