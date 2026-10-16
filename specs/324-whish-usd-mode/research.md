# Research — LIRA-324 Whish App USD mode

All Technical Context unknowns resolved below. Evidence comes from two code read-throughs (2026-10-16) of the Whish App Bills sale flow and of the `mobile_service_items` plumbing.

## R1. Does the sale backend already support a USD catalog sale?

- **Decision**: Yes — no new money logic in core. The frontend sends `currency: "USD"` and USD amounts; the existing cost/price flow does the rest.
- **Rationale**: `FinancialServiceRepository.createTransaction` reads `currency = data.currency ?? "USD"` and uses it for: the provider-drawer cost debit (`insertPayment(..., providerDrawer, currency, -cost)` + `upsertBalanceDelta(providerDrawer, currency, -cost)`, walk-in block ~L3417-3433), the unified `transactions.amount_usd/amount_lbp` split (~L2489), `profit_usd/profit_lbp` (~L2545), the single-payment and multi-leg inflow (per-leg `currencyCode`), debt currency, the FOR-partner arm (cost into `serviceDrawer` in `currency`, `partnerOwedDelta` uses `params.currency`) and `itemCostService.autoSaveCost(..., currency)`. A source comment (~L1780) already notes "a USD catalog sale would credit USD to the drawer". `Whish_App` has seeded USD and LBP `drawer_balances`/`currency_drawers` rows. Void/refund `_reversePayments` mirrors each `payments` row in its own `currency_code`; profit reversal negates both profit columns. Sessions bucket by the cart entry's `currency`.
- **Alternatives considered**: a dedicated USD service path — rejected, it would duplicate the posting rules (rule 14) and the money invariants that already hold per currency.
- **Consequence**: core gets characterization tests that pin USD behaviour (FR-006/FR-008), not new posting code. If one of them fails, that is a real defect to fix in the repository, not in the form.

## R2. Where is LBP hard-coded?

- **Decision**: In the frontend only — `FinancialForm.tsx` (≈10 sites: session label and sub-items `currency: "LBP"`, `checkoutTotal = { usd: 0, lbp }`, `currency: "LBP"` in the walk-in payload, `extra_lbp` only, partner `currency`/`currencyCode: "LBP"`, LBP display strings, `PaymentSheet totalAmountCurrency="LBP" currency="LBP"`) and in the catalog data (`cost_lbp`/`sell_lbp` only).
- **Rationale**: `OmtWhishAppTransferForm` already drives the same `addOMTTransaction` with a `currency` state and `PaymentSheet totalAmountCurrency={currency}` — the pattern to copy.
- **Alternatives considered**: none; the currency must be a parameter of the form.

## R3. How to store USD prices

- **Decision**: Two nullable columns on `mobile_service_items`: `cost_usd REAL`, `sell_usd REAL` (migration v218, mirrored in `create_db.sql`). One row per product; the price pair present decides the mode.
- **Rationale**: one name, one picture, one product-line position per product (FR-005); the edit screen just gains two fields; no unique-key change.
- **Alternatives considered**: a row per currency (rejected: duplicates a product, its image key and its edits; needs `currency` in `UNIQUE(...)` → table rebuild); converting LBP by rate (rejected: Whish prices each currency independently — TOUCH $1.67 is 2.08 USD).
- **USD-only items**: `cost_lbp = 0, sell_lbp = 0` (columns are `NOT NULL DEFAULT 0`) with `cost_usd`/`sell_usd` set.

## R4. Which items show in which mode (one definition)

- **Decision**: one pure helper in core (browser-safe, rule 29), e.g. `constants/catalogCurrency.ts`:
  - `isUsdSellable(item)`: `cost_usd > 0 && sell_usd > 0` and NOT (`category ∈ {alfa, mtc}` and `subcategory = Prepaid`).
  - `isLbpSellable(item)`: NOT (`cost_lbp = 0 && sell_lbp = 0 && cost_usd > 0`) — i.e. everything shown today, except USD-only rows.
- **Rationale**: FR-003/FR-004 and the prepaid exclusion are a business rule used by the grid, Settings badges and tests → defined once (rule 14). The LBP rule is written so that every item visible today stays visible (SC-005), including legacy items with a 0 price.
- **Alternatives considered**: filtering in SQL (rejected: the context loads all active items once for every provider; a client-side predicate is enough and is testable).

## R5. Filling USD prices for existing and new shops

- **Decision**:
  - **New shops**: `frontend/src/data/providers/whishApp.ts` items gain `cost_usd`/`sell_usd` (sell = cost); USD-only items are added with LBP prices `"0"`. `ItemPricing`, `SeedItem`, `parseCatalogToSeedData`, the create schema and `bulkCreate` carry the two fields.
  - **Existing shops**: migration v218 (frozen data file `migrations/data/v218WhishUsdPrices.ts`, same pattern as v216): for every tenant that already has catalog rows, (a) set `cost_usd`/`sell_usd` on WHISH_APP rows matched by `(category, subcategory, label)` **only where `cost_usd IS NULL`**, (b) insert the USD-only items that are missing. Never touches LBP columns, names or existing USD values. `down()` clears only values still equal to what v218 wrote, deletes unchanged + unreferenced USD-only rows, then drops the two columns.
- **Rationale**: same proven shape as v216 (idempotent, skips empty catalogs so the frontend seed still runs, frozen copy so later edits to `whishApp.ts` don't change history).
- **Coverage (from the 2026-10-14 crawl)**: 319 of the 369 non-Prepaid Whish App items get a USD price; 34 USD-only items are added (the 35th, ALFA WAFFER, is a Prepaid card — excluded). ≈353 items sellable in USD. The 20 hand-maintained Prepaid cards get no USD price in this release.
- **Alternatives considered**: matching by fuzzy name at runtime (rejected: non-deterministic); updating rows the shop renamed (impossible to match safely — spec edge case: no USD price, owner sets one).

## R6. `item_costs` saved-cost override

- **Decision**: In USD mode the saved cost override (`savedCost`, from the legacy `item_costs` table, which has a `currency` column) is applied only when its currency is USD; LBP mode keeps today's behaviour.
- **Rationale**: `autoSaveCost` already saves per currency; mixing an LBP saved cost into a USD sale would post a wrong cost. **Resolved in implementation (2026-10-16):** `savedCost` is set in `MobileServiceItemsContext` but read nowhere in the frontend, so it cannot leak an LBP cost into a USD sale; no change needed.

## R7. The switch and its memory

- **Decision**: `whishBillsCurrency: "LBP" | "USD"` state on the Recharge page, passed to `FinancialForm` as a prop. Persisted per device with a small try/catch localStorage helper (key `liratek:whish-bills-currency`), modelled on `features/suppliers/utils/omtCoveredTypesStorage.ts`; unreadable/absent → `"LBP"`. The control reuses the existing segmented-toggle style of the Transfer | Bills switch.
- **Rationale**: FR-001/FR-002; browser storage is a convenience only, LBP is the safe fallback.
- **Switching with a selection**: confirm dialog → clear selection (owner decision 2026-10-16).

## R8. Offline replay and transports

- **Decision**: No new channels. `financial:create` already carries `currency`; the catalog create/update/seed schemas gain two optional nullable fields. In implementation, check `offline/channelPolicy.ts` for the mobile-service-items channels: if any is `offline`/`checkpoint`, update its fixture; `schemaShape`/`channelPolicy.complete` guards will flag it.
- **Rationale**: Feature Guide "Offline replay" rules; columns are nullable so the offline fixture INSERT (`testHelpers/fixtures/financial.ts`) keeps working.

## R9. Images

- **Decision**: USD-only items get card images like the rest (keys are `category|subcategory|label`, provider-agnostic); regenerate `cardImageManifest.ts` for the new USD-only labels from the crawl images.
