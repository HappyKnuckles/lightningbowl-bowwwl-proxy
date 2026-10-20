// GET /api/all-balls[?weight=lbs] — the whole catalog as a plain array, newest
// first. Kept for existing app versions; new code uses /api/balls.
import { withCors, validateInput } from '../lib/cors.js';
import { sortItems } from '../lib/query.js';
import { getAllBalls } from '../lib/upstream.js';

async function handler(req, res) {
  let weight;
  if (req.query.weight) {
    const weightValidation = validateInput(req.query.weight, 'number');
    if (!weightValidation.valid) {
      return res.status(400).json({ error: `Invalid weight parameter: ${weightValidation.error}` });
    }
    if (weightValidation.value < 0 || weightValidation.value > 20) {
      return res.status(400).json({ error: 'Weight must be between 0 and 20' });
    }
    weight = weightValidation.value;
  }

  try {
    const balls = await getAllBalls(weight);
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400');
    res.setHeader('Vary', 'Origin');
    res.status(200).json(sortItems(balls, [{ field: 'release_date', direction: 'desc', kind: 'date' }]));
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
