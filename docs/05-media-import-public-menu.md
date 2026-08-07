# Media, Bulk Import & Public Menu — Phase 4 (V2)

Three features that complete the deferred Phase 4 work: a production image
pipeline, a validated bulk menu import, and a read-only public storefront
menu API. All integrated into the existing multi-tenant Express + Sequelize
stack, tenant-scoped, RBAC-gated, and covered by tests on **both SQLite and
PostgreSQL** (138 backend tests + Playwright e2e).

---

## 1. Image Pipeline

### How it works

1. The merchant uploads an image (`POST /api/uploads/images`, multipart field
   `image`) — JPEG / PNG / WebP only.
2. The request is authenticated, tenant-scoped, and gated to the
   `manage:menu` permission.
3. `sharp` **sniffs the real content** (never trusts the declared MIME), then:
   - rejects non-images, files over `MAX_IMAGE_BYTES` (default 5 MB) and
     dimensions over `MAX_IMAGE_DIMENSION` (default 4096 px);
   - strips EXIF, honours orientation, re-encodes to **WebP**;
   - produces a **standard** variant (max 1600 px) and a **320×320 thumbnail**.
4. Both variants are stored through the storage abstraction and returned as
   public URLs. Originals are never persisted — only processed WebP.
5. Any processing/storage failure cleans up already-written objects — no
   orphaned files.

### Storage abstraction (`backend/src/config/storage.js`)

| Driver | When | Where files go | Public URL |
|---|---|---|---|
| `local` (default) | dev / tests | `backend/uploads/` | `{APP_BASE_URL}/uploads/{key}` (served via express static; vite proxies `/uploads`) |
| `s3` | production | any S3-compatible bucket (AWS, MinIO, R2) | `{CDN_BASE_URL}/{key}`, else the bucket URL |

Object keys are always server-generated (`tenants/{id}/images/{uuid}-{base}.webp`)
— user input never forms a path, so path traversal / key injection is
structurally impossible. Delete (`DELETE /api/uploads/images/:key`) removes the
standard + thumbnail objects.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `STORAGE_DRIVER` | `local` | `local` or `s3` |
| `UPLOAD_DIR` | `./uploads` | local driver target |
| `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | — | S3 credentials (never committed) |
| `S3_ENDPOINT` | — | custom S3-compatible endpoint (MinIO, R2) |
| `S3_FORCE_PATH_STYLE` | — | `1` for MinIO-style endpoints |
| `CDN_BASE_URL` | — | public image base URL (CDN) |
| `MAX_IMAGE_BYTES` | 5242880 | per-file upload cap |
| `MAX_IMAGE_DIMENSION` | 4096 | per-dimension cap |

Setting `STORAGE_DRIVER=s3` without `S3_BUCKET`/keys fails fast at boot with a
clear message instead of a confusing crash. Credentials are never exposed to
the frontend — the API returns only public URLs.

### Example

```bash
curl -X POST http://localhost:4000/api/uploads/images \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Tenant: 1" \
  -F "image=@burger.png"
```

```json
{
  "url": "http://localhost:5173/uploads/tenants/1/images/8f2b...-burger-standard.webp",
  "thumbUrl": "http://localhost:5173/uploads/tenants/1/images/8f2b...-burger-thumb.webp",
  "key": "tenants/1/images/8f2b...-burger-standard.webp",
  "thumbKey": "tenants/1/images/8f2b...-burger-thumb.webp",
  "width": 640,
  "height": 480
}
```

---

## 2. Bulk Import (CSV)

### Endpoint

`POST /api/products/import` — multipart: file `file` (CSV) + optional field
`duplicates` (`skip` | `error` | `update`, default `skip`).
Authenticated, tenant-scoped, `manage:menu`.

`GET /api/products/import/template` returns a downloadable CSV template.

### CSV columns

| Column | Required | Notes |
|---|---|---|
| `name` | ✅ | trimmed, ≤ 200 chars |
| `price` | ✅ | number ≥ 0; empty cell is an error (never coerced to 0) |
| `weight_gm` | ✅ | positive integer |
| `description` | — | text |
| `enabled` | — | `true/false/1/0/yes/no`; blank = `true` |
| `category` | — | matched by name within the tenant; **unknown categories are auto-created** (idempotent by name) |
| `prep_minutes` | — | non-negative integer |
| `image_url` | — | valid URL |

### Behaviour

- **Partial success by design.** Valid rows import; invalid rows are reported
  per row (`{ row, field, message }`) and never block the rest of the file.
- **Duplicates:**
  - within the file — a later row with the same name (case-insensitive) is
    skipped as a duplicate of an earlier row;
  - against the database — `skip` (default): existing products are skipped;
    `error`: the whole import fails with `409 DUPLICATE_PRODUCTS`;
    `update`: existing products are updated in place (no new row).
- **Batching.** Rows are written in transactions of 50; a failure inside a
  batch is reported without rolling back the rest of the batch.
- **Limits.** `MAX_IMPORT_BYTES` (default 2 MB) and `MAX_IMPORT_ROWS`
  (default 2000) — oversized files/imports are rejected with clear errors.

### Response

```json
{
  "total": 12,
  "succeeded": 10,
  "failed": 1,
  "skipped": 1,
  "createdCategories": 2,
  "columns": ["name", "price", "weight_gm", "description", "enabled", "category", "prep_minutes", "image_url"],
  "errors": [{ "row": 7, "field": "price", "message": "price is required" }]
}
```

### Example import workflow

1. Open **Products → Import CSV** in the app (or hit the endpoint).
2. Download the template, fill it in (Excel/Sheets → save as CSV).
3. Upload — the modal shows Imported / Failed / Skipped counts and per-row
   errors.
4. Fix the reported rows and re-import; already-imported rows are skipped
   (`duplicates=skip`) so nothing is duplicated.

---

## 3. Public Menu API

Read-only, **no authentication**, for the customer storefront. Only
whitelisted fields are ever serialised; suspended/archived workspaces 404
(never reveal a hidden tenant).

| Endpoint | Purpose |
|---|---|
| `GET /api/public/restaurants/:slug` | public restaurant summary |
| `GET /api/public/restaurants/:slug/menu` | grouped menu (categories → items) |

### Filters (`/menu`)

- `?categoryId=123` — only items in that category
- `?available=false` — include hidden items (default: only available)

### Response shape

```json
{
  "restaurant": { "id": 1, "name": "KFC Dhanmondi", "slug": "kfc-dhanmondi", "logoUrl": null, "status": "active" },
  "categories": [
    {
      "id": 3, "name": "Burgers", "parentId": null, "sortOrder": 1,
      "items": [
        {
          "id": 42, "name": "Zinger Burger", "description": "Crispy fillet",
          "price": 260, "weightGm": 280, "prepMinutes": 8,
          "imageUrl": "https://cdn.example.com/tenants/1/images/...-standard.webp",
          "available": true, "categoryId": 3,
          "variants": [{ "id": 9, "name": "Large", "priceAdjustment": 50, "sortOrder": 1 }],
          "addons": [{ "id": 5, "name": "Extra Cheese", "price": 30, "sortOrder": 1 }]
        }
      ]
    }
  ]
}
```

No internal columns (`tenant_id`, `settings`, `plan_id`), no user data, no
hashes — verified by `publicMenu.test.js`. Uncategorised items appear under an
`"Other"` group. The demo storefront page is at `/m/:slug` in the frontend.

---

## Security notes

- Uploads: MIME sniffing, size + dimension caps, no user-controlled paths,
  WebP-only output (no stored originals), cleanup on failure.
- Import: per-row validation, row limits, size limits, no mass-assignment
  (whitelist columns only), tenant-scoped writes.
- Public API: field whitelist serialisers, no auth weakening of existing
  routes, rate-limited like every other route.

## Local development

- Backend: nothing extra needed — `STORAGE_DRIVER` defaults to `local`,
  images land in `backend/uploads/` (gitignored).
- To try S3 locally: run MinIO, set `STORAGE_DRIVER=s3`, `S3_ENDPOINT`,
  `S3_BUCKET`, `S3_FORCE_PATH_STYLE=1` + keys.
- Frontend: vite proxies `/api` and `/uploads` to the backend (port 4000).
- Visit `/m/{slug}` (e.g. `/m/kfc-dhanmondi`) for the public storefront demo.
