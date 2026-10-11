# Research: Phone Lines Management (LIRA-309)

Phase 0 output. Three read-only code scouts ran on 2026-10-11. Every
decision below cites the code it rests on. Paths are repo-relative. RR =
`packages/core/src/repositories/RechargeRepository.ts`, CLR =
`CarrierLineRepository.ts`, FSR = `FinancialServiceRepository.ts`.

---

## R1. Where for-sale line expiry and credit live

**Decision**: a new child table `resale_lines`, keyed one-to-one on
`products.id`. It holds carrier, credits and `validity_expires_at`. It is
never stored in `carrier_lines`. The **number is not copied**: it is the
product's `barcode`, which LIRA-207 already stores normalised for a lines
category (`InventoryService` create/update). A second copy would drift when
the barcode is edited (rule 14).

**Rationale**: `carrier_lines` drives at least five shop-only totals:
- the drawer sum `getCarrierCreditsSum` (CLR:466), used by checkpoints
  (ClosingRepository.ts:561, :727) and the buy-back drawer reset (RR:2062);
- the active lists `getActiveByCarrier`/`getAllActive` (CLR:448, :477), used
  by shop-line detection, checkpoint counts and `daily_closing_carrier_lines`;
- primary selection `getPrimary` (CLR:901), which DAYS, credit, buy-back and
  self-charge debit from;
- the setup wizard;
- Reset Data.

A purpose column on `carrier_lines` would need a filter in every one of
those queries, and one missed filter puts for-sale credit into the MTC/Alfa
drawer (FR-019). A separate table cannot leak by omission.
`product_units` (create_db.sql:599, `ProductUnitRepository`,
`productUnitHandlers.ts`, `backend/src/api/productUnits.ts`) is the
existing full-stack template for a product child table.

**Alternatives rejected**: `carrier_lines.purpose`, for the leak risk above.
Columns on `products`: they would sit as nullable clutter on every product,
and the table is shared with every category.

## R2. How a sale's cost is decided, and therefore how to capitalize

**Finding**: a sale's cost comes from the FIFO batch, not from the product.
`SalesRepository` (≈:1139) consumes `product_stock_batches` at
`batch.unit_cost_usd` (StockBatchRepository.ts:405-409). It falls back to
`products.cost_price_usd` only for units with no batch (:413-418), and
stamps the result as `sale_items.cost_price_snapshot_usd`, which
ProfitRepository reads.

**Decision**: a capitalization of cost *c* (USD) does three things in one
DB transaction:
- `products.cost_price_usd += c`;
- `products.selling_price_usd += c`;
- `unit_cost_usd += c` on the product's one open batch (`quantity_remaining > 0`).

A legacy line with no batch gets only the product changes, which are what
the fallback uses. A product with more than one open batch, or
`quantity_remaining > 1`, is refused: a for-sale line is stock 1 by owner
rule (#13).

**Rationale**: raising only `products.cost_price_usd` would leave the sale
costed at the old batch cost, so profit would become $13 instead of $10.
That breaks SC-003. No method updates `unit_cost_usd` today (scout 2 §2), so
the plan adds one guarded batch method, `addToOpenBatchUnitCost`.

**Reversal is by delta, not by snapshot**: void subtracts *c* from the
current cost, price and batch cost. A later manual price edit (FR-018) is
kept: $28 edited to $27, then voided, gives $24, not $25. The previous
values are still recorded, for the audit trail.

**Known interaction**: `receiveStock` sets
`cost_price_usd = unit_cost_usd` ("newest price wins", InventoryService.ts:836).
That only matters if someone restocks a stock-1 line, which the line
products never do. It is recorded here and not guarded.

## R3. Source 1, card from the iPick/Katsh balance (no card stock exists)

**Finding**: no prepaid-card quantity exists anywhere. Cards are catalog rows
in `mobile_service_items` (create_db.sql:1418-1451): provider iPick, Katsh
or WHISH_APP, category `mtc`/`alfa`, with `cost_lbp`, `validity_days` and
`credits`. Selling one debits the provider's prepaid drawer by `cost`
(FSR:3216-3228). The `VOUCHER` recharge type is dead: no UI tab produces it.
The closest flow is `selfChargeTelecomItem` (FSR:4830), "Charge to shop line":
- debits the iPick/Katsh drawer by `-cost_lbp`;
- applies the card's `credits`/`validity_days` to a shop line;
- books `TELECOM_SELF_CHARGE` with zero profit.

**Decision**: the card source works like self-charge, aimed at a
for-sale line. The cashier picks a catalog card (same carrier as the line)
from the iPick/Katsh catalog:
- that provider's drawer is debited `cost_lbp`;
- the line's credits rise by the card's `credits`;
- the line's expiry moves by `validity_days`;
- *c* = `cost_lbp ÷ exchange_rate` (USD).

The MTC/Alfa drawer is not touched, because the credit goes to a line the
shop doesn't use.

**Owner confirmed (2026-10-11)**: a card recharge is a card bought from the iPick/Katsh balance. No card count is kept.

## R4. Source 2, credit transferred from a shop line

**Finding**: CREDIT_TRANSFER debits the MTC/Alfa drawer `-amount` and the
primary line `-(amount + smsCostUsd)` (RR:1325-1335, :1496). The SMS fee is
`planSmsTransfer(amount).messages × 0.16`, booked as a separate
`SMS_Transfer_Fee` expense (RR:1528-1553). The sale's `cost` is
`amount × alfa_credit_cost_lbp` (RI:806, RR:382-400). That is what the
credit cost the shop to buy, which is lower than its face value.

**Decision**:
- The source line is any active shop line of the line's carrier (default:
  primary).
- Its credits drop by `amount + smsCostUsd` through `applyMovement`
  (reason `RESALE_TRANSFER`).
- The MTC/Alfa drawer drops by `amount + smsCostUsd`, keeping LIRA-252's
  drawer = Σ line credits.
- The for-sale line's credits rise by `amount`.
- *c* = (`amount × alfa_credit_cost_lbp` + `smsCostUsd × exchange_rate`) ÷
  `exchange_rate`, so the SMS fee is capitalized too.
- No `SMS_Transfer_Fee` expense row is written, because owner decision 2
  says no expense on the recharge day.

**Rationale**: valuing credit at its purchase cost matches how every
credit sale already records `cost`. Face value would overstate the line's
cost by the 85,000→89,000 gap. The drawer still moves at face value, exactly
as a CREDIT_TRANSFER does today.

**Alternative rejected**: keeping the SMS expense. It would book a cost on
the recharge day, which contradicts decision 2.

## R5. Source 3, MTC/Alfa days

**Finding**: DAYS works for both carriers. Only ALFA_GIFT is MTC-hidden
(TelecomForm.tsx:568), and the validator has no provider-by-type rule. A
DAYS sale:
- takes `-days` validity off the primary line;
- takes credits `stockLeg.amountUsd` off it (RR:1380-1400);
- posts a `VALIDITY_DAYS_COST` drawer leg of `-daysCostUsd` (RR:472-480).

Days cost is entered in USD (`telecomDaysCostUsd`) and converted through
`alfa_credit_cost_lbp` (RR:1310-1316). A shortfall beyond the line's days
goes to `days_owed` (RR:1419-1432).

**Decision**:
- The source shop line (default primary) loses the days and the days-cost
  credits through `applyMovement` (reason `RESALE_DAYS`), with the same
  sold-ahead/`days_owed` handling. This is reused, not re-implemented.
- The MTC/Alfa drawer moves by the same leg.
- The for-sale line's expiry moves through `projectValidityExpiry`
  (`carrierLineValidity.ts:245`): it stacks on remaining days, revives from
  today in grace, and refuses a BURNED line.
- *c* = `daysCostUsd`.

**Spec assumption resolved**: Alfa days already exist, so no new source
work is needed for Alfa.

## R6. "Paid in cash" source: dropped

The owner removed it on 2026-10-11 as unnecessary. No drawer OUT leg and no
shared-payment-loop path are needed, so rule 16 does not apply.

## R7. Transaction row and reversal

**Decision**:
- New transaction type `LINE_RECHARGE`, one row per recharge.
- `source_table = 'resale_line_recharges'`, no client, `profit_usd = 0`.
- Label "Line recharge".
- Cash direction `null`. All three sources move only internal balances
  (shop line, MTC/Alfa drawer, iPick/Katsh drawer), the same as the closest
  analogue `TELECOM_SELF_CHARGE: null` (cashFlow.ts:31). No General-drawer
  cash moves, so the Cash Report is unaffected.
- It is reversible: kept out of `NON_REVERSIBLE_TRANSACTION_TYPES`
  (transactionTypes.ts:441) and added to `ACTIONABLE_TYPES` (auditConstants.ts:431).

**Reversal owner** (rule 20): the generic void path, plus one new step,
`_reverseResaleLineRecharge`. It is keyed on
`resale_line_recharges.transaction_id`, like `_reverseCarrierLineMovements`
(TransactionRepository.ts:9368). It:
1. **refuses if the line has been sold** (batch consumed or stock 0), with
   "Refund the sale of this line first". Once sold, the cost is inside a
   sale's cost of goods;
2. **refuses if it is not the line's newest unreversed recharge** (LIFO,
   same reason as carrier-line movements);
3. subtracts *c* from cost, price and batch cost (R2);
4. restores the line's `validity_expires_at`/`credits` from the stored
   `prev_*`;
5. leaves the rest to existing generic steps:
   - `_reversePayments` puts back the drawer legs (provider drawer,
     MTC/Alfa leg);
   - `_reverseCarrierLineMovements` puts back the source shop line's credits,
     validity and `days_owed`.

Net-zero is proven per ledger and currency in one test per source (FR-017,
SC-004).

**Alternatives rejected**: a module-owned void in
`NON_REVERSIBLE_TRANSACTION_TYPES`. It would duplicate payment and movement
reversal that the generic path already does correctly.

## R8. Write-off of a lost line (FR-016)

**Decision**: reuse **`EXPENSE_INVENTORY`** through
`ExpenseRepository.createStockExpense` (ExpenseRepository.ts:654). It:
- decrements stock with a guard;
- FIFO-consumes (owner `expense_id`), so the capitalized batch cost is used;
- books an expense at that cost, which lowers net profit
  (`ProfitRepository.getExpenseTotals`);
- is already reversible (`restoreExpenseStock`, TransactionRepository.ts:5559, :6137).

The plan adds a fixed category "Lost phone line". The Write off button calls
the existing transport; no new money path is added. The only refusal is for
products with IN_STOCK IMEI units, which line products never have.

**Alternative rejected**: a manual stock decrease (`decreaseStockForAdjustment`).
It writes no transaction, books no loss and cannot be voided (scout 2 §3).

## R9. Status, alert window, "today"

**Finding**: shop lines already raise a Dashboard alert, built in the
frontend by `computeCarrierLineAlerts`
(`frontend/src/features/dashboard/utils/carrierLineAlerts.ts`) with kinds
`missing`/`expiring`/`sold-ahead`. **`expiring` fires at ≤ 7 days.** The bell
is client-side only: `NotificationCenter` keeps a 20-item in-memory history,
and TopBar polls low stock and emits warnings. No scheduled job produces
business alerts (scout 3 §2).

**Decision**:
- One pure, browser-safe core module, `utils/lineStatus.ts` (rule 29 leaf).
  `classifyLineStatus(expiry, today)` is a **thin layer over the existing
  `classifyLineValidity`** (carrierLineValidity.ts:180, already browser-safe).
  It takes the warning window as a parameter. `RESALE_LINE_EXPIRY_WARNING_DAYS = 3`
  and `SHOP_LINE_EXPIRY_WARNING_DAYS = 7`, today's threshold moved from
  `carrierLineAlerts.ts` into core. It maps VALID with `daysRemaining ≤ window`
  to EXPIRING, any other VALID to OK, GRACE to IN_GRACE (days left to save =
  `LINE_REVIVAL_GRACE_DAYS − lapseDays`), BURNED to LOST, and NO_EXPIRY to
  NO_EXPIRY. The grace boundary is therefore compared in exactly one place
  (rule 14).
- It is used by the Phone Lines page, the Dashboard and the bell, for both
  kinds (FR-009, rule 14).
- "Today" is the browser's `localDay()` (FR-010, rule 27).
- Alerts are computed when a page loads: on the Dashboard by extending
  `computeCarrierLineAlerts` into `computeLineExpiryAlerts`, and in TopBar as
  emitted warnings like low stock. No server job is added: the Fly clock is
  UTC and the bell has no store.
- **The bell must not flood.** TopBar re-runs on every poll and the bell keeps
  only 20 entries. Each line's alert is emitted **at most once per line, per
  status, per calendar day, per session**, tracked by an in-memory key
  `lineId:status:day`.

**Owner decision (2026-10-11)**: shop lines keep their 7-day warning.
For-sale lines use 3. Two named constants share one classifier, so there is
no behaviour change for shop lines.

## R10. Detection on Mobile Recharge (FR-011/012)

**Finding**: the Recharge page fetches shop lines through
`getActiveCarrierLines(carrier)` (backendApi.ts:7593; IPC
`carrier-lines:get-active-by-carrier`; REST `GET /api/carrier-lines/active/:carrier`).
It matches with `isSameLebanesePhone` (RI:292-294). The backend re-checks
through `isShopOwnLine` (RR:512-521).

**Decision**:
- Add `getUnsoldResaleLines(carrier?)` on both transports, returning
  `products.barcode` as the number. The page matches the typed number against
  it with the same helper.
- **Scope of detection**: only the MTC/Alfa Telecom form takes a target
  number. iPick/Katsh card and Only-Days sales record only the customer's
  phone (`KatshForm.tsx`, `setClientPhone`). They have no recharge target to
  detect, so they are out of scope.
- On a match it shows the "line for sale" banner and swaps the payment
  section for the internal-recharge panel.
- **Backend guard**: `processRecharge` refuses any customer recharge whose
  number matches an unsold for-sale line ("This is your line for sale —
  use Recharge line"), the same as the `isShopOwnLine` re-check, because the
  REST route is directly callable (FR-012).

## R11. Page placement and roles

**Decision**:
- New route `/phone-lines`, a hard-coded sidebar link gated on
  `isModuleEnabled("recharge")` (the pattern of the Warranty link at
  Sidebar.tsx:265), and an entry in `ActiveModuleContext` `routeToModule`.
- No new module row and no module migration.
- Roles: editing lines is `admin`, matching carrier-line handlers
  (carrierLineHandlers.ts:79). Internal recharge needs only authentication,
  matching `/api/recharge` (router-level `authenticateJWT`, no
  `requireRole`).
- The shop-line tab reuses `CarrierLinesManager` behaviour and transports
  unchanged (FR-003).

## R12. Migration number, offline channels

- The latest migration is **v210** (migrations/index.ts:14417). This feature
  takes **v211**: `resale_lines` and `resale_line_recharges`, both in
  `create_db.sql`, with `down()`. Re-check the last entry at build time: a
  parallel session (LIRA-308) may land a migration first.
- New IPC channels must be classified in
  `packages/core/src/offline/channelPolicy.ts` (LIRA-306 offline desktop).
  Reads are offline-safe. `resale-lines:recharge` is a money write, so it
  follows how `recharge:process` is classified.

## Owner answers (2026-10-11)

1. Card source = card bought from the iPick/Katsh balance. Confirmed.
2. Shop lines keep 7 days; for-sale lines 3. Confirmed.
3. "Paid in cash" source dropped.
