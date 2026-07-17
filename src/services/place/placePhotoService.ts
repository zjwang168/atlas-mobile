import type { ParsedPlace } from '../import/importService';

const PHOTO_TIMEOUT_MS = 2500;
const MAX_CONCURRENT_REQUESTS = 4;

type WikiSearchPage = {
  title?: string;
  thumbnail?: {
    source?: string;
  };
};

type WikiSearchResponse = {
  query?: {
    pages?: Record<string, WikiSearchPage>;
  };
};

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error('Photo lookup timed out')), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
}

async function fetchPhotoForPlace(place: ParsedPlace): Promise<string | null> {
  const query = [place.name, place.subtitle].filter(Boolean).join(' ');
  if (!query.trim()) return null;

  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: query,
    gsrlimit: '1',
    prop: 'pageimages',
    pithumbsize: '600',
    format: 'json',
    origin: '*',
  });

  try {
    const response = await withTimeout(fetch(`https://en.wikipedia.org/w/api.php?${params.toString()}`), PHOTO_TIMEOUT_MS);
    if (!response.ok) return null;
    const json = (await response.json()) as WikiSearchResponse;
    const page = Object.values(json.query?.pages ?? {})[0];
    return page?.thumbnail?.source ?? null;
  } catch {
    return null;
  }
}

export async function fetchPhotosForPlaces(places: ParsedPlace[]): Promise<Array<string | null>> {
  const results: Array<string | null> = new Array(places.length).fill(null);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (nextIndex < places.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await fetchPhotoForPlace(places[index]);
    }
  }

  const workerCount = Math.min(MAX_CONCURRENT_REQUESTS, places.length);
  await Promise.all(Array.from({ length: workerCount }, worker));
  return results;
}
