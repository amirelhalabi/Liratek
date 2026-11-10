# Implementation Plan: Restore a shop (to an earlier time, or from a backup file)

**Branch**: `377-shop-restore` (work on `main`; ticket LIRA-377) | **Date**: 2026-11-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/377-shop-restore/spec.md`

## Summary

A web shop admin restores their shop to a moment in the last 7 days (from the shop's continuous Litestream replica), from a downloaded backup file, or back to the automatic "before restore" copy. The server builds a candidate file on the volume, brings it to the current schema, prepares it (sign-in tables emptied, till-PC state and integration secrets carried from the current file, id sequences raised so no number is ever reissued), shows a preview of what will be lost, and after the typed shop name copies the candidate INTO the live shop file with SQLite's online backup while that one shop is blocked for a few seconds. Paired PCs learn of it from the check-in response and refresh their copy at once; an offline sale that points at a removed record is held for review, never booked to another record.

## Technical Context

**Language/Version**: TypeScript (strict), Node 20 (Fly), React 19 + Vite (web)

**Primary Dependencies**: better-sqlite3 (online `.backup()`), Litestream 0.5.17 (child process, backend only), Express (`express.raw` on one route), Zod, TanStack Query

**Storage**: per-shop SQLite files `/data/tenants/<id>.db`; platform file `/data/liratek.db` (new `shop_restores` table, v231); work files under `/data/restore-work/`, before-copies under `/data/restore-points/`; R2 via Litestream (retention 192 h)

**Testing**: core jest, backend jest (supertest), frontend jest, web Playwright (`frontend/tests/e2e-web`), one Linux validation on Fly against a copy (quickstart §1)

**Target Platform**: web app (Vercel → Fly, one machine). Desktop out of scope (spec FR-023)

**Project Type**: web service + web frontend + desktop offline client (PC side of the check-in only)

**Performance Goals**: shop blocked < 15 s for an 11 MB shop (SC-002); other shops unaffected

**Constraints**: single Fly machine and single SQLite writer; better-sqlite3 is synchronous (a long synchronous step blocks every shop — candidate build/migration run before the block and must stay short; the block itself is the copy only); Litestream must keep replicating (no rename over a watched file, research R3)

**Scale/Scope**: 2 live shops (11 MB / 2 MB), growing via self-serve sign-up

## Constitution Check

| Principle | Status |
|---|---|
| I. One core, two transports (rule 19) | **Waived for this feature, recorded in spec FR-023** (owner: web only; restore replaces server-side shop data that has no desktop counterpart). Frontend still goes through `useApi()`/`backendApi.ts`; desktop branch returns "Available on the web app". |
| I. Client supplies time/day (rule 27) | Restore moment chosen in the browser, sent as UTC + `clientTzOffsetMin`; server never uses its own clock to interpret it. |
| I. `browser.ts` leaf (rule 29) | Litestream child process and file moves live in `backend/`; core gets ports (`RestoreSourcePort`, `ShopFilePort`) with pure types only. |
| II. Layer boundaries (rule 13) | `ShopRestoreService` (core) orchestrates; SQL in `ShopRestoreRepository` (candidate prep, preview queries) and `ShopRestoresRepository` (platform table). Route only validates/authorizes/calls. |
| III. Contracts once (rules 14, 21) | Schemas in `packages/core/src/validators/restore.ts`; adapter types `z.input<…>`; stripped-table list reused from `SNAPSHOT_STRIPPED_TABLES`; file verifier reused from the backup builder. |
| IV. Money integrity (rules 16, 18, 20) | A restore writes no transaction. Replay of offline sales after a restore uses the existing booking paths unchanged; the new hold happens before booking. FEATURE_GUIDE §13 reviewed for the replay part: nothing new is booked. |
| V. Data and security | Parameterized SQL; uploaded file is untrusted (FR-006 + planted-object check); admin only; JWT tenant only; sessions ended. |
| Migrations (rule 10) | v231 in `migrations/index.ts` AND `create_db.sql`; platform-file guard stays green (no per-shop seeding). |
| Tests failing first (rule 17) | Guard tests written and run red before each fix (replay hold, sequence raise, refusals, block → 503). |
| Release note (rule 30) | UNRELEASED.md line + What's new card with a real screenshot. |

Post-design re-check: no new violation; the waiver above is the only one.

## Project Structure

### Documentation (this feature)

```text
specs/377-shop-restore/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R10
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── rest.md
│   └── offline-checkin.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code

```text
packages/core/src/
├── validators/restore.ts                     # prepare/confirm/cancel schemas (+ export from browser.ts)
├── db/migrations/index.ts                    # v231: shop_restores (platform-only), offline_review_items CHECK rebuild
├── db/tenantSplit.ts                         # PLATFORM_ONLY_TABLES += shop_restores
├── db/tenantSnapshot.ts                      # export the file verifier + stripped/secret lists for reuse
├── repositories/ShopRestoreRepository.ts     # candidate prep + preview SQL (opens candidate by path)
├── repositories/ShopRestoresRepository.ts    # platform shop_restores rows (runWithoutTenant)
├── services/ShopRestoreService.ts            # prepare / confirm / cancel / points; ports for source + swap
├── offline/reviewKinds.ts                    # + restore_removed
├── offline/ReplayEngine.ts                   # hold check after rewriteIdPositions
├── services/OfflineReviewService.ts          # Apply with replacement client for restore_removed
└── services/OfflineDeviceService.ts          # check-in `restore` field; SHOP_RESTORING code
electron-app/create_db.sql                     # v231 mirror

backend/src/
├── api/restore.ts                            # routes (contracts/rest.md); express.raw on /file
├── restore/litestreamSource.ts               # child process: litestream restore -timestamp / latest
├── restore/shopFileSwap.ts                   # block → evict → VACUUM INTO before-copy → .backup() → unblock
├── database/connection.ts                    # export pool accessor; pool block/unblock
├── email/templates/shopRestored.ts           # owner email
├── services/restorePointSweep.ts             # delete before-copies > 7 days (keep newest), expired candidates
└── server.ts                                 # mount /api/restore
backend/litestream.yml                        # snapshot: interval 24h, retention 192h

packages/core/src/db/tenantDatabasePool.ts    # blocked set; get() throws ShopRestoringError

electron-app/offline/syncClient.ts            # react to `restore`, refresh now, banner; SHOP_RESTORING = retry
frontend/src/
├── api/backendApi.ts, ElectronApiAdapter.ts  # restore functions (desktop branch: unavailable)
├── features/settings/pages/Settings/ShopRestorePanel.tsx   # in the Backup tab: picker, upload, preview, confirm
└── features/offline/…/OfflineReview          # Apply-with-replacement for restore_removed
packages/ui/src/api/types.ts, i18n en/ar
docs/OPERATIONS.md                             # restore points, before-copies, retention
docs/release-notes/UNRELEASED.md               # line + card
```

**Structure Decision**: existing monorepo layout; core owns rules and SQL, backend owns processes and files, frontend one panel in the existing Backup tab.

## Phases (for /speckit-tasks)

1. **Validate on Linux** (quickstart §1) — blocking; if `.backup()` into a watched file misbehaves, fall back to `litestream unregister` + rename (research R3 alternative).
2. **Retention** — `litestream.yml` global snapshot block; deploy alone; confirm with `litestream ltx` after 24 h that history is kept. Independent and low-risk, ship first.
3. **Core**: migration v231, `shop_restores`, review kind, candidate preparation + verifier reuse, preview, service with ports. Failing-first tests.
4. **Swap**: pool block/`ShopRestoringError`, `shopFileSwap`, lock, merge-round wait, before-copy, sweep.
5. **Routes + email + audit + signin sync**.
6. **Offline**: check-in field, PC refresh + banner, `SHOP_RESTORING`, replay hold, Apply-with-replacement.
7. **Frontend**: panel, preview, upload (gzip), sign-out after restore.
8. **E2E + production check on the Test shop** (quickstart §3–4), docs, release note + screenshot.

## Owner decisions (2026-11-10, after planning)

1. **Kept from the shop as it is just before the restore:** integration keys (API keys/tokens in Settings), Google sign-in links, till-PC pairings. Everything else comes from the restored copy.
2. **Review "Apply with replacement"** only for a removed **client** (pick another client or walk-in); a sale pointing at a removed product or supplier is dismissed and re-entered (details shown).

## Risks

- `.backup()` into a Litestream-watched file proven on macOS only → Phase 1 gate.
- Synchronous candidate build/migration blocks every shop for its duration (better-sqlite3); measure on the 11 MB shop; if > 2 s, move candidate preparation to a worker thread.
- `SNAPSHOT_STRIPPED_TABLES` also lists offline tables; the carry-over must run after the stripping or the PC set is lost — test pins it.
- Production shop files are NOT encrypted (checked 2026-11-10: `/data/tenants/1.db` starts with the plain `SQLite format 3` header, although a `DATABASE_KEY` secret exists — stock better-sqlite3 ignores it, OPERATIONS.md). If SQLCipher is ever enabled, file restore needs a re-key step.

## Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
|---|---|---|
| Rule 19 (desktop parity) | Owner scoped restore to the web; it replaces server-side per-shop files | A desktop restore of local backups is a different feature (separate gap) |
