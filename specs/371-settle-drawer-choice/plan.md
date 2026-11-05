# Implementation Plan: Choose the cash drawer when settling OMT system items

**Branch**: `371-settle-drawer-choice` (work on `main`, ticket LIRA-371) | **Date**: 2026-11-05 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/371-settle-drawer-choice/spec.md`

## Summary

A two-option control, "OMT Cash Drawer | General" (Whish on a Whish shop), with OMT selected by default. It appears on Debts → Repay and on the main-system supplier's settle screens whenever that payment's cash would go to the system cash drawer today.

- One optional request key, `cashDrawer` / `cash_drawer: "SYSTEM" | "GENERAL"`.
- On **Suppliers** it rides in the resolver context that every supplier cash leg already uses (`resolveServiceCashDrawer`). When it is GENERAL, the resolver returns General.
- On **Debts** it skips the internal RESERVE move (General → system drawer) and changes nothing else.
- The server refuses GENERAL where the choice does not apply.
- Void needs no new code, because `_reversePayments` mirrors stored drawer names. Tests prove create + void nets to 0.
- No migration.

## Technical Context

**Language/Version**: TypeScript 5 (strict), Node 20 / Electron 31

**Primary Dependencies**: Zod 3 (core validators), React 19 + TanStack Query, better-sqlite3

**Storage**: SQLite. Existing `payments.drawer_name` column, no schema change

**Testing**: jest (core, backend, electron-app, frontend), Playwright web e2e (`frontend/tests/e2e-web`)

**Target Platform**: Electron desktop + web (Vercel frontend, Fly backend)

**Project Type**: Yarn monorepo (`packages/core`, `electron-app`, `backend`, `frontend`, `packages/ui`)

**Performance Goals**: N/A (one extra enum per payload)

**Constraints**: Default must be byte-identical to today (SC-001). Browser-reachable code must stay Node-free (rule 29).

**Scale/Scope**: 4 write paths (1 debt + 3 supplier), 4 surfaces (Debts Repay, Settle Account sheet, batch Settle confirm, Pay / Receive)

## Constitution Check

| Principle | How this plan complies | Status |
|---|---|---|
| I. One core, two transports | Schema keys in `packages/core/src/validators`. IPC handlers spread validated data, REST routes spread `req.body`, both into the same service. Proven by web e2e `lira-web-092` | PASS |
| I. One payload per operation (rule 22) | The key is added inside the existing single builders: Debts submit (`Debts/index.tsx:1327`), `buildSettlePayload` (`AccountSettleSheet.tsx:867`), batch settle and cashflow builders | PASS |
| I. Rule 27 (where-code-runs) | None: no clock/locale. `baseSystem` is a tenant setting, read the same on both transports | PASS |
| I. Rule 29 (browser leaf) | New `constants/cashDrawerChoice.ts` imports nothing. `utils/payments.ts` (imports a repository) is NOT made browser-reachable. Guard test re-run | PASS |
| II. Layer boundaries (rule 13) | Logic in `DebtRepository` / `SupplierRepository` (money posting) and the pure predicate. Services stay pass-through, with one forwarded key in `DebtService` | PASS |
| III. Contracts once (rules 14, 21, 23) | One enum constant. Adapter types already `z.input`-derived. Three-way key diff (schema / preload / forwarded) is task T008. The `DebtService` rebuild that drops unknown keys is called out | PASS |
| III. No `.default()` on drifting money fields (rule 22) | `.optional()` only | PASS |
| IV. Money integrity (§13 checklist, rules 16, 18, 20) | See §13 walk-through below. No new ledger row or side-effect type, so the reversal owner is the existing `_reversePayments`. Create + void = 0 tests | PASS |
| IV. Rule 26 (`is_auto`) | No new system-written rows | N/A |
| III. Envelope (REST 200 on failure) | Pre-existing deviation, not introduced here: `POST /api/debts/repayments` returns 400 on failure (`backend/src/api/debts.ts:195`). No route is added or changed. T012 asserts `success: false` in the body, not the status. Assumption (unverified): `requestJson` in `frontend/src/api/backendApi.ts` surfaces the body's `error` on a non-2xx, so the refusal text reaches the web user; in practice the UI never sends `GENERAL` where it does not apply | PASS (pre-existing debt noted) |
| V. Security | No new route. Same `requireRole` (debts admin+staff, suppliers admin). Actor from session/JWT. No SQL added | PASS |
| VI. Testing (rules 15, 17, 24, 28) | Failing-first tests written before behaviour, with the failure recorded (T003, T005, T010–T011, T016 (component + `isGeneralCash` stub-first), T017, T019, T024, T026). Frontend payload tests parse through the schema. e2e uses deltas + identity (`lira-web-092`, web only: no desktop e2e on this Mac) | PASS |
| VII. Code quality | No `any`. The `api` ref rule respected (no new effect deps) | PASS |
| Quality Gates (full suites) | Local gates run explicit affected test paths only (owner rule "affected tests only, never full suites (RAM)"). The full core / backend / electron-handler / frontend suites run in CI on push. Recorded exception, see Complexity Tracking | EXCEPTION (owner-approved) |
| Delivery (rule 30) | `UNRELEASED.md` line + Highlights card + `frontend/public/whats-new/1.35.0/settle-drawer-choice.png` from a web e2e screenshot | PASS |

One recorded exception (full suites run in CI, not locally), owner-approved. See Complexity Tracking.

### FEATURE_GUIDE §13 walk-through

- **1 plumbing:** no migration. Schema, handler and preload types are extended, and core build + sync.
- **2 transactions row:** unchanged type, rows and stamps.
- **3 IN/OUT:** unchanged.
- **4 legs:** no new loop. Debts skips only the internal RESERVE pair. Suppliers' existing single loops (IN and OUT) resolve through the same context.
- **5 drawers:** the point of the feature. The leg goes to General instead of `OMT_System`/`Whish_System`.
- **6 client:** unchanged.
- **7 CUSTOMER_ACCOUNT:** unaffected (non-drawer).
- **8 ledgers:** unchanged amounts (I2).
- **9 void:** stored-drawer mirror. Tests are I3.
- **10 profit:** unchanged (I2 asserts).
- **11 sessions:** not a session flow.
- **12 audit viewer:** no new label. Details already show leg drawers (FR-010).
- **13 e2e:** `lira-web-092`.
- **14 one obligation:** the drawer moves, the obligation does not.
- **15 reconciliation:** guards untouched, and the predicate is the same as the posting.
- **16 back-timed:** unchanged. `resolveBackTimedDrawerMovement` already runs on posted legs.

## Design (decisions, detail in research.md)

1. **One value set:** `CASH_DRAWER_CHOICES = ["SYSTEM","GENERAL"] as const` and `cashDrawerChoiceSchema` (R8). Keys: `cashDrawer` on `addRepaymentSchema` (camelCase schema), `cash_drawer` on `supplierSettleSchema`, `supplierSettleAccountBaseSchema` and `supplierCashflowSchema`. Never the deprecated `drawer_name`.
2. **Suppliers (R3):** `ServiceCashDrawerContext.cashDrawer?`. In `resolveServiceCashDrawer`, `GENERAL` returns `paymentMethodToDrawerName(method)`. The four `drawerCtx` builders (`SupplierRepository.ts:4580, 6588, 7134, 8853`) add `cashDrawer: data.cash_drawer`. The five leg sites (`:4911, :5630, :6912, :7683, :8999`) need no edit.
3. **Debts (R4):** `CreateRepaymentData.cash_drawer?`. After `allocateRepayment` (`DebtRepository.ts:1121`): if `GENERAL` and routing is empty, refuse. If `GENERAL`, skip the RESERVE loop (`:1153-1192`) and record `routed` with empty lists and `cash_drawer: "GENERAL"` (`:1238`).
4. **Applicability (R5):** Debts uses `repaymentRoutesToSystemDrawer(allocateRepayment(...))`, one helper in `utils/debtRepaymentAllocation.ts` (page + server). Suppliers use the pure `systemCashDrawerChoiceApplies` (page + server). `GENERAL` is refused when it does not apply. `SYSTEM` or absent is always accepted.
5. **UI:** one shared presentational component, `CashDrawerChoice`. It is a two-pill segmented control, styled like the existing Split pill (memory: mocks match real UI), with the label "Goes to" (IN) or "Comes from" (OUT), `data-testid="cash-drawer-choice"`, and options `cash-drawer-choice-system` / `cash-drawer-choice-general`. It resets to SYSTEM each open, because it is component state with no persistence.
   - **Location:** `frontend/src/shared/components/CashDrawerChoice.tsx` (the existing shared-component folder, exported from its `index.ts`), reusing the `SplitToggle` primitive's classes from `packages/ui/src/components/ui/SplitToggle.tsx` (reuse, not a restyled copy).
   - **Cash test:** `frontend/src/shared/utils/isGeneralCash.ts`, extracted from the Debts preview's `isCash` (`Debts/index.tsx:1053`) with its exact rule: GIFT_CARD and CUSTOMER_ACCOUNT are never cash; a method with a `drawer_name` is cash iff `affects_drawer === 1 && drawer_name === "General"`; a method without one is cash iff its code is `CASH`. Extracted in US1, reused by US2.
   - **Debts:** rendered inside the existing `repay-goes-to` box. The preview must compute the default routing to decide visibility, then display the split for the chosen option: General → all cash in "General" (fix the `:1093` early-return trap).
   - **Settle Account sheet:** new prop `systemCashDrawer?: "OMT_System" | "Whish_System" | null` from the page (`useShopBase().baseSystem` vs the account's provider). The control sits under the payment boxes, next to the LIRA-359 total line, and is shown when the predicate is true for the lines typed. Its value goes into `buildSettlePayload`.
   - **Batch Settle confirm and Pay / Receive (`Suppliers/index.tsx` `CounterpartySettleModal` children):** same component, same predicate. Reachable only on a Whish-main shop (R2); the owner confirmed no OMT batch Settle / Pay / Receive is added on an OMT-main shop.
6. **Labels/i18n:** the shared control gets its own keys in the shared `payment` namespace: `cashDrawerChoice.goesTo`, `.comesFrom`, `.omt` ("OMT Cash Drawer"), `.whish` ("Whish Cash Drawer"), `.general` ("General"), in `packages/ui/src/i18n/locales/{en,ar}/payment.json`. The Debts preview rows keep `repay.omtCashDrawer` / `repay.whishCashDrawer` / `repay.general`.

## Project Structure

### Documentation (this feature)

```text
specs/371-settle-drawer-choice/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md
├── contracts/cash-drawer-choice.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code (files touched)

```text
packages/core/src/
├── constants/cashDrawerChoice.ts            NEW pure leaf (values, predicate, refusal text)
├── browser.ts                               export the leaf
├── utils/payments.ts                        ServiceCashDrawerContext.cashDrawer + resolver branch
├── validators/debt.ts, validators/supplier.ts   optional keys
├── services/DebtService.ts                  forward cashDrawer
├── repositories/DebtRepository.ts           skip RESERVE, refuse N/A, record choice
└── repositories/SupplierRepository.ts       4 drawerCtx builders + refusal + data types
electron-app/handlers/debtHandlers.ts        RepaymentData type
electron-app/preload.ts, frontend/src/types/electron.d.ts   hand-written payload types
frontend/src/shared/components/CashDrawerChoice.tsx (+ index.ts export)   NEW shared control
frontend/src/shared/utils/isGeneralCash.ts                NEW shared method-list cash test (moved out of Debts preview :1053, same rule)
frontend/src/features/debts/pages/Debts/index.tsx          preview + payload
frontend/src/features/suppliers/components/AccountSettleSheet.tsx   prop + control + payload
frontend/src/features/suppliers/pages/Suppliers/index.tsx  pass prop; control in batch confirm (handleBatchSettle :2127) + Pay/Receive (handleCashflow :1560)
packages/ui/src/i18n/locales/{en,ar}/payment.json
frontend/tests/e2e-web/lira-web-092-settle-drawer-choice.spec.ts   NEW
docs/release-notes/UNRELEASED.md, frontend/public/whats-new/1.35.0/settle-drawer-choice.png
```

**Structure Decision**: Existing monorepo layout. No new package or route.

## Spec reconciliation (all resolved by the owner 2026-11-05, see spec Clarifications)

- **D1:** Batch Settle and Pay / Receive for OMT are hidden on an OMT-main shop (research R2). Owner: the choice on OMT Settle Account plus Debts Repay is enough; batch Settle and Pay / Receive show it only where they exist for the main system's supplier (Whish-main shop). Spec US2 scenario 4 and FR-002 now say so. Server support stays on all four paths (one resolver change), UI controls are gated by the predicate.
- **D2:** Change on Debts always leaves General, as today, whatever the choice (owner). Spec edge case updated. On Suppliers, change legs go through the resolver and follow the choice.
- **D3:** FR-007 now reads: `GENERAL` is refused where the choice does not apply; `SYSTEM` (or absent) there is accepted and behaves as today (R5). No money effect, keeps the single payload builder simple.
- **Q2 (informational, owner confirmed):** $200 OMT send, $100 into General then $100 default → the second $100 goes to the OMT Cash Drawer ("OMT drawer first", unchanged). Guarded by T030.

## Dependencies

- **LIRA-373** (settlement refunds are an exact reversal) is committed as `414ce0da`. `SETTLEMENT_TRANSACTION_TYPES` (`constants/transactionTypes.ts:889`) refuse a `refundLegs` override at `TransactionRepository.ts:6771-6773`; `_reversePayments` is at `:9749`. US3 builds on it (T029).
- **LIRA-372** (settle discount line) is planned in parallel and also edits `AccountSettleSheet.tsx`, `validators/supplier.ts`, `UNRELEASED.md` and `current_sprint.md`. Whichever lands second rebases onto the first (T001). It uses `lira-web-093` and `whats-new/1.35.0/settle-discount.png`, so `lira-web-092` and `settle-drawer-choice.png` stay free for this ticket.

## Complexity Tracking

| Exception | Why needed | Simpler alternative rejected because |
|---|---|---|
| Quality Gates: full core / backend / electron-handler / frontend suites are not run locally; explicit affected paths are (T034), and CI runs the full suites on push | Owner rule "affected tests only, never full jest suites (RAM)" | Running full suites locally exhausts RAM on the owner's machine; CI (`.github/workflows/ci.yml`) runs them on every push to `main` |
