# Research: Customer adds change on payouts (LIRA-336)

These findings come from reading `main` at bbc7a7da on 2026-10-18, in two passes. Abbreviations:

- "MPI" is `packages/ui/src/components/ui/MultiPaymentInput.tsx`.
- "MP" is `packages/core/src/repositories/moneyPosting.ts`.
- "FS" is `FinancialServiceRepository.ts`.

## R1: Wire claim

- **Decision.** Add a new optional pair, `added_change_usd` / `added_change_lbp`. It is nonnegative, has no `.default()`, and is in the **payout** currency only. Put it in `validators/common.ts` as `addedChangeFields`, next to `roundingGivenFields`.
- **What the claim does.** It is both the FR-008 opt-in and the tamper check. With no claim, every flow behaves byte-for-byte as today, including the overpay refusal.
- **The customer's lines** use the existing key `customerPayments` (`customerLegSchema`):
  - Exchange and the app/Binance receive already have it.
  - Add it as a plain top-level optional key (not the whole `customerPaymentsField`, which brings `customer_waived_amount` with it) to `createRechargeSchema` (CREDIT_BUYBACK only, refused on other types), `topUpFromClientSchema` and `holdMoneyCollectSchema`.
  - Relax the financial refine (validators/financial.ts ~:596-631) and its repository copy (FS ~:2359) so that OMT/WHISH system RECEIVE takes `customerPayments` **only together with** an added-change claim.
- **Rationale.**
  - It follows the LIRA-334 pattern, which is offline-replay safe. Never change a leg element schema: arrays are compared whole by `offline/schemaShape.ts`.
  - The claim states the amount the screen showed, so the server books exactly that (rule 14).

## R2: Measure, then write

- **Decision.** Split `bookCustomerLegs` (MP ~:1135) in two:
  - a pure `measureCustomerLegs` (steps 1–4: shape, currencies, forgive, balance), which gains `allowAddedChange`;
  - the existing writer (step 5).
- **What `allowAddedChange` changes in the measure step:**
  - `expected.amount` may be 0.
  - Money above the target returns `addedChange` (in the expected currency, plus its USD equivalent) instead of throwing the overpay error.
  - It is refused when any CUSTOMER_ACCOUNT leg or waive is present (FR-009).
- **`bookCustomerLegs`** keeps its current behaviour for existing callers by calling measure and then write.
- **Rationale.** Exchange, buy-back, top-up and Hold Money verify the round-up and kept change before the transaction id exists. They must measure early and write later.

## R3: One resolver

- **Decision.** Add `resolveAddedChange` in a new node-only file, `repositories/addedChange.ts`. Input:
  - `legs`, `expected` (0 when the customer owes nothing);
  - `payoutCurrency`, `exchangeRate`, `tenderExchangeRate`;
  - `claimed`, `notAllowed`, `context`.
- **What it does:**
  1. Measures with `allowAddedChange`.
  2. Requires drawer-method legs for the extra.
  3. Converts the extra into the payout currency at `preferTenderRate(server, tender)`, the OUT reconcile rate.
  4. Checks the cap with `isWithinShortfallMax`.
  5. Requires the claim to equal the derived extra within `KEPT_CHANGE_ROUNDING_TOLERANCE`, or the leg epsilon when currencies mix.
  6. Returns the claimed value in the payout currency, rounded to cents or whole LBP, plus the measured result used later for the write.
- **No claim and no extra** returns zero and leaves the legacy path untouched.
- **Rationale.** One rule for every flow (rule 14). Every accepted key is used or refused (rule 23).

## R4: Raised target in every flow

- **Decision.** Each payout flow passes `owed + added` to `resolveRoundingGiven`, `resolveKeptChange`, `postPayoutLegs`, or the hand-written reconciles (Exchange ~:874, top-up ~:3364).
- **What never moves:** the transaction amount, the profit stamp, `cashPaid` / `recharges.cost`, the hold portion and `amount_*` (FR-005).
- **When the customer's lines are written:**
  - Exchange and FS wallet receive: where `bookCustomerLegs` runs today.
  - FS system receive: before the cash cashout block, through `resolveServiceCashDrawer` so they land in the primary cash drawer like the payout.
  - Buy-back: after `createTransaction` (~:2329).
  - Top-up: right before its payout loop (~:3537).
  - Hold Money: after `createTransaction` (~:536).
- **Payment snapshot.** Pass `customerPayments` wherever it is missing (buy-back, top-up, Hold Money). `buildPaymentSnapshot` already records them as IN lines.
- **Refusals:** the claim is refused on a payout made for a partner (FOR), in a session (`deferPayment`), to the customer's account, on a non-cash system-receive cashout, and on a two-currency Hold Money pickup. FS also gets a fail-closed check, like LIRA-334's.
- **Exchange:** only when both currencies are USD/LBP. The customer's lines stay locked to the from-currency.
- **Top-up drawer guard** (~:3374): unchanged. It checks gross payout legs and may refuse when the drawer can't cover the full amount; that is acceptable.

## R5: WHISH system receive with the fee paid on top

- **Decision.** The fee section (`feePayments`, `bookFeeCollectionLegs` FS ~:3100) takes the added change too.
  - `bookFeeCollectionLegs` gains `addedChange`. The fee legs reconcile against `fee + added` (converted to the fee currency), and all those lines post to the primary cash drawer as today.
  - The screen sends `feePayments` (all lines) plus the claim.
- **Rationale.** MPI has only one IN section, and the server keeps one writer for those lines.

## R6: Reversal (rule 20)

- The customer's lines are ordinary `payments` rows on the payout's transaction.
- The generic `_reversePayments` (TransactionRepository ~:8888) mirrors them. Hold Money's `voidPickup` (~:803-838) already mirrors every payment row of the pickup transaction.
- **No new reversal owner is needed.** It is proven by a create + void that nets to 0 in each drawer.

## R7: Payment box

- **`useLinesSection`** gains these options:
  - `allowAddedChange` and `isAddedChangeAllowed(amount)`, read through `optsRef`;
  - `state.addedChange`, from non-account lines only; over the cap counts as overpaid;
  - an emit-on-disable (`onChange([])` plus a zero state) when the section is turned off.
- **MPI:**
  - Move the `useLinesSection` call up, right after `convertSafe`. It is unconditional, so hook order is safe.
  - Fold `addedTarget = round(convert(state.addedChange → payout currency))` into `effectiveTotals` when the payer is payout, the section allows added change, and `perCurrencyTotals` is off.
  - Add `addedTarget` to the auto-sync dependencies, so an untouched "Shop pays" line follows to $200.
  - Kept change and round-up then measure against the raised target by construction (FR-003).
- **New `counterFlow` fields:**
  - `allowAddedChange`;
  - `optional`: hidden behind "+ Customer gives change" (`counter-flow-add-change`), with an × to close it (`counter-flow-remove-change`) that clears the lines and reports null.
- **New prop** `onAddedChange({usd, lbp} | null)`, in the payout currency, keyed like `onRoundUpChange`.
- **Summary row** `payout-added-change-summary`: "Owed $197.00 + customer gave $3.00 = $200.00".
- **Cap:** `isAddedChangeAllowed = isWithinShortfallMax(convert(a), payoutCurrency)`. Over the cap the section shows as overpaid, so pages' existing Confirm gates block it. New i18n key `counterFlow.addedChangeOverCap` ("use the Exchange page").
- **Only USD/LBP sections (plus USDT counted as USD).** `convertSafe` passes unknown pairs through 1:1.

## R8: Screens

- **Existing section** (Exchange with USD/LBP only, CryptoForm, OmtWhishAppTransferForm, Services WHISH fee section): set `allowAddedChange: true`.
- **New optional section** `{optional, allowAddedChange, totalAmount: 0, currency: payoutCurrency}` on:
  - Services OMT and WHISH system receive (cash cashout, when no fee section);
  - HoldMoneyPickupSheet (one currency);
  - TelecomForm buy-back (through PaymentSheet, which passes `counterFlow` on unchanged);
  - TopUpModal "From client".
- Each screen sends `customerPayments` (or `feePayments`) and `added_change_*` in its one payload builder, guarded against stale values like `rounding_given_*`.
- **Off for:** payouts made for a partner (FOR), sessions, Debts cash-out and refunds.

## R9: Out of scope

- Lifting the from-currency lock on Exchange.
- Per-currency (`perCurrencyTotals`) screens.
- EUR / exotic sections.
