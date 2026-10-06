# LiraTek Constitution

The non-negotiables for any feature built through Spec Kit. Each rule is
checkable against a diff. The full wording, history and examples live in
`CLAUDE.md` (rule numbers cited) and `docs/FEATURE_GUIDE.md`; where this file
and `CLAUDE.md` disagree, `CLAUDE.md` wins and this file gets fixed.

## Core Principles

### I. One core, two transports

- Every new or changed feature works on both desktop (Electron IPC) and web
  (REST), and both call the same `@liratek/core` service. _Why: one codebase
  ships as both apps._ (rule 19) Existing desktop-only paths are tracked debt
  in `docs/plans/ongoing_plans/WEB_PARITY_ROADMAP.md`, not a pattern.
- Frontend data access goes through `useApi()` / `backendApi.ts` (`ipcOrHttp`);
  no raw `window.api.*` and no `if (window.api)` gate in pages or components.
  _Why: a raw gate takes the wrong branch in the browser._ (rules 2, 19)
- A payload is built once per operation, never once per transport. _Why: the
  branch nobody runs locally drifts and breaks._ (rule 22)
- Anything that depends on where code runs (clock, day, timezone, locale, env,
  filesystem) is supplied by the client and validated, with the server value
  only as fallback. _Why: core runs in Beirut on desktop and UTC on Fly._ (rule 27)
- Modules reachable from `packages/core/src/browser.ts` import no Node
  built-in at any depth. _Why: it breaks the Vercel build after every local
  gate passed._ (rule 29)

### II. Layer boundaries

- Repositories own all SQL; new or changed services never call
  `getDatabase()` or `db.prepare(...)`. _Why: SQL stays in one layer and
  services stay unit-testable with a mocked repo._ (rule 13) Known legacy
  violations, to be fixed rather than copied: `ProfitService`,
  `SessionPaymentService`, `ActivityService`.
- Handlers and routes hold no business logic; they validate, authorize, and
  call the service. _Why: logic in a transport layer exists on only one
  transport._ (rule 19)
- The renderer never imports Node, Electron or `better-sqlite3`, and only
  `preload.ts` calls `ipcRenderer`. _Why: `contextIsolation` sandbox._

### III. Contracts are defined once

- Each write-path Zod schema lives in `packages/core/src/validators/` and is
  shared by the IPC handler and the REST route. _Why: two schemas drift._
  (rules 14, 19)
- Adapter payload types derive from the schema (`z.input<typeof schema>`),
  never hand-written. _Why: a hand-copied type endorsed a broken payload._
  (rule 21)
- Before putting a schema in front of an existing handler, diff schema keys
  vs. preload type vs. handler-forwarded fields. _Why: Zod strips unknown keys
  silently._ (rule 23)
- A business-rule SQL predicate is a named constant used everywhere, never
  pasted twice. _Why: copies diverge._ (rule 14)
- IPC and REST both return `{ success, data?, error? }`; REST returns HTTP 200
  on failure. _Why: the adapter branches on `success`, not status._ (rule 6)

### IV. Money integrity (NON-NEGOTIABLE)

- Any flow that writes transactions, payments, drawers or ledgers works
  through the `docs/FEATURE_GUIDE.md` §13 checklist. _Why: each item there is a
  bug that shipped._ (rule 18)
- Flow-specific branches consume IN legs only; OUT legs are debited once by the
  shared end-of-transaction loop. _Why: iterating OUT legs double-debits the
  drawer._ (rule 16)
- Forms with a client field propagate `client_id` UI → IPC/REST → service →
  `createTransaction`. _Why: a dropped link silently loses the client._ (rule 11)
- Every side-effect ledger row has a named reversal owner, and create + reverse
  nets to 0 per ledger per currency in a test. New module charge types are
  named `'<Module> Debt'`. _Why: un-reversed refunds kept customer debt._
  (rule 20)
- System-written sibling rows carry `metadata_json.is_auto = true`, derived at
  the shared writer from the source link; missing metadata reads as visible.
  _Why: hide bookkeeping, never swallow money._ (rule 26)

### V. Data and security

- SQL uses `?` placeholders only, never string concatenation. _Why: injection._
  (rule 3; `yarn check:bind-arity` in CI)
- Every SQL statement on a tenant-scoped table references `tenant_id`.
  _Why: one missing filter leaks another shop's data._
  (`yarn check:tenant-scoping` in CI)
- Write-path IPC handlers call `requireRole` + `validatePayload`; REST routes
  run `authenticateJWT` then `requireRole` with the same roles, and take the
  actor from the JWT, never from the body. _Why: a missing check is a privilege
  hole._ (rule 19)
- Every table has `id`, `created_at`, `updated_at`. (rule 5)
- A migration updates both `packages/core/src/db/migrations/index.ts` and
  `electron-app/create_db.sql`, with a `down()`. _Why: fresh installs and
  upgraded installs must get the same schema._ (rule 10;
  `yarn check:schema-equivalence` in CI)

### VI. Testing

- A regression guard is written first and seen failing on the unfixed code;
  finished code is never reverted to prove a test. _Why: a test never seen
  failing proves nothing._ (rule 17)
- E2E specs on the shared DB match rows by identity and assert deltas, never
  row position or absolute totals. _Why: specs share one accumulating DB._
  (rule 15)
- Payload field names in tests come from the schema, not hand-typed. _Why: a
  wrong assertion protects the defect._ (rule 24)
- Web parity is proven by a web e2e spec (`frontend/tests/e2e-web/`) or a
  desktop spec run over the web shim. _Why: desktop green says nothing about
  web._ (rule 19)
- A green result counts only after confirming the assertions ran (suite/test
  counts, elapsed time). _Why: fast no-op runs were read as passes._ (rule 28;
  CI suite-count floors)

### VII. Code quality

- TypeScript strict, no `any`. _Why: `payload: any` hid the repayment
  field drift._ (rules 1, 21)
- Module loggers only, no `console.log`. (rule 4)
- Named exports, except pages/components; `@/` alias for `frontend/src/`.
  (rules 7, 8)
- `api` from `useApi()` in a dependency array is read through a ref, and test
  mocks of `useApi()` return a stable reference. _Why: identity churn caused
  synchronous render loops reported as worker OOM._ (rule 25)

## Quality Gates

A feature is done when all of these pass, the same as CI (`.github/workflows/ci.yml`):

- `yarn lint` and `yarn typecheck`
- `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`
- core, backend, electron-handler and frontend test suites (core and electron-handler also above their suite/test-count floors)
- `yarn build`
- `node scripts/build-release-notes.cjs --check`

There is no coverage threshold: coverage is uploaded by CI, not gated.

## Delivery

- Every user-visible change adds a line to `docs/release-notes/UNRELEASED.md`
  in shop-owner language, in the same change. _Why: it is the only channel
  desktop users see._ (rule 30)
- Commits use Conventional Commits and cite the ticket (`LIRA-NNN`) when
  there is one; tickets live in `current_sprint.md`.
- Pushing to `main` deploys web and API; deploy manually only with
  `yarn api:deploy`, never `flyctl` directly. _Why: the script verifies
  migrations, Litestream and the single-machine invariant._

## Governance

- This file summarizes `CLAUDE.md`; a rule change lands in `CLAUDE.md` first,
  then here, in the same commit.
- `/speckit-plan` and `/speckit-analyze` treat a violation of this file as a
  blocker unless the plan records an explicit, owner-approved exception.

**Version**: 1.0.0 | **Ratified**: 2026-10-06 | **Last Amended**: 2026-10-06
