// GET /api/ball?id=<ballId>[&weight=<lbs>] — one ball, all weight variants
// unless a weight is given. Responds with an array of variants.
import { withCors } from '../lib/cors.js';
import { sortItems, parseNumber, parseString, BadRequestError } from '../lib/query.js';
import { sendJson, withErrorHandling } from '../lib/respond.js';
import { getAllBalls } from '../lib/upstream.js';

async function handler(req, res) {
  const id = parseString('id', req.query.id);
  if (!id) throw new BadRequestError('Parameter "id" is required');
  const weight = parseNumber('weight', req.query.weight, { min: 0, max: 20 });

  const balls = await getAllBalls(weight);
  const variants = balls.filter((ball) => String(ball.ball_id) === id);

  if (variants.length === 0) {
    return res.status(404).json({ error: 'Ball not found' });
  }

  sendJson(res, sortItems(variants, [{ field: 'core_weight', direction: 'desc', kind: 'number' }]));
}

export default withCors(withErrorHandling(handler));
