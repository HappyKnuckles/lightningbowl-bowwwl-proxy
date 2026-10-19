// api/getSameCoverstockBalls.js
import { withCors, validateInput } from '../lib/cors.js';

// Whitelist of allowed API endpoints
const ALLOWED_API_BASE = 'https://bowwwl.com/restapi/balls/v2';

async function handler(req, res) {
  const { coverstock, ballId } = req.query;

  // Validate inputs
  const coverstockValidation = validateInput(coverstock, 'url-safe', 500);
  if (!coverstockValidation.valid) {
    return res
      .status(400)
      .json({ error: `Invalid coverstock: ${coverstockValidation.error}` });
  }

  const ballIdValidation = validateInput(ballId, 'alphanumeric', 50);
  if (!ballIdValidation.valid) {
    return res
      .status(400)
      .json({ error: `Invalid ballId: ${ballIdValidation.error}` });
  }

  // Use validated values
  const validCoverstock = encodeURIComponent(coverstockValidation.value);
  const validBallId = ballIdValidation.value;

  // Construct API URL safely
  const apiUrl = `${ALLOWED_API_BASE}?coverstock=${validCoverstock}`;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'bowwwl-proxy/1.0',
      },
      // Timeout after 10 seconds
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error('Failed to fetch coverstock balls');
    }

    let coverstockBalls = await response.json();

    // Validate response is an array
    if (!Array.isArray(coverstockBalls)) {
      throw new Error('Invalid response format');
    }

    // Filter out the specified ball
    coverstockBalls = coverstockBalls.filter(
      (coverstockBall) => coverstockBall.ball_id !== validBallId,
    );

    res.status(200).json(coverstockBalls);
  } catch (error) {
    console.error('API Error:', error.message);
    if (error.name === 'AbortError') {
      res.status(504).json({ error: 'Request timeout' });
    } else {
      res.status(500).json({ error: 'Failed to fetch coverstock balls' });
    }
  }
}

export default withCors(handler);
