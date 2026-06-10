// app.config.js
// Environment variables from .env are auto-loaded by Expo CLI (@expo/env).
// Explicit dotenv loading is included as a fallback.
try {
  require('dotenv').config();
} catch (_) {
  // dotenv may not be resolvable in all contexts; Expo handles .env loading natively.
}

const MAPBOX_ACCESS_TOKEN =
  process.env.MAPBOX_ACCESS_TOKEN || 'YOUR_MAPBOX_ACCESS_TOKEN';

export default {
  expo: {
    name: 'atlas-mobile',
    slug: 'atlas-mobile',
    version: '1.0.0',
    orientation: 'portrait',
    icon: './assets/icon.png',
    userInterfaceStyle: 'light',
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'com.anonymous.atlas-mobile',
    },
    android: {
      adaptiveIcon: {
        backgroundColor: '#E6F4FE',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      package: 'com.anonymous.atlasmobile',
      predictiveBackGestureEnabled: false,
    },
    web: {
      favicon: './assets/favicon.png',
    },
    plugins: [
      [
        '@rnmapbox/maps',
        {
          RNMapboxMapsImpl: 'mapbox',
        },
      ],
    ],
    extra: {
      mapboxAccessToken: MAPBOX_ACCESS_TOKEN,
    },
  },
};
