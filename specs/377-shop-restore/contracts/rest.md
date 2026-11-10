# REST contract: Shop restore (web only)

Router `backend/src/api/restore.ts`, mounted at `/api/restore`. Every route: `authenticateJWT` → `requireRole(["admin"])` → Zod schema from `packages/core/src/validators/restore.ts`. Shop = JWT tenant, never a body field. IPC-identical envelope, HTTP 200 on failure (rule 19c). No IPC handler: desktop out of scope (spec FR-023); the adapter's desktop branch returns `{ success:false, error:"Available on the web app" }` like `downloadShopBackup`.

**Envelopes** (implemented 2026-11-10):

```jsonc
{ "success": true, "data": { … } }
{ "success": false, "code": "<CODE>", "error": "<plain text>", "shopName"?: "…" }   // a refusal, HTTP 200
{ "success": false, "error": "<zod message>" }                                         // schema failure (validateRequest), no code
{ "success": false, "error": "Restore is only available on the web app" }              // not per-tenant mode (desktop/shared), no code
```

`shopName` on a refusal appears only with `OTHER_SHOP` (the FILE's shop). Every code, all routes: `RESTORE_RUNNING`, `OUT_OF_WINDOW`, `BEFORE_SHOP_EXISTED`, `NO_BACKUP_AT_TIME`, `PREPARE_FAILED`, `NOT_A_SHOP_FILE`, `FILE_DAMAGED`, `OTHER_SHOP`, `MIXED_SHOPS`, `NEWER_VERSION`, `UNEXPECTED_SCHEMA_OBJECT`, `NAME_MISMATCH`, `EXPIRED`, `NOT_YOURS`, `RESTORE_FAILED`, `FILE_TOO_LARGE` (the one non-200: HTTP 413).


## GET `/api/restore/points`

What the picker offers.

```jsonc
{ "success": true, "data": {
  "earliest": "2026-11-03T12:40:00Z",   // oldest restorable moment (now − 7 days, or shop creation)
  "latest":   "2026-11-10T12:39:30Z",
  "shopName": "CornerTech",              // platform tenants.name — exactly what confirm compares the typed name with
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
  "shopName": "CornerTech",          // same value as /points
  "preview": {                       // ShopRestoreRepository.previewCandidate's result, passed through unchanged, + restoredTo
    "restoredTo": "2026-11-10T12:00:00Z",
    "lastSaleInCopy": { "at": "2026-11-10T11:58:41Z", "amount": 12.5, "currency": "USD", "client": "Rami" } | null,
    // `amount` = what the customer was charged (final_amount_usd + extra_usd).
    "lost": {                         // rows in the live file with id above the copy's MAX(id)
      "sales": { "count": 3, "totalUsd": 50.0 },   // completed + refunded; drafts / cancelled excluded
      "payments": 5,                  // customer-facing legs (IN and OUT)
      "expenses": 1,
      "dayClosings": 1,               // distinct shop days among the lost checkpoints
      "checkpoints": 2,               // daily_closings rows (drawer counts)
      "settlements": { "suppliers": 1, "partners": 0, "loto": 0 },  // one per settle action (its transaction); suppliers include OMT/Whish
      "moneyIn":  [ { "currency": "LBP", "amount": 900000 }, { "currency": "USD", "amount": 50.0 } ],  // gross IN legs
      "moneyOut": [ { "currency": "USD", "amount": 9.0 } ]   // gross OUT legs (change, payouts), positive; never nets moneyIn
    },
    "youAreMissing": false            // FR-010: the restoring admin does not exist in the copy
  } } }
```

Errors (`success:false`): `RESTORE_RUNNING`, `OUT_OF_WINDOW`, `BEFORE_SHOP_EXISTED`, `NO_BACKUP_AT_TIME`, `PREPARE_FAILED`; undo also `NOT_YOURS` (another shop's restore id), `FILE_DAMAGED`, `MIXED_SHOPS`.

- Time: `OUT_OF_WINDOW` when `restoredTo` is in the future (vs the request's own instant) or older than 7 days, and when Litestream's kept history does not reach that far back. Litestream answers "timestamp does not exist" both before its history and after the shop's last write; the server then fetches the latest copy and uses it only if nothing in it was written after `restoredTo`, otherwise `OUT_OF_WINDOW`. Note: retention was raised to 192 h on 2026-11-10, so until about 2026-11-17 `earliest` offers moments older than the history really kept; picking one answers `OUT_OF_WINDOW` or `NO_BACKUP_AT_TIME`.
- Undo: `restoredTo` = when the before-copy was taken (that restore's `finishedAt`). Refused (`OUT_OF_WINDOW`) once older than 7 days, `NO_BACKUP_AT_TIME` when the copy file is gone (swept).
- Preparing again while YOUR OWN earlier restore is still `prepared` replaces it (the old one becomes `expired`). Another admin's open restore → `RESTORE_RUNNING`.

## POST `/api/restore/file`

`Content-Type: application/octet-stream`, optional `Content-Encoding: gzip`, raw body ≤ 64 MB (route-level `express.raw`). Query: `clientTzOffsetMin`. Same response as `/prepare` (incl. `shopName`) with `kind: "file"` and `preview.restoredTo` = the newest write time found in the file (`created_at`/`updated_at`/`last_activity_at`/`last_seen_at`, read before migrating). A backup file has no build-time marker, so this is "the shop as at its last recorded change", which is at or slightly before the download time.

Extra errors: `NOT_A_SHOP_FILE` (no SQLite header, no shop tables, empty/unreadable body), `FILE_DAMAGED` (valid header but unreadable or integrity check fails), `OTHER_SHOP` (with `shopName`), `MIXED_SHOPS` (more than one `tenants` row, or any row of another shop), `NEWER_VERSION`, `UNEXPECTED_SCHEMA_OBJECT` (after migration, a table/index/trigger/view not in a fresh `create_db.sql` + migrations build). Over 64 MB (also after gzip inflation): HTTP **413** `{ success:false, code:"FILE_TOO_LARGE", error }`.

## POST `/api/restore/confirm`

Body (`confirmRestoreSchema`): `{ "restoreId": 13, "typedShopName": "CornerTech" }`.

Runs the swap (R3/R5): lock → wait for merge round → block shop → before-copy → backup-copy candidate into live file → unblock → `shop_restores.status = done` → audit (after swap) → owner email → signin directory sync. Returns when done (a few seconds).

```jsonc
{ "success": true, "data": { "restoreId": 13, "restoredTo": "…", "beforeCopy": { "takenAt": "…" } } }
```

Errors: `NAME_MISMATCH` (exact, case- and space-sensitive; the restore stays prepared), `EXPIRED` (over 15 min, or already confirmed/cancelled), `NOT_YOURS` (another admin, or another shop's id), `RESTORE_RUNNING`, `RESTORE_FAILED` (shop unchanged, FR-012).

The caller's own session ends with the swap; the frontend shows "Restored — please sign in again" and signs out.

## POST `/api/restore/cancel`

`{ "restoreId": 13 }` → deletes the candidate, `status = expired`. `{ "success": true, "data": { "restoreId": 13 } }`. Errors: `NOT_YOURS`, `EXPIRED`, `RESTORE_RUNNING`.

## During the swap (any shop route)

`pool.get(id)` throws `ShopRestoringError` → session validation returns HTTP 503 "please retry" (existing path, token kept). Not a `TenantContextError` (would route to the platform file).
