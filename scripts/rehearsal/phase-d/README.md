# Phase D rehearsal (per-tenant DB split)

Adversarial rehearsal of the Phase D split runbook
(`docs/plans/ongoing_plans/PRODUCTION_DATABASE_AND_HOSTING_PLAN.md` § 12.4)
against a **copy** of the real desktop database. Three independent parts;
Parts A and B live here because they depend on a local file and on run order
(one writes a manifest, the other reads it) — neither is safe to let `yarn
test`/CI discover, so they are **not** under `packages/core/src/` or
`backend/src/` at all, and neither main jest config's `roots` reaches this
folder. Part C has no such dependency and stays in the guarded backend suite
(`backend/src/__tests__/perTenantMode.races.test.ts`).

| Part | File (this folder)                  | Jest config              | Depends on            |
| ---- | ------------------------------------ | ------------------------- | ---------------------- |
| A    | `split.phaseD.rehearsal.test.ts`     | `jest.core.config.cjs`    | a copy of the desktop DB (below) |
| B    | `runbook.phaseD.rehearsal.test.ts`   | `jest.backend.config.cjs` | the manifest Part A writes — **run A first** |
| C    | `../../backend/src/__tests__/perTenantMode.races.test.ts` | `backend/jest.config.cjs` (part of `yarn workspace @liratek/backend test`) | nothing — self-contained |

## What it does

- **Part A** (real `better-sqlite3`, no mocks): copies the desktop DB into a
  throwaway temp dir, provisions a second tenant through the app's own
  provisioning service, snapshots it (`VACUUM INTO`, same as the real
  runbook), dry-runs then really runs `splitTenantDatabase()`, moves the
  output into a `platform.db` + `tenants/<id>.db` layout, and writes a
  manifest (tenant ids, file paths, pre-split per-table row counts, a
  pre-split session token) to a fixed scratch path so Part B can pick up
  where it left off.
- **Part B** (backend-flavored: express/supertest, `@liratek/core` resolved
  to source): reads that manifest, boots per-tenant routing in-process
  against the split output (mirrors `connection.ts#installTenantDbRouting`),
  and proves: each shop's admin sees exactly its own pre-split data (Steps
  6–7), a super admin sees both tenants (Step 8), a session token minted
  BEFORE the split still validates after switching to per-tenant mode (Step
  9), the documented rollback discards any post-split write with no merge
  tool (Step 10), and the safety lock (`checkPlatformSplitStatus`) refuses to
  treat an un-split copy as split.
- **Part C**: two race scenarios under per-tenant mode — suspending a shop
  mid-impersonation, and deleting a shop while a request for it is mid-flight
  across a real `await`. Self-contained (own temp dirs, own HTTP-provisioned
  tenants), so it runs as part of the ordinary backend suite instead of
  living here.

**Neither this folder nor anything it imports ever opens
`~/Documents/LiraTek/liratek.db` (the live desktop DB) — see
`docs/DEPLOYMENT.md`/CLAUDE.md's "Local app DB location" note for where that
file actually is. Part A only ever reads a COPY you place yourself (below),
the same "never the live file" contract the real runbook enforces on an
operator.**

## Running it

### 1. Place a copy of the desktop DB

Part A refuses to run (`ENOENT`) until this exists:

```bash
mkdir -p "$(node -e "console.log(require('os').tmpdir())")/liratek-phase-d-rehearsal"
cp ~/Documents/LiraTek/liratek.db \
   "$(node -e "console.log(require('os').tmpdir())")/liratek-phase-d-rehearsal/liratek-copy.db"
```

(A stray `-wal`/`-shm` beside the copy is harmless — Part A only opens the
copy read/write to seed a known password and provision a second tenant, and
takes its own `VACUUM INTO` snapshot before splitting, same as the real
runbook.) Override the whole scratch directory with
`PHASE_D_REHEARSAL_SCRATCH_DIR` if you'd rather not use the OS temp dir (see
`scratchPaths.ts`) — Part A and Part B both read the same env var, so they
can't drift onto two different directories.

### 2. Run Part A, then Part B, in that order

From the repo root:

```bash
npx jest --config scripts/rehearsal/phase-d/jest.core.config.cjs
npx jest --config scripts/rehearsal/phase-d/jest.backend.config.cjs
```

Verified green end-to-end on 2026-09-27 (portable default scratch dir, no env
override): Part A **1 passed, 6.7s**; Part B **8 passed, 5.2s** (per-test
timings logged, including `migrateAllTenants` real elapsed time for Step 5 —
this is not a vacuous pass; every step asserts a real HTTP response body or a
real file's row counts). Re-running Part A alone regenerates a fresh manifest
each time, so the pair can be repeated as often as needed — Part A always
starts from a brand-new temp dir under `os.tmpdir()`; nothing here is
order-dependent beyond "A before B" for that one run.

### 3. Part C (races) — runs with the ordinary backend suite

No separate command: `yarn workspace @liratek/backend test` (or
`node ../node_modules/jest/bin/jest.js --config jest.config.cjs
src/__tests__/perTenantMode.races.test.ts` from `backend/`) already includes
it. It provisions its own two shops over the real HTTP admin API and cleans
up its own temp dirs; it deletes then restores
`globalThis.__LIRATEK_TEST_DB__` around its per-tenant resolver install so it
can't affect any other file's run in the same suite.

## Two things that bite here specifically (beyond the general Windows/E2E
notes in the root `CLAUDE.md`)

- **Windows file handles.** If you re-run Part A/B and see `EBUSY` or
  `EPERM` moving/deleting a split-output file, something (an editor, a DB
  browser, an antivirus scan) still has one of the temp `.db`/`.db-wal`
  files open — close it and re-run. `splitTenantDatabase()` itself always
  closes every connection it opens (`finally { db.close() }` throughout), so
  this is never the split tool leaking a handle; it's an external process.
  **Not an issue on the real Fly Linux host** the actual runbook runs
  against — `rename`/`unlink` on Linux never fails because another process
  still has the old inode open.
- **better-sqlite3 ABI.** Both configs need the **Node** ABI (plain
  `node_modules/.bin/jest`, not Electron) — if you've just run desktop e2e
  (`yarn dev` → `node scripts/run-e2e.mjs electron`), that leaves the
  **Electron** ABI rebuilt, and Part A/B will fail every test at the first
  `new Database(...)` call with `NODE_MODULE_VERSION mismatch`. Run
  `yarn rebuild:node` first if that happens, and remember that going back to
  desktop e2e afterward needs the full `yarn dev` → stop → e2e cycle to
  restore the Electron ABI again (see the root `CLAUDE.md`'s "better-sqlite3
  ABI is NOT portable" note) — this rehearsal and desktop e2e can't be run
  back-to-back without that rebuild step in between.

## Files

- `split.phaseD.rehearsal.test.ts` — Part A.
- `runbook.phaseD.rehearsal.test.ts` — Part B.
- `scratchPaths.ts` — the one shared definition of where the desktop-DB copy
  and the manifest live (rule 14 — Part A writes, Part B reads, from the same
  constants).
- `jest.core.config.cjs` / `jest.backend.config.cjs` — each reuses its real
  counterpart (`packages/core/jest.config.cjs` / `backend/jest.config.cjs`)
  verbatim, only overriding `rootDir`/`roots`/`testMatch` so it discovers
  exactly its one file here instead of the package's own `src/`. Neither
  `packages/core/jest.config.cjs` nor `backend/jest.config.cjs` has been
  changed to exclude this folder — they simply never reach it, since both
  scope `roots` to their own `<rootDir>/src`.
