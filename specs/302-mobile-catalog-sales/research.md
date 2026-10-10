# Research: Phone Katsh / iPick catalog sales (LIRA-302)

Facts checked in the repository on 2026-10-10 unless marked "Likely".

## R1. How the web books a catalog cart today

- `frontend/src/features/recharge/components/KatshForm.tsx` serves both Katsh and iPick. A walk-in cart is aggregated
  into ONE `SEND` (`:1651-1799`): `amount` = Σ sell price × qty − discount, `cost` = Σ catalog cost × qty (gross,
  `calcCost` `:86`), `commission` = max(0, amount − cost) (the server recomputes it), `currency: "LBP"`, `note` =
  `formatCatalogItemName(item)` + ` xN` per line, joined by ", ", `paidByMethod`, `payments[]`, `checkoutTotal`,
  `tender_exchange_rate`, `clientId` / `clientName`. No `price`, `itemKey` or `mobileServiceItemId` on this path; the
  repository sets `price = amount`.
- Submit: `addOMTTransaction` → `POST /api/services/transactions` → `createFinancialServiceSchema`
  (`packages/core/src/validators/financial.ts`) → `FinancialService.addTransaction` → `FinancialServiceRepository`.
  The route already supports the phone's `Idempotency-Key` (LIRA-289).
- Server effects: `useCostPriceFlow = cost > 0`; the provider drawer ("Katsh" / "iPick") drops by `cost`; IN legs
  credit their method's drawer; a `CUSTOMER_ACCOUNT` leg books the debt; no supplier ledger row for a cost/price SEND
  (prepaid drawdown); profit = price − cost.
- **No shared builder exists** — the payload is inline in the component. Rule 22 / FR-007 require one.

**Decision:** a core builder `buildCatalogSalePayload` (`packages/core/src/utils/catalogSale.ts`) producing exactly
the walk-in cart payload above for the plain case; `KatshForm` calls it and layers its extras (discount,
Only-Days `telecomCreditReturns`, split/multi-unit fields, kept change, For-Partner) on top; the phone calls it as is.
**Alternative rejected:** a new phone-only route that builds the payload server-side — a second write path for the
same sale (rule 19/22 drift risk) and a REST/IPC parity burden.

## R2. Catalog source for the phone

- `GET /api/mobile-service-items` (`backend/src/api/mobileServiceItems.ts:29`, authenticated, no role gate) returns
  the active `mobile_service_items` rows: `id, provider, category, subcategory, label, cost_lbp, sell_lbp,
  sort_order, is_active, validity_days, credits, …`.
- The web maps `catalogCost = cost_lbp`, `catalogSellPrice = sell_lbp`
  (`frontend/src/contexts/MobileServiceItemsContext.tsx:180-197`).

**Decision:** the phone reads the same route, filters by provider, keeps items with `sell_lbp > 0` and `cost_lbp > 0`
(spec edge case: incomplete items are not offered), groups by category, and caches it per shop (LIRA-300 cache,
fresh 30 s). MTC/Alfa cards (`category`/`subcategory` = `alfa`/`mtc`) are listed as plain items; none of their
Only-Days fields are read (FR-011).

## R3. Paying in USD (owner decision B)

- The web's tender rate is the shop's **buy** rate (we buy USD from the customer): `useSellRate().buyRate`
  (`frontend/src/hooks/useSellRate.ts`), parsed from `GET /api/rates` (`backend/src/api/rates.ts`, `requireAuth`) by
  `getExchangeRates` (`frontend/src/utils/exchangeRates.ts`): the `to_code = "LBP"` row's `buy_rate ?? market_rate`.
  The web falls back to 89,000 when the rate cannot be loaded.
- The server reconciles the legs against `checkoutTotal` at `tender_exchange_rate` and refuses a gap above
  `LEG_RECONCILIATION_EPSILON_USD = 0.05` (`packages/core/src/repositories/moneyPosting.ts:144`). A USD leg rounded to
  the cent is at most $0.005 away, so it always reconciles.
- `buildWalletTransferPayload` already emits `checkoutTotal` + `tender_exchange_rate` for legs; the catalog builder
  follows the same shape.

**Decisions:**
- Move `getExchangeRates` (pure) into core (`utils/exchangeRates.ts`, browser-safe) so web and phone read the rate
  the same way (rule 14); the web keeps its hook.
- The phone does **not** use the 89,000 fallback: if the rate cannot be loaded, USD is unavailable and LBP still
  works (spec edge case). A silent default rate on a money screen is the wrong direction.
- **USD amount rule (verified 2026-10-10, T001):** the web's payment sheet (`packages/ui/src/components/ui/
  MultiPaymentInput.tsx` `prefillAmountFor`) converts the LBP remaining with `packages/ui/src/money/convert.ts`
  (`amount × crossRate`, base USD, so LBP→USD = `lbp × (1 / rate)`) and then `roundForCurrency` (USD: 2 decimals,
  `Math.round(x × 100) / 100`, `packages/ui/src/money/registry.ts`). Core's `usdForLbp` reproduces exactly that
  arithmetic (same operation order, so the same half-cent results); core cannot import `@liratek/ui`.
- Booked as the web books it: one leg `{ method, currencyCode: "USD", amount }`, `checkoutTotal: { usd: 0, lbp:
  total }`, `tender_exchange_rate: buyRate`.
- On account in USD: the customer's debt is booked in USD, the leg's currency (verified 2026-10-10 by T012 on the
  real schema).

## R4. Payment choices and client

- Same as the phone's transfer form (LIRA-289): `CUSTOMER_ACCOUNT | WHISH | OMT`, one leg, one currency.
  `CUSTOMER_ACCOUNT` requires a client (`canChargeToCustomerAccount`, `createFinancialServiceSchema` refine at
  `:342`); wallets accept an optional client. New clients are created with the existing `createClient`.
- `paidByMethod` = the single method (the web sends "MULTI" only for several legs).

## R5. Refresh after saving

- Reuse LIRA-300 `invalidateAfter(shop, { kind: "transfer", paidBy, clientId })`: it marks balances,
  since-last-count, Activity and (on account) debts. The action name "transfer" becomes a general "sale"; the map is
  unchanged. Rename to `{ kind: "sale" }` with the test updated.

## R6. Wording

- The sale appears as "Katsh" / "iPick" (LIRA-301 `transactionTitle` base label) with the stored summary listing the
  items (`isKatshLike` summary in `FinancialServiceRepository.ts:2376-2420` uses the note). Same on web and phone.

## R7. Constitution scope

- Rule 19: no new endpoint — the phone uses the existing REST routes; desktop keeps IPC. The builder lives in core and
  is used by the web (both transports) and the phone.
- Rules 21/22: the builder returns `CreateFinancialServicePayload` (`z.input` of the schema); one payload shape.
- Rules 16/18/20: no new money path or ledger row; the money test proves create + void nets to zero per drawer and
  currency for every combination (FEATURE_GUIDE §13 walkthrough in the plan).
- Rule 27: the phone sends `X-Client-Day` as today.
- Rule 29: `catalogSale.ts` and `exchangeRates.ts` are pure leaves (guard test).
