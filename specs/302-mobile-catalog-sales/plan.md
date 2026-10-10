# Implementation Plan: Phone Katsh / iPick catalog sales

**Branch**: `302-mobile-catalog-sales` (work on `main`, ticket LIRA-302) | **Date**: 2026-10-10 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/302-mobile-catalog-sales/spec.md`

## Summary

Move the web's walk-in catalog-cart payload into one core builder (`buildCatalogSalePayload`), have the web's
`KatshForm` use it for its plain cart and layer its extras on top, and add a phone screen behind the Katsh / iPick
Sell tiles that builds the same payload: catalog → cart with quantities → client → payment (account / Whish / OMT,
LBP or USD at the day's buy rate) → Save with an Idempotency-Key. No new route, schema or migration: the phone posts
to the existing `POST /api/services/transactions`. A money suite on the real schema proves every
provider × payment × currency combination books the same as the counter and voids back to zero.

## Technical Context

**Language/Version**: TypeScript ~5.9/6.0 strict; React 19 (web), React Native 0.83 / Expo SDK 55 (phone)

**Primary Dependencies**: existing only — `@liratek/core` (schemas, services), TanStack Query (phone cache,
LIRA-300), Expo Router

**Storage**: SQLite via existing repositories; no schema change

**Testing**: core jest (builder unit tests + real-schema money suite), frontend jest (8 existing `KatshForm.*`
suites must pass unchanged), mobile jest (cache keys / invalidation), manual + Maestro on the simulator

**Target Platform**: web + desktop (refactor only, no visible change), iOS / Android phone app

**Project Type**: monorepo — core + frontend + mobile

**Performance Goals**: a three-item cart recorded in under 60 s (SC-001); catalog list instant on return (cached)

**Constraints**: payload identical to the web (SC-002); never book twice (FR-008); no cash, no split, no discount on
the phone; Only-Days and bills web/desktop-only

**Scale/Scope**: 2 new core modules, 1 web component refactored at its submit site, 1 phone screen + 1 API helper

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Note |
| --------- | ------ | ---- |
| I. One core, two transports (19, 22, 27, 29) | Pass | Builder in core, used by web (IPC + REST) and phone (REST). One payload shape (FR-007). Phone keeps `X-Client-Day`. New core modules are pure leaves (browser-entry guard test). |
| II. Layer boundaries (13) | Pass | No SQL or service change. |
| III. Contracts defined once (14, 21, 23) | Pass | Builder returns `CreateFinancialServicePayload` (`z.input` of the schema). `formatCatalogItemName`, the note format and `getExchangeRates` move to core instead of being copied. No schema put in front of a new handler. |
| IV. Money integrity (11, 16, 18, 20, 26) | Pass | FEATURE_GUIDE §13 walk-through below; no new ledger row type; client propagated (`clientId`); one IN leg, no OUT legs; money suite proves create + void nets to 0 per drawer and currency. |
| V. Data and security | Pass | Existing admin/staff route + phone admin-only sign-in; tenant scoping unchanged. |
| VI. Testing (17, 24, 28) | Pass | Builder tests take field names from the schema (parse the output through `createFinancialServiceSchema`). Parity test: web-shaped payload == builder output for the same cart — written BEFORE the KatshForm refactor and seen passing against the old inline code (characterization, not failing-first). Counts confirmed per run. |
| VII. Code quality | Pass | Strict TS, no `any`. |
| Delivery (30) | Pass | No web/desktop-visible change → no release-note line; the phone app has not shipped (LIRA-300 rule). Ticket "What users will notice" updated. |

### FEATURE_GUIDE §13 walk-through (rule 18)

1. Transaction row: unchanged repository path (`FINANCIAL_SERVICE`, provider Katsh/iPick, `SEND`).
2. IN/OUT badge: SEND = money in; unchanged.
3. Payment legs: one IN leg; `checkoutTotal` + `tender_exchange_rate` exactly as the web; no OUT legs.
4. Client propagation: `clientId` from the phone's picker → payload → route → service → `createTransaction`.
5. CUSTOMER_ACCOUNT: booked by the repository's existing debt path; requires a client (schema refine).
6. Supplier/partner ledger: none for a cost/price SEND (prepaid drawdown) — asserted in the money suite.
7. Void path: generic void/refund; asserted to net to zero.
8. Profit stamping: price − cost; asserted.
9. Session branch: not used (no `deferPayment`).

Re-checked after Phase 1 design: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/302-mobile-catalog-sales/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md
├── contracts/catalog-sale.md
├── checklists/requirements.md
└── tasks.md            # next: /speckit-tasks
```

### Source Code

```text
packages/core/src/
├── utils/catalogSale.ts                 # NEW: formatCatalogItemName, catalogCartNote, buildCatalogSalePayload, usdForLbp
├── utils/exchangeRates.ts               # NEW: getExchangeRates (moved from frontend)
├── utils/__tests__/catalogSale.test.ts  # NEW
├── utils/__tests__/exchangeRates.test.ts# NEW (or the moved frontend test)
├── repositories/__tests__/FinancialServiceRepository.phoneCatalogSales.test.ts  # NEW money suite
├── browser.ts, index.ts                 # export the two modules
frontend/src/
├── features/recharge/components/KatshForm.tsx         # walk-in cart payload via the builder; extras on top
├── features/recharge/hooks/useMobileServiceItems.ts   # re-export formatCatalogItemName from core
├── utils/exchangeRates.ts                              # re-export getExchangeRates from core
└── features/recharge/components/__tests__/KatshForm.builderParity.test.tsx  # NEW (web payload == builder)
mobile/src/
├── api/catalog.ts                       # NEW: getCatalog, getRates
├── data/queryKeys.ts                    # + catalog, rates
├── data/invalidation.ts                 # "transfer" → "sale" (+ test update)
├── app/(app)/sell/index.tsx             # Katsh / iPick tiles open the catalog screen
├── app/(app)/sell/_layout.tsx           # + catalog/[provider] screen
└── app/(app)/sell/catalog/[provider].tsx  # NEW screen
```

**Structure Decision**: core builder + web refactor + phone screen; no backend or electron change.

## Risks

1. **Web refactor changes a real checkout.** Mitigation: the parity test is written first against the existing
   inline payload; the 8 existing `KatshForm.*` suites must pass unchanged; only the plain-cart construction moves.
2. **USD rounding differs from the web.** Mitigation: read the web's tender conversion while writing `usdForLbp`;
   adopt its rule; the parity check (quickstart) compares a USD sale on both.
3. **Catalog size on a phone.** Catalogs can hold hundreds of items; use a virtualised list (`FlatList`/`SectionList`)
   and search.

## Complexity Tracking

None.
