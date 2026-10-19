// Query handling for the small reference lists (brands, cores, coverstocks).
import { inList, matchesText, paginate, parseList, parsePageable, parseSort, parseString, sortItems, wantsPaging } from './query.js';

/**
 * Applies `search`, `brand` (where present), `sort` and optional paging.
 * Without `page`/`size` the plain array is returned, as before, so existing
 * clients keep working.
 */
export function queryCatalog(items, query, { searchKeys, sortFields, defaultSort, brandKey }) {
  const search = parseString('search', query.search ?? query.q);
  const brands = brandKey ? parseList('brand', query.brand) : [];
  const sort = parseSort(query.sort, sortFields);
  const paging = wantsPaging(query) ? parsePageable(query) : null;

  let result = items.filter((item) => (!search || matchesText(item, search, searchKeys)) && (!brandKey || inList(item[brandKey], brands)));
  result = sortItems(result, sort.length > 0 ? sort : defaultSort);

  return paging ? paginate(result, paging) : result;
}
