import { afterEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { clearCatalogCache, fetchV2Catalog, getAllBalls } from '../lib/catalog.js';

const ball = (id, weight = '15', release = '2024-01-01') => ({ ball_id: String(id), core_weight: weight, ball_name: `Ball ${id}`, release_date: release });
const ids = (balls) => balls.map((b) => `${b.ball_id}-${b.core_weight}`);
const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  clearCatalogCache();
});

test('one request each for pages 0 and 1 when v2 ignores the page parameter', async () => {
  const requested = [];
  const result = await fetchV2Catalog({
    fetchPage: async (page) => {
      requested.push(page);
      return [ball(1), ball(2)];
    },
  });
  assert.deepEqual(ids(result), ['1-15', '2-15']);
  assert.deepEqual(requested, [0, 1]);
});

test('follows real paging until a page adds nothing', async () => {
  const pages = [[ball(1)], [ball(2)], [ball(3)], [ball(4)], [], []];
  const result = await fetchV2Catalog({ fetchPage: async (page) => pages[page] ?? [] });
  assert.deepEqual(ids(result), ['1-15', '2-15', '3-15', '4-15']);
});

test('keeps each weight of a ball', async () => {
  const result = await fetchV2Catalog({ fetchPage: async (page) => (page === 0 ? [ball(1, '15'), ball(1, '14')] : []) });
  assert.equal(result.length, 2);
});

function stubFetch(routes) {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const body = routes(url);
    if (body instanceof Error) throw body;
    return { ok: true, status: 200, json: async () => body };
  };
  return calls;
}

test('filters by weight, caches the catalog and falls back to the legacy endpoint for missing weights', async () => {
  const calls = stubFetch((url) => (url.includes('/balls/v2') ? [ball(1, '15'), ball(2, '15')] : [ball(9, '14')]));

  assert.deepEqual(ids(await getAllBalls(15)), ['1-15', '2-15']);
  assert.deepEqual(ids(await getAllBalls()), ['1-15', '2-15']);
  assert.equal(calls.filter((u) => u.includes('/balls/v2')).length, 2, 'catalog fetched once');

  assert.deepEqual(ids(await getAllBalls(14)), ['9-14']);
  assert.ok(calls.some((u) => u.includes('_format=json&weight=14')));
});

test('serves the last good catalog when bowwwl fails after expiry', async () => {
  stubFetch(() => [ball(1)]);
  await getAllBalls();
  const realNow = Date.now;
  Date.now = () => realNow() + 2 * 60 * 60 * 1000;
  try {
    stubFetch(() => new Error('down'));
    assert.deepEqual(ids(await getAllBalls()), ['1-15']);
  } finally {
    Date.now = realNow;
  }
});
