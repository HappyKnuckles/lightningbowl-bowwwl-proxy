import { BadRequestError } from './query.js';
import { UpstreamError } from './upstream.js';

/**
 * Sends JSON with CDN caching. Responses vary by Origin because the CORS
 * headers set in middleware.js depend on it.
 */
export function sendJson(res, body, { maxAge = 300, staleWhileRevalidate = 3600 } = {}) {
  res.setHeader('Cache-Control', `public, max-age=0, s-maxage=${maxAge}, stale-while-revalidate=${staleWhileRevalidate}`);
  res.setHeader('Vary', 'Origin');
  res.status(200).json(body);
}

/** Maps known error types to HTTP status codes. */
export function withErrorHandling(handler) {
  return async (req, res) => {
    try {
      return await handler(req, res);
    } catch (error) {
      if (error instanceof BadRequestError) {
        return res.status(400).json({ error: error.message });
      }
      if (error instanceof UpstreamError) {
        console.error('Upstream error:', error.message);
        return res.status(error.timeout ? 504 : 502).json({
          error: error.timeout ? 'Upstream request timed out' : 'Failed to load data from upstream API',
        });
      }
      console.error('Handler error:', error);
      return res.status(500).json({ error: 'Internal server error' });
    }
  };
}
