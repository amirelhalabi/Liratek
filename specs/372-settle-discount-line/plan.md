# Implementation Plan: One Discount line on every settle screen

**Branch**: `372-settle-discount-line` (work on `main`, ticket LIRA-372) | **Date**: 2026-11-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/372-settle-discount-line/spec.md`

## Summary

Every settle screen gets the same "Discount" line in the same place, under "Total Amount" inside the payment box: Debts Repay (picker and calendar), Suppliers Pay/Receive, batch Settle (shop pays only), Settle Account incl. OMT, and Partners by day and by amount. The line is capped at $5 / 450,000 LBP per currency, on screen and on the server, for every role. Waive is removed from all of them. Typing a discount lowers an untouched payment line on all 7 screens; on Debts and Partners this reverses LIRA-318's "forgive never moves the payment" (owner, 2026-11-05; R4).

The server work is mostly done already. Supplier Settle Account and both Partner settles already book a discount in both directions, and supplier settles already use the shared `SHORTFALL_MAX` cap. The plan has four parts:

- **(a)** One capped schema and one pure screen helper, reused everywhere (R1/R2).
- **(b)** The one genuinely new booking: a supplier **Receive** discount, booked as "given". Its void must skip the FIFO-coverage give-back (R5).
- **(c)** UI on the two settle screens that have no line, and relabel/cap/Waive removal on the others, through one `SettleDiscountLine` component (R3). On Debts and Partners the payment now follows the discount: drop `discountMovesPayment: false`, and on Debts make `repayFillTotals` net of the discount (R4).
- **(d)** Settle Account plumbing: preview passes the waive to the allocator, a `discount_reason` key, and settlement details (R6).

**No migration.** The design is in [research.md](research.md) (R1–R12).

## Technical Context

**Language/Version**: TypeScript strict (Node 22 / Electron 31 / React 19)

**Primary Dependencies**: `@liratek/core` (validators, repositories, pure utils), `@liratek/ui` (DiscountLine, MultiPaymentInput), Express backend, Electron IPC, Zod, TanStack Query

**Storage**: SQLite. No migration (R11).

**Testing**: core jest (Node ABI), frontend jest (jsdom), Playwright web e2e `lira-web-093-settle-discount.spec.ts`

**Target Platform**: desktop app and multi-tenant web app (rule 19). Every channel touched already has IPC and REST mirrors.

**Project Type**: monorepo desktop + web

**Performance Goals**: n/a. The line recomputes per keystroke as today.

**Constraints**:
- The cap is compared in each currency's own unit, never converted (`isWithinShortfallMax`).
- Money is rounded to cents / whole LBP.
- New helpers stay browser-safe (rule 29).
- Wire keys are not renamed (R12).

**Scale/Scope**: 7 screens on 3 pages, 6 write channels (3 admin-only supplier channels, 3 admin + staff; R13). Admin Write off and Loto Waive are untouched.

## Constitution Check

| Principle | Status |
| --- | --- |
| I. One core, two transports | ✅ Each channel already has an IPC handler and a REST route over the same core service. One payload builder per screen; the Settle Account `waive` goes into the existing `buildSettlePayload` (rule 22). No clock/locale dependence. The new `utils/settleDiscount.ts` is a pure leaf, checked by the `browserEntryIsNodeFree` guard (rule 29). |
| II. Layer boundaries | ✅ The room check for cashflow lives in `SupplierRepository`. Services stay orchestration-only. |
| III. Contracts once | ✅ One capped schema in `validators/counterparty.ts`, reused by 7 schema keys (rule 14). Adapter types are already `z.input` (rule 21). Rule-23 three-way diff for `discount_reason` and for cashflow RECEIVE `discount`. |
| IV. Money integrity | ✅ §13 walked in research. A discount is never a leg (rule 16). Reversal owners are named per screen in data-model.md (rule 20), and the R5 gate fixes the one gap. The discount is operator-typed, so it is **not** `is_auto` (rule 26). |
| V. Data and security | ✅ No SQL shape change beyond `?`-bound tenant-scoped reads already present. Roles unchanged (R13): supplier settles stay admin-only, Debts and Partners stay admin + staff, and the cap binds every role. |
| VI. Testing | ✅ Guards written first and seen failing (rule 17). Variant table over 7 screens × directions (rule 28d). Tests that asserted Waive/Forgive are rewritten as "not present" guards, not deleted (rule 24). Web e2e. Explicit paths only. |
| VII. Code quality | ✅ No `any`. Logger only. `useApi` refs unchanged. |
| Delivery | ✅ UNRELEASED line + What's new card with a real screenshot `frontend/public/whats-new/1.35.0/settle-discount.png` (rule 30). |

No violations. Complexity Tracking is not needed.

**Post-design re-check**: still passes. The one cross-cutting risk (replay of old offline repayments > $5) is a documented, accepted refusal (R8). Re-checked after the owner decisions taken after planning (R4, R13–R15): still passes.

## Project Structure

### Documentation (this feature)

```text
specs/372-settle-discount-line/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/settle-discount.md
├── checklists/requirements.md
└── tasks.md
```

### Source Code

```text
packages/core/src/
├── validators/counterparty.ts          # settleDiscountInputSchema + settleForgiveAmountSchema (moved/new)
├── validators/supplier.ts              # import the shared schema; cashflow RECEIVE allowed; per_currency waive capped; discount_reason
├── validators/debt.ts                  # addRepaymentSchema.discount → shared schema
├── validators/partner.ts               # settle discount + per-day forgive → shared schemas
├── utils/settleDiscount.ts             # NEW pure leaf: settleDiscountRoom, clampSettleDiscount
├── repositories/SupplierRepository.ts  # cashflow RECEIVE → forgiven, room check both ways; amount-first reason + details
├── repositories/TransactionRepository.ts # _reverseSupplierBundledDiscount: no give-back for forgiven
└── browser.ts / index.ts               # exports
electron-app/preload.ts + frontend/src/types/electron.d.ts   # SettleAccountRequest.discount_reason
packages/ui/src/components/ui/SettleDiscountLine.tsx (+ index export, i18n en/ar/fr ui.json)
packages/ui/src/components/ui/MultiPaymentInput.tsx    # per-currency follow for split boxes (T035) + doc comment (discountMovesPayment no longer false anywhere)
frontend/src/features/
├── debts/pages/Debts/index.tsx                       # relabel, cap, no Waive, payment follows discount (repayFillTotals net)
├── debts/utils/repaymentReduction.ts                 # applyDebtDiscount uses the cap
├── suppliers/pages/Suppliers/index.tsx               # Pay/Receive via discountRow both ways; batch Settle line
├── suppliers/components/AccountSettleSheet.tsx       # line per box, waive in payload, summary
├── suppliers/utils/accountSettleMath.ts              # allocateSection takes waive
├── partners/components/PartnerSettleSheet.tsx        # line both payers, cap, no Waive, payment follows discount
├── partners/pages/Partners/index.tsx                 # cap, label, no Waive, payment follows discount
└── partners/utils/settlementDiscount.ts              # wraps the core helper
frontend/tests/e2e-web/lira-web-093-settle-discount.spec.ts
docs/release-notes/UNRELEASED.md, frontend/public/whats-new/1.35.0/settle-discount.png, current_sprint.md
```

**Structure Decision**: the existing monorepo layout. Logic and caps live in core. The transports are untouched apart from one new optional key. The UI uses the existing component slot.

## Phases (handed to /speckit-tasks)

1. **Foundation**: shared schema and helper with failing-first tests, the `SettleDiscountLine` component and i18n, and a baseline pin of today's discount bookings.
2. **US1 (P1, shop pays a supplier)**:
   - Settle Account line + preview waive + reason + details.
   - Batch Settle line.
   - Pay via `discountRow`.
3. **US2 (P1, shop receives)**:
   - Supplier Receive booking + reversal gate.
   - Debts cap/label/no Waive.
   - Partners by day for both payers.
   - Partners by amount cap/label/no Waive.
4. **US3 (P2, OMT)**: commission-unchanged pin, summary lines.
5. **US4 (P1, void)**: net-0 variant table across every booking.
6. **Polish**: rewrite the old Waive/Forgive tests as guards, web e2e, release note + screenshot, gates, sprint entry.

## Risks

- **Debts over-$5 forgives disappear from the cashier's hands.** Bigger amounts must go through admin Write off. Staff lose that path, because Write off is admin-only (FR-009). The owner already decided this; the release note says it.
- **Existing tests assert Waive on Debts/Partners** (`Debts.lira310Waive*.test.tsx`, `Partners.lira310Waive.test.tsx`, `lira-web-057-waive.spec.ts`, and partly `lira-web-071-shop-day.spec.ts`). They are rewritten as "Waive is not shown" guards. `lira-web-071`'s shop day must be re-read for any forgive over $5.
- **e2e number collision**: LIRA-371 takes `lira-web-092`. This plan uses **093**. Re-check `ls frontend/tests/e2e-web` before creating it.
- **LIRA-371 shares files** (R15): validators, `SupplierRepository`, `preload.ts`/`electron.d.ts`, `Debts/index.tsx`, `AccountSettleSheet.tsx` (`buildSettlePayload`), `Suppliers/index.tsx` and `UNRELEASED.md`. **Merge order: 371 first, then 372.** T000 is the gate.
- **Debts auto-fill trap**: `fillTotals` beats `discountMovesPayment` in MPI's prefill. Flipping the flag alone leaves the Debts picker line at the gross ticked sum. `repayFillTotals` must subtract the discount (R4, T021).
- **LIRA-318 tests contradict the new rule**: `Debts.lira318Forgive.test.tsx`, `Partners.lira318ForgiveLine.test.tsx` and `PartnerSettleSheet.test.tsx` pin "payment never moves". They are rewritten (rule 24), not deleted.
- **LIRA-373 refund rule**: settlement refunds take no leg override. The US4 variant table refunds settlement rows exactly (R14).
- **Settle Account refusals** (discount + extra, partial row, opposite directions) can surprise the cashier. The sheet must show the server's sentence before Confirm (R6).
