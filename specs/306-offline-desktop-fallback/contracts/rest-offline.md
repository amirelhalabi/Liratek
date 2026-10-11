# Contract — REST `/api/offline/*`

All responses use the IPC-identical envelope `{ success, data?, error?, code? }` with **HTTP 200 on business failure**
(rule 6). Schemas live in `packages/core/src/validators/offline.ts` (rule 14); request bodies are validated with
`validateRequest(schema)`. Mounted in `backend/src/server.ts` as `/api/offline`. No route here, and nothing in this
feature, ever refuses a web or phone write (N1).

## Device routes — header `X-LiraTek-Device-Key: ltd_<tenantId>_<keyId>_<secret>`

`authenticateDevice` checks the format regex first (no DB read for malformed keys), then looks up `key_id` inside
`runWithTenant(<tenant id from the key>)`, constant-time compares sha256(secret), refuses revoked keys
(`DEVICE_REVOKED`) and sets `req.device = { tenantId, deviceId, deviceNo }`. Rate limit: verified key → bucket
`device:<tenantId>:<keyId>`.

| Method + path | Body | Success `data` | Codes |
| --- | --- | --- | --- |
| `POST /pair` (no key; `authLimiter`) | `{ shop, username, password, deviceName, deviceNo? }` — `deviceNo` re-keys that existing PC (FR-001a) | `{ deviceKey, deviceNo, tenantId, shopName, shopSlug, serverSchemaVersion }` (key shown once) | `INVALID_CREDENTIALS`, `ADMIN_ONLY` |
| `POST /checkin` | `{ state, pendingCount, appVersion, schemaVersion, pcClock }` | `{ serverSchemaVersion, serverTime, snapshotDue: boolean, maxSeq, maxOfflineIds: { [table]: n }, heldItems: { eventId, label, amount }[], renumberUnsent?: boolean }` (resume/seeding FR-008a; held list for the standby screen; renumber recovery for `SEQ_CONFLICT`) | `DEVICE_REVOKED` |
| `GET /snapshot` | — | gzip SQLite body; headers `X-Copy-Id`, `X-Snapshot-Schema-Version`, `X-Snapshot-Tenant-Id`, `X-Snapshot-Built-At` | `VERSION_MISMATCH` (envelope, JSON) |
| `POST /events` | `{ appVersion, schemaVersion, pcClock, events: OfflineEvent[1..100] }` | `{ acked: eventId[], rejected: { eventId, code, error }[] }` — `UNKNOWN_CHANNEL` / `NOT_RECORDABLE` events are stored as `refused` and **acked** (sequence stays gap-free, item on the review list) | `VERSION_AHEAD` (whole upload); per-event `EVENT_ID_REUSED`, `SEQ_CONFLICT` (not stored; stop that PC's queue; shown on the PCs panel) |
| `GET /events/status?fromSeq=n` | — | `{ outcomes: { eventId, seq, status, error?, serverIds? }[] }` (up to 500) | |
| `POST /manifest` | `{ copyId, tables: { [table]: offlineId[] }, readWrites: { channel, changes }[] }` | `{ matched: boolean, unexplained: { table, ids }[] }` — rows present on the PC that no event created (rows deleted offline are fine) | adds `pc_data_mismatch` review item when not matched |

`OfflineEvent` = `{ eventId: uuid, seq: int ≥1, channel, payload: object, actorUserId: int, occurredAt: ISO,
clientDay: YYYY-MM-DD, clientTzOffsetMinutes: int −720..840, copyId: uuid, schemaShape: object, rates: OfflineRates (strict: sell, buy, market, direction for every currency — no partial records),
created: { [table]: int[] }, dependsOn: uuid[] }`. Processing is asynchronous (gathering pause, R5); outcomes come from `/events/status`.

## Review routes — `authenticateJWT` → `requireRole(["admin"])`, actor from the JWT

| Method + path | Body | Success `data` |
| --- | --- | --- |
| `GET /review?state=open&kind=…` | — | `{ items: ReviewItemView[] }` (what, when, PC, who, amounts, reason in plain words, matching row) |
| `GET /history?deviceId&from&to` | — | `{ events: EventView[] }` incl. server row it became and offline receipt number |
| `POST /review/:id/apply` | — | `{ status, serverIds }` — re-runs the pipeline without hold/duplicate checks; then processes waiting dependants |
| `POST /review/:id/dismiss` | `{ note? }` | `{ state:"dismissed" }` |
| `POST /review/:id/reviewed` | — | `{ state:"reviewed" }` (notes only) |
| `POST /review/:id/book-anyway` | — | `{ status:"applied", serverIds }` (certain duplicates only) |
| `GET /devices` | — | `{ devices: { id, deviceNo, name, pairedAt, lastSeenAt, state, pendingCount, appVersion, revokedAt }[] }` |
| `POST /devices/:id/revoke` | — | `{ revoked:true }` (events already received are still processed) |

Static paths are mounted before `/:id` paths. Each action is idempotent: the state is checked inside the transaction
and a repeat returns the current state.

## Receipt alias (FR-040)

No new route. The existing receipt-number lookup (`parseReceiptNumber`, `packages/core/src/utils/receiptNumber.ts:26`,
used by `WarrantyRepository.ts:113` for warranty search) gains one step in the repository: a parsed id `≥ 10¹²` is
resolved through `offline_id_map` (table `sales`) to the server sale id before the existing query runs. Reprint looks
up the same way.
