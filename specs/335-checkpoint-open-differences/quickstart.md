# Quickstart: validate checkpoint open differences (LIRA-335)

Owner decision for this ticket: run **affected jest only**, with explicit paths. E2E specs are written and typechecked, not run. Never run a full suite.

## Core (packages/core)

```bash
cd packages/core
npx jest src/repositories/__tests__/checkpointResolution.test.ts \
         src/repositories/__tests__/CheckpointDifferenceRepository.test.ts \
         src/repositories/__tests__/checkpointResolution.flows.test.ts \
         src/repositories/__tests__/checkpointResolution.reversal.test.ts \
         src/utils/__tests__/checkpointDifference.test.ts \
         src/__tests__/checkpointResolution.wiring.guard.test.ts
```
Expected: the worked example (spec Background) holds — after checkpoint, back-timed sale and second checkpoint, drawer = counted cash at every step, second checkpoint delta 0; every flow in FR-006 nets to 0 per drawer and currency after create + void; refund keeps the resolution; close/reopen books and voids exactly one Drawer shortage expense.

Plus the existing suites the change touches (explicit paths): `ClosingRepository.sinceLastCount.test.ts`, `TransactionRepository.paymentLegs.test.ts`, the guard tests for reset tables and browser entry, `postingRules.guard.test.ts`.

## Electron handlers / backend

```bash
cd electron-app && npx jest handlers/__tests__/closingDifferenceHandlers.test.ts offline/__tests__/channelPolicy.complete.test.ts
cd backend && npx jest src/api/__tests__/closing.differences.test.ts
```

## Frontend

```bash
cd frontend
npx jest src/features/closing/pages/CheckpointTimeline/__tests__/CheckpointTimeline.differences.test.tsx \
         src/features/closing/components/__tests__/CloseDifferenceDialog.test.tsx \
         src/shared/components/__tests__/TransactionTimeOverride.hint.test.tsx \
         src/features/expenses/pages/Expenses/components/__tests__/HistoryModal.drawerShortage.test.tsx
```

## Static gates

```bash
yarn typecheck && yarn lint && yarn check:i18n && yarn check:tenant-scoping && yarn check:bind-arity && yarn check:schema-equivalence
node scripts/build-release-notes.cjs --check
```
Judge `tsc` by elapsed time, not output size (CLAUDE.md rule 28a).

## Manual check (web app, test tenant)

1. Checkpoint General with $50 more than expected → timeline row "Over $50.00", no pill (Open), filter count 1.
2. POS sale $50 cash, Set custom time before the checkpoint → hint line names the checkpoint; after save General's expected unchanged; row shows Resolved with the sale.
3. New checkpoint with the same cash → Balanced.
4. Void the sale → row back to Open; General unchanged.
5. Checkpoint with $3 less → Close difference… → Expenses shows "Drawer shortage" $3.00 on that day; Reopen removes it.
