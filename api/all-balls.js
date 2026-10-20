// GET /api/all-balls[?weight=lbs] — the whole catalog as a plain array, newest first.
import { withCors, validateInput } from '../middleware.js';
import { getAllBalls } from '../lib/catalog.js';

async function handler(req, res) {
  // `updated` is still validated for compatibility but no longer forwarded:
  // the catalog now comes from bowwwl's v2 endpoint, which has no such filter.
  if (req.query.updated) {
    const updatedValidation = validateInput(req.query.updated, 'alphanumeric', 50);
    if (!updatedValidation.valid) {
      return res.status(400).json({ error: `Invalid updated parameter: ${updatedValidation.error}` });
    }
  }

  let weight;
  if (req.query.weight) {
    const weightValidation = validateInput(req.query.weight, 'number');
    if (!weightValidation.valid) {
      return res.status(400).json({ error: `Invalid weight parameter: ${weightValidation.error}` });
    }
    // Validate weight is in reasonable range (bowling balls are typically 6-16 lbs)
    if (weightValidation.value < 0 || weightValidation.value > 20) {
      return res.status(400).json({ error: 'Weight must be between 0 and 20' });
    }
    weight = weightValidation.value;
  }

  try {
    const balls = await getAllBalls(weight);
    const sortedBalls = [...balls].sort((a, b) => new Date(b.release_date) - new Date(a.release_date));

    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
    res.status(200).json(sortedBalls);
  } catch (error) {
    console.error('API Error:', error.message);
    if (error.timeout) {
      res.status(504).json({ error: 'Request timeout' });
    } else {
      res.status(500).json({ error: 'Failed to load all balls' });
    }
  }
}

export default withCors(handler);
