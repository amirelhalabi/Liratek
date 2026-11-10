# Quickstart: validating Shop restore (LIRA-377)

Prerequisites: Node ABI `better-sqlite3` (`node -e "const D=require('better-sqlite3'); new D(':memory:')"`), core built and synced. Never run desktop/Electron e2e on the Mac; web e2e only.

## 1. Litestream behaviour on Linux (blocking, before the swap code is trusted)

On the Fly machine, against a COPY of the Test shop (never `/data/tenants/*.db` itself), in a scratch dir with its own `litestream.yml` (`file://` replica):

- online-backup a candidate into the replicated file with better-sqlite3 `.backup()` → no `ERROR` in litestream output, new txids appear, restore of the replica = candidate contents;
- `-timestamp` restore to a moment before the swap → pre-swap contents.

Expected: matches research.md R2/R3 (proven on macOS only).

## 2. Unit and integration tests (single files only)

- core: restore candidate preparation (stripped tables emptied, offline set carried, secrets carried, sequences raised, tenants mirror from platform); file checks (other shop, mixed shops, newer version, damaged, planted trigger); preview totals.
- core: `ReplayEngine` hold — event referencing a client created after the restore point, restore, create a new client, replay → held `restore_removed`, new client untouched (SC-003). Must fail first (rule 17).
- backend: `/api/restore/*` — staff 403, unauth 401, name mismatch, expired, one-at-a-time, swap returns 503 to a concurrent request of the same shop and 200 to another shop, sessions gone after swap.
- migration guard `migrationsPlatformFile.guard.test.ts` stays green with v231.

## 3. Web e2e (`frontend/tests/e2e-web/`)

- time restore: sale A, sale B, restore between them → A present, B absent, re-login required, audit row present;
- file restore: download backup (existing lira-web-094 flow), sale C, upload file → C absent;
- undo: restore, then restore the before-copy → state equals pre-restore (row counts + last sale);
- refusals: file from a second (canary) shop, damaged file;
- What's new screenshot of the Restore panel and preview.

## 4. Production check on the Test shop (tenant 5), after deploy

1. `yarn api:backup-check` → all ok.
2. Make a sale, wait 2 minutes, make another, restore to between them in Settings › Backup › Restore.
3. `yarn api:backup-check` again within 5 minutes → tenant 5 ok, not lagging (SC-007).
4. Restore the before-copy; confirm the second sale is back.
5. Log check: no `level=ERROR` litestream lines for `5.db`.
