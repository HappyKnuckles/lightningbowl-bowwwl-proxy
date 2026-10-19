// api/loadAllBalls.js
import { withCors, validateInput } from '../lib/cors.js';

// Whitelist of allowed API endpoints
const ALLOWED_API_BASE = 'https://bowwwl.com/restapi/balls';

async function handler(req, res) {
  let apiUrl = `${ALLOWED_API_BASE}?_format=json`;

  // Validate optional query parameters
  if (req.query.updated) {
    const updatedValidation = validateInput(
      req.query.updated,
      'alphanumeric',
      50,
    );
    if (!updatedValidation.valid) {
      return res
        .status(400)
        .json({
          error: `Invalid updated parameter: ${updatedValidation.error}`,
        });
    }
    apiUrl += `&updated=${encodeURIComponent(updatedValidation.value)}`;
  }

  if (req.query.weight) {
    const weightValidation = validateInput(req.query.weight, 'number');
    if (!weightValidation.valid) {
      return res
        .status(400)
        .json({ error: `Invalid weight parameter: ${weightValidation.error}` });
    }
    // Validate weight is in reasonable range (bowling balls are typically 6-16 lbs)
    if (weightValidation.value < 0 || weightValidation.value > 20) {
      return res.status(400).json({ error: 'Weight must be between 0 and 20' });
    }
    apiUrl += `&weight=${weightValidation.value}`;
  }

  try {
    const response = await fetch(apiUrl, {
      headers: {
        'User-Agent': 'bowwwl-proxy/1.0',
      },
      // Timeout after 15 seconds (this endpoint might be slower)
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      throw new Error('Failed to fetch data from target API');
    }

    const data = await response.json();

    // Validate response is an array
    if (!Array.isArray(data)) {
      throw new Error('Invalid response format');
    }

    const sortedBalls = data.sort(
      (a, b) => new Date(b.release_date) - new Date(a.release_date),
    );

    res.status(200).json(sortedBalls);
  } catch (error) {
    console.error('API Error:', error.message);
    if (error.name === 'AbortError') {
      res.status(504).json({ error: 'Request timeout' });
    } else {
      res.status(500).json({ error: 'Failed to load all balls' });
    }
  }
}

export default withCors(handler);
