# Contract: cash drawer choice on repayment / supplier settle payloads

One optional key per write schema, shared by IPC and REST (rules 14, 19). The adapter types derive from the schema (`z.input`, rule 21). They already do for `AddRepaymentPayload`, `SupplierSettleInput`, `SupplierCashflowPayload` and `SupplierSettleAccountPayload`.

| Operation | Schema (`packages/core/src/validators/`) | New key | IPC channel | REST route |
|---|---|---|---|---|
| Debt repayment | `debt.ts` `addRepaymentSchema` | `cashDrawer?: "SYSTEM" \| "GENERAL"` | `debt:add-repayment` (`electron-app/handlers/debtHandlers.ts:109`) | `POST /api/debts/repayments` (`backend/src/api/debts.ts:153`) |
| Batch settle | `supplier.ts` `supplierSettleSchema` | `cash_drawer?: …` | `suppliers:settle-transactions` (`supplierHandlers.ts:305`) | `POST /api/suppliers/:id/settle` (`suppliers.ts:652`) |
| Settle Account (both shapes) | `supplier.ts` `supplierSettleAccountBaseSchema` (carried to `.shape`) | `cash_drawer?: …` | `suppliers:settle-account` (`:334`) | `POST /api/suppliers/:id/settle-account` (`:697`) |
| Pay / Receive | `supplier.ts` `supplierCashflowSchema` | `cash_drawer?: …` | `suppliers:record-cashflow` (`:467`) | `POST /api/suppliers/:id/cashflow` (`:778`) |

## Forwarding chain (rule 23: every link must carry the key)

- **Debts:** schema → `RepaymentData` (handler, `debtHandlers.ts:30`) → `RepaymentData` (service, `DebtService.ts:37`; the destructure at `:232` and the rebuild at `:307` **drop unknown keys**, so they must forward `cash_drawer: cashDrawer`) → `CreateRepaymentData.cash_drawer` (`DebtRepository.ts:294`). The REST route spreads `req.body` into the same service.
- **Suppliers:** schema → handler `{...v.data}` / route `{...req.body}` → service pass-through (`SupplierService.ts:280/307/430`) → `SettleTransactionsData` / `SettleAccountData` (inherited by `SettleAccountRequest`) / `SupplierCashflowData` `.cash_drawer` → `drawerCtx.cashDrawer`.
- **Hand-written preload types to extend (rule 12):** `electron-app/preload.ts:433` (`addRepayment`), `:811` (`settleTransactions`), plus `frontend/src/types/electron.d.ts:1427`. `settleAccount` and `recordCashflow` are already typed from the schema.

## Envelope

Unchanged: `{ success, id? , error? }`, and HTTP 200 on refusal for supplier routes. The debts route keeps its existing 400-on-failure behaviour (`debts.ts:195`). That predates this ticket and is out of scope.

## Refusal texts (shop-owner language)

- Not applicable: "The drawer choice only applies when cash pays an OMT system transfer. Nothing to choose here." The text uses "Whish" on a Whish shop.
- Bad value: Zod enum message (unchanged mechanism).
