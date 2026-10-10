# UI contract: phone navigation and cache API (LIRA-300)

The only interfaces this feature defines are inside `mobile/`. No REST, IPC or schema contract changes; the reads and
writes listed in [data-model.md](../data-model.md) are used exactly as LIRA-289 defined them
(`specs/289-mobile-after-hours-sales/contracts/`).

## Routes

| Path               | Screen                       | Was (LIRA-289)        | Tab bar visible |
| ------------------ | ---------------------------- | --------------------- | --------------- |
| `/`                | Home                         | `/`                   | yes             |
| `/sell`            | Sell (sale tiles)            | tiles on `/`          | yes             |
| `/sell/[provider]` | Transfer form                | `/sale/[provider]`    | yes             |
| `/debts`           | Debtor list                  | `/debts`              | yes             |
| `/debts/[id]`      | Customer page + repayment    | `/client/[id]`        | yes             |
| `/activity`        | Latest transactions          | section on `/`        | yes             |
| `/settings`        | Appearance, sign out, delete | `/settings` (pushed)  | yes             |

`[provider]` stays `WHISH_APP | OMT_APP`; `/debts/[id]` keeps its `name` and `phone` params. Signed-out routes
(`(auth)`) have no tab bar.

## Cache module (`mobile/src/data/`)

- `queryClient` — the one `QueryClient` (staleTime 30 s, gcTime 10 min, retry per research R6).
- `queryKeys` — `balances(shop)`, `sinceLastCount(shop, drawers)`, `recent(shop, limit)`, `debtors(shop)`,
  `clientBalance(shop, clientId)`. Every key starts with `shop`.
- `keysToInvalidate(action)` — pure; `action` is
  `{ kind: "transfer", paidBy: "CUSTOMER_ACCOUNT" | "WHISH" | "OMT", clientId }`
  or `{ kind: "repayment", clientId }`. Returns the keys from the data-model invalidation map.
- `invalidateAfter(action)` — calls `queryClient.invalidateQueries` for each key.
- `resetCache()` — `cancelQueries()` then `clear()`; called by `signOut()` and the 401 handler before
  `setStatus("signedOut")`.
- `useRefreshOnFocus(refetch, isStale)` — on screen focus after the first, refetch when stale.
- `unwrap(result)` — turns an `ApiResult` with `success: false` into a thrown error carrying the code, for query
  functions.
