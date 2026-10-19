// Upstream access to the bowwwl.com REST API with an in-memory TTL cache.
//
// The cache lives in module scope, so it is shared by every request a warm
// serverless instance handles. Concurrent requests for the same URL share one
// in-flight fetch instead of hammering the upstream API.

export const UPSTREAM_BASE = 'https://bowwwl.com/restapi';

const USER_AGENT = 'bowwwl-proxy/1.0';

export const TTL = {
  balls: 60 * 60 * 1000, // 1 hour
  catalog: 24 * 60 * 60 * 1000, // brands, cores, coverstocks: 1 day
};

const cache = new Map(); // url -> { data, expires }
const inFlight = new Map(); // url -> Promise

export class UpstreamError extends Error {
  constructor(message, { timeout = false } = {}) {
    super(message);
    this.name = 'UpstreamError';
    this.timeout = timeout;
  }
}

async function fetchJson(url, timeoutMs) {
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

  return response.json();
}

/**
 * Fetches a JSON array from the upstream API, served from cache while fresh.
 * A stale cached copy is returned if the upstream call fails.
 */
export async function fetchList(path, { ttl = TTL.catalog, timeoutMs = 10000 } = {}) {
  const url = `${UPSTREAM_BASE}${path}`;
  const now = Date.now();
  const cached = cache.get(url);

  if (cached && cached.expires > now) {
    return cached.data;
  }

  if (inFlight.has(url)) {
    return inFlight.get(url);
  }

  const request = (async () => {
    try {
      const data = await fetchJson(url, timeoutMs);
      if (!Array.isArray(data)) {
        throw new UpstreamError('Invalid response format');
      }
      cache.set(url, { data, expires: Date.now() + ttl });
      return data;
    } catch (error) {
      if (cached) {
        console.error(`Serving stale data for ${url}:`, error.message);
        return cached.data;
      }
      throw error;
    } finally {
      inFlight.delete(url);
    }
  })();

  inFlight.set(url, request);
  return request;
}

// The full-catalog endpoint (/restapi/balls?_format=json) is currently broken
// upstream, so the catalog is assembled from the paged v2 endpoint instead.
const V2_BATCH = 4; // pages fetched in parallel
const V2_MAX_PAGES = 400; // safety stop

const ballKey = (ball) => `${ball.ball_id}-${ball.core_weight}`;

/**
 * Collects every ball from /balls/v2?page=N. Stops at the first page that is
 * empty or adds no new balls, which covers real paging as well as an ignored
 * or wrapping `page` parameter.
 */
export async function fetchPagedCatalog({ fetchPage = (page) => fetchJson(`${UPSTREAM_BASE}/balls/v2?page=${page}`, 15000) } = {}) {
  const byKey = new Map();

  for (let first = 0; first < V2_MAX_PAGES; first += V2_BATCH) {
    const pageNumbers = Array.from({ length: V2_BATCH }, (_, i) => first + i);
    const pages = await Promise.all(pageNumbers.map((page) => fetchPage(page)));

    for (const page of pages) {
      if (!Array.isArray(page)) {
        throw new UpstreamError('Invalid response format');
      }
      let added = 0;
      for (const ball of page) {
        const key = ballKey(ball);
        if (!byKey.has(key)) {
          byKey.set(key, ball);
          added++;
        }
      }
      if (added === 0) {
        return [...byKey.values()];
      }
    }
  }

  return [...byKey.values()];
}

async function cachedValue(key, ttl, loader) {
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && cached.expires > now) return cached.data;
  if (inFlight.has(key)) return inFlight.get(key);

  const request = (async () => {
    try {
      const data = await loader();
      cache.set(key, { data, expires: Date.now() + ttl });
      return data;
    } catch (error) {
      if (cached) {
        console.error(`Serving stale data for ${key}:`, error.message);
        return cached.data;
      }
      throw error;
    } finally {
      inFlight.delete(key);
    }
  })();

  inFlight.set(key, request);
  return request;
}

/**
 * Full ball catalog, optionally limited to one weight. Built from the v2 pages;
 * a weight that isn't in there falls back to the legacy endpoint.
 */
const weightViews = new WeakMap();

export async function getAllBalls(weight) {
  const catalog = await cachedValue('v2-catalog', TTL.balls, () => fetchPagedCatalog());
  if (weight === undefined) {
    return catalog;
  }

  // Memoized per catalog instance so callers get a stable array (the search
  // index is cached per array).
  let byWeight = weightViews.get(catalog);
  if (!byWeight) {
    byWeight = new Map();
    weightViews.set(catalog, byWeight);
  }
  if (!byWeight.has(weight)) {
    byWeight.set(
      weight,
      catalog.filter((ball) => Number(ball.core_weight) === weight),
    );
  }
  const forWeight = byWeight.get(weight);
  if (forWeight.length > 0) {
    return forWeight;
  }

  const params = new URLSearchParams({ _format: 'json', weight: String(weight) });
  return fetchList(`/balls?${params}`, { ttl: TTL.balls, timeoutMs: 15000 });
}

export const getBrands = () => fetchList('/brands');
export const getCores = () => fetchList('/cores');
export const getCoverstocks = () => fetchList('/coverstocks');

/** Test hook: drop all cached upstream data. */
export function clearUpstreamCache() {
  cache.clear();
  inFlight.clear();
}
