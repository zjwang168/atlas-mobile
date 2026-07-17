/**
 * Free place-photo lookup via Wikipedia page images.
 *
 * Layer 2 of the photo strategy (post og:image → Wikipedia → Places API):
 * zero keys, zero cost, strong hit rate for landmarks. Fetched once at save
 * time and cached forever in places.photo_url — never re-fetched.
 */

const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const REQUEST_TIMEOUT_MS = 2500;
const CONCURRENCY = 4;
const THUMB_SIZE = 640;

/** Look up a representative photo for a place name. Returns null on miss. */
export async function fetchWikipediaPhoto(name: string): Promise<string | null> {
  const term = name.trim();
  if (!term) return null;

  const params = new URLSearchParams({
    action: 'query',
    generator: 'search',
    gsrsearch: term,
    gsrlimit: '1',
    prop: 'pageimages',
    piprop: 'thumbnail',
    pithumbsize: String(THUMB_SIZE),
    format: 'json',
    origin: '*',
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${WIKI_API}?${params.toString()}`, {
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      query?: { pages?: Record<string, { thumbnail?: { source?: string } }> };
    };
    const pages = json.query?.pages;
    if (!pages) return null;
    const first = Object.values(pages)[0];
    return first?.thumbnail?.source ?? null;
  } catch {
    return null; // timeouts / network errors: photo is best-effort
  } finally {
    clearTimeout(timer);
  }
}

/** Fetch photos for a batch with bounded concurrency. Order preserved. */
export async function fetchPhotosForPlaces(
  places: { name: string }[],
): Promise<(string | null)[]> {
  const results: (string | null)[] = new Array(places.length).fill(null);
  let cursor = 0;
  async function worker() {
    while (cursor < places.length) {
      const i = cursor++;
      results[i] = await fetchWikipediaPhoto(places[i].name);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, places.length) }, worker),
  );
  return results;
}
