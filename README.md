# bowwwl API

Ball catalog API for [Lightning Bowl](https://github.com/HappyKnuckles/lightningbowl), backed by the bowwwl.com REST API.

The bowwwl full-catalog endpoint (`/restapi/balls?_format=json`) is currently broken, so the catalog is assembled from the paged `/restapi/balls/v2` endpoint (fetched in parallel batches until a page adds nothing new) and filtered by weight locally. v2 currently only serves 15 lb balls; other weights fall back to the old endpoint.

Upstream data is fetched once and cached in memory (balls: 1 hour, brands/cores/coverstocks: 1 day). If a refresh fails, the last good copy is served. Filtering, fuzzy search, sorting and paging all happen here, so clients only download the page they show. Responses carry `s-maxage` / `stale-while-revalidate` headers so Vercel's CDN can cache them too.

```bash
npm install
npm run dev   # http://localhost:3002
npm test
```

## Conventions

- **Paging** (Spring style): `page` is zero-based (default `0`), `size` defaults to `20`, max `100`.
- **Sorting** (Spring style): `sort=field` or `sort=field,asc|desc`. Repeat it to add tie-breakers: `sort=core_rg,desc&sort=ball_name`.
- **Multi-value filters**: repeat the parameter, e.g. `brand=Storm&brand=Roto Grip`. Text matching is case-insensitive.
- **Errors**: `400` invalid parameter, `404` not found, `429` rate limited, `502` upstream failed, `504` upstream timed out. The body is always `{ "error": "..." }`.

Paged responses look like this:

```json
{
  "content": [ { "ball_id": "…", "ball_name": "…" } ],
  "page": { "number": 0, "size": 20, "totalElements": 1234, "totalPages": 62 }
}
```

## Endpoints

### `GET /api/balls`

Search, filter, sort and page the catalog. Returns a page.

| Parameter | Description |
| --- | --- |
| `search` (alias `q`) | Fuzzy search over ball, brand, core and coverstock name and factory finish. Comma-separated terms are searched separately. |
| `weight` | Ball weight in lbs (passed to the upstream API). |
| `name`, `brand`, `core`, `coverstock`, `coverstockType`, `factoryFinish` | Exact (case-insensitive) match, repeatable. |
| `market` | `US` or `Overseas`. |
| `coreType` | `Symmetric` or `Asymmetric`. |
| `available` | `true` = only available balls, `false` = only discontinued ones. |
| `releaseDate` | Exact release date as returned by the API. |
| `releasedAfter`, `releasedBefore` | Release date range (inclusive, `YYYY-MM-DD`). |
| `minRg`, `maxRg`, `minDiff`, `maxDiff`, `minIntDiff`, `maxIntDiff` | Core spec ranges (inclusive). |
| `id` | Only these ball IDs, repeatable (e.g. the user's arsenal or favorites). |
| `excludeId` | Leave these ball IDs out, repeatable. |
| `sort` | `ball_name`, `brand_name`, `release_date`, `core_rg`, `core_diff`, `core_int_diff`, `core_type`, `coverstock_type`, `factory_finish`. |
| `page`, `size` | Paging. |

Default order is newest release first. With `search` and no `sort`, results keep relevance order.

Examples:

```
/api/balls?weight=15&brand=Storm&coreType=Asymmetric&sort=core_diff,desc
/api/balls?search=phaze,widow&available=true
/api/balls?core=Velocity&excludeId=1234           # other balls with the same core
/api/balls?coverstock=TX-16&excludeId=1234        # other balls with the same coverstock
```

### `GET /api/ball?id={ballId}[&weight={lbs}]`

All weight variants of one ball, heaviest first (an array). `404` if the ball is unknown.

### `GET /api/similar-balls?ballId={ballId}[&weight={lbs}][&limit={n}]`

Balls of the same weight with a similar expected reaction: same core type and coverstock type, RG within 0.03, differential within 0.008, and, for asymmetric cores, intermediate differential within 0.005. Newest first, `limit` defaults to 10 (max 50). Returns an array.

### `GET /api/brands`, `GET /api/cores`, `GET /api/coverstocks`

Reference lists, sorted by name (cores and coverstocks by brand, then name). Optional:

- `search`: case-insensitive substring match
- `brand`: repeatable (cores and coverstocks only)
- `sort`: `brand_name` for brands; `core_name` / `coverstock_name` and `brand` for the others
- `page`, `size`: when either is given, the response becomes a page; otherwise it stays a plain array

### Legacy endpoints

`/api/all-balls`, `/api/balls-pages`, `/api/core-balls` and `/api/coverstock-balls` still behave as before so existing app versions keep working. New code should use `/api/balls`:

| Legacy | Replacement |
| --- | --- |
| `all-balls?weight=15` | Still useful for downloading the full catalog for offline use. |
| `balls-pages?page=0` | `balls?page=0` |
| `core-balls?core=X&ballId=Y` | `balls?core=X&excludeId=Y` |
| `coverstock-balls?coverstock=X&ballId=Y` | `balls?coverstock=X&excludeId=Y` |

## Configuration

`ALLOWED_ORIGINS`: comma-separated CORS origins (see `.env.example`). Vercel preview deployments of the app are always allowed.
