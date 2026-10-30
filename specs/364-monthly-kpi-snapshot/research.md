# Research: Monthly KPI snapshot (LIRA-364)

Owner accepted the spec's three defaults on 2026-10-30: hold money and gift cards are not in "shop owes customers"; company suppliers (OMT, Whish, iPick, Katsh, Loto) are in the supplier KPIs; USDT partner balances are not included.

## R1. Where each KPI comes from (rule 14: reuse the app's own balance definitions)

| KPI | Source today | Decision |
|---|---|---|
| Customers owe shop / shop owes customers | `debt_ledger`, SUM per client. `DebtRepository.getDebtSummary` sums the whole ledger (net); the Debts page judges each client by its own sum. | Add `DebtRepository.getClientBalances()`: per client, `SUM(amount_usd)`, `SUM(amount_lbp)`, with the same `tenant_id` scoping as `getDebtSummary`. The service splits by sign. |
| Suppliers owe shop / shop owes suppliers | `SupplierRepository._ledgerBalanceQuery` (excludes refunded rows via `ledgerNotRefunded`); positive = shop owes. The OMT account rolls its children up under the parent (`getAccountBalances`). | Add `SupplierRepository.getCounterpartyBalances()`: reuses the `_ledgerBalanceQuery` join/predicate, grouped by `COALESCE(account_supplier_id, id)` so an account counts once. Every supplier, active or not (an archived one is $0 anyway), except the hidden secondary OMT/Whish system (`_secondarySystemHideClause`), whose obligations live in `partner_ledger` and would double count. |
| Partners owe shop / shop owes partners | `PartnerRepository.getAllBalances(includeInactive)`; `usd`/`lbp` = DEBIT − CREDIT, positive = partner owes shop (Partners page, `canWriteOff = usd > 0.01`). | Reuse as is with `includeInactive = true`. USDT column ignored (owner default). |
| Stock value | `ProductRepository.getStockStats().stock_budget_usd`, the Dashboard's "Stock Budget". | Reuse as is. LBP amount stored as 0. |
| Carrier total credits | `CarrierLineRepository.getCarrierCreditsSum(carrier)`, the documented single definition (= MTC/Alfa USD drawer). | Sum it for MTC and Alfa. LBP stored as 0. |

**Rationale:** SC-002 requires each figure to match the page it comes from. New methods reuse the existing predicates; nothing pastes them.
**Alternatives rejected:** netting a whole group (one figure for "customers") hides credits behind debts and loses the six-way split the owner asked for. Reading drawer balances for carriers conflicts with the "no drawers" decision, even though the totals are equal by invariant.

## R2. Splitting by sign

**Decision:** one pure function `splitBySign(balances, epsilon)` in `packages/core/src/utils/kpiSplit.ts`. For each counterparty and each currency on its own: a positive amount goes to one side, a negative amount (as its absolute value) to the other. Values within 0.005 USD or 0.5 LBP are zero. The orientation per group is fixed in the KPI definitions: customers/partners positive = they owe the shop; suppliers positive = the shop owes.
**Rationale:** spec FR-002 / scenario 3. Being pure, it is unit-testable and browser-safe (rule 29).

## R3. "Month" and time zone (rule 27)

**Decision:** months are calendar months in `Asia/Beirut`, computed with `Intl.DateTimeFormat` and an explicit zone, the precedent `utils/trialCalendar.ts` (`SHOP_TIME_ZONE`, LIRA-332) already set. The month described = the Beirut month before the current Beirut month.
**Rationale:** rule 27 says "client supplies the day". Here no client is involved: the web job runs on a server timer. The owner asked for Beirut month end explicitly, and an explicit zone (never `process.env.TZ` and never the server clock's own day) is the rule's own escape hatch, as used by the trial calendar. Recorded in Complexity Tracking.
**Alternatives rejected:** setting `TZ` on Fly (rule 27 forbids it); a per-tenant zone setting (none exists, and every tenant is in Lebanon today).

## R4. Scheduling

**Web:** `backend/src/services/kpiSnapshotSweep.ts`, copied from `lapseSweep.ts`: run once at boot, then every hour (`setInterval`, `unref`). For each row of `TenantRepository.listAllRows()`, call `runWithTenant(id, () => kpiSnapshotService.captureDue(now))` inside its own try/catch, so one shop's failure does not stop the others (FR-009). Hourly plus idempotent equals "within the first hour" (FR-006), with free retries.
**Desktop:** `electron-app/kpiSnapshotTimer.ts`, called from `main.ts` right after `initializeBackend()` and before the IPC handlers are registered, so the capture finishes before any sale can be saved (FR-007). The same hourly interval covers an app left open past midnight. **Standalone mode only**: a PC paired with a web shop (`offlineBoot.decision.mode !== "standalone"`) takes no snapshot, because the server's is the shop's one.
**Idempotency:** `UNIQUE(tenant_id, month)` plus `INSERT … ON CONFLICT DO NOTHING` inside one transaction with the values (FR-008).
**Alternatives rejected:** a cron dependency (lapseSweep explains why an idempotent hourly interval is enough); capturing on a user request (automatic-only decision; also misses shops nobody opens).

## R5. "Starts empty": the per-shop start marker

**Problem:** deploying on 15 November, the first sweep would see October "missing" and save today's balances as October's, which is wrong. Spec FR-016 says the first snapshot is the first month end after deploy.
**Decision:** the first time `captureDue` runs for a shop, it writes `system_settings.kpi_snapshots_since = <current Beirut month>` and captures nothing. Later, month M is captured only when M ≥ that marker. A shop created mid-month gets the same marker, so its first snapshot is that month's end (spec edge case).
**Alternatives rejected:** "capture only within N days of month start" breaks the desktop shop that is closed until the 3rd.

## R6. "Taken late"

**Decision:** `is_late = 1` when, at capture time, a `transactions` row already exists with `created_at` at or after the start of the new Beirut month (converted to UTC once, as `localDayRangeFilter` does). This test is objective and matches the spec ("after any money activity of the following month had already been saved").

## R7. Exchange rate stored

**Decision:** read the USD→LBP row of `exchange_rates` (`buy_rate`, `sell_rate`) at capture time; NULL when the row is missing. It is used only for display.

## R8. Phone-shop gating

**Decision:** the KPI definitions carry `group: 'generic' | 'phone_shop'` and `requiresModule?: 'recharge'`. The page hides a row whose module is off (`ModuleContext`). The value is always saved (FR-013).

## R9. Per-tenant DB mode on web

**Likely, based on `admin.ts`, which uses `runWithTenant(tenantId, …)` to reach a shop's own file:** wrapping the capture in `runWithTenant` routes repositories to that shop's database in per-tenant mode. **To verify in the first task:** a backend test that captures for two tenants and reads each back. Assumption (unverified) until that test passes.

## R10. Who can read

**Decision:** read-only IPC `kpi:list-snapshots` (`requireRole(["admin"])`, classified `read` in `channelPolicy.ts`) and REST `GET /api/kpi/snapshots` (`authenticateJWT` → `requireRole(["admin"])`). There is no write channel at all (FR-010). Route `/monthly-progress` sits under `AdminRoute`.
