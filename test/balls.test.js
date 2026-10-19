import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findSimilarBalls, parseBallQuery, queryBalls, searchBalls } from '../lib/balls.js';
import { BadRequestError } from '../lib/query.js';
import { BALLS, makeBall } from './fixtures.js';

const run = (query) => queryBalls(BALLS, parseBallQuery(query));
const ids = (page) => page.content.map((b) => `${b.ball_id}-${b.core_weight}`);

test('defaults to newest first', () => {
  assert.deepEqual(ids(run({})), ['2-15', '3-15', '4-15', '1-15', '1-14']);
});

test('filters by brand case-insensitively and by repeated values', () => {
  assert.deepEqual(ids(run({ brand: 'storm' })), ['2-15', '1-15', '1-14']);
  assert.deepEqual(ids(run({ brand: ['Hammer', 'Motiv'] })), ['3-15', '4-15']);
});

test('filters by market, core type and availability', () => {
  assert.deepEqual(ids(run({ market: 'overseas' })), ['3-15']);
  assert.deepEqual(ids(run({ coreType: 'Asymmetric' })), ['3-15']);
  assert.deepEqual(ids(run({ available: 'false' })), ['3-15']);
  assert.throws(() => parseBallQuery({ market: 'Mars' }), BadRequestError);
});

test('filters by coverstock name (not ball name)', () => {
  assert.deepEqual(ids(run({ coverstock: 'Aggression' })), ['3-15']);
});

test('numeric ranges exclude unparsable values only when a range is set', () => {
  assert.deepEqual(ids(run({ minRg: '2.49', maxRg: '2.50' })), ['2-15', '3-15']);
  assert.ok(ids(run({})).includes('4-15'));
  assert.throws(() => parseBallQuery({ minRg: '3', maxRg: '2' }), BadRequestError);
});

test('release date range', () => {
  assert.deepEqual(ids(run({ releasedAfter: '2021-01-01', releasedBefore: '2022-12-31' })), ['3-15', '4-15']);
});

test('id and excludeId lists', () => {
  assert.deepEqual(ids(run({ id: ['1', '4'] })), ['4-15', '1-15', '1-14']);
  assert.deepEqual(ids(run({ excludeId: '1' })), ['2-15', '3-15', '4-15']);
});

test('sorts by explicit sort param', () => {
  assert.deepEqual(ids(run({ sort: 'ball_name,asc', brand: 'Storm' })), ['1-15', '1-14', '2-15']);
  assert.deepEqual(ids(run({ sort: ['core_rg,desc', 'release_date,asc'], brand: 'Storm' })), ['2-15', '1-15', '1-14']);
});

test('pages results', () => {
  const page = run({ page: '1', size: '2' });
  assert.deepEqual(ids(page), ['4-15', '1-15']);
  assert.deepEqual(page.page, { number: 1, size: 2, totalElements: 5, totalPages: 3 });
});

test('search is fuzzy, keeps relevance order and supports comma-separated terms', () => {
  assert.deepEqual(
    searchBalls(BALLS, 'widow').map((b) => b.ball_id),
    ['3'],
  );
  assert.deepEqual(
    searchBalls(BALLS, 'jackal, widow').map((b) => b.ball_id),
    ['4', '3'],
  );
  // typo tolerance
  assert.ok(searchBalls(BALLS, 'jackel').some((b) => b.ball_id === '4'));
});

test('search combines with filters', () => {
  assert.deepEqual(ids(run({ search: 'phaze', weight: undefined, sort: 'release_date,desc' })), ['2-15', '1-15', '1-14']);
  assert.deepEqual(ids(run({ q: 'phaze', excludeId: '2' })).sort(), ['1-14', '1-15']);
});

test('findSimilarBalls matches core type, coverstock type and tolerances', () => {
  const base = makeBall({ ball_id: 'x', core_rg: '2.50', core_diff: '0.050' });
  const pool = [
    base,
    makeBall({ ball_id: 'close', core_rg: '2.52', core_diff: '0.055', release_date: '2024-01-01' }),
    makeBall({ ball_id: 'closer-older', core_rg: '2.50', core_diff: '0.050', release_date: '2019-01-01' }),
    makeBall({ ball_id: 'far-rg', core_rg: '2.60' }),
    makeBall({ ball_id: 'other-cover', coverstock_type: 'Pearl Reactive' }),
    makeBall({ ball_id: 'asym', core_type: 'Asymmetric' }),
  ];
  assert.deepEqual(
    findSimilarBalls(base, pool).map((b) => b.ball_id),
    ['close', 'closer-older'],
  );
  assert.deepEqual(findSimilarBalls(makeBall({ core_rg: 'n/a' }), pool), []);
  assert.equal(findSimilarBalls(base, pool, 1).length, 1);
});
