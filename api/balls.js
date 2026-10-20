// GET /api/balls — search, filter, sort and page the ball catalog.
import { withCors } from '../lib/cors.js';
import { parseBallQuery, queryBalls } from '../lib/balls.js';
import { sendJson, withErrorHandling } from '../lib/respond.js';
import { getAllBalls } from '../lib/upstream.js';

async function handler(req, res) {
  const options = parseBallQuery(req.query);
  const balls = await getAllBalls(options.weight);
  sendJson(res, queryBalls(balls, options));
}

export default withCors(withErrorHandling(handler));
