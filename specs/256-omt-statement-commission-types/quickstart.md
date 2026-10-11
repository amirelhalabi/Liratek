# Quickstart: validate LIRA-256

How to prove the feature works. Commands run from the repo root on the Mac unless noted.
Never launch Electron or run desktop e2e on this Mac (owner rule; G5) — the desktop twin is CI-only.

## Prerequisites

- `yarn install` done; Node ABI for core jest and web e2e: `yarn rebuild:node`
  (probe: `node -e "const D=require('better-sqlite3'); new D(':memory:'); console.log('Node ABI')"`).
- After any `packages/core` edit: `cd packages/core && npm run build`, then
  `cp -r packages/core/dist/. node_modules/@liratek/core/dist/`.

## 1. Core: the statement check filters by type (US1)

```bash
yarn workspace @liratek/core test --runTestsByPath \
  src/repositories/__tests__/SupplierRepository.accountExpectedStatement.test.ts \
  src/utils/__tests__/omtCoveredTypes.test.ts
```

Expected: with an INTRA SEND (estimate e₁) and a WESTERN_UNION SEND (estimate e₂) unsettled,
`covered = ["INTRA"]` → `unsettled_commission_usd = e₁`; no choice → `e₁ + e₂` (today's value).
Confirm the suite count printed is non-zero and the new `it(...)` titles appear (rule 28a).

## 2. Core: settlement refuses uncovered rows; covered settle → void nets to 0 (US2)

```bash
yarn workspace @liratek/core test --runTestsByPath \
  src/repositories/__tests__/SupplierRepository.coveredTypesSettlement.test.ts \
  src/repositories/__tests__/TransactionRepository.supplierSettlementReversal.test.ts \
  src/repositories/__tests__/SupplierRepository.commissionAtSettlement.test.ts \
  src/repositories/__tests__/TransactionRepository.accountSettlementReversal.test.ts \
  src/repositories/__tests__/SupplierRepository.settlement.test.ts   # legacy regression only
```

Expected:
- `settleTransactions` and `settleAccount` with `covered = ["INTRA"]` and the WU row selected →
  throws naming the WU row; ledger/drawer/allocation row counts unchanged.
- Covered INTRA-only settle (commission 1.37) then void → supplier balance, PCD and Profits
  commission deltas are 0 per currency; the WU row's `settlement_id` stays NULL and its stored
  estimate is unchanged throughout.

## 3. Backend REST + IPC handler parity

```bash
yarn workspace @liratek/backend test --runTestsByPath src/api/__tests__/suppliers.api.test.ts
yarn workspace @liratek/electron-app test --runTestsByPath handlers/__tests__/supplierHandlers.coveredTypes.test.ts
```

Expected: `?covered=INTRA` filters; `?covered=BOGUS` → HTTP 200 `{ success: false }`; the
settle routes forward `covered_omt_service_types` to the service (spy sees the key).

## 4. Frontend

```bash
yarn workspace @liratek/frontend test --runTestsByPath \
  src/features/suppliers/components/__tests__/OmtStatementCheckPanel.test.tsx \
  src/features/suppliers/components/__tests__/AccountSettleSheet.coveredTypes.test.tsx \
  src/features/suppliers/pages/Suppliers/__tests__/Suppliers.settleCoveredTypes.test.tsx
```

## 5. Web e2e (REST, real backend)

```bash
yarn test:e2e:web -g "lira-web-053"
```

Expected: 1 passed. Spec: `frontend/tests/e2e-web/lira-web-053-omt-statement-commission-types.spec.ts`.

## 6. Gates (constitution)

```bash
yarn typecheck && yarn lint && yarn build
yarn check:tenant-scoping && yarn check:bind-arity && yarn check:schema-equivalence
node scripts/build-release-notes.cjs --check
```

Measure elapsed time; a sub-second green is a no-op, not a pass (rule 28a).

## 7. Manual (web app, optional)

Suppliers → OMT account → "Check against OMT's statement": tick only Intra → the commission line
and expected figure change; the per-type list shows each type's amount. Open "Settle account":
Intra rows ticked, Western Union rows greyed "waiting: not in this statement".
