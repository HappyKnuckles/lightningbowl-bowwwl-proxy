// Ball catalog querying: filtering, fuzzy search, sorting, paging and
// "similar reaction" lookups. Pure functions over an array of upstream balls.

import Fuse from 'fuse.js';
import {
  BadRequestError,
  inList,
  paginate,
  parseBoolean,
  parseDate,
  parseEnum,
  parseList,
  parseNumber,
  parsePageable,
  parseSort,
  parseString,
  sortItems,
} from './query.js';

export const BALL_SORT_FIELDS = {
  ball_name: 'string',
  brand_name: 'string',
  release_date: 'date',
  core_rg: 'number',
  core_diff: 'number',
  core_int_diff: 'number',
  core_type: 'string',
  coverstock_type: 'string',
  factory_finish: 'string',
};

export const DEFAULT_BALL_SORT = [{ field: 'release_date', direction: 'desc', kind: 'date' }];

export const MARKETS = ['US', 'Overseas'];
export const CORE_TYPES = ['Symmetric', 'Asymmetric'];

// Same weighting as the app's client-side search, so results stay familiar.
const FUSE_OPTIONS = {
  keys: [
    { name: 'ball_name', weight: 1 },
    { name: 'brand_name', weight: 0.9 },
    { name: 'core_name', weight: 0.7 },
    { name: 'coverstock_name', weight: 0.7 },
    { name: 'factory_finish', weight: 0.5 },
  ],
  threshold: 0.2,
  ignoreLocation: true,
  minMatchCharLength: 3,
  shouldSort: true,
};

/** Unique key of a ball entry: the same ball exists once per weight. */
export const ballKey = (ball) => `${ball.ball_id}-${ball.core_weight}`;

/** Validates the query string of `GET /api/balls` into a typed options object. */
export function parseBallQuery(query) {
  const options = {
    search: parseString('search', query.search ?? query.q),
    weight: parseNumber('weight', query.weight, { min: 0, max: 20 }),
    brands: parseList('brand', query.brand),
    cores: parseList('core', query.core),
    coverstocks: parseList('coverstock', query.coverstock),
    coverstockTypes: parseList('coverstockType', query.coverstockType),
    factoryFinishes: parseList('factoryFinish', query.factoryFinish),
    ids: parseList('id', query.id),
    excludeIds: parseList('excludeId', query.excludeId),
    market: parseEnum('market', query.market, MARKETS),
    coreType: parseEnum('coreType', query.coreType, CORE_TYPES),
    available: parseBoolean('available', query.available),
    releaseDate: parseString('releaseDate', query.releaseDate),
    releasedAfter: parseDate('releasedAfter', query.releasedAfter),
    releasedBefore: parseDate('releasedBefore', query.releasedBefore),
    minRg: parseNumber('minRg', query.minRg),
    maxRg: parseNumber('maxRg', query.maxRg),
    minDiff: parseNumber('minDiff', query.minDiff),
    maxDiff: parseNumber('maxDiff', query.maxDiff),
    minIntDiff: parseNumber('minIntDiff', query.minIntDiff),
    maxIntDiff: parseNumber('maxIntDiff', query.maxIntDiff),
    sort: parseSort(query.sort, BALL_SORT_FIELDS),
    ...parsePageable(query),
  };

  for (const [min, max] of [
    ['minRg', 'maxRg'],
    ['minDiff', 'maxDiff'],
    ['minIntDiff', 'maxIntDiff'],
    ['releasedAfter', 'releasedBefore'],
  ]) {
    if (options[min] !== undefined && options[max] !== undefined && options[min] > options[max]) {
      throw new BadRequestError(`"${min}" must not be greater than "${max}"`);
    }
  }

  return options;
}

function inRange(raw, min, max) {
  if (min === undefined && max === undefined) return true;
  const value = parseFloat(raw);
  if (Number.isNaN(value)) return false;
  return (min === undefined || value >= min) && (max === undefined || value <= max);
}

export function filterBalls(balls, o) {
  return balls.filter((ball) => {
    if (!inList(ball.brand_name, o.brands)) return false;
    if (!inList(ball.core_name, o.cores)) return false;
    if (!inList(ball.coverstock_name, o.coverstocks)) return false;
    if (!inList(ball.coverstock_type, o.coverstockTypes)) return false;
    if (!inList(ball.factory_finish, o.factoryFinishes)) return false;
    if (o.ids.length > 0 && !o.ids.includes(String(ball.ball_id))) return false;
    if (o.excludeIds.includes(String(ball.ball_id))) return false;
    if (o.market && ball.us_int !== o.market) return false;
    if (o.coreType && ball.core_type !== o.coreType) return false;
    if (o.available !== undefined && (ball.availability === 'Available') !== o.available) return false;
    if (o.releaseDate && ball.release_date !== o.releaseDate) return false;
    if (o.releasedAfter !== undefined || o.releasedBefore !== undefined) {
      const released = Date.parse(ball.release_date);
      if (Number.isNaN(released)) return false;
      if (o.releasedAfter !== undefined && released < o.releasedAfter) return false;
      if (o.releasedBefore !== undefined && released > o.releasedBefore) return false;
    }
    if (!inRange(ball.core_rg, o.minRg, o.maxRg)) return false;
    if (!inRange(ball.core_diff, o.minDiff, o.maxDiff)) return false;
    if (!inRange(ball.core_int_diff, o.minIntDiff, o.maxIntDiff)) return false;
    return true;
  });
}

// Fuse indexes are cached per catalog array; the upstream cache hands out the
// same array instance until it refreshes, so the index is built once per refresh.
const indexCache = new WeakMap();

function fuseFor(balls) {
  let index = indexCache.get(balls);
  if (!index) {
    index = Fuse.createIndex(FUSE_OPTIONS.keys, balls);
    indexCache.set(balls, index);
  }
  return new Fuse(balls, FUSE_OPTIONS, index);
}

/**
 * Fuzzy search. Comma-separated terms are searched individually and their
 * results concatenated (each in relevance order), without duplicates.
 */
export function searchBalls(balls, search) {
  const fuse = fuseFor(balls);
  const terms = search
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const seen = new Set();
  const results = [];
  for (const term of terms) {
    for (const { item } of fuse.search(term)) {
      const key = ballKey(item);
      if (!seen.has(key)) {
        seen.add(key);
        results.push(item);
      }
    }
  }
  return results;
}

/**
 * Search → filter → sort → page. With a search term and no explicit sort the
 * results keep relevance order; otherwise the default is newest first.
 */
export function queryBalls(balls, options) {
  let result = options.search ? searchBalls(balls, options.search) : balls;
  result = filterBalls(result, options);

  const orders = options.sort.length > 0 ? options.sort : options.search ? [] : DEFAULT_BALL_SORT;
  result = sortItems(result, orders);

  return paginate(result, options);
}

const RG_TOLERANCE = 0.03;
const DIFF_TOLERANCE = 0.008;
const INT_DIFF_TOLERANCE = 0.005;

/**
 * Balls with a similar expected reaction: same core type and coverstock type,
 * RG and differential within tolerance (and intermediate differential for
 * asymmetric cores). Newest first. Mirrors the app's movement-pattern lookup.
 */
export function findSimilarBalls(ball, balls, limit = 10) {
  const rg = parseFloat(ball.core_rg);
  const diff = parseFloat(ball.core_diff);
  const intDiff = parseFloat(ball.core_int_diff);

  if (Number.isNaN(rg) || Number.isNaN(diff)) {
    return [];
  }

  const similar = balls.filter((other) => {
    if (other.ball_id === ball.ball_id && other.core_weight === ball.core_weight) return false;
    if (other.core_type !== ball.core_type) return false;
    if (other.coverstock_type !== ball.coverstock_type) return false;

    const otherRg = parseFloat(other.core_rg);
    const otherDiff = parseFloat(other.core_diff);
    if (Number.isNaN(otherRg) || Number.isNaN(otherDiff)) return false;
    if (Math.abs(rg - otherRg) > RG_TOLERANCE) return false;
    if (Math.abs(diff - otherDiff) > DIFF_TOLERANCE) return false;

    if (ball.core_type === 'Asymmetric') {
      const otherIntDiff = parseFloat(other.core_int_diff);
      if (Number.isNaN(intDiff) || Number.isNaN(otherIntDiff)) return false;
      if (Math.abs(intDiff - otherIntDiff) > INT_DIFF_TOLERANCE) return false;
    }

    return true;
  });

  return sortItems(similar, DEFAULT_BALL_SORT).slice(0, limit);
}
