# Contract — mobile service items (create / update / seed / read)

Transports: IPC `mobile-service-items:{create,update,seed,get-all,get-all-admin}` and REST `/api/mobile-service-items` (`POST /`, `PUT /:id`, `POST /seed`, `GET /`, `GET /admin`). Both validate with the **same core schemas** in `packages/core/src/validators/mobileServiceItem.ts`; envelope `{ success, data?, error? }`, REST HTTP 200 on failure. Roles unchanged.

## Schema changes (additive, optional)

```ts
// mobileServiceItemCreateSchema  (seed schema = z.array(create) follows automatically)
cost_usd: z.number().nonnegative().nullable().optional(),
sell_usd: z.number().nonnegative().nullable().optional(),

// mobileServiceItemUpdateSchema
cost_usd: z.number().nonnegative().nullable().optional(),   // null clears
sell_usd: z.number().nonnegative().nullable().optional(),
```

Three-way key diff (rule 23) must be redone for create, update and seed: schema ↔ `preload.ts` types ↔ `electron.d.ts` types ↔ repository columns. Adapter payload types stay `z.input` of these schemas (rule 21).

## Read shape

`MobileServiceItemEntity` (repository, `backendApi.ts`, `packages/ui/src/api/types.ts`) gains `cost_usd: number | null`, `sell_usd: number | null`. Extra fields are harmless to the mobile app (`CatalogRow` ignores them).

## Sale payload (unchanged contract, new values)

`createFinancialServiceSchema` already accepts `currency`, `cost`, `amount`, `checkoutTotal {usd, lbp}`, `extra_usd`, `partnerId`, session `_batch` items. USD mode sends:

| field | LBP mode (today) | USD mode |
|---|---|---|
| `currency` | `"LBP"` | `"USD"` |
| `amount` / `cost` | LBP sell / LBP cost | `sell_usd` / `cost_usd` (2 decimals) |
| `checkoutTotal` | `{ usd: 0, lbp: total }` | `{ usd: total, lbp: 0 }` |
| extra | `extra_lbp` | `extra_usd` |
| For Partner | `currency: "LBP"` | `currency: "USD"` |
| session cart entry + sub-items | `currency: "LBP"` | `currency: "USD"` |
