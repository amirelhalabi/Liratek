# Contract: calendar reads (LIRA-343)

Both are reads. Both transports call the same `SupplierService` method (rule 19), and both return the raw shape (reads return raw objects, not envelopes; see CLAUDE.md "Adapter").

## 1. Month rows

Feeds the calendar grid for one month.

| | |
| --- | --- |
| Service | `SupplierService.getAccountMonthRows(accountSupplierId, month: "YYYY-MM")` |
| Repository | `SupplierRepository.getAccountRows(accountId, { fromUtc, toUtc })` (range mode): the same builder as `getAccountUnsettled` (research R3). The service turns `month` into a UTC window of month ± 1 day; rows are then kept where `shop_day` starts with `month`. |
| IPC | `suppliers:account-month-rows`, args `(accountSupplierId, month)`. Same gate as `suppliers:account-unsettled`. |
| REST | `GET /api/suppliers/:id/account-month-rows?month=YYYY-MM` with `requireAuth`, the same gate as `account-unsettled`. Returns `{ success: true, rows }`. |
| Adapter | `getSupplierAccountMonthRows(accountSupplierId, month)` in `backendApi.ts` (`ipcOrHttp`), `ElectronApiAdapter.ts` and `ApiAdapter`. |
| Validation | `month` matches `/^\d{4}-(0[1-9]|1[0-2])$/`. The schema lives in `validators/supplier.ts` and is shared by both transports. |
| Time zone | `shop_day` uses `localDayExpr`. On web the offset comes from the existing `X-Client-Tz-Offset` header (`httpClient.ts` ~:260, `auth.ts` ~:339), so nothing is added to the request. |

**Row shape**: `AccountUnsettledRow` (core and `packages/ui` mirror) plus `shop_day: string`, `source_ref_table: string | null`, `row_scope: "DAY" | "ACCOUNT"` and `transaction_id: number | null` (the unified id, for the R7 tag). Closed rows are included with `remaining_* = 0`.

## 2. Open queue (existing, extended)

`getAccountUnsettled` / `suppliers:account-unsettled` / `GET /api/suppliers/:id/account-unsettled` keep their path and envelope. Each row gains the same four fields as above. This queue drives:

- the default selection;
- the "N unselected days in <Month>" link;
- the `selections` payload;
- the OMT credit line (rows with `row_scope = 'ACCOUNT'`, either sign).

The default selection and the older-month link go through `buildSettleDays`, which ignores account rows.

## 3. Day details

| | |
| --- | --- |
| Service | `SupplierService.getAccountDayDetail(accountSupplierId, shopDay: "YYYY-MM-DD")` |
| IPC | `suppliers:account-day-detail`, args `(accountSupplierId, shopDay)` |
| REST | `GET /api/suppliers/:id/account-day-detail?day=YYYY-MM-DD`; returns `{ success: true, rows }` |
| Response row | Month-row shape, plus `settlements: Array<{ transaction_id, settled_at, currency, amount, source }>` (active coverage only), `added_after_settlement: boolean` (R7) and `waiting_for_statement: boolean` (R9, computed on the client from the chosen types). |

## Shared pure functions (core, browser-safe)

- `buildSettleDays(rows, { today, month })` lives in `utils/settleDays.ts` and is generic (see data-model.md). It never imports `requestDay.ts`; the `browserEntryIsNodeFree` guard test covers it.
- `isAccountCredit(row)` / `creditKindOf(row)` is the ONE classification, used by the repository (SQL twin named next to it) and by tests.
- `buildDaySelections(openRows, pickedDays, untickedRows, coveredTypes)` returns `{ selections, expected_owed, account_credit }` and is the ONE payload builder (rule 22).
