import http from 'node:http';
import { URL } from 'node:url';

import allBalls from './api/all-balls.js';
import ball from './api/ball.js';
import balls from './api/balls.js';
import ballsPages from './api/balls-pages.js';
import brands from './api/brands.js';
import coreBalls from './api/core-balls.js';
import cores from './api/cores.js';
import coverstockBalls from './api/coverstock-balls.js';
import coverstocks from './api/coverstocks.js';
import similarBalls from './api/similar-balls.js';

const PORT = Number(process.env.PORT || 3002);

const routeHandlers = {
  '/api/all-balls': allBalls,
  '/api/ball': ball,
  '/api/balls': balls,
  '/api/balls-pages': ballsPages,
  '/api/brands': brands,
  '/api/core-balls': coreBalls,
  '/api/cores': cores,
  '/api/coverstock-balls': coverstockBalls,
  '/api/coverstocks': coverstocks,
  '/api/similar-balls': similarBalls,
};

function setResponseHelpers(res) {
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };

  res.json = (payload) => {
    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
    }
    res.end(JSON.stringify(payload));
  };

  res.send = (payload) => {
    if (Buffer.isBuffer(payload)) {
      if (!res.getHeader('Content-Type')) {
        res.setHeader('Content-Type', 'application/octet-stream');
      }
      res.end(payload);
      return;
    }

    if (typeof payload === 'object' && payload !== null) {
      res.json(payload);
      return;
    }

    if (!res.getHeader('Content-Type')) {
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    }
    res.end(String(payload));
  };
}

function getQueryObject(searchParams) {
  const query = {};
  for (const [key, value] of searchParams.entries()) {
    if (query[key] === undefined) {
      query[key] = value;
    } else if (Array.isArray(query[key])) {
      query[key].push(value);
    } else {
      query[key] = [query[key], value];
    }
  }
  return query;
}

const server = http.createServer(async (req, res) => {
  setResponseHelpers(res);

  const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = parsedUrl.pathname.endsWith('/') && parsedUrl.pathname !== '/'
    ? parsedUrl.pathname.slice(0, -1)
    : parsedUrl.pathname;

  req.query = getQueryObject(parsedUrl.searchParams);

  const handler = routeHandlers[pathname];
  if (!handler) {
    res.status(404).json({ error: 'Not found' });
    return;
  }

  try {
    await handler(req, res);
  } catch (error) {
    console.error('Proxy dev server error:', error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal server error' });
    }
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Proxy dev server running at http://localhost:${PORT}`);
});
