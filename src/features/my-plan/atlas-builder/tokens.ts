import { lightThemeColor } from "@/theme/colors";

// Prefer NativeWind token classes in JSX. These aliases are only for React
// Native props that require a runtime color string, such as icon colors.
export const atlasBuilderColor = {
  surface: lightThemeColor.surface,
  background: lightThemeColor.bg,
  backgroundSecondary: lightThemeColor.bgSecondary,
  muted: lightThemeColor.muted,
  mutedStrong: lightThemeColor.borderStrong,
  border: lightThemeColor.border,
  borderStrong: lightThemeColor.borderStrong,
  textPrimary: lightThemeColor.textPrimary,
  textSecondary: lightThemeColor.textSecondary,
  textTertiary: lightThemeColor.textTertiary,
  primary: lightThemeColor.primary,
  primaryLight: lightThemeColor.primaryLight,
  primaryPressed: lightThemeColor.primaryPressed,
  textInverse: lightThemeColor.textInverse,
  danger: lightThemeColor.error,
  warningSurface: lightThemeColor.bgSecondary,
  warningBorder: lightThemeColor.warning,
  warningText: lightThemeColor.warning,
} as const;

export type AtlasBuilderColor = typeof atlasBuilderColor;
