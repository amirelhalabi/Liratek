# REST contract: Shop restore (web only)

Router `backend/src/api/restore.ts`, mounted at `/api/restore`. Every route: `authenticateJWT` → `requireRole(["admin"])` → Zod schema from `packages/core/src/validators/restore.ts`. Shop = JWT tenant, never a body field. IPC-identical envelope, HTTP 200 on failure (rule 19c). No IPC handler: desktop out of scope (spec FR-023); the adapter's desktop branch returns `{ success:false, error:"Available on the web app" }` like `downloadShopBackup`.

## GET `/api/restore/points`

What the picker offers.

```jsonc
{ "success": true, "data": {
  "earliest": "2026-11-03T12:40:00Z",   // oldest restorable moment (now − 7 days, or shop creation)
  "latest":   "2026-11-10T12:39:30Z",
  "beforeCopies": [ { "restoreId": 12, "takenAt": "2026-11-10T12:20:04Z", "byName": "owner" } ],
  "lastRestore": { "restoreId": 12, "restoredTo": "…", "finishedAt": "…", "byName": "owner" } | null
} }
```

## POST `/api/restore/prepare` (time or undo)

Body (`prepareRestoreSchema`):

```jsonc
{ "kind": "time", "restoredTo": "2026-11-10T12:00:00Z", "clientTzOffsetMin": 120 }
{ "kind": "undo", "restoreId": 12, "clientTzOffsetMin": 120 }
```

Builds the candidate (R2/R4), migrates, prepares it (data-model §3), computes the preview. Synchronous litestream call is run as a child process (backend only, never reachable from `browser.ts`, rule 29).

```jsonc
{ "success": true, "data": {
  "restoreId": 13,
  "expiresAt": "2026-11-10T12:55:00Z",
  "preview": {
    "restoredTo": "2026-11-10T12:00:00Z",
    "lastSaleInCopy": { "at": "2026-11-10T11:58:41Z", "amount": 12.5, "currency": "USD", "client": "Rami" } | null,
    "lost": {
      "sales": 3, "payments": 4, "expenses": 1, "dayClosings": 0,
      "totals": [ { "currency": "USD", "amount": 41.0 }, { "currency": "LBP", "amount": 900000 } ]
    },
    "youAreMissing": false            // FR-010: the restoring admin does not exist in the copy
  } } }
```

Errors (`success:false`): `RESTORE_RUNNING`, `OUT_OF_WINDOW`, `BEFORE_SHOP_EXISTED`, `NO_BACKUP_AT_TIME`, `PREPARE_FAILED`.

## POST `/api/restore/file`

`Content-Type: application/octet-stream`, optional `Content-Encoding: gzip`, raw body ≤ 64 MB (route-level `express.raw`). Query: `clientTzOffsetMin`. Same response as `/prepare` with `kind: "file"` and `preview.restoredTo` = the file's build time.

Extra errors: `NOT_A_SHOP_FILE`, `FILE_DAMAGED`, `OTHER_SHOP` (with `shopName`), `MIXED_SHOPS`, `NEWER_VERSION`, `UNEXPECTED_SCHEMA_OBJECT`.

## POST `/api/restore/confirm`

Body (`confirmRestoreSchema`): `{ "restoreId": 13, "typedShopName": "CornerTech" }`.

Runs the swap (R3/R5): lock → wait for merge round → block shop → before-copy → backup-copy candidate into live file → unblock → `shop_restores.status = done` → audit (after swap) → owner email → signin directory sync. Returns when done (a few seconds).

```jsonc
{ "success": true, "data": { "restoreId": 13, "restoredTo": "…", "beforeCopy": { "takenAt": "…" } } }
```

Errors: `NAME_MISMATCH`, `EXPIRED`, `NOT_YOURS`, `RESTORE_RUNNING`, `RESTORE_FAILED` (shop unchanged, FR-012).

The caller's own session ends with the swap; the frontend shows "Restored — please sign in again" and signs out.

## POST `/api/restore/cancel`

`{ "restoreId": 13 }` → deletes the candidate, `status = expired`.

## During the swap (any shop route)

`pool.get(id)` throws `ShopRestoringError` → session validation returns HTTP 503 "please retry" (existing path, token kept). Not a `TenantContextError` (would route to the platform file).
