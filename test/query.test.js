import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestError, paginate, parseList, parsePageable, parseSort, sortItems } from '../lib/query.js';

test('parsePageable defaults to page 0, size 20', () => {
  assert.deepEqual(parsePageable({}), { page: 0, size: 20 });
});

test('parsePageable rejects out-of-range values', () => {
  assert.throws(() => parsePageable({ size: '101' }), BadRequestError);
  assert.throws(() => parsePageable({ page: '-1' }), BadRequestError);
  assert.throws(() => parsePageable({ page: '1.5' }), BadRequestError);
});

test('parseList accepts repeated params and drops blanks', () => {
  assert.deepEqual(parseList('brand', ['Storm', ' ', 'Hammer']), ['Storm', 'Hammer']);
  assert.deepEqual(parseList('brand', 'Storm'), ['Storm']);
  assert.deepEqual(parseList('brand', undefined), []);
});

test('parseSort parses Spring-style field,direction and rejects unknown fields', () => {
  const fields = { name: 'string', rg: 'number' };
  assert.deepEqual(parseSort(['rg,desc', 'name'], fields), [
    { field: 'rg', direction: 'desc', kind: 'number' },
    { field: 'name', direction: 'asc', kind: 'string' },
  ]);
  assert.throws(() => parseSort('password', fields), BadRequestError);
  assert.throws(() => parseSort('rg,sideways', fields), BadRequestError);
});

test('sortItems handles strings case-insensitively, numbers, ties and does not mutate', () => {
  const items = [
    { name: 'b', rg: '2' },
    { name: 'A', rg: '1' },
    { name: 'c', rg: '1' },
  ];
  const sorted = sortItems(items, [
    { field: 'rg', direction: 'asc', kind: 'number' },
    { field: 'name', direction: 'desc', kind: 'string' },
  ]);
  assert.deepEqual(
    sorted.map((i) => i.name),
    ['c', 'A', 'b'],
  );
  assert.equal(items[0].name, 'b');
});

test('paginate returns a Spring-like page envelope', () => {
  const result = paginate([1, 2, 3, 4, 5], { page: 1, size: 2 });
  assert.deepEqual(result, { content: [3, 4], page: { number: 1, size: 2, totalElements: 5, totalPages: 3 } });
  assert.deepEqual(paginate([1], { page: 5, size: 2 }).content, []);
});
