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

/** Full ball catalog, optionally limited to one weight. */
export function getAllBalls(weight) {
  const params = new URLSearchParams({ _format: 'json' });
  if (weight !== undefined) {
    params.set('weight', String(weight));
  }
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
