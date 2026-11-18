# Feature Specification: Profits drill-downs — Katsh "Only Days" cost, module wording, and no empty rows

**Feature Branch**: `396-profits-labels-cost`

**Created**: 2026-11-18

**Status**: Draft (owner decision 2026-11-18: build)

**Input**: Owner audit of the Cornertech Profits page (2026-11-16), follow-up to LIRA-391 ("180 credit").

## Established facts (verified on Cornertech, 2026-09-01 → 2026-11-16)

1. **Katsh "Only Days" rows: cost does not match profit.** 28 Katsh SEND rows show e.g. price 2,500,000 LBP, cost 7,620,030 LBP, profit 744,970 LBP (FS #2220, note "mtc: 77.28 (Prepaid) [Only Days]"; also #2202, #1896 price 300,000 / cost 765,007 / profit 44,993; #1935). Every such row is a single-line checkout of a catalog item with the " [Only Days]" suffix (LIRA-337 "give credit back": the customer buys the validity days, the credits return to the shop line). `utils/catalogSale.ts` `buildCatalogSalePayload` writes `cost = Σ item.cost_lbp × qty` (the FULL package cost) and `commission = max(0, price − cost)` — which would be 0 here, so the stored commission/profit was adjusted later by the Only Days handling (`catalogItems[].onlyDays` / `returnedCreditsUsd` in `FinancialServiceRepository`). The stored `financial_services.cost` was not adjusted. Likely (unverified): true cost = package cost − value of the returned credits; e.g. #1896: 765,007 − 44,993-implied cost 255,007 → 510,000 LBP returned ≈ 5.7 credits × 89,000.
2. **FS drill-down detail is the raw enum**: `SEND`, `RECEIVE`, `BILL`, `SEND (settlement allocation)` (OMT 706 rows, Katsh 407, Whish App 528, Binance, Whish, OMT App, iPick). The unified transaction row already carries a human summary (`transactions.summary`, e.g. "OMT SEND: $197.96 (195.01 transfer + 2.95 fee)", "Katsh: mtc: 7.58 (Prepaid) — 300,000 LBP").
3. **KEPT_CHANGE drill-down lists every debt repayment**: 286 of 345 rows are "not counted" with reason "No kept change on this repayment (rounds to $0)." Noise; the row has nothing to show.
4. **TOPUP_BUYBACK drill-down**: 51 "Client top-up" rows, all counterpart "Walk-in", amount 0, profit 0 (a client top-up with no fee). Noise, and a client top-up always has a client.
5. **LOTO drill-down**: all 377 rows read "Loto ticket" — `loto_tickets.ticket_number` is never filled by the current Loto flow; the transaction summary ("Loto ticket sale: 2× CASH"-style) is informative.
6. **MAINTENANCE**: 2 rows with blank `device_name` (#70, #66). **CUSTOM_SERVICE**: 5 rows with blank `description` (#103, #84, #69, #109, #93). Blank detail column.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Katsh/iPick Only Days row: price − cost = profit (Priority: P1)

**Acceptance Scenarios**:

1. **Given** a catalog line sold as Only Days (credits returned to the shop line), **When** the financial-service row is written, **Then** its stored `cost` is the net cost (package cost − value of returned credits at the cost rate) so that `price − cost = commission` on the row, and the Profits drill-down shows that triple consistently.
2. **Given** existing Only Days rows written before the fix, **When** the drill-down is read, **Then** the cost column shows the same net cost (a migration backfills `cost = price − commission` for rows identifiable as Only Days — identify them from the stored metadata/catalogItems/note suffix; if a row cannot be identified with certainty, leave it and log the count). Supplier-ledger and drawer legs are NOT touched by the backfill.
3. **Given** a normal (not Only Days) catalog line, **Then** nothing changes.

**Owner-visible check**: Cornertech FS #2220 reads price 2,500,000 / cost 1,755,030 / profit 744,970 after deploy.

### User Story 2 — Module wording in the Detail column (Priority: P2)

1. **Given** any financial-service drill-down row (transfer arm), **Then** `detail` = the unified transaction's `summary` (one wording everywhere, rule 14); a settlement-allocation row = the same summary + " — commission at settlement".
2. **Given** a loto row, **Then** `detail` = the ticket's transaction summary when `ticket_number` is empty (keep "Ticket <n>" when it is set).
3. **Given** a maintenance row with blank device name, **Then** fall back to the job's issue/description, else "Repair job #<id>"; a custom service with blank description → service name/category, else "Custom service #<id>". Never a blank cell.

### User Story 3 — No empty rows (Priority: P2)

1. KEPT_CHANGE: a repayment / entry whose kept change rounds to 0 in both currencies is not listed. The remaining rows still reconcile to the module row.
2. TOPUP_BUYBACK: a top-up/buyback with 0 profit and 0 amount is not listed; a listed client top-up shows the client's name as counterpart (read it from the top-up's source row).

### Edge Cases

- Katsh line with BOTH credits given back and a quantity > 1.
- An Only Days row later refunded: the REFUND reverses the same net cost (rule 20 symmetry) — verify create + refund nets to 0 on the supplier/credit ledgers it touches.
- FS summary missing (legacy rows with NULL summary): fall back to today's enum text.

## Requirements *(mandatory)*

- **FR-001**: One net-cost derivation for an Only Days line, used by the write path AND the backfill migration (rule 14). Migration added to BOTH `packages/core/src/db/migrations/index.ts` (next number after the last entry — read it, the CLAUDE.md number is stale) AND `electron-app/create_db.sql` where schema is affected (a data backfill needs no `create_db.sql` change unless columns are added).
- **FR-002**: Detail wording reused from the module's own writer (transaction summary / existing label helpers); no new hand-written template in `ProfitService.ts` (LIRA-391 precedent).
- **FR-003**: Failing-first tests (rule 17), real schema, real write paths: Only Days cost (write path) + backfill (seed a pre-fix row, run migration, assert); FS/loto/maintenance/custom detail fallbacks; KEPT_CHANGE and TOPUP_BUYBACK zero rows absent while Σ counted still equals the module row (`ProfitRepository.moduleDetailReconciliation.test.ts` green).

## Success Criteria *(mandatory)*

- **SC-001**: Audit script (LIRA-397) check "price − cost = profit" passes on Cornertech for FINANCIAL_SERVICE_Katsh; no blank or enum detail; KEPT_CHANGE not-counted rows ≤ rows with a real partner/debt reason.

## Assumptions / Decisions taken (2026-11-18)

- Net cost is the truth for an Only Days line (the returned credits are an asset on the shop line, not a cost of this sale). If the agent's trace shows the returned credits are already booked elsewhere as income (double count risk), STOP the cost change, keep the display fix (cost column = price − profit for those rows), and record it under "Decisions taken unattended".

## Open questions for the owner (do not block)

- Should the Loto flow start saving the ticket number so the drill-down can show it? (Separate ticket.)

## File ownership (parallel build)

- Yours: `FinancialServiceRepository` Only Days path + `utils/catalogSale.ts`, the new migration, `getFinancialServiceDetail` / loto / maintenance / custom-service detail queries' `detail` columns, the `detail:` lines of `buildFinancialServiceModuleDetail`, `buildLotoModuleDetail`, `buildMaintenanceModuleDetail`, `buildCustomServiceModuleDetail`, zero-row filtering in `buildKeptChangeModuleDetail` and `buildTopupBuybackModuleDetail` (395 is ADDING a kept-change source to the same builder — keep your change to the filter; re-read before each edit), your tests.
- Not yours: counterpart helper (393), sale drill-down (394), by-user/by-module totals (395). Re-read shared files immediately before each edit; surgical edits; no prettier `--write` on `ProfitRepository.ts` / `ProfitService.ts` (`--check` and report).

## Decisions taken unattended (2026-11-18)

- **D1: Only Days cost is fixed on the Profits read side. The stored cost and the backfill migration (FR-001) are NOT done.** The double-count STOP condition was checked and **not** hit: the returned credits are income once, inside the row's commission (`commission = price − cost + credits × R`, R = `telecom_credit_cost_rate_lbp`). The `CREDIT_RETURN` leg is an internal method excluded from profit, and resold credits are costed at `alfa_credit_cost_lbp`. But `financial_services.cost` is deliberately gross (documented at the LIRA-153 margin-netting site: "`cost`, the drawer leg and the supplier payable are all untouched — only the margin moves"). It is also read as "what the provider drawer paid" by the Suppliers Transactions tab and Recharge history (`cost AS amount`), the FIFO payment walk, settle-by-day coverage and the `cost > 0` branch selectors. Storing net cost would change those supplier views, which the spec says must not be touched. So the drill-down shows `cost = revenue − stamped profit` for any row that posted a `CREDIT_RETURN` leg. That gives FS #2220 1,755,030, applies to existing rows without a migration, and makes price − cost = profit by construction. Full trace: research.md §1.
- **D2: Only Days rows are identified by their `CREDIT_RETURN` payment leg**, the writer-owned marker on every such row since LIRA-090. They are not identified by the note suffix or by `catalogItems`, which exists only since LIRA-329.
- **D3: By Module's FS cost total still sums gross `fs.cost`** (LIRA-395's lines). The fragment is exported for a follow-up. The drill-down's cost column and the module row's cost can therefore differ for Only Days rows until then. Profit totals are unaffected.
- **D4: Custom service fallback uses the transaction summary, not `category`.** The summary is the module's own wording and already names the service.
- **D5: The FS settlement-allocation detail is "<transfer summary> — commission at settlement"**, replacing "<enum> (settlement allocation)".
- **D6: Zero rows are dropped in the service** (KEPT_CHANGE: profit 0 in both currencies; TOPUP_BUYBACK: the same), using the same predicate that already marked them not counted. Totals are unchanged.
