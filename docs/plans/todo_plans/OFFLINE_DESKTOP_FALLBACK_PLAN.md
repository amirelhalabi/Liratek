# Offline Desktop Fallback — Web-First with a Desktop Plan B

> **Status**: TODO — planned 2026-09-27. **Step 1 is almost done (2026-09-28):** the hosting
> plan's per-tenant split (Phases A–C) is shipped and deployed; only its Phase D (the production
> switch, runbook § 12.4) remains, owner-scheduled. Nothing of this plan's own work is built yet.
> **Owner decisions recorded**: see § 2.

---

## 1. Goal

Most shops work on the **web app** (Vercel SPA → Fly backend). When the shop's
internet drops, the cashier switches to the **desktop app** on the same PC and
keeps working with the shop's own, recent data. When the internet returns, the
offline work lands on the web database and the shop carries on in the browser.
Nothing is lost, nothing is double-booked.

---

## 2. Decisions (owner, 2026-09-27)

| #   | Decision                                                                                                   |
| --- | ---------------------------------------------------------------------------------------------------------- |
| D1  | **Web is primary.** The desktop is a fallback for outages, not a second everyday till.                      |
| D2  | **No writes on the web during an outage.** While a shop's desktop is working offline, that shop's web app is read-only. |
| D3  | **Google Drive is NOT in the sync path.** It was the original idea; see § 4 for why it was dropped. It may return later as an optional encrypted daily export for customer peace of mind, never read back into the system. |
| D4  | **Row IDs are assigned only by the database that stores the row.** No client ever sends a row ID for a new row. See § 6. |
| D5  | **Step 1 is finishing the hosting plan** (`docs/plans/ongoing_plans/PRODUCTION_DATABASE_AND_HOSTING_PLAN.md`). |

---

## 3. Where things stand today (verified 2026-09-27)

- The web data is **still one SQLite file shared by every shop** — `/data/liratek.db` on a
  3 GB Fly volume in `fra` (`fly.toml`) — but only until the hosting plan's Phase D. The
  per-tenant split is **built and deployed** (off by default); after Phase D each shop is
  `/data/tenants/<id>.db` and Litestream replicates each one under `tenants/<id>.db/`.
- **Consequence for this plan (hosting decision A-D1):** a shop file keeps the shop's **real**
  `tenant_id` (CornerTech = 1, Test = 5), not 1. A desktop that mirrors a web shop file must
  take its fixed tenant id from the file's own `tenants` row, never assume 1.
- **Litestream** already replicates that file to Cloudflare R2 (`liratek-backups`,
  prefix `web/liratek`) with a 1 s sync interval, and a restore from R2 has been
  performed (`backend/litestream.yml`, hosting plan § 10).
- The desktop already runs fully offline on its own local SQLite file.
- An Electron auto-updater exists (`electron-app/handlers/updaterHandlers.ts`).
- Unused `sync_queue` and `sync_errors` tables exist in `create_db.sql`. Likely
  left over from an earlier attempt; they may be reusable for § 7.4.
- Production code never inserts an explicit row ID — only migrations do. Every row
  ID is already assigned by SQLite (68 `AUTOINCREMENT` tables).

---

## 4. Why not "back up to Google Drive every 10 s"

Kept here so the idea is not re-proposed without its costs.

1. **A backup file cannot sync.** Copying a whole file is safe only with one writer.
   Merging two SQLite files is impossible by copying — one side's sales, payments
   and drawer changes silently disappear.
2. **Cost grows with database size.** Every upload is the whole file: 8 640 uploads
   per day per shop. At today's ~1.3 MB that is ~11 GB/day (~$7/month of Fly egress
   per shop, assuming ~$0.02/GB). At an assumed 50 MB after a year, ~430 GB/day
   (~$260/month per shop). The desktop downloads the same volume over the shop's
   connection, which many Lebanese plans cap.
3. **The whole shared file would go to one customer** — every other shop's data with
   it — until the per-tenant split is switched on (hosting plan Phase D).
4. It puts a third party the customer can revoke, fill, move or delete into the
   critical path, and duplicates durability Litestream → R2 already provides.

---

## 5. Architecture

### 5.1 The three states

| State            | Who writes                         | Desktop does                                                    |
| ---------------- | ---------------------------------- | --------------------------------------------------------------- |
| **Online**       | Web only                           | Keeps a **read-only mirror** of the shop's database, fed from R2 |
| **Outage**       | Desktop only (web read-only, D2)   | Promotes the mirror to writable; logs every write to an **outbox** |
| **Reconnecting** | Desktop replays, then web unlocks  | Replays the outbox through the REST API, then discards its copy and re-downloads a fresh mirror |

### 5.2 Keeping the mirror fresh (online state)

1. The desktop runs as a tray app that starts with Windows (it must be running to
   stay fresh).
2. Every few seconds it asks the backend for new replication segments for its shop.
   The backend answers with **short-lived presigned R2 URLs scoped to that tenant's
   prefix** — the desktop never holds R2 credentials.
3. The desktop applies the segments to its local copy.

Cost: Likely, based on R2 pricing as of 2026-09: R2 has no egress fee and its free
tier covers ~10 M read requests/month. Polling every 10 s is ~260 000 requests per
shop per month — effectively free until dozens of shops. **Re-check current R2
pricing before relying on this.**

**Staleness never loses data.** The server keeps every row; offline work is
*replayed onto* the server, not copied over it. A stale mirror only affects what the
offline cashier sees (a drawer balance or stock count seconds old). That is why the
fallback in § 8 spike S1 is acceptable.

### 5.3 Going offline

- The desktop detects the backend is unreachable and offers "Work offline".
- It records its **base position** (the last replication position it applied).
- The mirror becomes writable. Every write-path call the cashier makes goes through
  the same `backendApi.ts` adapter it would online; in offline mode the adapter
  also appends the call (operation + schema-validated payload) to the outbox.

### 5.4 Keeping the web read-only (D2)

- The running desktop sends a heartbeat to the backend every few seconds.
- Heartbeats stop without a clean "signing off" message → the backend marks that
  tenant **read-only** and the web shows: "Your shop's desktop lost connection."
- A power cut (desktop simply off) would lock the web wrongly, so the banner offers
  an admin-only **"Unlock — the desktop isn't in use"**, which is audited.
- Safety net on reconnect: the desktop sends its base position. If the tenant's
  database changed after it (someone unlocked and wrote anyway), the backend
  **flags the batch for owner review** instead of guessing.

### 5.5 Coming back online

1. The desktop replays the outbox **in order** through the normal REST routes, with
   the device key (§ 7.6). The server runs the same services it runs for a web sale,
   so validation, stock, drawer balances, ledgers and profit stamping are all updated
   by the existing code.
2. Each operation carries an idempotency key (§ 6.3). A retry after a dropped
   response cannot double-book.
3. A rejected operation goes to an error list the owner resolves in the UI (§ 7.4).
   Nothing is dropped silently.
4. When the outbox is empty and error-free, the backend unlocks the web, and the
   desktop discards its local copy and pulls a fresh mirror.

---

## 6. Row IDs — the owner's question, answered

> "We should not send the row ID. This should be auto-generated by the database.
> What do you think? Is it doable? Pros, cons, damage?"

### 6.1 Verdict

**Agreed. This is the right rule, it is doable, and it is mostly already true.**
Production code never sends a row ID for a new row today; SQLite assigns every ID.
The rule only needs protecting at the one new place that could break it: **replay**.
When the desktop replays an offline sale that it stored locally as ID 8, it sends
the sale's *contents*, never "8". The web database gives it whatever its next ID is
(say 9). Two offline and online rows can never both be "8" in the same database.

### 6.2 Pros

- **No collisions by construction** — only one database ever numbers its own rows.
- **No schema change.** All 68 tables keep their integer `AUTOINCREMENT` keys. The
  rejected alternative — switching every primary key to a UUID — would rewrite every
  table, every foreign key, every repository and most tests.
- **Stored totals stay correct for free.** `drawer_balances.balance` and
  `products.stock_quantity` are running counters. Replayed operations go through the
  server's services, which update those counters exactly as a web sale does. Copying
  rows would have overwritten them.
- **Validation is re-applied.** The server re-checks every offline operation with the
  same Zod schema and business rules it uses online.

### 6.3 Cons — what the rule does NOT solve on its own

Each of these needs its own piece of work; none of them is a reason to drop the rule.

1. **Duplicate replays.** If the network drops after the server saved an operation
   but before the desktop got the answer, the desktop will resend it. With no ID, the
   server cannot tell it is a repeat → a double sale.
   **Fix:** every outbox operation gets a **client-generated UUID idempotency key**.
   The server stores it (unique) and returns the original result for a repeat. No
   such key exists anywhere in the codebase today (checked). *Note the irony: to stop
   sending row IDs, we must send a different kind of ID — one that names the
   **operation**, not the row.*
2. **Offline rows that point at other offline rows.** An offline sale (local ID 8)
   refunded offline sends "refund sale 8". On the server that sale is 9.
   **Fix:** the desktop keeps a **local-ID → server-ID map**, filled from each replay
   response, and rewrites ID fields in later payloads before sending them. The
   payload schemas must mark which fields are row references.
3. **Numbers people see change.** Anything that displays a row ID shows a different
   number after sync:
   - `SaleDetailModal.tsx:530` reprints a receipt as `RCP-${sale.id}`, while checkout
     (`CheckoutModal.tsx:125`) prints `RCP-${Date.now()}`. Likely, based on those
     two lines: the reprint already shows a different number from the original
     receipt today, and offline sales would make it worse.
   - `ClientList.tsx:147` shows `ID: #{client.id}`.
   **Fix:** a customer-facing number is stored once when the receipt is printed
   (`receipt_number`), unique per device, and never derived from the row ID.
4. **"Newest by ID" stops meaning newest.** A replayed row gets a higher ID than rows
   created online after it happened. 18 repository queries order by `id DESC` or use
   `MAX(id)` (e.g. `ClosingRepository.ts:283` picks the latest daily closing by ID).
   **Fix:** audit those 18. Where the intent is "most recent in time", order by
   `created_at` (with ID only as a tie-breaker, as `getRecent` already does).
5. **Timestamps.** Replayed rows must keep the time they happened, not the replay
   time, or a 23:50 offline sale lands in the next day's closing. **Fix:** operations
   carry their original timestamp and day; replay-capable services accept them
   (extends rule 27's `client_day ?? localDay()` pattern).

### 6.4 Would it do any damage?

**No damage to existing data or the current app** — nothing about how IDs are
assigned changes, and no migration touches primary keys. The only risks are the five
cons above, and each is a replay-only problem. All five must be done in the same
phase as replay (Phase 5); shipping replay without the idempotency key (con 1) is the
one that would book real money twice.

---

## 7. Blockers and how each is solved

| #   | Blocker                                            | Solution                                                                                                                                                                    | Phase |
| --- | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----- |
| 7.1 | One shared server file for all shops               | Hosting plan per-tenant split — A–C shipped 2026-09-28, only Phase D (the switch) left. Litestream 0.5 `dir` + `pattern` + `watch` replicates each tenant file under `tenants/<id>.db/` automatically.   | 1     |
| 7.2 | Bringing offline work back                         | Replay operations through REST, not rows (§ 5.5). Server assigns IDs (§ 6).                                                                                                  | 5     |
| 7.3 | Web must stay read-only during an outage (D2)      | Heartbeat + tenant read-only lock + audited admin unlock + base-position check on reconnect (§ 5.4).                                                                        | 4     |
| 7.4 | Rejected replays                                   | Per-operation error list the owner resolves; never silently dropped. Evaluate reusing `sync_errors`.                                                                        | 5     |
| 7.5 | Desktop and server on different versions           | Auto-update while online; backend publishes a minimum desktop version; a desktop older than its mirror refuses offline mode with a warning; REST schemas keep accepting the previous version's payloads for one release. | 3     |
| 7.6 | Offline login and who did what                     | The mirror holds the shop's users and password hashes, so the desktop verifies logins offline. Replay authenticates with a **device key** issued at desktop setup; the server accepts the offline user as actor only if that user belongs to the tenant and is active. This is a deliberate, narrow exception to rule 19's "actor comes from the JWT". | 3, 5  |
| 7.7 | Security of local copies                           | Local mirror encrypted at rest; R2 reached only via short-lived tenant-scoped presigned URLs; the local file is never uploaded — only replayed operations, which the server validates, so editing the file by hand cannot inject data. | 2, 3  |
| 7.8 | Dates and time zones (server UTC, desktop Beirut)  | Operations carry their own timestamp and day (§ 6.3 con 5).                                                                                                                  | 5     |
| 7.9 | The desktop must be running to stay fresh          | Tray app, auto-start with Windows, visible "mirror age" indicator.                                                                                                          | 3     |
| 7.10| Actions that call outside services                 | Classify every write-path operation as *offline-OK* or *online-only*; online-only ones are disabled in offline mode with a clear message.                                    | 5     |
| 7.11| Last ~1 s before the cut may be missing on desktop | Accepted. The server has those rows; replay lands on top of them. Only the cashier's view is briefly behind.                                                                | —     |

---

## 8. Spikes (run before Phase 3)

| #   | Question                                                                                                                  | Pass condition                                                                                          | If it fails                                                                                        |
| --- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| S1  | Can the desktop apply Litestream 0.5 segments from R2 **incrementally** to keep a live local copy? (One-time `litestream restore` is already proven.) | A desktop copy follows a live tenant file within 10 s for an hour, `integrity_check ok`, byte-identical row counts | Backend publishes a compressed tenant snapshot every few minutes; desktop downloads it. Acceptable because staleness loses no data (§ 5.2). |
| S2  | Inventory of write-path operations                                                                                         | Every write route listed with: replayable?, row-reference fields, needs timestamp override?, offline-OK? | — (this sizes Phase 5; it cannot fail, only grow)                                                  |
| S3  | Can R2 presigned URLs be restricted to one tenant prefix for listing as well as reading?                                   | A URL issued for tenant 1 cannot list or read tenant 2                                                 | Backend proxies the segment downloads itself                                                       |

---

## 9. Phases

| Phase | Work                                                                                                                                                                                                                      | Depends on |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **1** | **Finish the hosting plan.** Phases A (tenant-aware `getDatabase()`), B (control-plane split) and C (provisioning creates a tenant file) are ✅ shipped 2026-09-28, as is the per-tenant Litestream layout. Left: Phase D (move CornerTech = 1 and Test = 5 into their own files and switch on — runbook § 12.4, dry-run on a production snapshot passed). Its Phase E (hosting) is **done** — replaced by the Fly.io deployment (owner decision 2026-09-09, live per `docs/OPERATIONS.md`); nothing to do there. | —          |
| **2** | Spikes S1–S3 (§ 8).                                                                                                                                                                                                        | 1          |
| **3** | Read-only mirror: tray app + auto-start, device registration + device key, presigned-URL endpoint, segment apply (or snapshot fallback), mirror-age indicator, offline login against the mirror, minimum-version gate.      | 2          |
| **4** | Web read-only lock: heartbeat endpoint, tenant lock state, web banner, audited admin unlock, base-position check.                                                                                                          | 3          |
| **5** | Outbox + replay: outbox in the adapter's offline mode, idempotency keys (server-side unique store), local→server ID map, timestamp/day carry-through, operation classification, error list UI. Audit the 18 `id DESC` / `MAX(id)` queries; stored `receipt_number`. | 3, 4       |
| **6** | Extras (optional): Google login; encrypted daily "copy to my Drive" export using the `drive.file` scope.                                                                                                                  | —          |

### Proof required per phase

- Money invariants: an outage day replayed must net to the same drawer, ledger,
  stock and profit totals as the same actions done online — per currency (rule 20).
- Every guard test is written first and seen failing (rule 17).
- Both transports (rule 19): replay is by definition the REST path, so the desktop
  spec that creates offline work must assert the web database afterwards.

---

## 10. Assumptions and open questions

- Assumption (unverified): a busy shop's database reaches ~50 MB after a year. Used
  only to show how whole-file backup cost grows; measure a real tenant.
- Assumption (unverified): Fly egress ~$0.02/GB and R2 pricing as in § 5.2 — check
  current prices.
- Open: which operations are online-only (7.10) — decided from spike S2's list.
- Open: whether an offline-created client/product is allowed, or offline mode is
  limited to transactions against existing records (smaller Phase 5 if limited).
