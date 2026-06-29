/**
 * Import / link-parsing service.
 *
 * This is the single seam between the UI and the link parser. Today it returns
 * a mocked result after a short delay so the Analyzing → Save flow can be built
 * and demoed end-to-end. When the native parser is ready, replace the body of
 * `parseLink` with the real call — the UI contract stays the same.
 */

export type ParsedPlace = {
  id: string;
  name: string;
  subtitle: string;
  type: string;
  latitude: number;
  longitude: number;
  /** Optional thumbnail for the place row. */
  imageUri?: string;
};

export type ParseResult = {
  /** Caption/title extracted from the source link, shown in the top pill. */
  sourceTitle: string;
  /** Optional thumbnail of the source link. */
  sourceThumbnail?: string;
  /** Map center to frame the extracted places. */
  centerCoordinate: [number, number];
  /** Region/city the places were grouped under, if any. */
  region?: string;
  places: ParsedPlace[];
};

const EATER_BLURB =
  'From Eater: "René Redzepi\'s legendary spot redefines Nordic cuisine with foraged ingredients and seasonal menus."';

/**
 * Parse pasted text or a URL into places.
 *
 * @param input  Raw text or link the user pasted.
 * @returns      Extracted places. Currently mocked.
 */
export async function parseLink(input: string): Promise<ParseResult> {
  // TODO(native): replace with teammate's native parser, e.g.
  //   return NativeImportModule.parse(input)
  await new Promise((resolve) => setTimeout(resolve, 2200));

  return {
    sourceTitle: 'I thought Wuhan was just breakfast… oh how wrong I was',
    centerCoordinate: [-122.3321, 47.6062],
    region: 'Seattle',
    // Names match entries in mock-data/mockPlaceDetails so tapping a row opens a
    // populated PlaceDetail. Swap these for real parsed places once the native
    // parser is wired in.
    places: [
      { id: '1', name: 'Noma Restaurant', subtitle: EATER_BLURB, type: 'Restaurant', latitude: 47.6101, longitude: -122.3421 },
      { id: '2', name: 'Hidden Sushi', subtitle: EATER_BLURB, type: 'Restaurant', latitude: 47.615, longitude: -122.332 },
      { id: '3', name: 'Sakura Ramen', subtitle: EATER_BLURB, type: 'Ramen', latitude: 47.6205, longitude: -122.325 },
      { id: '4', name: 'Coffee Corner', subtitle: EATER_BLURB, type: 'Cafe', latitude: 47.6062, longitude: -122.336 },
      { id: '5', name: 'The Long Name Gastropub & Provisions', subtitle: EATER_BLURB, type: 'Gastropub', latitude: 47.599, longitude: -122.327 },
      { id: '6', name: 'Noma Restaurant', subtitle: EATER_BLURB, type: 'Restaurant', latitude: 47.5995, longitude: -122.324 },
      { id: '7', name: 'Hidden Sushi', subtitle: EATER_BLURB, type: 'Restaurant', latitude: 47.601, longitude: -122.34 },
      { id: '8', name: 'Sakura Ramen', subtitle: EATER_BLURB, type: 'Ramen', latitude: 47.5985, longitude: -122.3235 },
    ],
  };
}
