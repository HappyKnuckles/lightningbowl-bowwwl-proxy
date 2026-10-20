// GET /api/brands — optional: search, sort, page/size.
import { withCors } from '../middleware.js';
import { queryCatalog } from '../lib/catalog.js';
import { sendJson, withErrorHandling } from '../lib/respond.js';
import { getBrands } from '../lib/upstream.js';

const OPTIONS = {
  searchKeys: ['brand_name'],
  sortFields: { brand_name: 'string' },
  defaultSort: [{ field: 'brand_name', direction: 'asc', kind: 'string' }],
};

async function handler(req, res) {
  const items = await getBrands();
  sendJson(res, queryCatalog(items, req.query, OPTIONS), { maxAge: 3600, staleWhileRevalidate: 86400 });
}

export default withCors(withErrorHandling(handler));
