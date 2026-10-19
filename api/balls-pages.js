// api/loadBalls.js
import { withCors, validateInput } from '../lib/cors.js';

// Whitelist of allowed API endpoints
const ALLOWED_API_BASE = 'https://bowwwl.com/restapi/balls/v2';

async function handler(req, res) {
  const { page } = req.query;

  // Validate page number
  const pageValidation = validateInput(page, 'number');
  if (!pageValidation.valid) {
    return res
      .status(400)
      .json({ error: `Invalid page: ${pageValidation.error}` });
  }

  // Ensure page is positive
  if (pageValidation.value < 0) {
    return res.status(400).json({ error: 'Page must be a positive number' });
  }

  // Construct API URL safely
  const apiUrl = `${ALLOWED_API_BASE}?page=${pageValidation.value}`;

  try {
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'bowwwl-proxy/1.0',
      },
      // Timeout after 10 seconds
      signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
      throw new Error('Failed to fetch balls');
    }

    const data = await response.json();

    // Validate response
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid response format');
    }

    res.status(200).json(data);
  } catch (error) {
    console.error('API Error:', error.message);
    if (error.name === 'AbortError') {
      res.status(504).json({ error: 'Request timeout' });
    } else {
      res.status(500).json({ error: 'Failed to load balls' });
    }
  }
}

export default withCors(handler);
