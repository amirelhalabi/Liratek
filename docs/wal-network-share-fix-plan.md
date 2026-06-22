# Plan: Fix WAL-on-network-share (multi-PC shared database)

> Status: planned (target release 1.27.2). Scope: ~3 PCs in one shop sharing a
> single SQLite database file over a Windows network share.

## Symptom observed

A shared database opened concurrently by a host PC (local path) and a client PC
(UNC path) became `database disk image is malformed` (corruption), and earlier
attempts threw `disk I/O error` / `database is locked`.

## Root cause

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

## Design answers

- **Concurrent reads** are fine natively — SQLite allows unlimited simultaneous
  readers (shared locks). No app-level read coordination is needed, **provided
  the DB is not in WAL mode**.
- **Write coordination** already exists inside SQLite: a writer takes an
  exclusive lock and `busy_timeout` makes other writers wait for it to finish.
  The robust form of "check if anyone is writing, wait, else continue" is:
  rollback-journal mode + a generous `busy_timeout` + a retry-on-`SQLITE_BUSY`
  wrapper at the repository layer. A hand-rolled advisory lock is more fragile
  over SMB and is not recommended unless busy errors persist.

## Fix

### 1. One "shared DB" flag honored by every PC

Add a deliberate *shared-mode* signal read at startup **before** the DB is
opened — e.g. a `db-mode.txt` marker next to `db-path.txt` in
`~/Documents/LiraTek/`, written by the setup/join flow and a Settings toggle.
Host **and** every client set it. It is not derived from the path, so the host
(local) and clients (UNC) behave identically.

### 2. Never use WAL on a shared DB — use rollback journal

- In shared mode: `PRAGMA journal_mode = TRUNCATE` (rollback journal; no `-shm`,
  network-safe). Never WAL.
- **One-time repair**: if the file is currently WAL, checkpoint and convert
  (`wal_checkpoint(TRUNCATE)` → `journal_mode = DELETE/TRUNCATE`) and remove
  stale `-wal`/`-shm`. `journal_mode = WAL` is persistent in the file header, so
  the conversion must happen once and no connection may ever flip it back.
- Keep `synchronous = FULL` for shared DBs (safer against corruption over a
  network than NORMAL).
- Disable the in-app WAL auto-checkpoint logic when shared.

### 3. Concurrency settings + repository resilience

- `PRAGMA busy_timeout = 10000` on every connection.
- A repository-layer `withWriteRetry()` helper: on `SQLITE_BUSY`, retry a few
  times with small backoff before surfacing an error.
- Ensure every multi-statement write goes through `db.transaction(...)` (audit
  repositories for any that do not).
- Reads unchanged — concurrent readers are fine in rollback mode.

### 4. Guardrails

- On startup in shared mode: run `PRAGMA quick_check`; if malformed, block writes
  and offer auto-restore from the hourly backup.
- Verify the journal mode actually applied; log a warning if WAL can't be
  disabled.

## Files in scope

- `electron-app/main.ts` — DB-open journal-mode logic, shared-mode read, WAL→rollback repair
- `packages/core/src/db/connection.ts`, `dbPath.ts` — shared-mode config plumbing
- `packages/core/src/db/` — a small `withWriteRetry()` helper used by repositories
- setup/join flow + Settings — the shared-mode toggle
- existing hourly-backup + integrity-check paths — for the guardrails

## Testing

Recreate the 3-PC setup (Windows host + 2 clients, or VMs) on the real SMB share;
run concurrent sales/writes from all three; confirm no `database is locked`, no
`disk I/O error`, and no corruption over a sustained run.

## Long-term recommendation (not for this release)

Network-shared SQLite is officially discouraged by SQLite even when tuned — it is
always somewhat fragile over SMB. The robust architecture is **client-server**:
one PC runs the database, others connect over TCP. The repository already has a
`backend/` workspace (Express + Socket.IO) built for exactly this. For ~3 PCs the
hardened shared-file plan above is acceptable; beyond that, or if corruption
recurs, migrating to the backend service is the real fix.
