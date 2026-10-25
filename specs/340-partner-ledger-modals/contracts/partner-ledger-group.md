# Contract: partner ledger `group` filter

Both transports return the existing statement `{ partner, balance, breakdown, entries }`.

- **IPC** `partners:get-ledger(partnerId, filters?: LedgerFilters)` — `filters.group` passed through unchanged.
- **REST** `GET /api/partners/:id/ledger?group=transactions|payments&...` — any other value is ignored (no filter), matching how `mode`/`direction` are parsed.
- **Adapter** `partnersGetLedger(partnerId, filters?: LedgerFilters)` — type imported from `@liratek/core` (browser.ts), sets `group` in the query string.

Invariant (SC-001): for the same partner and dates, `count(group=transactions) + count(group=payments) = count(no group)`.
