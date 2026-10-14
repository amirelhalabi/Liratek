# Quickstart: validating LIRA-321

Ask the owner before running any test suite (standing rule). Desktop e2e is not run on the owner's Mac; web e2e is.

## Prerequisites
- Node ABI for core jest and web e2e: `yarn rebuild:node`.
- After core edits: `cd packages/core && npm run build` then `cp -r packages/core/dist/. node_modules/@liratek/core/dist/`.

## 1. Payment box (Phase 1)
`cd frontend && node ../node_modules/jest/bin/jest.js --config jest.config.ts src/shared/components/__tests__/MultiPaymentInput.test.tsx -t "counterFlow"`
Expect: single mode has no "+ Add line"/×; typing 87,600,000 of 89,500,000 switches to split with a 1,900,000 Customer Account line; overpaid reported; locked currency select disabled; on `payer="payout"` the IN section renders before "Shop pays"; on a POS-style sheet the header still reads "Payment". Confirm the test count printed matches the file (rule 28).

## 2. Booking helper and Exchange (Phase 1–2)
Core jest: `bookCustomerLegs`, `ExchangeRepository.customerPayments`, `TransactionRepository` exchange refund/void, `moduleDebtTypes.guard`. Expect the [data-model](./data-model.md#ledger-nets-create--refund-per-currency) nets: create deltas exact, create + refund = 0 per ledger per currency; old payload without `customerPayments` books the single lump exactly as before.

Web e2e (new `lira-web-0xx-exchange-customer-pays`): exchange $1,000 at 89,500 for a linked client, pay 87,600,000 → LBP drawer delta +87,600,000, USD −1,000, client debt +1,900,000 LBP on the Debts page; refund → all deltas back to 0. Match rows by identity, assert deltas (rule 15).

## 3. App receive and Binance (Phase 3)
Core jest: `FinancialServiceRepository.appWalletTransfer` / `binance` / `receiveFeeLegs` extended with the spec Story 3 and 4 cases, D1 OMT App fee refusal unchanged, `isInternalLegJs` still true for provider-wallet lines. Web e2e (new): Whish App receive $100 + $5 fee, Whish $90 + Cash $5 + Account $10 → Whish_App +90, USD cash −95, debt $10; refund → 0.

## 4. Gates before "done"
`yarn typecheck`, `yarn lint`, `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`, `node scripts/build-release-notes.cjs --check`, the suites above with counts confirmed.

## 5. Manual check on test.liratek.shop (after deploy)
Exchange LBP→USD $1,000 at 89,500: "Customer pays — LBP" (IN) on top, single line 89,500,000, LBP locked; type 87,600,000 → split, Customer Account 1,900,000; Confirm disabled until a client is picked.
