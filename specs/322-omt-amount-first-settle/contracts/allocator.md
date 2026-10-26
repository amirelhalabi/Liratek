# Contract: `allocateAccountSettlement` (pure, shared)

File: `packages/core/src/utils/accountSettleAllocation.ts`. Re-exported from `index.ts` and `browser.ts`. A leaf module: it imports only `utils/fifoCoverage.ts` and other pure utils, and no Node built-in at any depth (rule 29).

```ts
interface AllocRow {
  kind: "FINANCIAL_SERVICE" | "LEDGER";
  id: number;
  member_supplier_id: number;
  created_at: string;              // compared as a string
  remaining: number;               // signed, this currency: + shop owes, − OMT owes
  commission_model1: boolean;      // eligible for entered-commission allocation
  cashout_commission: number;      // deferred commission recognised if this credit closes
}

interface AllocInput {
  currency: "USD" | "LBP";
  rows: AllocRow[];                // already scoped (selections, covered types)
  paid: number;                    // signed money toward rows: + shop paid, − shop received
  commission: number;              // ≥ 0 — never covers a row (owner 2026-10-15); drives commission_alloc only
  waive: number;                   // ≥ 0, takes the sign of the direction
  eps: number;                     // 0.005 USD, 0.5 LBP
}

interface AllocResult {
  takes: { kind; id; member_supplier_id; source: "NETTING"|"PAYMENT"|"COMMISSION"|"WAIVE"; amount: number }[];
  closed: { kind; id }[];          // remaining ≤ eps after this settlement
  partial: { kind; id; applied: number; remaining: number } | null;
  untouched: { kind; id }[];
  netting_pairs: { credit_member: number; debit_member: number; amount: number }[];
  extra: number;                   // signed; goes on the account (LIRA-315)
  remaining_after: number;         // signed in-scope total still owed
  commission_alloc: { id: number; amount: number }[];  // over closed model-1 FS rows
  cashout_commission_recognised: number;
  direction_from_rows: "PAY" | "COLLECT" | "NONE";
}
```

Order: `created_at` asc (string), then kind (`FINANCIAL_SERVICE` < `LEDGER`), then id. Same order on server and client.

Steps (research R3/R4): net credits against debts → apply the signed budget `paid ± waive` → extra → allocate the commission over closed model-1 rows in proportion to what each row owed before this settlement (largest remainder, cents / whole LBP), for profit only.

Source tagging within the budget: the waive is consumed first, then the money. The allocator never emits `COMMISSION` takes (owner decision 2026-10-15: the commission is credited to the account by the repository after the payment, never used as coverage).

Spec examples that become unit tests (USD, rows $152/$101/$101/$101/$21/$21):

| Input | closed | partial | remaining_after | extra |
| --- | --- | --- | --- | --- |
| paid 300 | 152, 101 | 101: applied 47, remaining 54 | 197 | 0 |
| paid 497 | all 6 | — | 0 | 0 |
| paid 507.11 | all 6 | — | 0 | 10.11 |
| paid 497, commission 0.70 | all 6 | — | 0 | 0 (the 0.70 goes on the account as a credit, booked by the repository) |
| paid 496.30, commission 0.70 | first 5 | 21: applied 20.30, remaining 0.70 | 0.70 | 0 |
| paid 496.30, commission 0 | first 5 | 21: applied 20.30, remaining 0.70 | 0.70 | 0 |
| credit −60 added, paid 100 | credit, 152 | 101: applied 8, remaining 93 | 337 | 0 |
| credit −60 added, paid 437 | all | — | 0 | 0 |
| paid 0.50 | — | 152: applied 0.50 | 496.50 | 0 |

## LIRA-343 extension (account credits, user-chosen credit)

Source: `specs/343-omt-settle-by-day/research.md` R5 (with the 2026-10-26 "Update": the user controls the credit) and `contracts/settle-account-days.md`. Tests: `packages/core/src/utils/__tests__/accountSettleAllocation.accountCredits.test.ts`.

New optional inputs:

```ts
interface AllocInput {
  // ...as above, plus:
  account_credits?: AllocRow[]; // open account-level rows (row_scope = 'ACCOUNT'), this currency,
  // kept apart from `rows`; usually remaining < 0, a positive one is possible
  credit_used?: number; // magnitude ≥ 0, default 0: how much account credit the user chose to use
}
```

New outputs:

```ts
interface AllocResult {
  // ...as above, plus:
  credit_used_too_high?: true; // present only when true; nothing of credit_used was applied; the caller refuses
  account_credit_applied: number; // magnitude actually applied from the account credit pool
  account_partial: { kind; id; applied: number; remaining: number } | null; // the one part-covered ACCOUNT row (either sign)
}
```

Per currency:

1. Day credits in `rows` net against day debts in `rows` (unchanged).
2. Positive account rows net against negative account rows (NETTING on both sides). Then day credits still open net against positive account rows still open. The positive account rows left are **debts in scope**, queued after every day debt (not merged by date).
3. D = signed total still owed by the scope (`rows` + positive account rows). The negative account rows (the credit pool) are not in D.
4. **Shop pays (D > 0)**: `credit_used` must be ≤ min(D, open credit pool), compared in minor units; otherwise `credit_used_too_high`. Exactly `credit_used` of credit (oldest credit first) covers the oldest open debts as NETTING on both sides. Then the money covers the rest oldest first, and money beyond is `extra`.
5. **OMT pays (D ≤ 0, money received)**: `credit_used` must be ≤ the open credit pool, otherwise `credit_used_too_high`. The money covers the day credits first, then up to `credit_used` of account credit (oldest first, PAYMENT takes). Anything beyond that is `extra`. If the money runs out first, `account_credit_applied` < `credit_used`. With no money received, no account credit is used.
6. Account credit never produces `extra`. Account rows the settlement does not touch are listed in `untouched`. Closed account rows are listed in `closed`.
7. With `account_credits` absent or empty and `credit_used` 0, the output equals LIRA-322's, plus `account_credit_applied: 0` and `account_partial: null`.

Field meanings:

- `direction_from_rows` and `remaining_after` are computed over the scope (`rows` + positive account rows), not the credit pool. With no account rows they mean exactly what they did before.
- `partial` covers day rows (`rows`) only, which is LIRA-322's meaning, and is at most one row. After step 1 only one sign is still open among the day rows, and each later step continues that side's oldest-first queue.
- `account_partial` covers account rows of either sign and is at most one row, for the same reason: after the account netting in step 2, only one sign is still open among the account rows.
- **Change from R5's original invariant:** both fields can be set at once. There are two ways:
  - The user chooses the credit, so credit 5.00 of 8.70 with too little money leaves the credit part-used and a day debt part-paid.
  - The account netting can part-cover a positive account row, and the money then stops inside a day debt.
- Every input row appears in exactly one of `closed`, `untouched`, `partial` and `account_partial`. Callers that read `partial` (the repository's waive check, the sheet's preview) must also read `account_partial`.

Owner tables (all test cases). Shop pays: $375 owed, credit $8.70.

| credit_used | paid   | result                                                         |
| ----------- | ------ | -------------------------------------------------------------- |
| 8.70        | 366.30 | all closed, credit used up                                     |
| 5.00        | 370    | all closed, credit part-used, −3.70 left                       |
| 0           | 375    | all closed, credit untouched                                   |
| 8.70        | 300    | #430 part-paid, 66.30 left                                     |
| 0           | 380    | all closed, extra 5.00                                         |
| 9.00        | 366    | `credit_used_too_high`                                         |
| 5.00        | 300    | #430 part-paid (70 left) **and** credit part-used (−3.70 left) |

Positive account rows: account +3 with credit −8.70 → they net, and 5.70 of credit is left to use. Account +10 (no credit), paid 380 → the day rows close, and the +10 is part-paid 5 in `account_partial`. Account +10 and −3, paid 300 → +10 part-netted (7 left, `account_partial`) and #430 part-paid (75 left, `partial`). OMT pays with account +10, received 90 → the day credits net 10 against it, and everything closes.

OMT pays: $100 owed to the shop, credit $8.70.

| credit_used | received | result                       |
| ----------- | -------- | ---------------------------- |
| 8.70        | 108.70   | all closed                   |
| 4.00        | 104      | credit part-used, −4.70 left |
| 0           | 100      | credit untouched             |
