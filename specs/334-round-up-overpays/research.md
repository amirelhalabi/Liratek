# Research: Round-up overpays (LIRA-334)

These findings come from reading `main` at aa579377 on 2026-10-18, in two research passes. Abbreviations used below:

- "MPI" means `packages/ui/src/components/ui/MultiPaymentInput.tsx`.
- "KC" means `packages/core/src/repositories/keptChange.ts`.
- "MP" means `packages/core/src/repositories/moneyPosting.ts`.

## R1: How a payout overpay is refused today

- **Single-currency payouts with no kept claim.** These run `reconcileLegs` against what is owed (KC:522-532, MP:296-348). That call throws "The payment is more than the total." when the paid-minus-owed difference is more than 0.05 USD-equivalent.
- **System CASH receive and credit buy-back.** These reconcile inside `postPayoutLegs` (MP:925-935).
- **Exchange.** It reconciles itself (ExchangeRepository.ts:857-874).
- **Wallet receive (Binance, OMT App, Whish App).** It reconciles at FinancialServiceRepository.ts:4403-4409.
- **Top-up from client.** It reconciles at RechargeRepository.ts:3276-3285.
- **The screen side.** MPI only marks the overpay in red (`paidHasProblem` MPI:2145-2153). No payout page gates Confirm on it, so the server is the only real gate.

## R2: Wire field

- **Decision.** Add a new optional pair, `rounding_given_usd` / `rounding_given_lbp` (`z.number().nonnegative().optional()`, no `.default()`).
  - Put it on every payout write schema next to `kept_change_*`: `createFinancialServiceSchema`, the shared `keptChangeFields` in `validators/exchange.ts` (covers both exchange schemas), `createRechargeSchema`, `topUpFromClientSchema` and `holdMoneyCollectSchema`.
  - Only the owed currency's side may be non-zero.
- **Rationale.**
  - It mirrors kept change exactly, so it is offline-replay compatible (`offline/schemaShape.ts:201-217`).
  - Every adapter type is `z.input` of these schemas (rule 21), so pages pick up the field by type.
  - It is a separate key from `kept_change_*` because the sign is opposite: kept means the shop handed out less, rounding means it handed out more.
- **Alternatives considered.**
  - Let the server infer the rounding from the legs with no field. Rejected: a typo of $4 would be accepted silently, and the screen must show the amount the server books (spec FR-002 and FR-004).
  - Reuse `kept_change_*` with a negative value. Rejected: the schemas are nonnegative and it would change kept change's meaning in every report.

## R3: Server validation: one resolver

- **Decision.** Add `resolveRoundingGiven` in a new `repositories/roundingGiven.ts`, modelled on KC's payout branch. It returns `{ usd, lbp }`, the amount to book, or zero when there is no claim. It refuses when:
  - there is a claim and the transaction is for a partner (FOR), is deferred into a session basket, or also has a kept-change claim;
  - the payout has no legs, or any leg uses a non-drawer method or an OUT leg;
  - the payout currency is not USD or LBP;
  - the claim is in a currency other than the owed currency;
  - the claim is over the cap (`isWithinShortfallMax`, the same predicate kept change uses);
  - the legs do not reconcile against `owed + rounding` (by `reconcileLegs`, at the tender rate when given, with the context label).
- **The claim's currency is the owed currency.** The legs may be any mix of USD and LBP. For example, a USD payout topped up with an LBP note claims USD rounding, and the conversion is done by `reconcileLegs` at the tender rate. This avoids the trap in KC:555-563, where a claim in the leg's currency would be refused.
- **Rounding of the amount.** USD is rounded to cents and LBP to whole pounds, the same as `payoutKeptRounded`.
- **Rationale.** There is one predicate for every payout flow (rule 14), and every flow that accepts a claim must call it (rule 23: every accepted key is used or refused). Each flow keeps a fail-closed check: a claim that no branch verified is refused, like FinancialServiceRepository.ts:5430-5434 does for kept change.
- **`postPayoutLegs`.** It gains `roundingGiven?: {usd, lbp}`. Its internal target becomes `owed − kept + rounding`.

## R4: Booking: one writer

- **Decision.** Add `bookPayoutRoundingExpense` in `changeRoundingExpense.ts`, next to the existing LBP writer. It reuses:
  - `CHANGE_ROUNDING_EXPENSE_CATEGORY`;
  - `books_only: true`;
  - the parent link `source_ref_table` / `source_ref_id`, so `is_auto` is derived and the expense is voided by the cascade;
  - `expense_date = transactionTime ?? clientDay ?? clientDay()` (rule 27).
  - Its input is `{ parentSourceTable, parentSourceId, parentLabel, amount: {usd, lbp}, exchangeRate, userId, transactionTime?, clientDay? }`.
  - The description reads "Payout rounded up to the next note (label)".
  - `extra_metadata` is `{ payout_rounding_usd, payout_rounding_lbp }`.
- **Rationale.**
  - Same category: every rounding cost sits in one place on the Expenses page. This is the owner's choice.
  - Books-only: the payout leg already took the full amount from the drawer.
  - It counts in "Expenses Deducted" because the Profits sum has no books_only filter (ProfitRepository.ts:5591-5604; ProfitService.ts:1242).
  - The module's profit stamp is computed from what was owed, never from what was paid, so it does not change (FSR :2940-2959, Recharge :2302, Exchange :545).

## R5: Reversal owner per flow (rule 20)

| Flow | Parent link | Reversal |
| --- | --- | --- |
| OMT/Whish system receive, Binance, OMT/Whish App receive | `financial_services` / id | generic void/refund calls `_cascadeExpenseSiblingVoid` (TransactionRepository.ts:6131, :6792) |
| Exchange | `exchange_transactions` / id | generic cascade |
| Credit buy-back | `recharges` / id | generic cascade |
| Top-up from client | `recharges` / id | generic cascade |
| Hold Money pickup | `hold_money_pickups` / pickup id | **module-owned**: `HOLD_MONEY_COLLECT` is NON_REVERSIBLE and `voidPickup` (HoldMoneyRepository.ts:669-822) must void the linked expense. The `source_table "hold_money"` pair is shared by drop-off and all pickups, so it cannot be the link. |

- For Hold Money, add a public `TransactionRepository.voidLinkedExpenses(sourceTable, sourceId)` that wraps the private cascade. `voidPickup` calls it.
- Hold Money supports round-up only for one-currency pickups. Two-currency pickups use the per-currency no-cap path, which already refuses handing out more in a currency (KC:645-656). That stays as it is.

## R6: Screens: payout

- **Decision.**
  - MPI gains an opt-in `onRoundUpChange?: (r: { usd: number; lbp: number } | null) => void`.
  - The round-up is active when all of these hold: the payer is payout, `onRoundUpChange` is passed, `payoutExcessToAccount` is not set, `overpaidTarget > matchTolerance`, and `isWithinShortfallMax(overpaidTarget, totalAmountCurrency)`.
  - While active: `paidHasProblem` ignores the overpay, and an emerald note appears (`data-testid="payout-roundup-summary"`, i18n key `summary.roundUpBooked`, en and ar).
  - The amount is reported in the total's currency, rounded like `payoutKeptRounded`.
  - The report effect is keyed `${payer}|…` and reports `null` itself whenever it is inactive, including when the payer is not payout. No other effect clears it (unlike kept change, which has the T3 effect).
- **Callers.**
  - Each caller stores `{ usd, lbp, payout: boolean }` and sends `rounding_given_*` only when `payout` matches the current mode. This is the same stale guard as kept change.
  - The callers are Services RECEIVE (CASH cashout), CryptoForm through Recharge, OmtWhishAppTransferForm, TopUpModal, Exchange, HoldMoneyPickupSheet (one currency only) and TelecomForm buy-back through Recharge.
  - `PaymentSheet` passes the prop through.
  - `buildWalletTransferPayload` (core `utils/walletTransfer.ts`) gains the `roundingGiven` input, so the OMT/Whish App payload is still built in one place.
- **Excluded.** Debts cash-out (`payoutExcessToAccount` wins) and RefundMethodModal (a refund returns a known amount).

## R7: Screens: customer pays (+ Extra autofill)

- **Decision.** Add one pure helper, `suggestRoundUpExtra({ paidInTarget, baseTotalInTarget, currency, cap? })`, in `packages/ui/src/components/ui/roundUpExtra.ts`.
  - It returns the overpay (paid − pre-extra total) rounded to cents or whole pounds.
  - It returns 0 when the overpay is at or below the tolerance, above `isWithinShortfallMax`, or above the page's extra cap.
  - Both users below call it (rule 14).
- **MPI built-in line** (`extraAllowed`).
  - A new effect is keyed on the lines key (`id:currency:amount`).
  - When the helper returns a value above 0, no discount is typed, and the cashier has not dismissed it, it calls `setLineMode("extra")` and `setDiscountRaw` (converted to `discountCurrency`).
  - A `roundUpDismissedRef` is set by `handleLineModeChange` and by the cashier typing in the line. It is cleared when the lines key changes.
  - The overpay is measured against the pre-extra total, so the fill does not re-trigger itself.
- **CheckoutModal** (POS and Maintenance; its own `discountRow`, so MPI's `extraAllowed` is false).
  - Same rule in the modal, from its own `paymentLines` (it already gets them through `onChange`), with the same helper and the same dismiss ref.
  - It calls `handleExtraChange` and `setLineMode("extra")`.
  - Only when `canExtra` is true and no discount is typed.
- **Highlight.** While the extra was filled in automatically, the line shows a small note, "Rounded up, clear to give change" (`discountLine.autoExtraHint`). DiscountLine already takes a `hint` prop.

## R8: What stays out

- The refund window, Debts cash-out, Hold Money two-currency pickups, partner (FOR) payouts, and payouts into the customer's account or a wallet. These have no legs, so no overpay is possible.
- The payment snapshot does not get a rounding entry. The expense carries the amount in `extra_metadata`.
- Receipts: a payout receipt prints what was paid out. No change.
