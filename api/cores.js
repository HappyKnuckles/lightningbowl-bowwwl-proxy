// GET /api/cores — optional: search, brand, sort, page/size.
import { withCors } from '../middleware.js';
import { queryCatalog } from '../lib/catalog.js';
import { sendJson, withErrorHandling } from '../lib/respond.js';
import { getCores } from '../lib/upstream.js';

const OPTIONS = {
  searchKeys: ['core_name', 'brand'],
  sortFields: { core_name: 'string', brand: 'string' },
  defaultSort: [
    { field: 'brand', direction: 'asc', kind: 'string' },
    { field: 'core_name', direction: 'asc', kind: 'string' },
  ],
  brandKey: 'brand',
};

async function handler(req, res) {
  const items = await getCores();
  sendJson(res, queryCatalog(items, req.query, OPTIONS), { maxAge: 3600, staleWhileRevalidate: 86400 });
}

export default withCors(withErrorHandling(handler));
