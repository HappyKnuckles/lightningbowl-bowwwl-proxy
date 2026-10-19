import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchPagedCatalog } from '../lib/upstream.js';

const ball = (id, weight = '15') => ({ ball_id: String(id), core_weight: weight, ball_name: `Ball ${id}` });
const ids = (balls) => balls.map((b) => b.ball_id);

test('pages until an empty page', async () => {
  const pages = [[ball(1), ball(2)], [ball(3)], [ball(4)], [ball(5)], [ball(6)], []];
  const requested = [];
  const result = await fetchPagedCatalog({
    fetchPage: async (page) => {
      requested.push(page);
      return pages[page] ?? [];
    },
  });
  assert.deepEqual(ids(result), ['1', '2', '3', '4', '5', '6']);
  assert.ok(requested.includes(5));
});

test('stops when a page adds nothing new (page parameter ignored or wrapping)', async () => {
  let calls = 0;
  const result = await fetchPagedCatalog({
    fetchPage: async () => {
      calls++;
      return [ball(1), ball(2)];
    },
  });
  assert.deepEqual(ids(result), ['1', '2']);
  assert.ok(calls <= 4, 'stops after the first batch');
});

test('keeps different weights of the same ball apart', async () => {
  const result = await fetchPagedCatalog({ fetchPage: async (page) => (page === 0 ? [ball(1, '15'), ball(1, '14')] : []) });
  assert.equal(result.length, 2);
});

test('fails on a non-array page', async () => {
  await assert.rejects(fetchPagedCatalog({ fetchPage: async () => ({ error: 'nope' }) }));
});
