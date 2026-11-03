# Quickstart — prove LIRA-370 works

Run only the affected tests, with explicit paths (owner rule: never full suites).

## 1. Core (Node ABI)

```bash
yarn workspace @liratek/core jest src/utils/__tests__/omtSmsSettlement.test.ts \
  src/utils/__tests__/accountSettleAllocation.lira370.test.ts \
  src/repositories/__tests__/SupplierRepository.lira370Sms.test.ts \
  src/repositories/__tests__/SupplierRepository.lira370Variants.test.ts \
  src/repositories/__tests__/TransactionRepository.lira370Void.test.ts
```

Expected:
- **Variant table (rule 28d):** direction {PAY, COLLECT} × ticked {all, one, several} × money {full SMS, short, OMT asks more} × owed shares {none, cleared later, shares-only} × void order {none, newest, creating-first}. Every row checks the drawer, profit, balance and live owed shares, and that create + void nets to 0 on every ledger, per currency (rule 20).
- **Receive-only collect:** commission accepted (guard for R2, proven failing first).
- **Panel figure equals sheet figure (SC-003)** for the same rows and ticked types.
- **No double count:** a part-paid transfer closed by a second settlement books its commission once.

## 2. Frontend (jsdom)

```bash
yarn workspace @liratek/frontend jest src/features/suppliers/components/__tests__/AccountSettleSheet.lira370.test.tsx \
  src/features/suppliers/components/__tests__/OmtStatementCheckPanel.lira370.test.tsx
```

Expected:
- The SMS box prefills with the expected figure and derives the commission line.
- No change box appears in SMS mode.
- The warning appears when OMT asks for more.
- The sheet opens on "All types".
- The panel has no inputs.

## 3. Web e2e (test tenant shim)

```bash
cd frontend && npx playwright test --config playwright.web.config.ts tests/e2e-web/lira-web-091-omt-sms-settle.spec.ts --reporter=list
```

The scenarios match the test-shop runs:
- Pay $762.30 on $776.50 → profit $14.20, balance $0.
- WU receive, collect −249.70 → drawer +249.70, profit $26.20.
- Western Union only → $4.20 owed shares, then cleared by a later SMS.
- Undo order.

Check that the reported test count is above 0 (rule 28a).

## 4. Gates

`yarn typecheck`, `yarn lint`, `yarn check:bind-arity`, tenant-scoping check, `node scripts/build-release-notes.cjs --check`. Desktop e2e is not run on this Mac. Say so.

## 5. Release note (rule 30)

Add one line under `## 💸 OMT / Whish & suppliers` in `docs/release-notes/UNRELEASED.md`, and a What's new card with a real landscape screenshot of the new sheet (`frontend/public/whats-new/<next>/omt-sms-settle.png`) taken from a web e2e spec.
