// api/getSameCoreBalls.js
import { withCors, validateInput } from '../lib/cors.js';

// Whitelist of allowed API endpoints
const ALLOWED_API_BASE = 'https://bowwwl.com/restapi/balls/v2';

async function handler(req, res) {
  const { core, ballId } = req.query;

  // Validate inputs
  const coreValidation = validateInput(core, 'url-safe', 500);
  if (!coreValidation.valid) {
    return res
      .status(400)
      .json({ error: `Invalid core: ${coreValidation.error}` });
  }

  const ballIdValidation = validateInput(ballId, 'alphanumeric', 50);
  if (!ballIdValidation.valid) {
    return res
      .status(400)
      .json({ error: `Invalid ballId: ${ballIdValidation.error}` });
  }

  // Use validated values
  const validCore = encodeURIComponent(coreValidation.value);
  const validBallId = ballIdValidation.value;

  // Construct API URL safely
  const apiUrl = `${ALLOWED_API_BASE}?core=${validCore}`;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'bowwwl-proxy/1.0',
      },
      // Timeout after 10 seconds
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error('Failed to fetch core balls');
    }

    let coreBalls = await response.json();

    // Validate response is an array
    if (!Array.isArray(coreBalls)) {
      throw new Error('Invalid response format');
    }

    // Filter out the specified ball
    coreBalls = coreBalls.filter(
      (coreBall) => coreBall.ball_id !== validBallId,
    );

    res.status(200).json(coreBalls);
  } catch (error) {
    console.error('API Error:', error.message);
    if (error.name === 'AbortError') {
      res.status(504).json({ error: 'Request timeout' });
    } else {
      res.status(500).json({ error: 'Failed to fetch core balls' });
    }
  }
}

export default withCors(handler);
