# Remaining desktop e2e failures — 4 specs

**Status: DONE 2026-09-20.** All four fixed and verified green. Kept as the design record
for WHY each assertion reads the way it does now — every one of them encodes a deliberate
2026-09-07 behaviour change, so anyone who finds these assertions surprising should read
the matching Family section below before "correcting" them back.

**Scope:** the four desktop specs still red after the 2026-09-20 triage run. Thirteen
other failures from the same run were caused by the OMT open-credit epic and are fixed
(lira-056, 061, 141, 188, 189, 190, 192 all pass).

---

## Outcome — what was actually changed

Four spec files, **zero product code**, exactly as the diagnosis prescribed.

| Spec | Fix |
| --- | --- |
| lira-086 | profit delta `0.34` → `0.50` (gross), plus a new assertion that the `SMS_Transfer_Fee` expense rose by `$0.16` |
| lira-090 | dropped the `deducted` bounds trio for `delta ≈ 60000`, plus the expense delta of `$0.32` — booked in **USD** despite the LBP recharge |
| lira-077 | `getByText("+5 (15 → 20)")` → `/\+5( @ \$[\d.]+)? \(15 → 20\)/`, cost segment optional |
| lira-064 | helper renamed `readNewestPaymentLegsShape` → `readRechargePaymentLegsShape`, now matched by `type === "RECHARGE"` + `metadata_json.phone`, with a distinct `"target-row-not-found"` diagnostic |

Both Family A specs now assert the SMS cost **landed where it now lives**, not merely that
profit went up — so the coverage the old (wrong) assertion provided is preserved rather
than deleted.

### Two places this document's own prescribed fix was WRONG

Recorded because both look right on the page and cost nothing to avoid if you know:

1. **Family C suggested matching the row on `summary.includes("03999888")`.** The recharge
   summary is `Recharge: MTC <detail> — $5 USD` (`RechargeRepository.ts:763`) and **never
   contains the phone number**. The phone lives in `metadata_json.phone` (line 771), which
   `getRecent` does select. Matching on the summary would have failed every time.
2. **Family A suggested finding the SMS expense by `source_ref_table`/`source_ref_id`.**
   `ExpenseRepository.getColumns()` (line 108) does not select those columns, so
   `expenses.getToday()` cannot see them — the expense is real and carries the link in the
   DB, but not on the read path a spec has. Fixed by asserting a **category-scoped
   before/after delta** instead, which satisfies rule 15 better anyway.

Both were caught by reading source before delegating, not by a failing run. Worth the five
minutes.

### Verification

Targeted run, 2026-09-20 — `npx playwright test --config playwright.electron.config.ts
--reporter=list 064 077 086 090`:

```
22 passed (23.0s)
```

All four previously-red tests `ok`, plus the 18 already-green siblings in the same files.
Real run, not a fast-exit false green (rule 28a): per-test timings present, Electron booted
and exited cleanly (`[electron-exit] code=0`), and the **renamed** test titles appear
verbatim in the output — proving the edited code is what ran. lira-064 took 10.3s against
the others' ~20ms, which is the tell that it genuinely drove the UI recharge flow.

Static gates: `tsc -p tsconfig.playwright.json` clean (confirmed via `--listFiles` that it
actually compiled all four files), ESLint exit 0, Prettier clean.

**`yarn test:e2e` no-opped again** (zero output, sub-second) — the LIRA-123 failure mode,
still live in the agent shell. The diagnosis is unambiguous here: `run-e2e.mjs` prints
`[run-e2e] cwd=…` *unconditionally* before it spawns anything, so zero output proves yarn
never reached node. Also note a positional filename filter (`064`) is **not** `-g`, so
`hasGrepFilter()` returns false and the floor of 150 still applies — a targeted run through
the wrapper needs `--min=0` or it fails with `FLOOR CHECK FAILED` despite passing.

## The headline

**None of these four were caused by the OMT epic**, and **all four are SPEC bugs, not
product bugs.** In every case the product is doing what a deliberate change made it do; the
spec was never updated to match. Do not "fix" the product to make these green.

All four were already broken before the OMT work started, and **all four trace to one day —
2026-09-07** — when two features landed and nobody re-ran the specs asserting the old
behaviour. Three of them come from the *same commit*, `cff444ea`.

| Spec     | Line | Root cause  | What changed under the spec                          |
| -------- | ---- | ----------- | ---------------------------------------------------- |
| lira-086 | 95   | `cff444ea`  | SMS fee left recharge profit → profit is now gross    |
| lira-090 | 240  | `cff444ea`  | same change, LBP side                                 |
| lira-064 | 97   | `cff444ea`  | its new auto expense row is now `getRecent()[0]`      |
| lira-077 | 243  | `289d9348`  | adjustment rows gained an `@ $cost` segment           |

lira-064's cause is **confirmed against the failing run's own database**, not inferred — see
Family C. The other three are confirmed by arithmetic and source; each one's expected and
received values fall out of the change exactly.

## Before you run anything

The environment bites harder than the bugs do.

1. `env -u ELECTRON_RUN_AS_NODE` on every e2e command — if that variable is set in the
   shell, Electron boots as plain Node and _every_ spec dies at `waitForEvent("window")`
   with exit code 9. It looks like a total suite failure and is not.
2. Run the **desktop** suite before the web suite. The web suite's `rebuild:node` swaps
   better-sqlite3 to the Node ABI and then every desktop spec times out at the same place.
   Only a full `yarn dev` → stop cycle restores it; `yarn rebuild:native` alone has lied
   about this before.
3. `yarn test:e2e` silently no-ops in an agent shell (exit 0, zero output, sub-second).
   Use `cd frontend && npx playwright test --config playwright.electron.config.ts -g "<title>"`.
   A `FLOOR CHECK FAILED` message on a `-g` run is a false alarm — the floor is 150; trust
   the `N passed` line above it.

---

## Family A — the SMS fee no longer nets out of recharge profit

**lira-086** `frontend/tests/e2e-electron/lira-086-profits-coverage.spec.ts:95`
"a recharge teshriji (CREDIT_TRANSFER) increases recharge profit by its net commission"

```
expect(result.delta).toBeCloseTo(0.34, 2)
  Expected: 0.34   Received: 0.5
```

**lira-090** `frontend/tests/e2e-electron/lira-090-profit-correctness.spec.ts:240`
"Fix 3: an LBP credit transfer deducts a converted (large) SMS cost"

```
const deducted = 60000 - result.delta;
expect(deducted).toBeGreaterThan(5000)
  Expected: > 5000   Received: 0
```

### Why

Commit **`cff444ea`, 2026-09-07 16:45** — _"feat(recharge): SMS transfer fee becomes an
expense, recharge shows gross margin"_. Owner decision dated 2026-09-06. The SMS cost used
to be posted as a payment leg on the recharge itself, which netted it invisibly out of
recharge profit. It now books as its own `SMS_Transfer_Fee` expense via
`ExpenseRepository.createExpense` (`RechargeRepository.ts:1082-1105`), so **recharge profit
is now GROSS** and the SMS cost appears on the expense side of the books instead.

The money still moves exactly once, through the same provider drawer, in the same currency,
at the same magnitude — only the accounting bucket changed.

Both specs were last touched at **2026-09-07 02:27** (`12c3dd72`), **fourteen hours before**
that commit. They were never updated. Confirmed with `git merge-base --is-ancestor`.

The arithmetic matches the hypothesis exactly, which is why this is stated as fact and not
as a lead:

- lira-086 sells a $3 MTC transfer at $3.50. Gross = **$0.50** ← received. 1 SMS × $0.16
  = $0.16. Old net = 0.50 − 0.16 = **$0.34** ← expected.
- lira-090 prices 600,000 LBP against a 540,000 cost. Gross = **60,000 LBP**, so
  `deducted` = 60,000 − 60,000 = **0** ← received. The spec wants a converted 2 × $0.16
  taken off the top.

### What to do

**Do not restore the deduction.** It was removed by an explicit owner decision and
reversing it would double-count the cost, which now has its own expense row.

Rewrite both assertions to the gross figure, and — this is the part that actually preserves
the coverage — add an assertion that the SMS cost landed where it now lives. Each spec
should prove the money is still accounted for, not merely that profit went up:

- lira-086: assert `result.delta` is `0.50`, then assert an `SMS_Transfer_Fee` expense of
  `$0.16` exists for that recharge (it carries `source_ref_table: "recharges"` and
  `source_ref_id`, so it is findable by identity).
- lira-090: assert the LBP profit delta is the full `60,000`, then assert the expense row.
  Note the expense is booked in **USD** (`drawer_override.currency_code: "USD"`,
  `RechargeRepository.ts:1093-1096`) even for an LBP recharge — so the "converted to LBP"
  premise in the spec's own comment is obsolete too. Delete that comment; do not try to
  make it true.

Update the stale comments in both specs. lira-090's comment block still explains a pre-fix
behaviour that has been gone for two weeks.

---

## Family B — adjustment history rows now show their unit cost

**lira-077** `frontend/tests/e2e-electron/lira-077-stock-adjustments.spec.ts:243`
"adjustment history renders in the modal (identity-matched, not position)"

```
await expect(appPage.getByText("+5 (15 → 20)")).toBeVisible()
  → not found
```

### Why

Commit **`289d9348`, 2026-09-07** — _"feat(inventory,suppliers): book supplier debt at stock
intake with FIFO cost batches (v164)"_.

A **positive** stock adjustment is now treated as a real delivery. `AdjustStockModal.tsx:163-171`
routes any `increase > 0` through `receiveStock` instead of `adjustStock`, passing
`unit_cost_usd: Number(unitCost)`, and `unitCost` defaults to the product's own cost price
(`AdjustStockModal.tsx:79`). The history row therefore carries a non-null `unit_cost_usd`,
and the renderer appends it (`AdjustStockModal.tsx:526-530`):

```tsx
{adj.delta > 0 ? "+" : ""}{adj.delta}
{adj.unit_cost_usd != null && ` @ $${adj.unit_cost_usd.toFixed(2)}`}{" "}
({adj.old_quantity} → {adj.new_quantity})
```

The spec seeds the product with `cost_price: 1` and adjusts by `+5` from 15, so the row
renders **`+5 @ $1.00 (15 → 20)`**. Playwright's `getByText(string)` is a substring match,
and `"+5 (15 → 20)"` is not a substring of that. The sibling jest test already asserts the
new format (`AdjustStockModal.test.tsx:416` expects `+2 @ $1300.00 (2 → 4)`) — only the e2e
was left behind.

### What to do

Change the assertion to tolerate the cost segment rather than hard-coding it, so the spec
does not break again the next time the row gains a field:

```ts
await expect(appPage.getByText(/\+5( @ \$[\d.]+)? \(15 → 20\)/)).toBeVisible();
```

Worth a moment's thought, but **out of scope unless you find evidence**: a plain "+5, I
miscounted the shelf" correction now books a FIFO cost batch and, if the product has a
supplier and "old stock" is unchecked, a supplier ledger debit. That is the documented
intent of `289d9348` (an increase _is_ a delivery), so treat it as designed. Only raise it
with the owner if you find a real flow where a pure correction wrongly creates debt.

---

## Family C — the spec reads the newest row

**lira-064** `frontend/tests/e2e-electron/lira-064-payment-legs-summary.spec.ts:97`
"recharge transfer: newest txn exposes structured payment legs and the table renders them"

```
await expect.poll(() => readNewestPaymentLegsShape(appPage)).toBe("ok")
  Expected: "ok"   Received: "payments-empty"
```

### Why

This one is a **rule 15 violation in the spec**, and the file knows it — the _frontend_ half
of the very same test carries a comment explaining why it must not use `tbody tr.first()`.
The _backend_ helper never got the same treatment. `readNewestPaymentLegsShape`
(`lira-064-payment-legs-summary.spec.ts:458-512`) does:

```ts
const list = (await api.transactions.getRecent(5, {}))…;
const newest = list[0];
if (newest.payments.length === 0) return "payments-empty";
```

**Confirmed against the 2026-09-20 run's own database** (the leaked worker profile
`%TEMP%\liratek-e2e-test-0-16884\phone_shop.db`, read with Python's stdlib `sqlite3`). This
is measured, not inferred:

```
recharges.id=6  →  transactions.id=46  RECHARGE  2026-09-20 14:06:04

getRecent() order from that point:
  id   type      legs in DB   source      
  47   EXPENSE   1            expenses    is_auto   <== list[0]
  46   RECHARGE  2            recharges
```

`list[0]` is **id 47, the auto `SMS_Transfer_Fee` expense** — the row introduced by
`cff444ea`, the same commit behind Family A. It is written after the recharge, so it takes
the higher id and wins `ORDER BY created_at DESC, id DESC`.

It has one payment row in the database, but `getRecent` does **not surface it**.
`_attachPaymentLegs` filters every leg through `isInternalLegJs`
(`TransactionRepository.ts:177-201`, "surface only customer-facing cash"), and this leg is
internal twice over: its drawer is `MTC`, which is in `PROVIDER_STOCK_DRAWERS`, and its
method is `SMS_COST`, which is in `INTERNAL_LEG_METHODS`. `toLeg` returns `null`, the array
comes back `[]`, and the helper reports `payments-empty`.

So the product is behaving correctly on both counts — the expense's provider-drawer leg is
not customer cash and should not appear in a customer-facing legs column. The spec is simply
reading the wrong row.

For completeness, the recharge itself (id 46) holds exactly what the spec wants:

```
CASH  LBP  500000.0  drawer=General   ← customer-facing, survives the filter
MTC   USD  -5.0      drawer=MTC       ← internal, filtered
```

One surviving `in:` leg with a currency — the helper would return `"ok"` if pointed at it.

### What to do

Match by identity, not position. The spec already has the identifiers it needs:
`TRANSFER_PHONE = "03999888"` and `TRANSFER_USD = "5"` (lines 29-30). Have the helper
request more rows and pick the recharge:

```ts
const mine = list.find(
  (t) =>
    t.type === "RECHARGE" /* confirm the real type first */ &&
    String(t.summary ?? "").includes("03999888"),
);
if (!mine) return "target-row-not-found";
```

Return a distinct string for "not found" so a future failure tells you _which_ thing broke
instead of collapsing into `payments-empty` again — and note that `RECHARGE` is the type on
the row, confirmed above.

Since the newest row is an `is_auto` expense, `excludeTypes`/`is_auto` filtering would also
make the spec pass. **Don't do that** — it would leave the helper still position-dependent,
green only until the next sibling row arrives. Match by identity.

### Two attributions to ignore

An earlier triage pinned this on `cf19acdd` ("checkpoint payment legs now name their
drawer"). **That was wrong and has been checked.** That commit's only change to
`TransactionRepository.ts` is additive — an optional `drawer_name?: string` on the leg type
and a conditional spread that never assigns `undefined`. `git diff 56b3dcff..HEAD` over that
file shows the legs query itself was not touched this session. Do not spend time there.

The intuitive second guess — that the legless row is the auto `SUPPLIER_PAYMENT` sibling
from `SupplierRepository.addLedgerEntry`, which genuinely does write a transaction row with
no `payments` row at all (`SupplierRepository.ts:1419-1421`) — is **not** what happens here.
An earlier draft of this document asserted it. The database says the row on top is the SMS
expense. The supplier-sibling mechanism is real and worth knowing, but it is not this bug.

---

## Suggested order — ~~plan~~, as executed

All four were diagnosed and none needed investigation first. Executed in this order:
**A** (two specs, one cause), then **B** (one line), then **C** (rewrite the helper to match
by identity). C was the only one that was more than an assertion edit, and the only one whose
outcome was genuinely uncertain before the run.

After each family, run just that spec:

```bash
cd frontend && env -u ELECTRON_RUN_AS_NODE npx playwright test \
  --config playwright.electron.config.ts -g "<test title>"
```

Then run the whole desktop suite once at the end — these specs share one accumulating SQLite
DB and run in order, so a spec that passes alone can still fail in sequence.
