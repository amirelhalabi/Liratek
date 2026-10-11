# Quickstart — validating LIRA-305

Run from the repo root on macOS (no Electron on this Mac — desktop e2e is CI-only, ground rule G5). Core jest needs the
Node ABI of better-sqlite3; probe first (a bare `require` is a false positive):

```bash
node -e "const D=require('better-sqlite3'); new D(':memory:'); console.log('Node ABI')"
```

## 1. Core — the netting rule (P1)

```bash
cd packages/core && npx jest src/repositories/__tests__/ProfitRepository.syriaCorridorNetting.test.ts
```

Expected: every case in `data-model.md` invariants and spec US1 scenarios 1–7 passes, plus the SC-004 perf case.
Before the fix (T004) the netted cases fail with the measured figures (Q1 5 ≠ 8, Q2 3 ≠ 6, Q3 3.8 ≠ 5) and the
non-netted guards pass.

Regression nets that must stay green with no edits:

```bash
cd packages/core && npx jest src/repositories/__tests__/ProfitRepository.viaPartnerCustomServiceDeferral.test.ts \
  src/repositories/__tests__/CustomServiceRepository.payout.test.ts \
  src/repositories/__tests__/CustomServiceRepository.viaPartner.test.ts \
  src/repositories/__tests__/ProfitRepository.partnerProportional \
  src/constants/__tests__/partnerLedgerTypes.guard.test.ts
```

## 2. Web e2e — the whole corridor over REST (P2)

```bash
node scripts/run-e2e.mjs web -g "lira-web-054"
# fallback that is known to work from an agent shell:
cd frontend && npx playwright test --config playwright.web.config.ts lira-web-054 --reporter=list
```

Expected (fresh partner, deltas only): SEND → General +103, partner −100, Custom Services profit +3; RECEIVE → General −97,
partner 0, profit +3; void RECEIVE → General +97, partner −100, profit −3; void SEND → all back to start. Also re-run
`lira-web-custom-service-payout` (its header says "NOT RUN").

Confirm the run really executed: "1 passed" (or "2 passed") with a non-trivial time, not an empty log (rule 28).

## 3. Desktop e2e twin

`frontend/tests/e2e-electron/lira-305-syria-corridor-netting.spec.ts` — typecheck and lint only on this Mac:

```bash
cd frontend && npx tsc -p tsconfig.playwright.json --noEmit && npx eslint tests/e2e-electron/lira-305-syria-corridor-netting.spec.ts
```

First real run is CI (unverified until then).

## 4. Gates

```bash
yarn typecheck && yarn lint && yarn build
yarn check:tenant-scoping && yarn check:bind-arity && yarn check:schema-equivalence
yarn check:transport-parity
(cd packages/core && npx jest)    # full core
yarn workspace @liratek/backend test
yarn workspace @liratek/electron-app test   # electron handlers
yarn workspace @liratek/frontend test
# NOT `yarn test` at the root: it runs `rebuild:node` first, which would swap the better-sqlite3 ABI under a running e2e
node scripts/build-release-notes.cjs --check
```

Measure elapsed time and suite counts for each (a clean `tsc` prints nothing; a fast run may be a no-op).

## 5. Manual check (optional, web test shop)

Services → Via Partner (7welet souria) → SEND cost 100 / price 103 cash. Then Via Partner → Pay out, Arrived 100 /
Paid Out 97. Partners → 7welet souria shows 0. Profits → By Module → Custom Services shows +$6 for the day.
