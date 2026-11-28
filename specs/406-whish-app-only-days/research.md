# Research: Whish App "Only Days" (LIRA-406)

All unknowns resolved by reading the code and the seeded screenshot shop (2026-11-28).

## R1. Why Whish App books no returned credit today
- **Decision**: add `WHISH_APP` to `isTelecomResellerApp` in `FinancialServiceRepository.createTransaction` (~line 2370), only when the sale's currency is LBP.
- **Rationale**: it is the single gate for both the profit offset (LIRA-153 resolution) and `processTelecomCreditReturn` (drawer leg + line movement). Everything downstream is provider-agnostic (`carrierDrawerName`, `CarrierLineService.applyMovement`, `_reverseCarrierLineMovements`, `ONLY_DAYS_TXN_IDS_SQL`).
- **Existing test to adapt**: `FinancialServiceRepository.telecomOnlyDays.test.ts` "a non-telecom-reseller provider (e.g. OMT_APP cost/price) never books a credit-return leg" uses `WHISH_APP`. Switch it to `OMT_APP` (its title's intent) so it keeps guarding the non-reseller case; add a new `WHISH_APP` test, failing first.
- **Alternatives**: a Whish-specific credit-return path (rejected: second copy, rule 16 "re-gate the existing leg, never add a second").

## R2. USD Whish App sale with a credit return
- **Decision**: the gate requires `currency === "LBP"` for `WHISH_APP`; a USD Whish App sale books no credit return even if the payload carries one. Pinned by a test.
- **Rationale**: prepaid cards are LBP-only in Whish App (`isUsdSellable` refuses `alfa`/`mtc` + `Prepaid`, LIRA-324). The repository would otherwise net raw dollars against a USD cost, a path never designed or reviewed. Katsh / iPick keep today's behaviour (no currency condition) to stay byte-for-byte unchanged.
- **Alternatives**: throw on USD (rejected: could break a scripted USD caller that sends a stale field; silently ignoring matches the "skip, never book half" stance of `resolveTelecomCreditReturns`).

## R3. Whish App books one transaction per unit (deferPayment siblings)
- **Finding**: FinancialForm calls `addOMTTransaction` once per unit; units after the first carry `deferPayment: true` and no legs. In the cost/price branch the deferred case is a no-op inside the inflow `if/else` and execution reaches `processTelecomCreditReturn()` after it (~line 4393). So siblings DO credit. `price` falls back to `amount` (`data.price ?? (useCostPriceFlow ? data.amount : 0)`).
- **Decision**: no server change; pin with a test (qty 2 with split legs: both units credit, profit stamped on both).

## R4. Pricing must not be copied
- **Finding**: Katsh's Only Days pricing (`resolveOnlyDaysPricing`, `calcPrice`, `lineUnitPriceOf`, `CatalogPricingRow`, `OnlyDaysPricingResult`) and the toggle default (split-complete → `resolveMaxReturnedCredits`; else `maxReturnableCredits(parseFloat(label))`) are module-private in `KatshForm.tsx`. The pricing data (`sell_days_lbp`, `sell_credit_lbp`, `max_returned_credits_usd` per item id + tenant `telecom_credit_sell_price_lbp`) is loaded inside KatshForm with `api` in the effect deps (a rule-25 smell).
- **Decision**: move pricing + toggle default to `utils/onlyDaysPricing.ts`; move the load to `hooks/useOnlyDaysPricingData.ts` (api through a ref). Both forms use them. FinancialForm routes BOTH its unit-price sites (`pricedLines` and the submit loop's `catalogSellPrice`) through one `lineUnitPrice`.
- **`alfaCreditSellRate`** (the legacy fallback rate for items without a days price) comes from `Recharge/index.tsx`; it is passed to FinancialForm the same way it is passed to KatshForm.

## R5. Four payload builders
| Mode | Builder today | Change |
| --- | --- | --- |
| Walk-in | FinancialForm per-unit loop → `addOMTTransaction` | add per-unit `itemCategory` / `mobileServiceItemId` / `returnedCreditsUsd` (scalar fields) and the Only Days unit price |
| Session basket | `whishBatchSubItems` → `_batch` sub-items | same fields from the shared per-unit derivation |
| Basket checkout (LIRA-326) | `buildBasketCheckoutPayload` consumes sub-items | none beyond sub-items (verify keys survive the schema) |
| For Partner (LIRA-327) | `buildPartnerOrderPayload` WHISH_APP branch: one sale per sub-item, forwards only `itemKey` / `itemCategory` / `note` | forward `mobileServiceItemId` / `returnedCreditsUsd` too |

- **Decision**: one helper `onlyDaysUnitFields(line)` returns `{ mobileServiceItemId?, returnedCreditsUsd? }` (the B2 rule: id only when split complete; returned credit only when edited or split incomplete). `catalogBatchSubItems`, `whishBatchSubItems` and the walk-in loop all use it.

## R6. Other gates
- Settings → Mobile Services split editor: provider list includes `WHISH_APP`; editor is provider-agnostic (no change).
- Profits Only Days drill-down: keyed on the `CREDIT_RETURN` leg (provider-agnostic).
- Transactions badges (`rowBadges`, `useTransactionRows`): read the leg sum; provider-agnostic. Only comments name Katsh / iPick.
- Note suffix `[Only Days]`: added by the Whish walk-in note and sub-item note when the line is Only Days (FR-008).

## R7. Display currency in FinancialForm
- Only Days is offered only when `!isUsd` (LBP mode). Switching to USD clears the cart today (LIRA-324), so no Only Days line can survive into USD mode.
