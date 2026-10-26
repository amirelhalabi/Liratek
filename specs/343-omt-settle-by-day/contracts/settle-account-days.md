# Contract: settling picked days (LIRA-343)

The endpoint is unchanged: `suppliers:settle-account` (IPC, `admin`) / `POST /api/suppliers/:id/settle-account` (REST, `requireAuth` → `requireRole(["admin"])`). The payload stays `SupplierSettleAccountPayload` (amount-first branch, `per_currency` + `expected_owed`), with one new optional key.

## Schema change (`validators/supplier.ts`, `supplierSettleAccountBaseSchema`)

| Key | Type | Meaning |
| --- | --- | --- |
| `credit_used` | `{ usd?: number, lbp?: number }`, optional, each ≥ 0 | How much account credit to use per currency (owner: the user controls it). The server refuses more than the open account credit or, when the shop pays, more than the scope owes. Requires `include_account_credits`. |
| `include_account_credits` | `boolean`, optional, default `false` | `true` makes the server add every open row with `row_scope = 'ACCOUNT'` (either sign) to the scope, whatever `selections` says. These rows are then passed to the allocator as `account_credits` (R5), not as `rows`. Refused in legacy mode (added to `LEGACY_ONLY`-style refusal for non-`per_currency` payloads). |

**Rule 23 check before wiring.** Diff three key sets for this key: (a) the schema, (b) the preload `data` type (derived via `z.input`, so automatic), and (c) what `_settleAccountAmountFirst` reads. The same change must show the repository reading the key; an accepted key that is never read is a defect.

## Payload the sheet builds (one builder, rule 22)

```
{
  per_currency: { USD?: { direction, payments, commission? }, LBP?: {...} },
  selections: [{ kind, id }, ...],        // picked days' open rows − unticked − waiting
  include_account_credits: true,
  expected_owed: { usd, lbp },            // Σ remaining(selections) + Σ account credits, signed
  covered_omt_service_types?: [...],
  note?
}
```

## Server behaviour (`_settleAccountAmountFirst` / `_amountFirstScope`)

1. Load a fresh queue. Scope = `selections` (existing checks: duplicates, "no longer open", statement types). If `include_account_credits` is set, add every open ACCOUNT credit that is not already in the scope.
2. Stale check: `expected_owed` must equal Σ remaining over the scope, per currency (existing message and prefix).
3. Per currency: `allocateAccountSettlement({ rows: scope − accountCredits, account_credits, paid, ... })`.
4. Write as today: coverage rows (account-credit coverage uses source `NETTING`, so the existing reversal owner applies), legs, overpay, commission credit, `metadata_json` (now also `include_account_credits`).

## Allocator contract change (`utils/accountSettleAllocation.ts`)

New optional input `account_credits: AccountSettleAllocRow[]` (all with remaining < 0, oldest first). The existing contract `specs/322-omt-amount-first-settle/contracts/allocator.md` is extended:

- **D > 0 (shop owes)**: account credits cover min(max(D − paid, 0), Σ|credits|), oldest first, against the oldest open debts (NETTING takes on both sides), before the money covers the rest.
- **D ≤ 0 with money received**: the money covers the day credits in `rows` first, then the account credits, oldest first.
- Account credits never produce `extra`. Unused credits are reported in `untouched`.
- With `account_credits` empty or absent, the output is identical to today's (regression net: the existing allocator tests stay green unchanged).

## Owner acceptance tables (failing-first tests)

Confirmed by the owner 2026-10-26 (page section 4, Q1): the user sets the credit (`credit_used`); the payment does not move it.

**Shop pays.** Picked 23–25 Oct owe $375.00 (after the $40 receive on 24 Oct); account credit $8.70.

| credit set | paid | debts | left over |
| --- | --- | --- | --- |
| 8.70 | 366.30 | all closed | credit 0 |
| 5.00 | 370.00 | all closed | credit 3.70 |
| 0 | 375.00 | all closed | credit 8.70 |
| 8.70 | 300.00 | #430 (25 Oct) part-paid, 66.30 left | credit 0 |
| 0 | 380.00 | all closed | credit 8.70 + extra 5.00 |
| 9.00 | — | refused: more than the credit | — |

**OMT pays.** Picked day credits owe the shop $100.00; account credit $8.70.

| credit set | received | day credits | left over |
| --- | --- | --- | --- |
| 8.70 | 108.70 | closed | credit 0 |
| 4.00 | 104.00 | closed | credit 4.70 |
| 0 | 100.00 | closed | credit 8.70 |

## "Settle old history up to D"

The same endpoint and builder: `selections` = open debts and day credits with `shop_day` ≤ D, `include_account_credits: true`, every section with `payments: []` and money 0. This is accepted today (no money is required, "nothing to settle" counts NETTING takes; research R6). It is undone like any settlement.

## Undo and void (research R12)

No refusal message any more for OMT accounts: any settlement can be undone and any covered transfer voided (FR-018, FR-019). Undo / void write a balancing account row owned by the undo / void transaction; see research R12 and tasks T034–T039.
