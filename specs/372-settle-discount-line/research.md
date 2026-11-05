# Research: One Discount line on every settle screen (LIRA-372)

All line numbers were read on 2026-11-05 from `main` at `2aeb43de`. They drift, so search by the quoted name. `414ce0da` (LIRA-373) has since changed `TransactionRepository.ts`, and LIRA-371 will change several of the same files before this ticket is built (R15); T001 re-reads every reference.

## What exists today (verified)

| # | Screen | UI today | Wire key | Server cap today | Booking | Both directions on server? |
|---|---|---|---|---|---|---|
| 1 | Debts Repay (picker + calendar, one modal) | page `DiscountLine` "Forgive (no cash)", USD + LBP fields, reason (`Debts/index.tsx` ~3099–3179); Waive via `onWaiveRemaining` (~3183); cap = due (~910–924) | `addRepaymentSchema.discount` (`validators/debt.ts:52`, `counterpartyDiscountInputSchema`, no cap) | none beyond "≤ due" in the repository | `DebtRepository._postDebtDiscount` (~1332), `'Debt Discount'` row + `COUNTERPARTY_DISCOUNT` | Receive only. A repay is always money in. |
| 2 | Suppliers Pay / Receive | MPI built-in discount, `showDiscount: direction === "PAY"`, `maxDiscount: cashflowOwed`; reason is a separate input under the box (`Suppliers/index.tsx` ~3146–3191) | `supplierCashflowSchema.discount` (`supplier.ts:208`), refine "PAY only" (~212) | none. Repository refuses RECEIVE (`SupplierRepository.ts` ~8795) | `postSupplierBundledDiscount(direction:"received", applyPurchaseCoverage:true)` (~9038) | PAY only |
| 3 | Suppliers batch Settle (`CounterpartySettleModal` ~4207–4253) | no line, `waiveDisabled` | `supplierSettleSchema.discount` = `settlementDiscountSchema` (`supplier.ts:99`, cap `SHORTFALL_MAX`) | `assertSettlementWaive` (`SupplierRepository.ts:1295`): cap, and must be < owed. Refused on bills-only and on `OTHER_PAYMENT` (~4402–4413) | bundled DISCOUNT "received", self-stamped (~4943) | Pay only. The only "receive" shapes (bills-only commission) refuse a discount. |
| 4 | Suppliers Settle Account (incl. OMT SMS) (`AccountSettleSheet.tsx` ~1565–1688) | no line, `waiveDisabled` on both boxes | `per_currency.<C>.waive` (`supplier.ts:229`) | `_planAmountFirstSection` (~7961–8044): cap via `assertSettlementWaive`, nothing-owed refusal; ~8186: refused with an extra in the same currency, refused if it stops inside a partial row; ~7329: refused when the waived sections point opposite ways | one DISCOUNT on the waived member, `received` (PAY) / `forgiven` (COLLECT) (~7749) | Yes, both |
| 5 | Partners settle by day (`PartnerSettleSheet.tsx` ~842–1002) | page `DiscountLine` "Forgive", only when `payer === "PARTNER"`; Waive only when the partner pays | `sections[].forgive.amount` (`partner.ts:258`), no cap | "≤ what the picked days owe" (`PartnerSettlementRepository.ts` ~1000) | DISCOUNT `partner_ledger` row, CREDIT/DEBIT from the first waived unit (~1189–1216), `recordDiscount` | Yes. A DEBIT forgive books "received". |
| 6 | Partners settle by amount (`Partners/index.tsx` ~495–786) | page `DiscountLine` "Forgive", both directions (`balanceInCurrency > 0`); Waive only when money comes in (`waiveDisabled: shopPays`) | `partnerSettleSchema.discount` (`partner.ts:134`), no cap | `PartnerService.settle`: amount + discount ≤ balance | same-direction DISCOUNT row + `recordDiscount` | Yes |

There are 7 screens: Debts picker + Debts calendar count as two, but they are one modal with one discount state.

**The shared cap already exists**: `SHORTFALL_MAX = { USD: 5, LBP: 450_000 }` and `isWithinShortfallMax()` in `packages/core/src/validators/exchange.ts:28/53`. It is browser-safe, and LIRA-310 Waive, LIRA-365 Discount and kept change all use it.

**The write-off schemas are separate** (`debtWriteOffSchema`, `partnerWriteOffSchema`). Neither reuses `counterpartyDiscountInputSchema`, so capping the settle discount cannot touch Write off (FR-009).

## R1 — One capped schema, defined once

**Decision**: Move `settlementDiscountSchema` from `validators/supplier.ts:99` into `validators/counterparty.ts` as an exported `settleDiscountInputSchema`. Reword its messages from "waived amount" to "discount", e.g. "The discount is more than $5." Add a single-amount variant, `settleForgiveAmountSchema`, for the partner per-day `forgive.amount`, refined with the same `isWithinShortfallMax`. Use them for:

- `addRepaymentSchema.discount`
- `supplierCashflowSchema.discount`
- `supplierSettleSchema.discount`
- `supplierSettleAccountSchema.discount` (legacy)
- `partnerSettleSchema.discount`
- `partnerSettleDaysSectionSchema.forgive.amount`
- `settleAccountCurrencySectionSchema.waive`, refined per currency in the parent `superRefine`

`counterpartyDiscountInputSchema` stays uncapped for any other reader.

**Rationale**: rule 14 (one definition of the cap). Rule 29: `counterparty.ts` imports only zod and `exchange.ts`, both leaves.

**Alternatives**: capping `counterpartyDiscountInputSchema` itself was rejected. It is the generic shape, and a future write-off reuse would silently inherit the cap.

## R2 — One screen helper

**Decision**: Add a new pure leaf, `packages/core/src/utils/settleDiscount.ts`, exported from `browser.ts` and `index.ts`. It holds:

- `settleDiscountRoom(currency, owed)`, which returns `min(SHORTFALL_MAX[c], max(0, owed))`. `owed` is what is owed in that currency **before** the payment (net of any credit used). It is not "owed after the payment": with the payment line following the discount (R4), a room measured after the payment would shrink as the discount grows and lock itself at 0.
- `clampSettleDiscount(currency, typed, owed)`, which returns `{ applied, capped: boolean, room }`.
- `settleDiscountOverpaid(currency, owed, paid, discount)`, which returns true when `paid + discount` exceeds `owed`, within half a cent or half a lira. Screens use it to block Confirm when the cashier typed the payment by hand and then added a discount (FR-010).

Every screen clamps through it and shows `DiscountLine`'s `capNote`, "Capped to max ($5.00)". The server re-checks with the R1 schema plus each repository's existing "≤ owed" check.

**Rationale**: one derivation per value (rule 14, screens too). Partners' `capSettlementDiscount` / `discountRoomAfterSettlement` become thin wrappers over the core helper. `applyDebtDiscount` keeps its per-currency clamp and adds the cap. Debts keeps its own `repayForgiveBlocked` check, which converts across USD and LBP through `computeRepaymentReduction`. A mixed-currency debt cannot use the single-currency predicate, and both checks answer the same question.

## R3 — The same line, label and place (FR-001)

**Decision**:

- New shared component `SettleDiscountLine` in `packages/ui/src/components/ui/SettleDiscountLine.tsx`, exported from the ui index. It wraps `DiscountLine` with:
  - label `t("discountLine.settleLabel")` = "Discount"
  - one field per currency it is given (USD `$` prefix, LBP suffix)
  - an optional reason
  - cap note from R2
  - test ids `settle-discount-line`, `settle-discount-usd`, `settle-discount-lbp`, `settle-discount-reason`
- Every settle screen passes it through MPI's `discountRow` slot, with `showDiscount={false}` and `totalBeforeDiscount` = gross.
- Supplier Pay / Receive moves off the MPI built-in discount onto `discountRow` so it matches. Its stray reason input under the box is removed and goes into the line.
- "Forgive (no cash)" and "Forgive" become "Discount" on the settle screens (en/ar/fr). The admin Write off windows keep their wording.

**Rationale**: the spec wants the same component, label and place. Today three screens use a page `DiscountLine`, one uses the MPI built-in, and two have none.

## R4 — Does typing a discount move the payment line?

**Decision (owner, 2026-11-05, FR-010)**: yes, on all 7 screens. `discountMovesPayment` is true everywhere (the MPI default). This reverses LIRA-318 on Debts and Partners. Owed $412.50 with discount $2.50 gives a payment of $410.00.

**What has to change, per screen**:

- **Partners by amount** (`Partners/index.tsx` ~736) and **by day** (`PartnerSettleSheet.tsx` ~963): drop `discountMovesPayment: false`. Both already pass `totals` net of the forgive and no `fillTotals`, so the single-line auto-sync (MPI ~1305, keyed on `totalsKey` / `clampedDiscount`) refills from the net total. The `afterDiscountLabel` "After Forgive" becomes the default "After Discount".
- **Debts** (`Debts/index.tsx` ~3109): dropping the flag is **not enough**. `prefillAmountFor` uses `fillTotals ?? …` first, and in picker mode `repayFillTotals` (~888) is the gross ticked sum (`repayTickedUsd − repayCreditUseUsd`). It must also subtract the applied discount (`repayAppliedDiscountUsd/Lbp`), the way `repayWaiveTotals` already does, so the line refills through `fillTotalsKey`. With no picker, `fillTotals` is undefined and the net `totals` already apply.
- **Supplier Pay / Receive**: already true through the MPI built-in discount. When it moves to `discountRow` (R3), it must pass `totals` net of the discount and `totalBeforeDiscount = cashflowOwed`. Otherwise the auto-fill regresses.
- **Supplier batch Settle** (net-pay MPI, `Suppliers/index.tsx` ~4220): single currency, `totals` only. Pass `totals` = net pay − discount and `totalBeforeDiscount` = net pay, and the single-line auto-sync follows.
- **Supplier Settle Account** (`AccountSettleSheet.tsx`):
  - The main box uses `perCurrencyTotals` + `initialLines` from `mainTotals` (~699, SMS amount when SMS mode is on). In that mode `prefillAmountFor` reads `fillTotals ?? baseTotals` and never looks at the flag. `mainTotals` must therefore be net of each currency's discount (SMS − discount in SMS mode: 772.30 − 2.30 = 770.00).
  - A side box passes `totals` + `fillTotals` (~1628/1637), and both must be net.
  - A one-currency box then follows through the single-line auto-sync.
  - **A two-currency main box opens in split mode** (one seeded Cash line per currency), and MPI's auto-sync only runs in single mode. Its `fillKey` re-fill adjusts only the last line. Neither path moves the USD line when a USD discount is typed. This needs a small MPI extension (T035): in `perCurrencyTotals` mode, when `fillTotals` changes, each currency's last line is re-filled if it still holds that currency's previous fill amount. A line the cashier typed is kept.
- **MPI doc comment** (`MultiPaymentInput.tsx` ~318–323): it names Debts and Partners as the reason for `false`. After this change no caller passes `false`. Keep the prop, since removing it is a separate refactor, but reword the comment.

**A payment typed by hand** (SUPERSEDED by the owner on 2026-11-05, option B: the discount always wins — screens put the discount in MPI `fillKey`, so a typed payment is re-filled too; the text below is the planning-time reading): MPI stops auto-syncing a single line once the cashier edits its amount (`singleAmountTouchedRef`). A typed payment is therefore kept when a discount is typed afterwards. That is today's supplier Pay-tab behaviour, and spec FR-010 records it. Confirm is blocked with a hint while payment + discount > owed: through `settleDiscountOverpaid` on the single-currency screens, and through the existing `repayForgiveBlocked` on Debts (its hint wording becomes "Discount").

**Tests that pinned the old behaviour, to rewrite and not delete (rule 24)**:

- `Debts.lira318Forgive.test.tsx` (header, "never moves")
- `Partners.lira318ForgiveLine.test.tsx` (the "payment stays 80/90", "payment does not move" and "by day … payment st[ays]" cases)
- the forgive cases in `PartnerSettleSheet.test.tsx`

Each becomes "an untouched line drops by the discount", plus "a typed line is kept and Confirm is blocked".

## R5 — Supplier Receive discount (new, the only new booking)

**Decision**:

- Allow `discount` on `RECEIVE`. Drop the schema refine at `supplier.ts` ~212 and the repository guard at ~8795.
- Book it with `postSupplierBundledDiscount(direction: "forgiven", applyPurchaseCoverage: false)`, linked to the payment's ledger row. Ledger +x (the supplier owes less), profit −x, summary "Supplier discount given".
- Server room check: `discount ≤ |balance in the direction| − cash` per currency, read inside the db transaction from `getSupplierBalance`. Apply it to PAY too, which today has no server room check.

**Reversal (rule 20)**: `TransactionRepository._reverseSupplierBundledDiscount` (~7823) gives back FIFO purchase coverage for every `SUPPLIER_PAYMENT`. A forgiven discount applied none, so the give-back must be gated:

- skip it when the discount ledger row's `amount_usd + amount_lbp > 0` (forgiven), or
- skip it when the original's `metadata_json.direction === "RECEIVE"`.

Use the ledger sign, because it is the row's own fact. Guard test, failing first: Receive $495 + discount $5, then void. Supplier balance, drawer, profit and `supplier_purchases.paid_usd` each net to 0.

## R6 — Settle Account (OMT sheet included)

**Decision**: the server already books `per_currency.<C>.waive` both ways. Work needed:

- **Sheet**: one `SettleDiscountLine` per payment box. The main box has a field per `mainCurrencies` entry. A side box has a field for its own currency. The payload builder adds `waive` per currency in `handleSubmit` (~893). The rule-22 builder is still `buildSettlePayload`, with no second literal.
- **Preview = server**: `accountSettleMath.allocateSection` passes `waive: 0` today (~217). Add a `waive` input so the sheet's preview, "still owes" and Confirm gating use the same allocator figure the server does (rule 14).
- **FR-006 (OMT)**: `sms.commission` is derived from `owed − SMS` before the waive is read (~8064–8080). The waive only enters `allocateAccountSettlement` as a budget. The commission is therefore unchanged by construction. Pin it with a test: owed 776.50, SMS 772.30, waive 2.30, pay 770 → commission 4.20, profit 4.20 + 2.30.
- **Summary (US3 AS2)**: the sheet's summary shows "SMS amount", "Commission" and "Discount" as separate lines.
- **Reason**: amount-first has no reason today. Add a top-level `discount_reason?: string (≤500)`, allowed only with `per_currency` (added to the "only when settling by amount" key list). Pass it to `postSupplierBundledDiscount`. Rule-23 three-way diff: schema ↔ preload `SettleAccountRequest` ↔ repository.
- **Details (FR-008)**: the amount-first `ACCOUNT_SETTLE` details (~7493) do not pass `discount`. Pass `{amount_usd: waive.usd, amount_lbp: waive.lbp, reason}`. `buildSupplierEntryDetails` records one currency only. With two currencies the separate `COUNTERPARTY_DISCOUNT` row (which carries both, plus the reason) is the record. The versioned details schema is not widened.
- **Existing refusals stay**:
  - discount + extra in the same currency
  - a discount that stops inside a partial row ("must settle the transfers it covers in full")
  - discounts in two sections with opposite directions (owner 2026-11-05: kept, FR-011)

  The sheet disables Confirm with the server's own sentence instead of letting the round trip fail.

## R7 — Batch Settle

**Decision**: show the line only on the net-pay branch (`payer: "shop"`), with `discount: { amount_usd, amount_lbp, reason }` sent from the page's own state.

The bills-only branch (commission arrives IN through a top-up or another payment) has no balance to discount. The server refuses it (~4402–4413), so no line shows there.

This is the only screen with one direction. The owner confirmed it on 2026-11-05 (FR-002 exception).

## R8 — Debts

**Decision**:

- Cap the existing fields at R2 (USD ≤ $5, LBP ≤ 450,000, and ≤ due).
- Relabel to "Discount".
- Remove `onWaiveRemaining` and set `waiveDisabled`. `waiveTotals` stays for the "Remaining on ticked" line, but without a Waive inside it.
- The payment follows the discount (R4). `repayFillTotals` becomes net of the applied discount, and `discountMovesPayment: false` goes.
- `repayForgiveBlocked` / `repayForgiveHint` stay. They guard a payment typed by hand. Their comment and wording move from "Forgive" to "Discount".

The calendar picker (`DebtDayCalendar.tsx`) lives inside the same repay modal and submits through the same `addRepayment` payload, so there is one change. Server: `addRepaymentSchema.discount` → R1 schema.

**Offline**: `debt:add-repayment` is an offline channel (`offline/channelPolicy.ts:91`). A repayment queued offline on an old build with a forgive over $5 is refused on replay. That is acceptable: replays already surface refusals, and the release note says the limit is new.

## R9 — Partners

- **By day**: show the line for both payers. Drop the `partnerPays &&` gate (~316–335, ~845) and compute the room the same way for `SHOP` (shop owes → the forgive covers negative units, server DEBIT → "received", profit +). Remove Waive (`waiveDisabled` always, drop `onWaiveRemaining`). Cap with R2. Server: `forgive.amount` → R1 single-amount schema.
- **By amount**: already both directions. Add the cap, the label and Waive removal. Server: `partnerSettleSchema.discount` → R1.
- **Both**: the payment follows the discount (R4). The room is `settleDiscountRoom(c, due)`, measured before the payment, and replaces today's "room left after the payment". Confirm is blocked via `settleDiscountOverpaid` when a hand-typed payment plus the discount exceeds the due.
- **Ledger sign check (by day)**: the DISCOUNT direction comes from the first waived unit's sign (~1196). With SHOP payer, every unit in scope is negative, so DEBIT. A guard test pins it: shop owes $500, pays $497, forgive $3 → ledger closes at 0, profit +3, void nets 0.

## R10 — No discount-only close is added

The spec's edge case ("closed by discount alone only where a no-money settle already exists") needs no change:

- Debts refuses a zero repayment (`DebtService.ts:275`).
- Supplier settles refuse a waive ≥ owed (`assertSettlementWaive`, "pay at least part of it").
- Partners by-day already allows a no-money settle and hides the line there (`noMoney`).

Nothing new is built.

## R11 — No migration

`supplier_ledger.entry_type` already allows `'DISCOUNT'` (v131), with no sign CHECK. `partner_ledger` has no CHECK. `debt_ledger` has no CHECK. `COUNTERPARTY_DISCOUNT` exists. **No migration.**

## R12 — Wire keys are not renamed

`discount`, `forgive` and `waive` keep their names (rules 22/23). Only the labels change.

## §13 walk (FEATURE_GUIDE)

| Item | Applies? | Note |
|---|---|---|
| 1 Schema/plumbing | Partly | New keys: `discount_reason` (settle account) and RECEIVE discount (cashflow). Adapter types already derive from the core schemas (rule 21). Preload `SettleAccountRequest` gains `discount_reason`. |
| 2 Transactions row | Reused | `COUNTERPARTY_DISCOUNT`, amount 0, signed profit, via `buildCounterpartyDiscountPosting`. |
| 3 IN/OUT badge | No change | `COUNTERPARTY_DISCOUNT` is already classified. |
| 4 Payment legs | No change | A discount is never a leg. Flow branches stay IN-only. |
| 5 Drawers | None | A discount moves no drawer. |
| 6 Client propagation | Unchanged | Debts already carries `clientId`. |
| 8 Ledger sign | Yes | Supplier forgiven = +x. Partner DEBIT/CREDIT from the units. Debt Discount reduces debt. |
| 9 Void path | Yes | R5 gate. Existing owners: `_reverseSupplierBundledDiscount`, the partner settlement sweep (`_negateCounterpartyDiscountProfit`, TransactionRepository ~10335), and the debt repayment reversal. |
| 10 Profits | Yes | received = +, given = −. |
| 12 Audit viewer | Check | "Supplier discount given" summary already exists. |
| 13 E2E | Yes | `lira-web-093-settle-discount.spec.ts`. |
| 15 Legs vs amount | Yes | Legs reconcile against `owed − discount` on every path (already true for the settles; cashflow books the legs and the discount separately). |

## R13 — Roles (staff vs admin)

These were read on 2026-11-05 from `electron-app/handlers/*.ts` and `backend/src/api/*.ts`:

| Channels | Role |
|---|---|
| `suppliers:settle-transactions`, `suppliers:settle-account`, `suppliers:record-cashflow` (IPC) and their REST routes | `["admin"]` |
| `debt:add-repayment`, `partners:settle`, `partners:settle-days` (IPC), and `POST /api/debts/repayments` / the partners `writeGate` (REST) | `["admin","staff"]` |

The owner's "staff up to $5 / 450,000 LBP, bigger through an admin's Write off" is therefore met by the cap alone: staff reach only the Debts and Partners screens, and the cap applies to every role. **No role change.** T007 checks the write-off schemas are uncapped, and T034 re-greps the roles so a drift in LIRA-371 is caught.

## R14 — LIRA-373 (committed `414ce0da`): refunds of settlements are exact

`refundTransaction` now refuses a `refundLegs` override on `SUPPLIER_SETTLEMENT` / `PARTNER_SETTLEMENT` (`isSettlementTransactionType`). The US4 variant table must refund those rows with **no override**. Debt repayment (`DEBT_REPAYMENT`) and supplier cashflow (`SUPPLIER_PAYMENT`) stay editable. Their rows refund with the default (exact) legs, so that "nets to 0" is measured the same way on every row.

## R15 — Merge order with LIRA-371 (settle drawer choice)

LIRA-371 is planned in parallel. It touches these same files:

- `validators/debt.ts`, `validators/supplier.ts`
- `SupplierRepository.ts`, `DebtRepository.ts`
- `electron-app/preload.ts`, `frontend/src/types/electron.d.ts`
- `Debts/index.tsx`
- `AccountSettleSheet.tsx`: `buildSettlePayload` gains `cash_drawer`
- `Suppliers/index.tsx`: `handleBatchSettle` / `handleCashflow`
- `UNRELEASED.md`

**LIRA-371 lands first.** This ticket then re-reads every line reference (T000/T001) and adds its keys (`waive`, `discount_reason`, `discount` on RECEIVE) inside the payload builders as 371 left them (rule 22). There is still one builder per operation.

LIRA-371 takes e2e `lira-web-092`. This ticket uses `093`.
