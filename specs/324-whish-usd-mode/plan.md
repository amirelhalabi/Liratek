# Implementation Plan: Whish App items in USD (LBP | USD switch)

**Branch**: `324-whish-usd-mode` (work on `main`; ticket LIRA-324) | **Date**: 2026-10-16 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/324-whish-usd-mode/spec.md`

## Summary

Add an LBP | USD switch to Recharge → Whish App → Bills. In USD mode the grid shows Whish App items that have a USD price (never the MTC/Alfa Prepaid cards) and sells them at that price; the sale is recorded in USD and its cost leaves the `Whish_App` drawer's USD balance.

Research found the **core sale path already handles a USD catalog sale generically** (`currency` drives the provider-drawer debit, amount split, profit, partner ledger, session bucketing and void reversal). The work is therefore:

1. **Data**: two nullable columns `cost_usd` / `sell_usd` on `mobile_service_items` (migration v218 + `create_db.sql`), carried through repository, schemas, preload/types, adapters, seed and Settings.
2. **Prices**: USD prices from the 2026-10-14 Whish crawl into the starting catalog (`whishApp.ts`) and, for existing shops, migration v218 from a frozen list — 319 items gain a USD price, 34 USD-only items are added.
3. **UI**: the switch (remembered per device, confirm-then-clear), a currency prop on `FinancialForm` replacing its ~10 hard-coded `"LBP"` sites, USD/LBP sellability filters, and USD fields in Settings → Mobile Services.
4. **Proof**: core characterization tests pinning USD money behaviour (sale, void, partner, session), migration test, frontend tests, one web e2e.

## Technical Context

**Language/Version**: TypeScript (strict), React 19, Node 22, Electron 31

**Primary Dependencies**: `@liratek/core` (repositories/services/validators/migrations), Vite frontend with TanStack Query and the `useApi()` dual-mode adapter, Express backend (REST), better-sqlite3 / SQLCipher

**Storage**: SQLite — `mobile_service_items` gains `cost_usd REAL NULL`, `sell_usd REAL NULL` (v218); sales reuse `financial_services`, `transactions`, `payments`, `drawer_balances`, `partner_ledger`, session cart tables unchanged

**Testing**: jest (core, backend, frontend); Playwright web e2e (`frontend/tests/e2e-web/`); desktop e2e not run on this Mac

**Target Platform**: Electron desktop (Windows/macOS) and multi-tenant web (Vercel + Fly)

**Project Type**: monorepo desktop + web app (frontend, electron-app, backend, packages/core, packages/ui)

**Performance Goals**: switching currency re-renders the existing grid with no extra request (items are already loaded once per page)

**Constraints**: LBP behaviour byte-identical (SC-005); no new money posting code in core unless a characterization test fails; browser-safe helpers only from `browser.ts` (rule 29)

**Scale/Scope**: ≈389 Whish App items per shop; ≈353 USD-sellable; one page + one Settings screen + one migration

## Constitution Check

*GATE: passes before Phase 0; re-checked after Phase 1 — passes.*

| Principle | How this plan complies |
|---|---|
| I. One core, two transports | No new endpoint; existing IPC + REST catalog routes already share core schemas; sale goes through `addOMTTransaction` (`ipcOrHttp`). Web proven by a `lira-web-*` spec. Currency preference is client-side; no server clock/day use. Sellability helper is pure and browser-safe. |
| II. Layer boundaries | SQL changes only in `MobileServiceItemRepository` and the migration; no service touches the DB; handlers/routes unchanged apart from schema fields. |
| III. Contracts defined once | Two fields added to the core create/update schemas (seed follows); adapter types stay `z.input`; three-way key diff (rule 23) for create/update/seed against `preload.ts` / `electron.d.ts`; sellability rule defined once (rule 14). |
| IV. Money integrity | Feature Guide §13 walked below; no new transaction type, ledger row or charge type; void reversal is the existing generic path, proven per currency by a test. |
| V. Data & security | `?` placeholders; every migration statement scoped by `tenant_id`; v218 in both `index.ts` and `create_db.sql` with `down()`; roles unchanged. |
| VI. Testing | Characterization tests are new guards for behaviour that already exists (labelled "not failing-first: pins existing behaviour"); new behaviour (sellability, switch, payload, migration) gets tests first and shown failing; e2e asserts deltas by identity. |
| VII. Code quality | strict TS, no `any`, module loggers, `api` via ref in effects. |

**Feature Guide §13 walk-through (money)**

1. Schema/plumbing — v218 both files; repository → service → handler unchanged except fields; preload + `electron.d.ts` types; core build & sync.
2. Transactions row — unchanged type; `currency='USD'` sets `amount_usd`, `profit_usd`; `client_id`, `session_id`, `exchange_rate` stamped as today.
3. IN/OUT badge — same type as LBP sales; no change.
4. Payment legs — same one-payload carrier/deferred-sibling model; `checkoutTotal.usd` carries the total; IN legs only in branches (no change to repository loops).
5. Drawers — cost from `Whish_App` USD; customer legs per their own currency.
6. Client propagation — unchanged fields; USD path sends the same `clientId`/`clientName`.
7. CUSTOMER_ACCOUNT — debt currency follows `currency` (already); test one USD sale on account.
8. Supplier/partner ledger — prepaid-units model: no supplier row per sale (unchanged); For Partner: `partner_ledger` delta in USD.
9. Void — generic `_reversePayments`; test sale + void nets 0 on `Whish_App` USD, drawers, profit.
10. Profits — `profit_usd = price − cost`; refund negates.
11. Sessions — cart entry and sub-items in USD; basket never mixes currencies (switch clears selection).
12. Audit viewer — USD amounts render via existing currency columns; verify in quickstart.
13. E2E guard — web spec with delta + identity assertions.
14. One obligation, one owner — cost is a drawer draw-down only (prepaid units), no ledger duplicate.
15. Legs vs amount — existing reconciliation against `checkoutTotal` now receives the USD side; covered by the sale test.

## Project Structure

### Documentation (this feature)

```text
specs/324-whish-usd-mode/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R9 decisions
├── data-model.md        # columns, sellability rule, v218
├── quickstart.md        # manual + automated validation
├── contracts/
│   ├── catalog-item-api.md
│   └── bills-currency-switch-ui.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
packages/core/src/
├── db/migrations/index.ts                    # v218 whish_app_usd_prices (+ helpers)
├── db/migrations/data/v218WhishUsdPrices.ts  # frozen USD prices + USD-only items
├── db/migrations/__tests__/v218.whishUsdPrices.test.ts
├── constants/catalogCurrency.ts              # isUsdSellable / isLbpSellable (browser-safe)
├── browser.ts, constants/index.ts            # export the helper
├── repositories/MobileServiceItemRepository.ts  # columns in getColumns/create/update/bulkCreate
├── validators/mobileServiceItem.ts           # cost_usd / sell_usd
└── repositories/__tests__/FinancialServiceRepository.whishUsdSale.test.ts  # characterization

electron-app/
├── create_db.sql                             # 2 columns + (218, …) row
├── preload.ts                                # create/update/seed types
frontend/src/
├── types/electron.d.ts
├── api/backendApi.ts                         # MobileServiceItemEntity
├── data/mobileServices.ts                    # ItemPricing cost_usd/sell_usd
├── data/providers/whishApp.ts                # USD prices + USD-only items
├── features/recharge/utils/parseCatalogToSeedData.ts
├── features/recharge/utils/whishBillsCurrencyStorage.ts   # per-device memory
├── features/recharge/utils/cardImageManifest.ts           # USD-only item images
├── contexts/MobileServiceItemsContext.tsx    # ServiceItem USD fields + savedCost by currency
├── features/recharge/pages/Recharge/index.tsx # switch + confirm-clear
├── features/recharge/components/FinancialForm.tsx  # currency prop, no hard-coded LBP
├── features/settings/pages/Settings/MobileServicesManager.tsx  # USD fields
└── tests/e2e-web/lira-web-0NN-whish-usd-sale.spec.ts
packages/ui/src/api/types.ts                  # MobileServiceItemEntity
docs/release-notes/UNRELEASED.md
```

**Structure Decision**: existing monorepo layout; no new package or module.

## Complexity Tracking

No constitution violations to justify.
