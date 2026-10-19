// Generic query-string parsing, sorting and paging helpers shared by the API
// handlers. Everything here is pure and framework-free so it can be unit tested.

export class BadRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = 'BadRequestError';
  }
}

const MAX_PARAM_LENGTH = 200;
const MAX_LIST_ITEMS = 100;

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

function isMissing(value) {
  return value === undefined || value === null || value === '';
}

/** First value of a possibly repeated query parameter. */
function single(name, value) {
  const result = Array.isArray(value) ? value[value.length - 1] : value;
  if (!isMissing(result) && String(result).length > MAX_PARAM_LENGTH) {
    throw new BadRequestError(`Parameter "${name}" is too long (max ${MAX_PARAM_LENGTH} characters)`);
  }
  return result;
}

export function parseString(name, value) {
  const result = single(name, value);
  return isMissing(result) ? undefined : String(result).trim() || undefined;
}

/** Repeated parameter (`?brand=a&brand=b`) as a list of non-empty strings. */
export function parseList(name, value) {
  if (isMissing(value)) return [];
  const values = (Array.isArray(value) ? value : [value]).map((v) => String(v).trim()).filter(Boolean);
  if (values.length > MAX_LIST_ITEMS) {
    throw new BadRequestError(`Parameter "${name}" accepts at most ${MAX_LIST_ITEMS} values`);
  }
  for (const v of values) {
    if (v.length > MAX_PARAM_LENGTH) {
      throw new BadRequestError(`Parameter "${name}" is too long (max ${MAX_PARAM_LENGTH} characters)`);
    }
  }
  return values;
}

export function parseNumber(name, value, { min = -Infinity, max = Infinity } = {}) {
  const raw = single(name, value);
  if (isMissing(raw)) return undefined;
  const num = Number(raw);
  if (!Number.isFinite(num)) {
    throw new BadRequestError(`Parameter "${name}" must be a number`);
  }
  if (num < min || num > max) {
    throw new BadRequestError(`Parameter "${name}" must be between ${min} and ${max}`);
  }
  return num;
}

export function parseInteger(name, value, range) {
  const num = parseNumber(name, value, range);
  if (num !== undefined && !Number.isInteger(num)) {
    throw new BadRequestError(`Parameter "${name}" must be an integer`);
  }
  return num;
}

export function parseBoolean(name, value) {
  const raw = parseString(name, value);
  if (raw === undefined) return undefined;
  const lower = raw.toLowerCase();
  if (lower === 'true' || lower === '1') return true;
  if (lower === 'false' || lower === '0') return false;
  throw new BadRequestError(`Parameter "${name}" must be true or false`);
}

/** Case-insensitive match against a fixed set of values; returns the canonical spelling. */
export function parseEnum(name, value, allowed) {
  const raw = parseString(name, value);
  if (raw === undefined) return undefined;
  const match = allowed.find((a) => a.toLowerCase() === raw.toLowerCase());
  if (!match) {
    throw new BadRequestError(`Parameter "${name}" must be one of: ${allowed.join(', ')}`);
  }
  return match;
}

export function parseDate(name, value) {
  const raw = parseString(name, value);
  if (raw === undefined) return undefined;
  const time = Date.parse(raw);
  if (Number.isNaN(time)) {
    throw new BadRequestError(`Parameter "${name}" must be a date (YYYY-MM-DD)`);
  }
  return time;
}

/**
 * Spring-style paging: `page` is zero-based, `size` defaults to 20 (max 100).
 */
export function parsePageable(query) {
  return {
    page: parseInteger('page', query.page, { min: 0, max: 100000 }) ?? 0,
    size: parseInteger('size', query.size, { min: 1, max: MAX_PAGE_SIZE }) ?? DEFAULT_PAGE_SIZE,
  };
}

/** True when the client asked for paging explicitly. */
export function wantsPaging(query) {
  return !isMissing(query.page) || !isMissing(query.size);
}

/**
 * Spring-style sort: `sort=field` or `sort=field,asc|desc`, repeatable for
 * tie-breakers. `fields` maps each sortable field to its kind:
 * 'string' (case-insensitive), 'number' (unparsable → 0) or 'date'.
 */
export function parseSort(value, fields) {
  return parseList('sort', value).map((entry) => {
    const [field, rawDirection = 'asc'] = entry.split(',').map((s) => s.trim());
    if (!Object.hasOwn(fields, field)) {
      throw new BadRequestError(`Cannot sort by "${field}". Sortable fields: ${Object.keys(fields).join(', ')}`);
    }
    const direction = rawDirection.toLowerCase();
    if (direction !== 'asc' && direction !== 'desc') {
      throw new BadRequestError(`Sort direction for "${field}" must be asc or desc`);
    }
    return { field, direction, kind: fields[field] };
  });
}

function sortValue(item, field, kind) {
  const raw = item[field];
  switch (kind) {
    case 'number':
      return parseFloat(raw) || 0;
    case 'date': {
      const time = Date.parse(raw);
      return Number.isNaN(time) ? 0 : time;
    }
    default:
      return String(raw ?? '').toLowerCase();
  }
}

/** Returns a new, stably sorted array. */
export function sortItems(items, orders) {
  if (orders.length === 0) return [...items];
  return [...items].sort((a, b) => {
    for (const { field, direction, kind } of orders) {
      const av = sortValue(a, field, kind);
      const bv = sortValue(b, field, kind);
      if (av < bv) return direction === 'asc' ? -1 : 1;
      if (av > bv) return direction === 'asc' ? 1 : -1;
    }
    return 0;
  });
}

/** Page envelope modelled on Spring Data's `PagedModel` JSON. */
export function paginate(items, { page, size }) {
  const totalElements = items.length;
  const start = page * size;
  return {
    content: items.slice(start, start + size),
    page: {
      number: page,
      size,
      totalElements,
      totalPages: Math.ceil(totalElements / size),
    },
  };
}

/** Case-insensitive substring match on any of the given keys. */
export function matchesText(item, text, keys) {
  const needle = text.toLowerCase();
  return keys.some((key) =>
    String(item[key] ?? '')
      .toLowerCase()
      .includes(needle),
  );
}

/** Case-insensitive membership test against a list of wanted values. */
export function inList(value, wanted) {
  if (wanted.length === 0) return true;
  const v = String(value ?? '').toLowerCase();
  return wanted.some((w) => w.toLowerCase() === v);
}
