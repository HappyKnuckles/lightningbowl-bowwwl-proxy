// Full ball catalog for /api/all-balls.
//
// bowwwl's full-catalog endpoint (/restapi/balls?_format=json) is currently
// broken, so the catalog is assembled from the paged v2 endpoint the bowwwl
// site itself uses, then filtered by weight here. The result is cached in
// memory per warm serverless instance; if bowwwl fails, the last good copy is
// served.

const UPSTREAM_BASE = 'https://bowwwl.com/restapi';
const USER_AGENT = 'bowwwl-proxy/1.0';
const CATALOG_TTL_MS = 60 * 60 * 1000; // 1 hour
const PAGE_BATCH = 4;
const MAX_PAGES = 400;

export class UpstreamError extends Error {
  constructor(message, { timeout = false } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.timeout = timeout;
  }
}

async function fetchJson(url, timeoutMs = 30000) {
  let response;
  try {
    response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    const timeout = error.name === 'TimeoutError' || error.name === 'AbortError';
    throw new UpstreamError(timeout ? 'Upstream request timed out' : 'Upstream request failed', { timeout });
  }
  if (!response.ok) {
    throw new UpstreamError(`Upstream responded with ${response.status}`);
  }
  const data = await response.json();
  if (!Array.isArray(data)) {
    throw new UpstreamError('Invalid response format');
  }
  return data;
}

const ballKey = (ball) => `${ball?.ball_id}-${ball?.core_weight}`;

/**
 * Collects every ball from /balls/v2?page=N. v2 may ignore `page` and return
 * everything at once, so pages 0 and 1 are fetched one at a time first: if
 * page 1 adds nothing, page 0 was the whole catalog. Otherwise the remaining
 * pages are fetched in parallel batches until a page adds no new balls.
 */
export async function fetchV2Catalog({ fetchPage = (page) => fetchJson(`${UPSTREAM_BASE}/balls/v2?page=${page}`) } = {}) {
  const byKey = new Map();
  const addPage = (page) => {
    let added = 0;
    for (const ball of page) {
      const key = ballKey(ball);
      if (!byKey.has(key)) {
        byKey.set(key, ball);
        added++;
      }
    }
    return added;
  };

  if (addPage(await fetchPage(0)) === 0) return [];
  if (addPage(await fetchPage(1)) === 0) return [...byKey.values()];

  for (let first = 2; first < MAX_PAGES; first += PAGE_BATCH) {
    const pages = await Promise.all(Array.from({ length: PAGE_BATCH }, (_, i) => fetchPage(first + i)));
    for (const page of pages) {
      if (addPage(page) === 0) return [...byKey.values()];
    }
  }
  return [...byKey.values()];
}

let cached; // { data, expires }
let inFlight;

async function getCachedCatalog() {
  if (cached && cached.expires > Date.now()) return cached.data;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const data = await fetchV2Catalog();
      cached = { data, expires: Date.now() + CATALOG_TTL_MS };
      return data;
    } catch (error) {
      if (cached) {
        console.error('Serving stale catalog:', error.message);
        return cached.data;
      }
      throw error;
    } finally {
      inFlight = undefined;
    }
  })();
  return inFlight;
}

/**
 * The full catalog, optionally one weight. A weight the v2 catalog doesn't
 * contain falls back to the legacy per-weight endpoint.
 */
export async function getAllBalls(weight) {
  const catalog = await getCachedCatalog();
  if (weight === undefined) return catalog;

  const forWeight = catalog.filter((ball) => Number(ball.core_weight) === weight);
  if (forWeight.length > 0) return forWeight;

  return fetchJson(`${UPSTREAM_BASE}/balls?_format=json&weight=${weight}`, 15000);
}

/** Test hook. */
export function clearCatalogCache() {
  cached = undefined;
  inFlight = undefined;
}
