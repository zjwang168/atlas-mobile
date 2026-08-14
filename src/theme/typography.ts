import { TextStyle } from 'react-native';

/**
 * Typography tokens — mirror the text styles defined in the SPARC Figma file.
 * Also usable directly as NativeWind classNames (`h2`, `bodySmallEmphasis`, ...) —
 * see the `@utility` block in `tokens.css`. Keep both in sync when either changes.
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
 *   <Text className="h2">Hello</Text>
 */
export const typography = {
  /** Display — Semibold 28/34, -1% tracking */
  display: { fontSize: 28, fontWeight: '600', lineHeight: 34, letterSpacing: -0.28 },
  /** Heading/H2 — Semibold 22/28, -1% tracking */
  h2: { fontSize: 22, fontWeight: '600', lineHeight: 28, letterSpacing: -0.22 },
  /** Heading/H3 — Semibold 20/26, -1% tracking */
  h3: { fontSize: 20, fontWeight: '600', lineHeight: 26, letterSpacing: -0.2 },
  /** Heading/Subheader — Semibold 16/22 */
  subheader: { fontSize: 16, fontWeight: '600', lineHeight: 22, letterSpacing: 0 },
  /** Body — Regular 17/24 */
  body: { fontSize: 17, fontWeight: '400', lineHeight: 24, letterSpacing: 0 },
  /** Body Medium — Medium 17/24 */
  bodyMedium: { fontSize: 17, fontWeight: '500', lineHeight: 24, letterSpacing: 0 },
  /** Body Emphasis — Semibold 17/24 */
  bodyEmphasis: { fontSize: 17, fontWeight: '600', lineHeight: 24, letterSpacing: 0 },
  /** Body Small — Regular 15/20 */
  bodySmall: { fontSize: 15, fontWeight: '400', lineHeight: 20, letterSpacing: 0 },
  /** Body Small Medium — Medium 15/20 */
  bodySmallMedium: { fontSize: 15, fontWeight: '500', lineHeight: 20, letterSpacing: 0 },
  /** Body Small Emphasis — Semibold 15/20 */
  bodySmallEmphasis: { fontSize: 15, fontWeight: '600', lineHeight: 20, letterSpacing: 0 },
  /** Caption — Regular 14/18 */
  caption: { fontSize: 14, fontWeight: '400', lineHeight: 18, letterSpacing: 0 },
  /** Caption Medium — Medium 14/20 (looser leading than `caption`: sized for 2-line clamps) */
  captionMedium: { fontSize: 14, fontWeight: '500', lineHeight: 20, letterSpacing: 0 },
  /** Caption Emphasis — Semibold 14/18 */
  captionEmphasis: { fontSize: 14, fontWeight: '600', lineHeight: 18, letterSpacing: 0 },
  /** Label/Tab — Medium 11/14 */
  labelTab: { fontSize: 11, fontWeight: '500', lineHeight: 14 },
} satisfies Record<string, TextStyle>;

export type TypographyToken = keyof typeof typography;
