/**
 * Device location.
 *
 * Wraps `expo-location` so the rest of the app never has to reason about
 * permission states: every call resolves to a usable coordinate, falling back
 * to the default map center when permission is refused or the fix fails. It
 * never throws and never returns null — a caller that has to null-check would
 * end up reimplementing the fallback at each site.
 */

import * as Location from 'expo-location';

import { DEFAULT_MAP_CENTER } from '@/utils/constants';

export type LocationPermissionStatus = 'undetermined' | 'granted' | 'denied';

export type UserLocationResult = {
  /** `[longitude, latitude]`, matching Mapbox's ordering. */
  coordinate: [number, number];
  status: LocationPermissionStatus;
  /** True when `coordinate` is the default center rather than a real fix. */
  isFallback: boolean;
};

const FALLBACK: UserLocationResult = {
  coordinate: DEFAULT_MAP_CENTER,
  status: 'denied',
  isFallback: true,
};

/** Whether permission is already granted, without prompting for it. */
export async function getLocationPermissionStatus(): Promise<LocationPermissionStatus> {
  try {
    const { granted, canAskAgain } = await Location.getForegroundPermissionsAsync();
    if (granted) return 'granted';
    return canAskAgain ? 'undetermined' : 'denied';
  } catch {
    return 'denied';
  }
}

/**
 * Resolve the device's position, prompting for permission the first time.
 *
 * iOS only shows the system prompt once; after a refusal this resolves to the
 * fallback without prompting again, so it is safe to call on every "locate me"
 * tap.
 */
export async function requestUserLocation(): Promise<UserLocationResult> {
  try {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    if (!granted) return FALLBACK;

    const position = await Location.getCurrentPositionAsync({
      // Balanced rather than High: a map recenter does not need metre-level
      // precision, and High keeps the GPS radio busy for noticeably longer.
      accuracy: Location.Accuracy.Balanced,
    });

    return {
      coordinate: [position.coords.longitude, position.coords.latitude],
      status: 'granted',
      isFallback: false,
    };
  } catch (error) {
    // Location services switched off entirely, a timeout, or a simulator with
    // no location set — all mean the same thing to a caller.
    console.warn('[locationService] falling back to default center:', error);
    return FALLBACK;
  }
}
