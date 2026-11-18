# Research — LIRA-396

## 1. Katsh / iPick "Only Days": what the stored figures mean

**Decision**: fix the Profits drill-down's cost column for Only Days rows by reading it, not by changing the stored data. The column shows `cost = revenue − stamped profit` for rows that posted a `CREDIT_RETURN` leg. `financial_services.cost` stays gross, and there is no migration.

**Trace (source-verified 2026-11-18):**

| Step | Where | What it does |
|---|---|---|
| 1 | `frontend/src/features/recharge/components/KatshForm.tsx` about lines 1598–1660 | Builds cart lines: `cost_lbp = calcCost(item)` (catalog GROSS cost) and `sell_lbp` = the Only Days price (`resolveOnlyDaysPricing`). It also sends `telecomCreditReturns[]`, one entry per physical unit, so quantity > 1 is expanded. |
| 2 | `packages/core/src/utils/catalogSale.ts` `buildCatalogSalePayload` | `amount = price = Σ sell × qty`, `cost = Σ cost × qty` (gross), `commission = max(0, price − cost)`. The server recomputes it. |
| 3 | `FinancialServiceRepository.ts` about lines 2320–2426 | `resolveTelecomCreditReturns` gives the credits returned (USD). They are valued at R = `system_settings.telecom_credit_cost_rate_lbp` (fallback `TELECOM_CREDIT_COST_RATE_LBP`): `telecomCreditReturnCredit = telecomCreditReturnValueLbp(credits, R)`. Then **`commission = price − cost + telecomCreditReturnCredit`**. The comment states: "`cost`, the drawer leg and the supplier payable are all untouched by this: only the margin moves." |
| 4 | same file, about lines 4044/4228 | Provider-drawer leg `-Math.abs(cost)`: the Katsh drawer pays the GROSS card. |
| 5 | same file, `processTelecomCreditReturn` (about line 3780) | Writes a `CREDIT_RETURN` payment leg (+credits USD to the Alfa/MTC drawer) and an `ONLY_DAYS_RETURN` carrier-line movement on the shop's primary line, tied to this transaction. |
| 6 | Profit stamp | `transactions.profit_lbp` = the commission from step 3. |

Check: FS #1896 has price 300,000, cost 765,007 and profit 44,993. `profit − (price − cost) = 44,993 + 465,007 = 510,000 LBP` = credit value, which is ≈ 6 credits × 85,000 (R). (Assumption, unverified: the exact credit count; it is consistent with R = 85,000.)

**Readers of the stored gross `cost`** (all would break or mislead if it were stored net):

- `SUPPLIER_OWED_EXPR` / `grossOwedDelta`: the `service_type='SEND' AND cost > 0` branches. Today only legacy `supplier_debt_booked = 1` rows owe `cost`, but a net `cost` of 0 would fall to `ELSE ABS(amount)`, a phantom payable.
- `getSaleCostSettleColumns` (`cost AS amount`) → `getAllByProvider` (Suppliers → Transactions tab, recharge `HistoryModal`) and `getFifoPrefixByProvider` (the FIFO payment walk). Settle-by-day coverage (`SupplierRepository` about lines 1688–1723) reads `|amount|` of these rows. Likely, based on the projection: storing net cost would shift what a Katsh settlement appears to cover.
- `_providerHistoryUnion`'s `cost > 0` branch selector, the edit path's `useCostPriceFlow: (e.cost ?? 0) > 0` summary rebuild, and the `transactions.metadata_json.cost` copy (a rule 31 second copy).

**Double-count check (spec STOP condition)**: not triggered.

- The credit value enters profit once, in this row's commission.
- `CREDIT_RETURN` is in `TransactionRepository.INTERNAL_LEG_METHODS`, so it is excluded from the by-payment-method profit view (ProfitRepository about line 3474) and is not revenue anywhere.
- The `ONLY_DAYS_RETURN` carrier movement is informational (CarrierLineService: "no drawer legs").
- Resale: a later credit transfer/recharge out of the shop line is costed at `alfa_credit_cost_lbp` (RechargeRepository about lines 418–478). The asset is consumed at a cost, so it is not counted a second time as free income.

**Rationale**: the owner's "price − cost = profit" check is a Profits-page reading, and the spec's acceptance check (#2220 reads cost 1,755,030) is met exactly by `price − profit`. Storing net cost would contradict a documented design decision (LIRA-153 / D2.1) and the supplier views, which the spec says must not be touched ("Supplier-ledger and drawer legs are NOT touched").

**Alternatives considered**:

- (A) Store net cost on the write path plus a backfill migration (the spec's FR-001). Rejected because the supplier history and FIFO read `cost` as "what the provider drawer paid", and of the branch-flip risk at net cost 0.
- (B) Identify Only Days rows by the note suffix " [Only Days]" or `catalogItems[].onlyDays`. Rejected: the note is free text, and `catalogItems` only exists since LIRA-329. The `CREDIT_RETURN` leg is the one writer-owned marker for every row since LIRA-090.
- (C) A correlated `EXISTS` on `payments`. Rejected: `payments` has no `transaction_id` index, so it would scan per row. One pre-aggregated derived table, joined once, is used instead.

## 2. Detail wording sources

**Decision**: `transactions.summary` is the module's own wording (each writer builds it):

- FS: `buildFinancialServiceSummary`;
- Maintenance: device + issue, MaintenanceRepository about line 934;
- Custom service: the note text;
- Loto: the ticket sale summary.

Detail chains:

| Module | Detail |
|---|---|
| FS transfer | `COALESCE(NULLIF(TRIM(t.summary),''), fs.service_type)` |
| FS allocation | the same summary through the transfer's transaction, then the service appends " — commission at settlement" (replacing "(settlement allocation)", as the spec wording asks) |
| Maintenance | `device_name` → summary (which carries the issue) → `'Repair job #' || id` |
| Custom | `description` → summary → `'Custom service #' || id` |
| Loto | `Ticket <n>` when a number is set → summary → "Loto ticket" |

**Alternative rejected**: the `category` column for custom services (spec: "service name/category"). The summary already names the service, and the reconciliation fixture schema has no `category` column. Logged as a decision.

## 3. Zero rows

**Decision**: the service skips a KEPT_CHANGE row whose `profit_usd === 0 && profit_lbp === 0`, using the same `isRealMoney` predicate that already classified it as not counted. It does the same for a TOPUP_BUYBACK row (its `amount_*` are always 0 in this drill-down). Because only rows that were contributing 0 are dropped, Σ counted still equals the module row.

TOPUP_BUYBACK counterpart: `COALESCE(NULLIF(r.client_name,''), t.client_name)`. `topUpFromClient` writes the client to the transaction but not to the `recharges` row; phone is handled the same way.
