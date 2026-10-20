import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import ballHandler from '../api/ball.js';
import ballsHandler from '../api/balls.js';
import coresHandler from '../api/cores.js';
import similarHandler from '../api/similar-balls.js';
import { clearUpstreamCache } from '../lib/upstream.js';
import { BALLS } from './fixtures.js';

const CORES = [
  { core_name: 'Velocity', brand: 'Storm', id: '1', api_filter_url: '' },
  { core_name: 'Gas Mask', brand: 'Hammer', id: '2', api_filter_url: '' },
];

let upstreamCalls;
let upstream;
const realFetch = globalThis.fetch;

beforeEach(() => {
  clearUpstreamCache();
  upstreamCalls = [];
  upstream = (url) => {
    if (url.includes('/balls')) return BALLS;
    if (url.includes('/cores')) return CORES;
    return [];
  };
  globalThis.fetch = async (url) => {
    upstreamCalls.push(url);
    const body = upstream(url);
    if (body instanceof Error) throw body;
    return { ok: true, json: async () => body };
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

let ip = 0;
async function call(handler, query = {}) {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) {
      this.headers[k.toLowerCase()] = v;
    },
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
    },
    end() {},
  };
  // Fresh client IP per call so the in-memory rate limiter never interferes.
  await handler({ method: 'GET', query, headers: { 'x-forwarded-for': `10.0.0.${++ip}` }, socket: {} }, res);
  return res;
}

test('GET /api/balls returns a page and caching headers', async () => {
  const res = await call(ballsHandler, { brand: 'Storm', size: '2' });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.content.length, 2);
  assert.equal(res.body.page.totalElements, 3);
  assert.match(res.headers['cache-control'], /s-maxage=/);
  assert.equal(res.headers.vary, 'Origin');
});

test('GET /api/balls builds the catalog from v2 pages once and filters by weight locally', async () => {
  const first = await call(ballsHandler, { weight: '15' });
  const callsAfterFirst = upstreamCalls.length;
  const second = await call(ballsHandler, { weight: '14', page: '0' });

  assert.ok(upstreamCalls.every((url) => url.includes('/balls/v2?page=')));
  assert.equal(upstreamCalls.length, callsAfterFirst, 'second request served from cache');
  assert.equal(first.body.page.totalElements, 4);
  assert.deepEqual(
    second.body.content.map((b) => b.core_weight),
    ['14'],
  );
});

test('GET /api/balls rejects invalid params with 400', async () => {
  const res = await call(ballsHandler, { sort: 'nope' });
  assert.equal(res.statusCode, 400);
  assert.match(res.body.error, /Cannot sort by/);
});

test('upstream failures map to 502 and timeouts to 504', async () => {
  upstream = () => new Error('boom');
  assert.equal((await call(ballsHandler)).statusCode, 502);

  clearUpstreamCache();
  upstream = () => Object.assign(new Error('t'), { name: 'TimeoutError' });
  assert.equal((await call(ballsHandler)).statusCode, 504);
});

test('stale cache is served when upstream fails after a successful load', async () => {
  await call(ballsHandler);
  // Force expiry by advancing time past the TTL.
  const realNow = Date.now;
  Date.now = () => realNow() + 2 * 60 * 60 * 1000;
  try {
    upstream = () => new Error('down');
    const res = await call(ballsHandler);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.page.totalElements, BALLS.length);
  } finally {
    Date.now = realNow;
  }
});

test('GET /api/ball returns all weight variants or 404', async () => {
  const res = await call(ballHandler, { id: '1' });
  assert.deepEqual(
    res.body.map((b) => b.core_weight),
    ['15', '14'],
  );
  assert.equal((await call(ballHandler, { id: 'missing' })).statusCode, 404);
  assert.equal((await call(ballHandler, {})).statusCode, 400);
});

test('GET /api/similar-balls compares same-weight balls only', async () => {
  const res = await call(similarHandler, { ballId: '1' });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(
    res.body.map((b) => b.ball_id),
    ['2'],
  );
});

test('GET /api/cores stays a plain array unless paging is requested', async () => {
  const plain = await call(coresHandler);
  assert.ok(Array.isArray(plain.body));
  assert.deepEqual(
    plain.body.map((c) => c.brand),
    ['Hammer', 'Storm'],
  );

  const paged = await call(coresHandler, { brand: 'storm', page: '0' });
  assert.deepEqual(
    paged.body.content.map((c) => c.core_name),
    ['Velocity'],
  );
});
