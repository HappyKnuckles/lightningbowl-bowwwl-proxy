// GET /api/similar-balls?ballId=<id>[&weight=<lbs>][&limit=<n>]
// Balls with a similar expected reaction to the given ball, newest first.
import { withCors } from '../lib/cors.js';
import { findSimilarBalls } from '../lib/balls.js';
import { BadRequestError, parseInteger, parseNumber, parseString } from '../lib/query.js';
import { sendJson, withErrorHandling } from '../lib/respond.js';
import { getAllBalls } from '../lib/upstream.js';

async function handler(req, res) {
  const ballId = parseString('ballId', req.query.ballId);
  if (!ballId) throw new BadRequestError('Parameter "ballId" is required');
  const weight = parseNumber('weight', req.query.weight, { min: 0, max: 20 });
  const limit = parseInteger('limit', req.query.limit, { min: 1, max: 50 }) ?? 10;

  const balls = await getAllBalls(weight);
  const ball = balls.find((b) => String(b.ball_id) === ballId);

  if (!ball) {
    return res.status(404).json({ error: 'Ball not found' });
  }

  // Compare like with like: only balls of the same weight.
  const sameWeight = balls.filter((b) => b.core_weight === ball.core_weight);
  sendJson(res, findSimilarBalls(ball, sameWeight, limit));
}

export default withCors(withErrorHandling(handler));
