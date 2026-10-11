# Data model — LIRA-305

**No schema change.** Database stays at migration **v209**. No new table, column, index, ledger `transaction_type`,
debt type, payment method or drawer. `create_db.sql` and `migrations/index.ts` are not touched (rule 10 not triggered).

## Existing rows the corridor writes (as built in v185 / `9ed8d90f`, unchanged by this ticket)

### SEND — Custom Services, Via Partner (`partnerMode: "VIA"`, no `direction` / `"IN"`)

| Table | Row | Key fields |
| --- | --- | --- |
| `custom_services` | 1 | `partner_mode='VIA'`, `direction='IN'`, `cost_*` (owed to partner), `price_*` (customer pays), `profit_*` generated |
| `transactions` | 1 `CUSTOM_SERVICE` | `amount_*` = price, `profit_*` = price − cost (+ kept change), `metadata_json.direction='IN'`, `client_*` |
| `payments` | 1 per IN leg (+ OUT change legs) | method's drawer, signed amount |
| `drawer_balances` | Δ per leg | General (or the method's drawer) + |
| `partner_ledger` | 1 per currency with cost > 0 | `THROUGH_CUSTOM_SERVICE`, **CREDIT** (shop owes partner), amount = cost, `reference_table='custom_services'` |
| `debt_ledger` | only for CUSTOMER_ACCOUNT / GIFT_CARD legs | `'Custom Service Debt'` |

### RECEIVE — Custom Services, Via Partner + Pay out (`direction: "OUT"`)

| Table | Row | Key fields |
| --- | --- | --- |
| `custom_services` | 1 | `partner_mode='VIA'`, `direction='OUT'`, `paid_by='CASH'`, `cost_*` = paid out, `price_*` = arrived |
| `transactions` | 1 `CUSTOM_SERVICE` | `amount_*` = paid out, `profit_*` = arrived − paid out, `metadata_json.direction='OUT'` (IN/OUT badge OUT) |
| `payments` | 1 per currency | CASH / General, **negative** (an OUT leg posted by the shared loop, rule 16) |
| `drawer_balances` | Δ | General − |
| `partner_ledger` | 1 per currency with price > 0 | `THROUGH_CUSTOM_SERVICE`, **DEBIT** (partner owes shop), amount = arrived — an obligation head (`partnerObligationRowSql`, LIRA-258 D5) |

### Settling the partner (existing Partners page)

`partner_ledger` `SETTLEMENT` (+ optional `DISCOUNT`), direction from the balance sign; drawer moves by the settlement
method. A CREDIT settlement FIFO-stamps `covered_amount` on DEBIT obligation heads (Pay out DEBITs included).

## Reversal owners (rule 20) — all existing, all measured (research R2)

| Row | Reversed by |
| --- | --- |
| `payments` / `drawer_balances` | `TransactionRepository._reversePayments` (void and refund) |
| `partner_ledger` `THROUGH_CUSTOM_SERVICE` | `TransactionRepository._reversePartnerLedger` (type-agnostic, by reference) |
| profit stamp | reversal / REFUND row with negated profit; status VOIDED |
| `debt_ledger` `'Custom Service Debt'` | `_cancelDebt` (`MODULE_DEBT_TRANSACTION_TYPES`) |
| `SETTLEMENT` + its `covered_amount` stamps | `_reversePartnerSettlementLedger` + `_unwindPartnerSettlementCoverage` |
| **netting (new)** | nothing stored → nothing to reverse; re-derived on every read |

## The derived quantities this ticket adds (read-time only)

Both live in `packages/core/src/constants/partnerObligation.ts` (research R4 has the full rule and the measured cost).

**Partner netting balance** — `partnerNettingBalanceSql(alias)`: for the partner, currency and tenant of `alias`,
Σ DEBIT − Σ CREDIT over every row **except paper credits** — a CREDIT row that is the source of a `PARTNER_ADJUSTMENT`
transaction (`source_table = 'partner_ledger'`, `source_id = row.id`; a manual entry with "Cash moved" off), or a legacy
manual CREDIT from before LIRA-066 (no reference, not SETTLEMENT/DISCOUNT, no `PARTNER_PAYMENT`/`PARTNER_SETTLEMENT`
link) (Y13).
Reversal rows always count (they never carry their own `PARTNER_ADJUSTMENT` link, and paper entries are
non-reversible), so create + void of any row leaves `N` unchanged. Equals `PartnerRepository.getBalance` when the partner
has no paper credits.

**Effective coverage of a partner obligation head** — `partnerEffectiveCoveredSql(alias)`:

- Pay out head (`transaction_type='THROUGH_CUSTOM_SERVICE'`, `direction='DEBIT'`, first row of its group is a DEBIT):
  `coverable − held`, where `held = MAX(0, MIN(unc, N − newerSum))`, `unc = MAX(0, MIN(amount, groupNet) −
  covered_amount)`, `N` = netting balance, `newerSum` = Σ `unc` of the partner's Pay out groups whose head is newer by
  `julianday(head created_at)` then head `id`. When `unc ≤ 0.005` or `N ≤ 0.005`, `held = 0` (and the newer sum is not
  evaluated).
- Every other head: `MIN(covered_amount, coverable)` — today's value.

Invariants (each pinned by a test in T004):

1. 0 ≤ effective covered ≤ coverable (never more than 100%).
2. Σ over a partner's Pay out heads of (coverable − effective covered) = MIN(MAX(0, N), Σ unc) — exactly the money the
   partner still owes is held back, no more, no less.
3. Effective covered ≥ `MIN(covered_amount, coverable)` (netting only adds).
4. Non-Pay-out heads: effective covered = `MIN(covered_amount, coverable)` exactly.
5. Depends only on `partner_ledger` rows (and, for telling paper credits from cash ones, their `transactions` link) of
   one partner, one currency, one tenant.
6. For every Pay out head, `partnerPayoutUncoveredSql` equals `partnerObligationCoverableSql − MIN(covered_amount,
   coverable)`, and the grouped per-group `unc` inside `payoutNewerSumSql` equals `partnerPayoutUncoveredSql` of that
   group's head (rule 14 pins — faster forms of the same definition, not second ones).
7. Create + void (or refund) of ANY partner row — including a cash-moved entry and a `WHISH_TOPUP` — leaves `N`, and so
   every Pay out's effective coverage, exactly where it was.
