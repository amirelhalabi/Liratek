# Plan: Safe multi-PC shared database (WAL fix + concurrent-write correctness)

> Status: planned (target release 1.27.2). Scope: ~3 PCs in one shop sharing a
> single SQLite database file over a Windows network share.

## Two distinct problems

The "two instances sell the last item at the same time" scenario actually hides
**two separate problems** that need **two separate fixes**. Solving one does not
solve the other.

1. **Write collision / corruption (infrastructure).** Multiple PCs writing the
   same file concurrently must be _serialized_; and over a network share, WAL
   mode actively corrupts the file. → Fixed by Layer 1.
2. **Lost update / oversell (business rule).** Two instances each read
   "1 in stock", both add to cart, both click _Complete Sale_. The second sale
   must **fail with an error**, not silently drive stock to −1. Serialization
   alone does **not** prevent this — the second writer still oversells unless its
   write _re-checks_ the precondition. → Fixed by Layer 2.

A custom "is anyone writing? wait" lock only addresses #1, which SQLite already
does for free, and does nothing for #2. So it is the wrong tool; the right tools
are SQLite's own locking (Layer 1) plus guarded/optimistic writes (Layer 2).

---

## Problem 1 — WAL on a network share (corruption)

### Symptom observed

A shared database opened concurrently by a host PC (local path) and a client PC
(UNC path) became `database disk image is malformed`; earlier attempts threw
`disk I/O error` / `database is locked`.

### Root cause

SQLite **WAL mode coordinates readers and writers through a shared-memory file
(`-shm`) that only works among processes on the same machine.** Over a network
share with multiple PCs that coordination breaks, producing lock errors and
corruption.

Two compounding bugs:

1. [`electron-app/main.ts`](../electron-app/main.ts) sets `journal_mode = WAL`
   **unconditionally**, even when the DB lives on a network share.
2. A per-machine `isNetworkPath` check is **not sufficient**: the **host sees a
   local path** (would choose WAL) while clients see a UNC path. Mixed journal
   modes on the same file corrupt it. The journal-mode decision must be **global
   to the database**, identical on the host and every client.

### Design answers

- **Concurrent reads** are fine natively — SQLite allows unlimited simultaneous
  readers (shared locks). No app-level read coordination is needed, **provided
  the DB is not in WAL mode**.
- **Write serialization** already exists inside SQLite: a writer takes an
  exclusive lock and `busy_timeout` makes other writers wait for it to finish.
  The robust form of "check if anyone is writing, wait, else continue" is:
  rollback-journal mode + a generous `busy_timeout` + a retry-on-`SQLITE_BUSY`
  wrapper at the repository layer.

---

## Problem 2 — Concurrent business writes (the oversell)

### Current state (the bug)

The sale's stock decrement is **unguarded**
([`SalesRepository.ts:504`](../packages/core/src/repositories/SalesRepository.ts#L504)):

```sql
UPDATE products SET stock_quantity = stock_quantity - ? WHERE id = ?
```

There is no `stock_quantity >= ?` guard and no rows-affected check, so today the
second concurrent sale silently drives stock to **−1** instead of erroring.

### Fix — optimistic / guarded writes

Express each business precondition **as a guard inside the write**, run it inside
the existing `db.transaction(...)`, and check rows affected. Example for the
sale:

```sql
UPDATE products SET stock_quantity = stock_quantity - :q
WHERE id = :id AND stock_quantity >= :q
```

```js
const r = stockStmt.run(item.quantity, item.product_id);
if (r.changes === 0) throw new InsufficientStockError(item.product_id);
```

`better-sqlite3`'s `db.transaction()` auto-rolls-back on throw, so the sale row,
items, and ledger entries are undone. The existing `{ success, error }` IPC
envelope carries the message to the renderer, which already renders
`result.error` ("Sale failed: …").

### Walking the scenario with both layers in place

- **app1** clicks → takes the write lock → `UPDATE … WHERE stock>=1` succeeds
  (1→0) → commits.
- **app2** clicks ~simultaneously → its `IMMEDIATE` transaction blocks on the
  lock (the button stays in its loading state) → app1 commits → app2 proceeds →
  `UPDATE … WHERE stock>=1` affects **0 rows** → throws → rollback →
  `{ success:false, error:"Charger is out of stock" }` → frontend shows it.

Identical behavior whether the DB is local or shared.

### General pattern + where to apply

All mutations already flow through repositories using `db.transaction(...)`. The
standard for every write path:

- Run the transaction as **`IMMEDIATE`** (`db.transaction(fn).immediate(...)`) so
  the write lock is taken at `BEGIN` and the read-check-write is atomic (avoids
  `SQLITE_BUSY_SNAPSHOT` from read-then-upgrade).
- Encode each invariant as a `WHERE` guard and verify `result.changes`.
- Throw a typed domain error on violation; let the IPC envelope surface it.

Apply to invariant-bearing operations in priority order (insert-only operations
need nothing beyond Layer 1):

1. **Sale stock decrement** (the example above) — first.
2. Debt repayment / credit balance checks.
3. Hold-money collect (held → collected, once).
4. Voucher redeem (unused → used, once).
5. Partner / supplier settlement (not-already-settled).
6. Any status transition or balance mutation guarded by a current value.

---

## Combined fix

### Layer 1 — serialization (global, automatic)

- One **shared-mode flag** read at startup _before_ the DB is opened — e.g. a
  `db-mode.txt` marker next to `db-path.txt` in `~/Documents/LiraTek/`, written
  by the setup/join flow and a Settings toggle. Host **and** every client set it,
  so the host (local) and clients (UNC) behave identically.
- In shared mode: `PRAGMA journal_mode = TRUNCATE` (rollback journal; no `-shm`,
  network-safe). **Never WAL.** One-time repair: if the file is currently WAL,
  `wal_checkpoint(TRUNCATE)` → `journal_mode = DELETE/TRUNCATE`, remove stale
  `-wal`/`-shm`. (`journal_mode = WAL` is persistent in the header, so the
  conversion must happen once and no connection may flip it back.)
- `PRAGMA synchronous = FULL` for shared DBs (safer over a network).
- `PRAGMA busy_timeout = 5000` on every connection so a busy writer **waits**
  (the loading state) instead of erroring.
- A repository-layer `withWriteRetry()` helper: on `SQLITE_BUSY`, retry a few
  times with small backoff before surfacing an error.
- Disable the in-app WAL auto-checkpoint logic when shared.

### Layer 2 — guarded writes (per invariant)

- `IMMEDIATE` write transactions + `WHERE`-guard + `changes` check + typed domain
  errors, as described in Problem 2. Roll out per the priority list.

### Guardrails

- On startup in shared mode: `PRAGMA quick_check`; if malformed, block writes and
  offer auto-restore from the hourly backup.
- Verify the journal mode actually applied; log a warning if WAL can't be
  disabled.

## better-sqlite3 caveat (synchronous)

`better-sqlite3` is synchronous, so while an instance waits on a busy lock its
main process is blocked for that span. For ~3 PCs with sub-second transactions
the contention window is milliseconds, so it is fine — but keep transactions
short and prefer a sane `busy_timeout` (~5s) + 2–3 retries over a very large
timeout.

## Files in scope

- `electron-app/main.ts` — DB-open journal-mode logic, shared-mode read, WAL→rollback repair
- `packages/core/src/db/connection.ts`, `dbPath.ts` — shared-mode config plumbing
- `packages/core/src/db/` — a `withWriteRetry()` helper and `IMMEDIATE` transaction usage
- `packages/core/src/repositories/SalesRepository.ts` — first guarded write (stock), then the priority list
- a typed domain-error type (e.g. `InsufficientStockError`) surfaced through the IPC envelope
- setup/join flow + Settings — the shared-mode toggle
- existing hourly-backup + integrity-check paths — for the guardrails

## Testing

- **Layer 1**: recreate the 3-PC setup (Windows host + 2 clients, or VMs) on the
  real SMB share; run concurrent sales/writes from all three; confirm no
  `database is locked`, no `disk I/O error`, and no corruption over a sustained
  run.
- **Layer 2**: the explicit oversell test — one unit in stock, two instances both
  complete a sale; assert exactly one succeeds and the other returns an
  out-of-stock error (and final stock is 0, never negative).

## Long-term recommendation (not for this release)

Network-shared SQLite is officially discouraged by SQLite even when tuned — it is
always somewhat fragile over SMB. The robust architecture is **client-server**:
one PC runs the database, others connect over TCP. The repository already has a
`backend/` workspace (Express + Socket.IO) built for exactly this. For ~3 PCs the
hardened shared-file plan above is acceptable; beyond that, or if corruption
recurs, migrating to the backend service is the real fix. (Note: Layer 2 guarded
writes remain correct and necessary under the client-server model too.)
