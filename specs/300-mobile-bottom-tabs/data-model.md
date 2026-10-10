# Data model: Phone app bottom tabs (LIRA-300)

No database, schema or server change. The "data" of this feature is what the phone keeps in memory between
pages: one cache entry per read, named by a query key.

## Kept page data (query cache entries)

Every key starts with `shop` = the signed-in shop slug (research R8), so two shops can never share an entry.

| Key                                         | Read (existing, `mobile/src/api/`)          | Used by                    |
| ------------------------------------------- | ------------------------------------------- | -------------------------- |
| `[shop, "balances"]`                        | `getDrawerBalances()`                       | Home                       |
| `[shop, "sinceLastCount", drawers]`         | `getSinceLastCount(WALLET_DRAWERS)`         | Home                       |
| `[shop, "recent", limit]`                   | `getRecentTransactions(limit)`              | Activity                   |
| `[shop, "debtors"]`                         | `getDebtors()`                              | Debts                      |
| `[shop, "clientBalance", clientId]`         | `getClientBalance(clientId)`                | Debts › customer page      |

Not cached: the client search on the transfer form (`searchClients`), which runs as the owner types and is
throw-away by nature.

**Rules**

- Fresh for 30 s (`staleTime`, FR-009); a stale entry is refetched when its screen gains focus or the app returns to
  the foreground (research R5). Kept in memory for 10 min after its last screen unmounts (`gcTime`).
- Lives in memory only; nothing is written to the phone's disk (spec assumption).
- A failed refetch keeps the previous data; the screen shows a short "Could not refresh" notice (FR-010).
- Cleared entirely, after cancelling in-flight reads, on sign-out and on a 401 (FR-013, research R8).

## Invalidation map

After a money action returns `success`, the screen calls `invalidateAfter(action)`. "Invalidate" marks an entry stale;
an entry whose screen is mounted refetches at once, the rest refetch when next shown.

| Action (unchanged submit function)                          | Invalidates                                                                  |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Transfer paid into a wallet (`recordServiceSale`, WHISH/OMT) | `balances`, `sinceLastCount`, `recent`                                       |
| Transfer on the customer's account (`CUSTOMER_ACCOUNT`)     | `balances`, `sinceLastCount`, `recent`, `debtors`, `clientBalance(clientId)` |
| Repayment (`recordRepayment`)                               | `balances`, `sinceLastCount`, `recent`, `debtors`, `clientBalance(clientId)` |
| New client (`createClient`)                                 | nothing (no cached read lists clients)                                       |

The map is a pure function, `keysToInvalidate(action) → QueryKey[]`, so it can be unit-tested without React.

## Tabs

| Tab      | Route (Expo Router, under `(app)`) | Icon (lucide)   | Reads on first open             | Detail pages            |
| -------- | ---------------------------------- | --------------- | ------------------------------- | ----------------------- |
| Home     | `index`                            | `House`         | balances, sinceLastCount        | —                       |
| Sell     | `sell/index`                       | `Send`          | none                            | `sell/[provider]`       |
| Debts    | `debts/index`                      | `Users`         | debtors                         | `debts/[id]`            |
| Activity | `activity`                         | `History`       | recent                          | —                       |
| Settings | `settings`                         | `Settings`      | none                            | —                       |

State transitions of a tab: not yet opened, then mounted (first open fetches), then focused or blurred. A tab never
unmounts while signed in; sign-out unmounts all of them.
