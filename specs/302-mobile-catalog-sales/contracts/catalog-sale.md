# Contracts: Phone Katsh / iPick catalog sales (LIRA-302)

No new REST route, IPC channel or schema. Existing routes used by the phone:

| Route                                  | Auth                | Purpose                                         |
| -------------------------------------- | ------------------- | ----------------------------------------------- |
| `GET /api/mobile-service-items`        | signed in           | catalog (filtered to Katsh / iPick on the phone) |
| `GET /api/rates`                       | signed in           | the day's rates (USD payment)                   |
| `POST /api/services/transactions`      | admin/staff + `Idempotency-Key` | book the sale (`createFinancialServiceSchema`) |
| `GET /api/clients?search=` / `POST /api/clients` | as today (LIRA-289) | find / create the customer               |

## Core functions (new, pure, browser- and phone-safe)

`packages/core/src/utils/catalogSale.ts`

- `formatCatalogItemName(item: { category; label; subcategory? }): string` — moved from
  `frontend/src/features/recharge/hooks/useMobileServiceItems.ts`; the web re-exports it.
- `catalogCartNote(lines: { item; quantity; suffix?: string }[]): string` — `"<name>[ xN][suffix]"` joined by `", "`.
  `suffix` lets the web keep its `" [Only Days]"` marker.
- `buildCatalogSalePayload(input): CreateFinancialServicePayload`
  - `input`: `{ provider: "Katsh" | "iPick"; lines: { item: { category; label; subcategory?; cost_lbp; sell_lbp };
    quantity }[]; paidByMethod: string; payments: { method; currencyCode: "LBP" | "USD"; amount }[];
    tenderExchangeRate?: number; client?: { id?: number | null; name?: string } }`
  - returns the walk-in cart payload of data-model.md § Booked sale. Throws on an empty cart or a quantity < 1.
- `usdForLbp(lbp: number, rate: number): number` — the tender conversion, rounded as the web rounds (verified while
  writing the builder).

`packages/core/src/utils/exchangeRates.ts`

- `getExchangeRates(rates: unknown[], fallbackRate?): { buyRate; sellRate }` — moved from
  `frontend/src/utils/exchangeRates.ts`; the web re-exports it. The phone calls it WITHOUT a fallback and treats a
  missing LBP row as "no rate" (USD disabled).

## Phone routes

| Path                        | Screen                                        |
| --------------------------- | --------------------------------------------- |
| `/sell/catalog/[provider]`  | catalog + cart + client + payment + Save       |

`[provider]` ∈ `Katsh | iPick`. The Sell tab tiles for Katsh and iPick open it (they say "Coming next" today).

## Cache keys (mobile, LIRA-300)

- `catalog(shop)` — all active items (one read, filtered per provider in the screen).
- `rates(shop)` — the rates rows.
- After a successful save: `invalidateAfter(shop, { kind: "sale", paidBy, clientId })` (renamed from `"transfer"`).
