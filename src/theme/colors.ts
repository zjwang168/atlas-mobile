// Runtime color tokens for React Native props that cannot consume NativeWind
// classes, such as icon `color`, `ActivityIndicator.color`, and TextInput
// placeholder colors. Keep these in sync with src/theme/tokens.css.
export const themeColor = {
  gray: {
    50: '#f7f7f7',
    100: '#ebebeb',
    200: '#e0e0e0',
    300: '#d1d1d1',
    400: '#b0b0b0',
    500: '#717171',
    600: '#5c5c5c',
    700: '#444444',
    800: '#2e2e2e',
    900: '#1a1a1a',
  },
  emerald: {
    50: '#e9fbf1',
    100: '#c6f4db',
    200: '#93e6b7',
    300: '#5fd896',
    400: '#2bcb7c',
    500: '#12c170',
    600: '#0fa75f',
    700: '#0c8149',
    800: '#086036',
    900: '#053e23',
  },
  amber: {
    500: '#e8a317',
  },
  red: {
    500: '#e5484d',
  },
} as const;

export const lightThemeColor = {
  background: '#ffffff',
  foreground: themeColor.gray[900],
  primary: themeColor.emerald[500],
  primaryForeground: '#ffffff',
  primaryLight: themeColor.emerald[50],
  primaryPressed: themeColor.emerald[600],
  bg: '#ffffff',
  bgSecondary: themeColor.gray[50],
  surface: '#ffffff',
  border: themeColor.gray[100],
  borderStrong: themeColor.gray[200],
  muted: themeColor.gray[100],
  textPrimary: themeColor.gray[900],
  textSecondary: themeColor.gray[500],
  textTertiary: themeColor.gray[400],
  textInverse: '#ffffff',
  warning: themeColor.amber[500],
  error: themeColor.red[500],
} as const;
