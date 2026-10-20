// Rate limiting store (in-memory)
const rateLimitStore = new Map();

// Clean up old entries every 5 minutes.
// Vercel also loads this root-level file as edge Routing Middleware, where
// setInterval returns a number, so unref() (which lets Node test runs exit)
// must be optional.
const cleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of rateLimitStore.entries()) {
    if (now - value.resetTime > 60000) {
      rateLimitStore.delete(key);
    }
  }
}, 300000);
cleanupTimer?.unref?.();

// Rate limiting configuration
const RATE_LIMIT = {
  windowMs: 60000, // 1 minute
  maxRequests: 100, // 100 requests per minute per IP
};

// Rate limiter middleware
function rateLimit(req, res) {
  const clientId =
    req.headers['x-forwarded-for']?.split(',')[0] ||
    req.socket.remoteAddress ||
    'unknown';

  const now = Date.now();
  const clientData = rateLimitStore.get(clientId);

  if (!clientData || now - clientData.resetTime > RATE_LIMIT.windowMs) {
    // New window
    rateLimitStore.set(clientId, {
      count: 1,
      resetTime: now,
    });
    return true;
  }

  if (clientData.count >= RATE_LIMIT.maxRequests) {
    // Rate limit exceeded
    res.setHeader(
      'Retry-After',
      Math.ceil((RATE_LIMIT.windowMs - (now - clientData.resetTime)) / 1000),
    );
    res.status(429).json({
      error: 'Too many requests. Please try again later.',
      retryAfter: Math.ceil(
        (RATE_LIMIT.windowMs - (now - clientData.resetTime)) / 1000,
      ),
    });
    return false;
  }

  // Increment count
  clientData.count++;
  rateLimitStore.set(clientId, clientData);

  // Set rate limit headers
  res.setHeader('X-RateLimit-Limit', RATE_LIMIT.maxRequests);
  res.setHeader(
    'X-RateLimit-Remaining',
    RATE_LIMIT.maxRequests - clientData.count,
  );
  res.setHeader(
    'X-RateLimit-Reset',
    new Date(clientData.resetTime + RATE_LIMIT.windowMs).toISOString(),
  );

  return true;
}

// Input validation helper
export function validateInput(value, type = 'string', maxLength = 100) {
  if (value === undefined || value === null) {
    return { valid: false, error: 'Missing required parameter' };
  }

  const strValue = String(value);

  if (strValue.length > maxLength) {
    return {
      valid: false,
      error: `Parameter too long (max ${maxLength} characters)`,
    };
  }

  switch (type) {
    case 'number':
      const num = Number(strValue);
      if (isNaN(num) || !isFinite(num)) {
        return { valid: false, error: 'Invalid number' };
      }
      return { valid: true, value: num };

    case 'alphanumeric':
      if (!/^[a-zA-Z0-9\s\-_]+$/.test(strValue)) {
        return { valid: false, error: 'Invalid characters detected' };
      }
      return { valid: true, value: strValue };

    case 'url-safe':
      // For query parameters that will be URL encoded
      if (!/^[a-zA-Z0-9\s\-_.~%()+/]+$/.test(strValue)) {
        return { valid: false, error: 'Invalid characters detected' };
      }
      return { valid: true, value: strValue };

    case 'string':
    default:
      // Reject HTML-significant characters rather than trying to strip tags.
      // Regex-based tag filtering is circumventable (e.g. `</script >`, split
      // or nested tags) and stripping can re-expose the payload it removed.
      if (/[<>"'`&]/.test(strValue)) {
        return { valid: false, error: 'Invalid characters detected' };
      }
      return { valid: true, value: strValue };
  }
}

// Allowed CORS origins - configurable via ALLOWED_ORIGINS env variable (comma-separated)
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

// Fixed regex for Vercel preview deployments of the lightningbowl project
const vercelPreviewRegex =
  /^https:\/\/lightningbowl-[a-z0-9]+(?:-[a-z0-9]+)*-nicos-projects-1c3811a7\.vercel\.app$/;

// CORS middleware wrapper for Vercel serverless functions
export function withCors(handler) {
  return async (req, res) => {
    // Apply rate limiting first
    if (!rateLimit(req, res)) {
      return; // Rate limit exceeded, response already sent
    }

    const origin = req.headers.origin;

    // More strict CORS - only allow credentials for known origins or Vercel preview deployments
    const isAllowedOrigin =
      allowedOrigins.includes(origin) ||
      (!!origin && vercelPreviewRegex.test(origin));

    if (isAllowedOrigin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      res.setHeader('Access-Control-Max-Age', '86400'); // Cache preflight for 24 hours
    } else if (origin === 'null') {
      // For installed PWAs - don't allow credentials
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '86400');
    } else if (origin) {
      // Unknown origin - reject
      res.status(403).json({ error: 'Origin not allowed' });
      return;
    }

    // Security headers
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '1; mode=block');
    res.setHeader(
      'Strict-Transport-Security',
      'max-age=31536000; includeSubDomains',
    );

    // Handle preflight OPTIONS request
    if (req.method === 'OPTIONS') {
      res.status(200).end();
      return;
    }

    // Only allow GET requests
    if (req.method !== 'GET') {
      res.status(405).json({ error: 'Method not allowed' });
      return;
    }

    // Continue to the actual handler
    try {
      return await handler(req, res);
    } catch (error) {
      console.error('Handler error:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  };
}
