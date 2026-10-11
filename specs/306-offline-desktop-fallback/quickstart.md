# Quickstart — proving LIRA-306 slice by slice

Prerequisites: `yarn install`; core built and synced after core edits
(`cd packages/core && npm run build`, then `cp -r packages/core/dist/. node_modules/@liratek/core/dist/`); Node ABI for
core/backend jest and web e2e (`yarn rebuild:node`). Never launch Electron on this Mac.

## Slice US1 — web write lock (tonight)

1. `yarn workspace @liratek/core test -- offline` — registry, lock predicate, device repository/service tests.
2. `yarn workspace @liratek/backend test -- offline requireShopUnlocked deviceAuth` — gate (locked / unlocked / no device /
   GET passes / auth exempt / lookup error passes), device auth, routes.
3. Web e2e (`yarn rebuild:node` first): `cd frontend && npx playwright test --config playwright.web.config.ts tests/e2e-web/lira-web-055-offline-lock.spec.ts --reporter=list`
   — confirm "1 passed" (or the spec's test count) and a non-trivial duration (rule 28).
   Expected: banner after the short stale window, refused sale (HTTP 200, `success:false`, `SHOP_LOCKED_OFFLINE`), reads OK, admin Unlock →
   sale OK, audit row present; device revoked at the end.

## Slice US2 — replay (tonight)

1. `yarn workspace @liratek/core test -- OfflineReplay` — book once, refused continues, held after unlock, day/offset
   carry-through (23:50 Beirut op lands on day N), parity (SC-001), void-after-replay.
2. Backend route tests for `/replay`, `/period/complete`, `/review/*`.
3. Web e2e `lira-web-056` — replay 3 ops dated yesterday 23:50 Beirut, deltas match, resend changes nothing, a refused op is
   on the review page, Dismiss works, period complete unlocks, device revoked at the end.

## Slice US3 — mirror (server half tonight)

1. `yarn workspace @liratek/core test -- tenantSnapshot tenantSplit` — two-shop source → snapshot holds one shop, no
   stripped rows, licence key null, integrity ok; the split tool's own tests still pass after the `narrowToTenant`
   extraction.
2. Record the build time on a copy of a local DB (task T056).
3. Desktop half: `yarn workspace @liratek/electron-app test -- offline` (boot decision, guard, pairing store). Visible
   behaviour: unverified until CI / Windows.

## Slice US4 — offline mode (code + electron jest tonight)

`yarn workspace @liratek/electron-app test -- offline` — recorder atomicity (throw mid-transaction → no sale, no op),
refusals (standby write, non-registry write, ref to offline row, after reconnect), sender marks results and retires the
working copy only at 0 waiting. Desktop CI spec `lira-306-unpaired-desktop-unchanged` runs on CI only.

## Gates (every slice)

`yarn typecheck`, `yarn lint`, `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`,
core/backend/electron/frontend jest (suite counts above floors), `yarn build`, `node scripts/build-release-notes.cjs --check`.

## Owner-run (US5)

See `docs/OPERATIONS.md` § "Offline desktop fallback" (written by task T080): push/deploy, first pairing on the test
shop, outage drill, Phase D, S1/S3.
