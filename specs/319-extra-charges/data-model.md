# Data model: Extra charges (LIRA-319)

## `transactions` (existing table, two new columns — migration v212)

| Column | Type | Rule |
| --- | --- | --- |
| `extra_usd` | REAL NOT NULL DEFAULT 0 | USD extra the customer was charged on this row. ≥ 0 on a sale/service row, ≤ 0 on a REFUND / REFUND_UNDO row (negated share), 0 everywhere else. |
| `extra_lbp` | REAL NOT NULL DEFAULT 0 | Same, LBP. |

- Migration v212 adds both columns with `DEFAULT 0` (every existing row reads 0); `down()` drops them. `electron-app/create_db.sql` gets the same columns and the v212 marker (check that v208–v211 markers are present first).
- **Invariants**
  - `amount_usd/lbp` of a sale/service row = what it charged before (unchanged formulas) **+ extra**, per currency.
  - `profit_usd/lbp` never includes the extra.
  - A row has an extra **or** a discount, never both (enforced in the schemas, R4).
  - For any sale/service row, `extra + Σ(extra of its REFUND rows)` ≥ 0, and = 0 after a full refund.
- **No change** to `sales`, `maintenance`, `custom_services`, `loto`, `recharges`, `financial_services` tables: their price / discount / fee columns keep their meaning (item / service price). The extra lives only on the transaction.

## Rows that carry an extra

| Row type | Written by | `extra_*` |
| --- | --- | --- |
| SALE | `SalesRepository.processSale` | the sale's extra |
| MAINTENANCE | `MaintenanceRepository.processPayments` | the job's extra |
| CUSTOM_SERVICE | `CustomServiceRepository` add | the extra |
| LOTO | `LotoTicketRepository` sell | the extra |
| RECHARGE | `RechargeRepository.processRecharge` | the extra |
| FINANCIAL_SERVICE (SEND, cart, crypto send, app transfer) | `FinancialServiceRepository` | the extra |
| EXTRA_CHARGE (new type) | `SessionCheckoutService` — one per basket with an extra | amount = extra, profit 0, extra = extra |
| REFUND / REFUND_UNDO | `TransactionRepository._createRefundRow`, `SalesRepository.refundSaleItem` / `undoSaleItemRefund`, session refund / undo | negated full extra or negated share |

`EXTRA_CHARGE` is a no-money posting type like `KEPT_CHANGE` (`constants/postingRules.ts:1312`): the basket's payment legs carry the money.

## Write payloads (shared Zod schemas)

Optional on each: `extra_usd?: number (≥ 0)`, `extra_lbp?: number (≥ 0)` — **no `.default()`** (offline replay, R4). Refinements, each with a plain-sentence message:

- extra > 0 and discount > 0 on the same payload → refused ("A sale can have a discount or an extra, not both.").
- extra > 0 with `partnerMode: "FOR"` / for-partner → refused.
- extra > 0 with `deferPayment` (session basket item) → refused server-side ("Add the extra at the session checkout.").
- extra above the pre-extra total → refused ("The extra can't be more than the sale itself.").

Schemas touched: `validators/sale.ts` (`saleProcessSchema`), `maintenance.ts` (`saveMaintenanceJobSchema`), `customService.ts`, `loto.ts` (`lotoSellSchema`), `recharge.ts` (`createRechargeSchema`), `financial.ts` (`createFinancialServiceSchema`), `session.ts` (`sessionCheckoutSchema`).

## Reporting shape

`ProfitByModule` gains a row with `module: "EXTRA_CHARGE"`, `label: "Extra charges"`, `revenue_usd/lbp = profit_usd/lbp = Σ extra_*`, `cost_* = 0`, `count` = rows with a non-zero extra. `ProfitSummary` gains `extra_charges: { usd, lbp }` folded into the gross total. One SQL fragment `EXTRA_CHARGE_PROFIT_USD/LBP` (R2) is the only definition of "extra counts as profit".

## Lifecycle

```
sale with extra ──void──────────────► original VOIDED (leaves profit queries); payments reversed
     │
     ├──full refund──────────────────► REFUND row: amount −(price+extra), extra −extra
     │
     └──item refund (share s)────────► REFUND row: amount −(item+extra·s), extra −extra·s
                └──undo────────────── REFUND_UNDO row: extra +extra·s
```
