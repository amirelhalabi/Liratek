# Exchange Lot Settlement — realized cost-basis profit for exotic currencies

**Status: IMPLEMENTED 2026-08-23 (commits 5ee10ce9..62a15b1b + review-fix commit(s) after) — desktop/web e2e guard still pending (Phase 8).**
Owner answered a 17-question interview 2026-08-22 (decision record below). Shipped in phases:
v156 schema → ExchangeLotRepository engine → money-path wiring + rule-20 reversal owners →
dual-transport lot API (preview/positions/breakdown/adjust) → history lot summaries →
frontend (preview, loss confirm, history columns/breakdown/filter, positions panel) →
top-up lot creation. Full suite green (3,678 tests), two adversarial execution reviews run;
confirmed findings fixed (see "Review findings & residuals" at the bottom).

## The feature in one paragraph

Today exchange profit is a half-spread-vs-mid-market snapshot stamped at trade time
(`computeLegProfitUsd`), computed in the frontend and trusted by
`ExchangeService.addDirectTransaction`. Nothing tracks what the shop actually paid to acquire
the currency it later sells. This feature replaces that model **for exotic currencies only**
(non-USD, non-LBP): a BUY of €2,000 at rate X creates an open **lot**; later SELLs settle it
FIFO, possibly partially, each settlement realizing `qty × (proceeds − cost)` in USD — which
can be negative. A buy books **zero** profit until it is sold. USD↔LBP exchanges keep the
current spread model unchanged.

## Decision record (owner, 2026-08-22)

| # | Question | Decision |
|---|----------|----------|
| Q1 | Scope | **Exotics only** (non-USD, non-LBP). USD↔LBP stays spread-based. |
| Q2 | Profit unit | **Always USD.** |
| Q3 | Lot sources | Exchange BUYs **and** foreign-currency drawer top-ups. Basis: **market rate by default** (owner refinement 2026-08-23): override via edit link; configured market rate server-side; feed-only uses the client feed hint; error only when none exist. |
| Q4 | Wallet exchange | **Out of scope** — OMT_App/Whish_App conversions keep booking zero profit. |
| Q5 | Matching | **FIFO automatic** (no manual lot picking). |
| Q6 | Oversell | Never block. Uncovered quantity settles at **that day's market rate as basis** (≈ zero profit on the uncovered slice). |
| Q7 | Cross-currency | **Two independent lot events**, one per leg. Direction (stated correctly): customer gives EUR / receives GBP ⇒ shop **acquires** a EUR lot (leg-1 basis) and **consumes** GBP lots (realizing P&L at leg-2 proceeds). |
| Q8 | Old spread profit | **Replaced entirely** for lot-tracked currencies. A buy's exotic leg stamps 0 profit; all profit appears at settlement. |
| Q9 | Profit date | **Settlement date** (the sell's own date) — daily closing and Profits see it then. The buy's history row displays accumulated realized profit for reference only. |
| Q10 | Losses | Legitimate. **Confirmation dialog ("realizes −$X — proceed?"), any operator**; must not be blocked by the existing >10% sanity guard. |
| Q11 | Unrealized P&L | **Yes** — indicative, display-only, never in Profits totals. |
| Q12 | Void partially-settled BUY | **Blocked** until its settling sells are voided first (supplier-settlement guard pattern). Voiding a SELL always allowed: restores quantities, negates realized profit. |
| Q13 | For-partner | Lots move **at trade time**; realized profit stamped then but **deferred via the existing `notPartnerPending` gate** until partner coverage. (Note: for-partner requires `fromCurrency ∈ {USD, LBP}` — partner debt guard — so for-partner can only **consume** exotic lots, never create them. Moot for the buy side.) |
| Q14 | Go-live | **Start empty.** No opening lots, no history replay. Pre-existing EUR sells through the Q6 market-basis path; the Q15 admin adjust is the manual escape hatch to establish a basis. |
| Q15 | Drift | **Admin-only manual position adjustment** (add at stated basis / write off), with note. |
| Q16 | History UI | All four: status+remaining+realized columns, expandable per-row settlement breakdown, currency filter, open-positions panel on the Exchange page. |
| Q17 | History cap | **Keep the 50-row cap**; currency filter is client-side over loaded rows. (Positions panel is unaffected — it reads the lot table, not history rows.) |

## Direction semantics (get this right — it was inverted once already)

In `ExchangeRepository`: `amount_in`/`from_currency` = what the **customer gives** (shop
**receives**); `amount_out`/`to_currency` = what the **shop disburses**. Therefore:

- `from_currency` exotic ⇒ shop **acquires** ⇒ **create a lot** of `amount_in`.
- `to_currency` exotic ⇒ shop **disburses** ⇒ **consume lots** for `amount_out`.
- Cross-currency (both exotic, via USD): do both, independently, one per leg.
- USD and LBP sides never create or consume lots (Q1).

## Schema (migration — increment from the LAST entry in `migrations/index.ts`; was v155 → v156 at design time, RE-VERIFY)

Mirror in `electron-app/create_db.sql` (rule 10). Composite currency FK
`(tenant_id, currency_code) REFERENCES currencies(tenant_id, code)` — `code` alone has no
unique index (v154/v155 FK-mismatch trap).

**`exchange_lots`** — one row per acquisition:
`id, tenant_id, currency_code, drawer_name TEXT NOT NULL DEFAULT 'General',
source_type TEXT CHECK('EXCHANGE_BUY','DRAWER_TOPUP','ADJUSTMENT'), source_table TEXT,
source_id INTEGER, original_qty REAL NOT NULL, remaining_qty REAL NOT NULL,
unit_cost_usd REAL NOT NULL, acquired_at DATETIME NOT NULL, is_voided INTEGER DEFAULT 0,
created_at, updated_at` + tenant index + `(tenant_id, currency_code, acquired_at, id)` index
for FIFO. Ownership links are **real columns**, never metadata_json id lists
(TransactionRepository ~:3013 precedent).

**`exchange_lot_settlements`** — one row per (lot × consuming event):
`id, tenant_id, lot_id INTEGER NULL REFERENCES exchange_lots(id), basis_source TEXT
CHECK('LOT','MARKET') NOT NULL, settled_by_table TEXT NOT NULL, settled_by_id INTEGER NOT NULL,
qty REAL NOT NULL, unit_cost_usd REAL NOT NULL, unit_proceeds_usd REAL NOT NULL,
profit_usd REAL NOT NULL, is_refunded INTEGER DEFAULT 0, refunded_at TEXT, created_at,
updated_at`. `lot_id NULL` + `basis_source='MARKET'` is the Q6 uncovered slice.

**`exchange_position_adjustments`** (Q15): `id, tenant_id, currency_code, qty REAL (signed),
unit_cost_usd REAL NULL, note TEXT, created_by, created_at, updated_at`. An ADD creates an
ADJUSTMENT-source lot at the stated basis; a REMOVE consumes FIFO at **zero profit**
(proceeds = cost — shrinkage sync, not a sale). Adjustments move **no money** (no drawer
delta, no unified transaction, no payments row) — they re-sync the lot ledger to physical
reality whose money movement happened elsewhere. Correction of an adjustment is another
adjustment; rule 20 does not attach (no transaction tie).

**Named fragments (rule 14), defined once in the repository:** `OPEN_LOT`
(`is_voided = 0 AND remaining_qty > 0.005`-style epsilon — reuse the 0.005 money epsilon),
and the FIFO `ORDER BY acquired_at ASC, id ASC` (id tiebreak — `created_at` is
second-granular, rule 15 trap).

## Engine (new `ExchangeLotRepository`, called from inside `ExchangeRepository.createTransaction`'s existing db.transaction)

All lot math is **server-side** (rule 13; client-sent profit is untrusted and REST already
strips leg profit fields). Per exchange:

1. **Acquire** (from-side exotic): insert lot; `unit_cost_usd` = executed leg USD notional ÷ qty
   (leg1 for direct/cross from-side).
2. **Consume** (to-side exotic): walk `OPEN_LOT` FIFO for `amount_out`; per lot write a
   settlement with frozen `unit_cost_usd`, `unit_proceeds_usd` = executed USD taken per unit
   (direct: `amount_in`/`amount_out` in USD terms; cross: derived from the ONE shared USD
   notional, LBP-anchor priority), decrement `remaining_qty`. Shortfall → one MARKET-basis
   settlement row at `exchange_rates.market_rate` (USD-normalized via `is_stronger`).
   **Rounding, as implemented (differs from an earlier draft of this doc):** profit is
   rounded to the cent PER settlement row and the stamped total is the exact sum of the
   rounded rows — there is no remainder-absorption step, so the stamped total can drift
   from the unrounded ideal by up to ½ cent per row (adversarially measured: +$0.11 over
   52 rows). Quantities are exact (Σ settlement qty ≡ amount_out to <1e-9). The books are
   internally consistent because every reader sums the same rounded rows.
3. **Stamp** the realized total as the sell row's exotic-leg profit column
   (`leg1_profit_usd`/`leg2_profit_usd`) and in the unified row's `profit_usd`. Buy-side exotic
   legs stamp **0** (Q8 — spread profit gone for lot currencies). USD↔LBP legs keep today's
   spread stamping untouched. Consequences that fall out for free: `EXCHANGE_LEG_PROFIT`
   aggregation, the Profits card, history's profit cell, and settlement-date attribution (Q9 —
   profit sits on the sell row, dated by the sell) all work **unchanged**; the for-partner
   `notPartnerPending` gate composes automatically (Q13).

**Reversals (rule 20):**
- Up-front guard `_assertExchangeLotsVoidable` in BOTH `_voidTransactionInternal` and
  `_refundTransactionInternal` (mirror `_assertSupplierSiblingsVoidable` at ~:1305/:1509):
  refuse reversing an exchange whose created lot has active (is_refunded=0) settlements (Q12).
- Reversal owner `_reverseExchangeLotEffects` in both step lists (template
  `_reverseSupplierSettlement` ~:3073): voided SELL → per active settlement restore
  `remaining_qty += qty` and mark it refunded; voided BUY → mark its lot `is_voided=1`
  (guard guarantees it is untouched). Cash legs reverse for free via `_reversePayments`;
  profit negation for free via the REFUND row / `notRefunded` retro-removal (consistent with
  current exchange behavior).
- DRAWER_TOPUP is permanently non-reversible — top-up-sourced lots have no void path; the
  Q15 adjustment is the correction.
- Prove create+reverse **nets to 0 across lots, settlements, drawers, and profit, per
  currency**, with failing-first tests (rule 17).

**Rate-editing note:** basis/proceeds always come from the **stamped executed leg rates on the
row** (operator overrides included), never from the `exchange_rates` table (no history kept
there — upsert overwrites).

## Read APIs (all: core service method → IPC handler + mirroring REST route, shared Zod schema in `packages/core/src/validators/`, adapter fn via `ipcOrHttp` — rule 19)

- `exchange-lots:preview` — FIFO dry-run for (currency, qty): matched lots, uncovered slice,
  realized profit. Feeds the form's live profit display and the Q10 loss-confirm dialog
  *before* submit; submit recomputes authoritatively server-side. The existing >10% sanity
  guard must treat a lot-realized loss as expected, not anomalous.
- `exchange-lots:positions` — per currency: open qty, weighted-avg cost, current market rate,
  unrealized P&L. Powers the Q11/Q16 panel; label **indicative** (feed ~24h stale).
- `exchange-lots:breakdown` (per exchange id) — settlements for the expandable history row,
  fetched lazily on expand (keeps the 50-row history read light per Q17).
- `exchange-lots:adjust` — Q15, `requireRole` admin on BOTH transports.
- `getHistory` gains a small JOIN: per row, settled qty / realized-so-far / status
  (Open, Partial, Settled — buys) and lots-consumed count (sells). New columns must be added
  to the read projection or they're silently invisible (`getColumns()` — the LIRA-131 bug).

## Frontend

- **Exchange form:** live realized-profit preview from `preview`; loss-confirm dialog (Q10).
- **HistoryModal** (module-private — isolated edit): status badge + remaining + realized
  columns; expandable settlement sub-table (inline second-`<tr>` pattern already in the file;
  DataTable exports multi-`<tr>` rows); client-side currency dropdown next to the date filter
  (Q17: rows stay capped at 50). While in the file, fix the pre-existing raw
  `window.api.exchange.updateMetadata` call (rule 19) and the drifting local `ExchangeTx` type.
- **Open-positions panel** on the Exchange page (Q16), linking into filtered history.
- **Drawer top-up form:** required acquisition-rate field when topping up an exotic currency
  into General (Q3).

## Test plan (rule 17 — each guard shown failing against un-fixed code first)

Core jest: FIFO order incl. same-second id tiebreak; partial settle across two lots;
oversell MARKET slice; cross-currency both legs (direction per §above); rounding remainder
absorption; void SELL restores quantities + nets to 0 per ledger per currency; void
partially-settled BUY blocked; refund profit negation; for-partner defer composition;
buy stamps zero profit (spread replaced); USD↔LBP path byte-identical to today.
`profitRecognition.guard.test.ts` gains the exchange entry. E2E: extend the exchange specs —
identity + delta assertions only (rule 15); desktop before web (ABI).

## Explicitly out of scope (v1)

Wallet exchange (Q4); USD↔LBP lots (Q1); short positions (Q6); manual lot picking (Q5);
opening-lot migration (Q14); history-cap lift (Q17); restating historical profit.

## Review findings & residuals (adversarial reviews, 2026-08-23)

Two execution-based adversarial reviews ran against the committed feature (22 hostile money
scenarios + a parity/checklist sweep). 21/22 money attacks held. Confirmed findings and
their outcomes:

**Fixed in the review-fix commit(s):**
- `notPartnerPending("exchange_transactions", "id")`'s unqualified `id` broke the for-partner
  deferral on `getExchangeTotals` + the `daily_exchange` CTE (correlated against `plp.id`) —
  PRE-EXISTING since LIRA-081, amplified by lot P&L; fixed by qualifying the outer column,
  guarded by a diverging-id failing-first test (the old guard test passed only by an id
  coincidence and was strengthened).
- Preview didn't mirror the submit-side lot-skip for anchorless crosses (both sides feed-only,
  no rate row): the loss dialog could confirm a number the server then discarded. Preview now
  shares the anchor predicate and reports `NO_RATE_ANCHOR`; the form shows "configure a rate"
  instead of a realized figure.
- Preview failure silently disarmed the loss dialog (now a visible warning; submit never
  blocks); preview qty aligned to the exact submitted amount; unvoidable-buy error message
  now names an adjustment blocker honestly; result-type declarations completed.

**Accepted behavior, documented (no code change):**
- **Epsilon stranding**: a lot left at 0 < remaining ≤ 0.005 is permanently depleted-by-epsilon
  (invisible to positions/FIFO). Worst case 0.005 × unit cost per lot — negligible for fiat.
- **Backdating is trusted**: a sell backdated before its lot's acquisition still consumes at
  LOT basis and books profit on the backdated day; a later-inserted buy with an earlier
  `transaction_time` takes FIFO precedence. Operator-driven `transaction_time` is trusted
  system-wide; noted, not guarded.

**DECIDED (owner, 2026-08-23): accept as-is.**
- **A BUY becomes permanently unvoidable once an admin write-off (Q15 adjust) consumes from
  its lot** — write-off settlements have no reversal path (adjustments tie to no transaction),
  so `_assertExchangeLotsVoidable` blocks the buy's void forever (honest message names the
  adjustment), and a compensating `adjust(+)` does NOT unblock it. Owner accepted: blocking
  beats corrupting; a write-off means currency physically left outside any transaction, so
  corrections happen FORWARD via another adjustment, never by voiding the buy. Revisit only
  if write-offs become frequent (the alternative is an adjustment-reversal flow).

**F3 — RESOLVED 2026-08-23 (owner requested same-session follow-up):** the web submit route
now mirrors IPC exactly — admin+staff, HTTP 200 envelope always, and the full submit schema
(`exchangeSubmitSchema`) lifted to core validators (killing the electron-app local duplicate,
rule 14) so operator rate overrides reach the web server via `addDirectTransaction`. Proven by
lira-web-022 (4 tests, each shown failing against the reverted pre-fix route): staff submit
with verbatim override storage, 200+success:false on business failure, realizedProfitUsd in
the web response, admin unaffected. The dangling "Appendix A" adapter comment is gone.

**RESOLVED 2026-08-23 (owner decision: ENABLE exchange backdating, trusted, no guard):**
- **`transaction_time` was stripped by the exchange submit schema** — the Exchange page's
  backdate field never survived `validatePayload`/`validateRequest`, so exchange rows always
  stamped CURRENT_TIMESTAMP even when the operator backdated. The repository layer already
  honored transaction_time correctly (adversarially verified) — the loss was purely at the
  schema: `exchangeSubmitSchema` (`packages/core/src/validators/exchange.ts`) lacked the field
  that `createExchangeSchema` in the same file already had via `transactionTimeSchema`. Fixed by
  adding `transaction_time: transactionTimeSchema` to `exchangeSubmitSchema` — the electron-app
  re-export (`ExchangeTransactionSchema` in `electron-app/schemas/index.ts`) is a direct cast of
  the same schema object (no local duplicate to touch), and `preload.ts` /
  `frontend/src/types/electron.d.ts` already typed `transaction_time?: string` on
  `exchange.addTransaction`'s data param (the frontend had been sending it all along — verified,
  not newly added). Proven by a failing-first test in `ExchangeRepository.lotSettlement.test.ts`
  ("schema-validated submit path — transaction_time backdating") that submits through
  `exchangeSubmitSchema.safeParse()` the way both transports do, shown failing on the pre-fix
  schema (`created_at` came back as `CURRENT_TIMESTAMP` instead of the backdated value), then
  passing after the one-line addition. **Backdating still affects lot FIFO order by design** — a
  BUY backdated earlier than an existing lot's `acquired_at` wins FIFO precedence over it (same
  "Accepted behavior" note above); the new test also proves this directly (a backdated lot
  consumed ahead of a pre-existing later-acquired one).

## Open items for implementation time

- Re-verify latest migration version; re-check the uncommitted drawer-policy work
  (GENERAL_DRAWER_UNRESTRICTED) hasn't moved the Exchange General-drawer auto-register.
- Rule 18: read `docs/FEATURE_GUIDE.md` §13 checklist before writing code; use the
  `new-money-feature` skill.

## FEATURE_GUIDE §13 walkthrough (rule 18 — answered 2026-08-22 before implementation)

1. **Transaction row**: NO new unified transaction type. The lot engine hooks inside the
   existing EXCHANGE flow; `exchange_lots`/`exchange_lot_settlements` are side tables keyed
   to `exchange_transactions` rows by real columns. Position adjustments write NO unified
   transaction — justified: they move no money (no drawer delta, no legs); they re-sync the
   lot decomposition to physical reality whose money movement happened elsewhere.
2. **IN/OUT badge**: n/a — EXCHANGE already maps to "both"; no new type.
3. **Payment legs**: n/a — no new legs; consumption reads `amount_out`/`to_currency`,
   orthogonal to how payout legs split (exotic targets can't split anyway).
4. **Drawers**: n/a — no new drawer movements anywhere in this feature.
5. **Client propagation**: unchanged (`client_name` only on exchange; no client_id today —
   out of scope).
6. **CUSTOMER_ACCOUNT**: n/a — exchange payout legs hard-reject CUSTOMER_ACCOUNT.
7. **Supplier/partner ledger**: no new entries. FOR_EXCHANGE partner rows unchanged;
   realized profit on for-partner sells defers via the existing `notPartnerPending` gate.
8. **Void path**: EXCHANGE stays reversible. NEW in the same change (rule 20):
   `_assertExchangeLotsVoidable` up-front guard in void AND refund (block reversing a BUY
   whose lot has active settlements) + `_reverseExchangeLotEffects` reversal owner
   (SELL reversal restores consumed quantities + flags settlements refunded; BUY reversal
   voids its untouched lot). Prove create+reverse nets to 0 across lots/settlements/drawers/
   profit per currency, failing-first (rule 17).
9. **Profits**: realized profit stamped server-side on the sell's exotic-leg profit column
   + unified `profit_usd`; buy's exotic leg stamps 0 (spread model replaced, owner Q8).
   Refund nets via existing `notRefunded` retro-removal + REFUND-row negation.
   `profitRecognition.guard.test.ts` gains the exchange entry. **The frontend's
   `session.linkTransaction(profitUsd)` must carry the SERVER-returned realized profit**,
   not the client preview — return it from addExchangeTransaction.
10. **Sessions**: documented exclusion stands — exchange has no basket branch; executes
    immediately, links via `session.linkTransaction` (lira-094).
11. **Audit viewer**: unchanged — no new visible types, cash-only filter unaffected.
12. **E2E guard**: extend exchange e2e — buy EUR / partial sell / assert drawer+settlement
    deltas by identity (rule 15); rule-17 proofs live primarily at core-jest level.
13. **Item 14 (one obligation, one owner)**: lots are NOT an obligation ledger — they are a
    cost-basis decomposition of `drawer_balances(General, exotic)`. Flow invariant, per
    currency, per exchange: `covered_lot_qty + market_slice_qty = amount_out = |drawer
    delta|` on sells, and `lot original_qty = amount_in = drawer delta` on buys. With
    "start empty" (Q14) the absolute sums diverge from drawer balances by the pre-feature
    holdings — deltas, not absolutes, are the invariant.
