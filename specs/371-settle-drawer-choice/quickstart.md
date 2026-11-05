# Quickstart: validating LIRA-371

Run affected tests only, by explicit path (owner rule: never full suites).

## Core (jest, Node ABI)

```bash
cd packages/core
npx jest src/repositories/__tests__/DebtRepository.lira371DrawerChoice.test.ts \
         src/repositories/__tests__/SupplierRepository.lira371DrawerChoice.test.ts \
         src/constants/__tests__/cashDrawerChoice.test.ts \
         src/validators/__tests__/lira371.cashDrawer.schema.test.ts \
         src/__tests__/browserEntryIsNodeFree.guard.test.ts
```

Expected: every test runs (check the count in the summary, rule 28a), and all pass.

## Transports

```bash
cd backend && node ../node_modules/jest/bin/jest.js --config jest.config.cjs src/api/__tests__/debts.lira371.api.test.ts src/api/__tests__/suppliers.lira371.api.test.ts
cd electron-app && node ../node_modules/jest/bin/jest.js --config jest.config.cjs handlers/__tests__/debtHandlers.lira371.test.ts handlers/__tests__/supplierHandlers.lira371.test.ts
```

## Frontend (jest)

```bash
cd frontend && npx jest src/features/debts/pages/Debts/__tests__/Debts.lira371DrawerChoice.test.tsx \
  src/features/suppliers/components/__tests__/AccountSettleSheet.lira371DrawerChoice.test.tsx \
  src/features/suppliers/pages/Suppliers/__tests__/Suppliers.lira371DrawerChoice.test.tsx \
  src/shared/components/__tests__/CashDrawerChoice.test.tsx \
  src/shared/utils/__tests__/isGeneralCash.test.ts
```

## Web e2e (proves web parity, rule 19d; never desktop e2e on this Mac)

```bash
cd frontend && npx playwright test --config playwright.web.config.ts tests/e2e-web/lira-web-092-settle-drawer-choice.spec.ts --reporter=list
```

## Manual scenarios (amounts from spec)

1. **Debts, General:** A client owes $200 for one OMT send. On Repay, pay $200 cash. "Goes to" shows OMT Cash Drawer | General, with OMT selected. Pick General and confirm. Expected: General +$200, OMT_System ±0, debt $0. Void it. Expected: General −$200, debt back to $200.
2. **Debts, mixed default:** $200 OMT send + $50 sale, pay $250 cash, leave OMT. Expected: OMT_System +$200, General +$50 (today). Repeat with General. Expected: General +$250, OMT_System ±0, same debt $0.
3. **Debts, no transfer:** sale + recharge only. Expected: no choice shown, cash to General.
4. **OMT Settle Account:** owes $772.30. Cash $772.30, pick General, confirm. Expected: General −$772.30, OMT_System ±0, OMT balance $0, days settled. Void. Expected: General back +$772.30.
5. **Two currencies:** +$7,492.70 collected, −60,000,000 LBP paid, with General. Expected: both lines in General.
6. **Katsh / product supplier / Partners:** no choice shown.
7. **Debts change:** $200 OMT send, customer hands $250 cash, $50 change, pick General. Expected: General +$200 net (+$250 in, −$50 change), OMT_System ±0. With the default: OMT_System +$200, General ±0 net (+$50 in, −$50 change), as today. Change always leaves General on Debts.
8. **OMT shop, OMT supplier:** no batch Settle or Pay / Receive tab (unchanged). **Whish-main shop:** batch Settle (bills commission, cash) and Pay / Receive (Whish inactive) show the choice.
9. **"OMT drawer first":** $200 OMT send, pay $100 with General, then $100 with the default. Expected: General +$100, OMT_System +$100, debt $0.

## Gates before done

`yarn typecheck`, `yarn lint`, `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`, `yarn build`, `node scripts/build-release-notes.cjs --check`, core build + sync (`cp -r packages/core/dist/. node_modules/@liratek/core/dist/`).
