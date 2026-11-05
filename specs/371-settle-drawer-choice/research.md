# Research: LIRA-371 — choose the cash drawer when settling main-system items

Read from the code on 2026-11-05 (main @ `2aeb43de`); re-checked at `414ce0da` (LIRA-373), which changed only `TransactionRepository.ts`, `constants/transactionTypes.ts` and the refund modal. Line numbers in `DebtRepository.ts`, `SupplierRepository.ts`, `utils/payments.ts`, `Debts/index.tsx`, `AccountSettleSheet.tsx` and `Suppliers/index.tsx` are unchanged; `TransactionRepository.ts` numbers below are as of `414ce0da`.

## R1. Where the system cash drawer is chosen today

**Debts (Repay, item picker and calendar — one modal, one submit: `Debts/index.tsx:1327` `api.addRepayment`).**

- `DebtRepository.addRepayment` posts every IN leg to its method's own drawer (`paymentMethodToDrawerName`, `DebtRepository.ts:1137-1152`, so CASH → General).
- It then moves the routed share General → system cash drawer as an internal `RESERVE` pair (`DebtRepository.ts:1153-1192`).
- The routed share comes from `allocateRepayment` (`utils/debtRepaymentAllocation.ts:175`), called at `DebtRepository.ts:1121`. Its `cashUsd/cashLbp` come from `isRoutableCash` (`:1063-1069`), which is `resolveServiceCashDrawer(...) === pcdDrawer`.
- The record goes to `_recordRepaymentCoverage(..., { routed: {provider, drawer, by_transfer, legs} })` (`:1238-1259`).
- Change (OUT) legs are debited from their method's drawer, always General for cash (`:1196-1226`). The default never routes change.
- The page's "Goes to" preview (`Debts/index.tsx:1045-1126`, testid `repay-goes-to` at `:3273`) calls the **same** `allocateRepayment` (rule 14). It returns `null` (no box) when nothing is routed and no change goes to the account (`:1093`).

**Suppliers.** Every cash leg goes through `resolveServiceCashDrawer(method, drawerCtx)` (`utils/payments.ts:205`). `drawerCtx = { provider: supplier.provider, baseSystem }` is built once per entry point:

| Entry point | ctx built | leg loop |
|---|---|---|
| `settleTransactions` (batch Settle) | `SupplierRepository.ts:4580` | `:4911`; commission legs via `_bookCommissionAtSettlement` → `_bookBillsCommissionViaPaymentLegs` `:5630` |
| `settleAccount`, legacy whole-row | `:6588` | `:6912` (+ step F commission, same ctx) |
| `_settleAccountAmountFirst` (Settle Account sheet) | `:7134` | `:7683` |
| `recordSupplierCashflow` (Pay / Receive) | `:8853` | `:8999` |

The resolver returns `primaryCashDrawerName(baseSystem)` (`constants/systemFloatDrawers.ts:33`) only when `provider === baseSystem` and the method is a General-bound, drawer-affecting, non-gift-card method. In every other case it falls through to `paymentMethodToDrawerName`.

## R2. Which Supplier screens can actually reach a main-system supplier (finding)

- `settlesByDay` (`utils/settlesByDay.ts:34`) is true for every OMT-account member, and for WHISH when active.
- On the Suppliers page, the Pay / Receive tab is rendered only when `!isSettleByDay` (`Suppliers/index.tsx:3098`).
- The batch "Settle" tab is rendered only when `!isAccountMember && (!isSettleByDay || billsOnlyTickList)` (`:1229-1230`).

Consequences:

| Shop | Supplier | Settle Account sheet | Batch Settle | Pay / Receive |
|---|---|---|---|---|
| OMT main | OMT account | **yes** | hidden | hidden |
| WHISH main | Whish (active) | **yes** | **bills only** (`OTHER_PAYMENT` cash commission legs → `Whish_System`) | hidden |
| WHISH main | Whish (inactive) | no | yes | yes |

So spec US2 scenario 4 ("OMT's batch Settle and Pay / Receive") names screens an OMT shop cannot open today.

**Decision:** The server accepts the choice on all four entry points: one resolver change covers them, and old or REST callers can still reach them. The UI shows the control on every reachable surface where FR-002 applies. On an OMT shop that means the Settle Account sheet only. The batch Settle and Pay / Receive controls are still built, gated by the same predicate, so a Whish-main shop (bills commission, inactive Whish) gets them. The owner confirmed this on 2026-11-05 (spec Clarifications, post-planning session): no OMT batch Settle or Pay / Receive is added on an OMT-main shop.

## R3. Supplier design — one field on the resolver context

- **Decision:** Add `cashDrawer?: CashDrawerChoice` to `ServiceCashDrawerContext` (`utils/payments.ts:171`). `resolveServiceCashDrawer` returns `paymentMethodToDrawerName(method)` when `ctx.cashDrawer === "GENERAL"`. Each of the four supplier entry points copies `data.cash_drawer` into the `drawerCtx` it already builds.
- **Rationale:** One edit, and every supplier leg follows it: net-pay legs, change legs, and `OTHER_PAYMENT` commission legs. FinancialServiceRepository, TransactionRepository (refund override) and DebtRepository never set the field, so they stay byte-identical (FR-006, SC-001).
- **Alternatives rejected:** (a) A per-call-site `if (choice) drawer = "General"`. That makes 5 copies of one rule (rule 14). (b) Repointing `payment_methods.CASH`. That is blocked by design (see the resolver doc).

## R4. Debts design — skip the RESERVE move, keep the coverage

- **Decision:** `allocateRepayment` runs exactly as today. When `cash_drawer === "GENERAL"`, the RESERVE loop (`DebtRepository.ts:1153-1192`) is skipped. The coverage record keeps `routed` with `by_transfer: []`, `legs: []`, plus `cash_drawer: "GENERAL"` for the record.
- **Rationale:** Coverage (what the debt pays) is computed independently of routing. The routing only decides the internal RESERVE pair. Skipping the pair leaves all IN legs in General, and debt, coverage, profit and ledger stay identical (FR-005).
- **Consequence:** A General repayment consumes none of a transfer's routing cap (`_readRoutedByTransfer` reads only real routed records, `DebtRepository.ts:1765+`). A later default repayment can therefore still route up to the transfer's amount. This matches the owner's "OMT drawer first" rule: the OMT drawer never received that cash. The owner confirmed it on 2026-11-05 ("OMT drawer first", unchanged). If the owner wants otherwise, the change is local: record a "virtual routed" amount.
- **Change legs:** Today change on Debts already leaves General. The owner confirmed (2026-11-05) that Debts change keeps today's behaviour: it always leaves General, whatever the choice. The spec edge case now says so. On Suppliers, change legs go through the resolver and follow the choice.

## R5. Applicability (FR-007) — one predicate per surface, shared by screen and server

- **Debts:** The choice applies iff the **default** allocation routes > 0 (`routedUsd > 0 || routedLbp > 0`). The page already computes that allocation for the preview, and the server computes it before posting. One function decides both sides (rule 14). The server refuses `GENERAL` when the default routing is 0. Message: "The drawer choice only applies when cash pays an OMT system transfer. Nothing to choose here." The message uses the Whish wording on a Whish shop.
- **Suppliers:** The choice applies iff `provider === baseSystem` and at least one leg would resolve to the system cash drawer by default. This is a new pure leaf, `systemCashDrawerChoiceApplies({ provider, baseSystem, legs, isGeneralCash })`, in `constants/cashDrawerChoice.ts` (browser-safe, rule 29). The server passes a cash test built from `resolveServiceCashDrawer`. The sheet passes the method list's `drawer_name === "General" && affects_drawer === 1`, the same test the Debts preview uses (`Debts/index.tsx:1053`). The server refuses `GENERAL` when the predicate is false.
- **`SYSTEM` sent where it does not apply:** Accepted as a no-op, identical to absent (FR-008). Refusing it would add a refusal path with zero money effect, and would break the single payload builder whenever a preview went stale.
- **Partners:** Partner schemas get no key, so a stray `cash_drawer` is stripped by Zod and has no effect (FR-006). No partner code changes.

## R6. Reversal (FR-009, rule 20)

- Void runs `_reversePayments` (`TransactionRepository.ts:9749`, with LIRA-373 applied). It mirrors every stored `payments` row on its stored `drawer_name`, including the RESERVE pair. A General payment therefore reverses out of General with **no code change**. Tests still prove that create + void nets to 0 per drawer per currency.
- Debts: `_restoreRepaymentDebt` (called at `TransactionRepository.ts:6366`) gives back coverage from the coverage record. It is untouched, because the coverage is identical.
- Refund with a method override on a debt repayment: the IN CASH leg is overridable and its replacement resolves via `paymentMethodToDrawerName` → General (no FS context, `:9800`). That is correct for a General repayment.
- **Supplier settlement refunds (LIRA-373, committed as `414ce0da`):** `SETTLEMENT_TRANSACTION_TYPES` (SUPPLIER_SETTLEMENT, PARTNER_SETTLEMENT; `constants/transactionTypes.ts:889`) refuse a `refundLegs` override before any write (`TransactionRepository.ts:6771-6773`). So a General settlement can only be refunded exactly, and it reverses from General.
- **DEBT_REPAYMENT and SUPPLIER_PAYMENT (Pay / Receive) keep the override.** Its CASH replacement resolves to General, which is right for a General payment.

## R7. No migration

The choice lives in `payments.drawer_name`, which already exists per leg. That column is already what the transaction details and the payment lines show (FR-010). On Debts, the coverage record also gets `routed.cash_drawer: "GENERAL"`, so an empty `routed` reads as a choice rather than "no transfer". Suppliers need no stamp: the legs' `drawer_name` already says it. No table, no column, no `create_db.sql` change.

## R8. Naming

- Values: `"SYSTEM" | "GENERAL"`. The schema stays the same on a Whish shop. The label is resolved on screen: "OMT Cash Drawer" / "Whish Cash Drawer" (existing i18n keys `repay.omtCashDrawer` / `repay.whishCashDrawer`).
- Key: `cashDrawer` in `addRepaymentSchema` (that schema is camelCase), `cash_drawer` in the supplier schemas (snake_case). Not `drawer_name`: `supplierSettleSchema.drawer_name` already exists, is deprecated and ignored (`validators/supplier.ts:161-166`), and reusing it would revive a dead contract.
- Schema field is `.optional()`, never `.default()` (rule 22: a defaulted drifted field corrupts silently).

## R9. Parallel work

- LIRA-372 (settle discount line) is being planned at the same time. It is likely to touch `AccountSettleSheet.tsx` and the settle schemas.
- Implementation of the second ticket must rebase onto the first. The plan keeps this ticket's sheet edit to one new prop, one control near the payment box, and one payload key.
- e2e number: `lira-web-092` is the next free number (last existing: `lira-web-091`). LIRA-372's plan uses `lira-web-093-settle-discount` and `whats-new/1.35.0/settle-discount.png`, so there is no clash.
