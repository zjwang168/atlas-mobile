# OurAtlas — Mobile

Now, our MVP is a React Native (Expo) mobile app for collaboratively mapping and exploring places, powered by **Mapbox**.

## Prerequisites

- **Node.js** >= 18
- **Xcode** >= 16 (for iOS development)
- **CocoaPods** >= 1.16 (for iOS dependencies)
- **Expo CLI** (install globally: `npm install -g expo-cli`)

## Getting Started

### 1. Clone & Install Dependencies

```bash
git clone <repo-url>
cd atlas-mobile
npm install
```

### 2. Set Up the Mapbox Access Token

This project uses [Mapbox](https://www.mapbox.com/) for map rendering. A public access token (`pk.`) is required.

1. Create a `.env` file in the project root:
   ```
   MAPBOX_ACCESS_TOKEN=pk.eyJ...your-token-here (will be shared in our WeChat group)
   ```
2. The token will be auto-loaded by Expo and injected into the app at build time.

> The access token is shared in the team group chat. It is already listed in `.env` for existing team members.

### 3. Generate Native Projects

```bash
npx expo prebuild --clean
```

This generates the `ios/` directory with all necessary native dependencies (Mapbox SDK, React Native pods, etc.).

### 4. Run on iOS

```bash
npx expo run:ios
```

This will:
1. Install CocoaPods dependencies
2. Build the native Xcode project
3. Launch the Expo Dev Client on the iOS simulator (or connected device)

> **First launch**: The Dev Client downloads the JS bundle from Metro. This is a development-only step — production builds have the bundle compiled into the app binary.

### 5. Start Developing

Once the app is running, Metro Bundler will watch for file changes and hot-reload automatically.

- **Press `r`** in the terminal to reload the JS bundle
- **Press `d`** to open the developer menu on device/simulator
- **Press `i`** to open in iOS simulator (if using `expo start`)

## Production Build

To build a standalone IPA for App Store distribution:

```bash
npm install -g eas-cli
eas build --platform ios
```

## Project Structure

```
atlas-mobile/
├── app.config.js          # Expo configuration (plugins, env vars)
├── App.tsx                # Root component with error boundary
├── src/
│   ├── features/
│   │   ├── map/
│   │   │   ├── MapboxMap.tsx    # Mapbox map component
│   │   │   └── MAP.md           # Mapbox integration & design guide
│   │   ├── home/
│   │   │   └── HomeScreen.tsx   # Main screen with map + overlay
│   │   ├── collections/
│   │   ├── import/
│   │   └── place/
│   ├── data/
│   │   └── mockPlaces.ts        # Placeholder place data
│   ├── services/
│   ├── types/
│   └── utils/
├── .env                   # Local environment variables (gitignored)
├── assets/
└── docs/
```

## Troubleshooting

### `pod install` fails

If CocoaPods fails during `npx expo run:ios`, try:

```bash
cd ios && pod install --repo-update
```

### Build fails with stale cache errors

If the project directory was moved, clean cached build artifacts:

```bash
rm -rf node_modules/expo-modules-jsi/apple/.DerivedData
rm -rf ~/Library/Developer/Xcode/DerivedData
npx expo run:ios
```

### Map shows a blank or 64×64 area

This indicates the Mapbox `MapView` couldn't measure its container. The component uses `useWindowDimensions` to set explicit dimensions — ensure the parent view has proper layout constraints.

## Tech Stack

| Component | Library |
|-----------|---------|
| Framework | React Native 0.85 + Expo SDK 56 |
| Map SDK | `@rnmapbox/maps@10.3.1` (Mapbox v11) |
| Navigation | `@react-navigation/native` v7 |
| Gestures | `react-native-gesture-handler` |
| Animations | `react-native-reanimated` |
| Bottom Sheet | `@gorhom/bottom-sheet` |
