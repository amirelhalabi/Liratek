# Telecom Credit Rate — Re-anchoring `days_cost_lbp` (2026-08-05)

> **Status: IMPLEMENTED 2026-08-05.** R moved from 93,333.33 to
> **85,000 LBP/$** (owner-confirmed). Migration **v146** re-derives every
> `days_cost_lbp` that was written at the old rate and **preserves operator
> overrides**; the rate setting itself only moves if it still holds the old
> default.
>
> Supersedes the R chosen in `done_plans/TELECOM_DAYS_COST_PLAN.md` §4.3. That
> plan's model is unchanged — only its rate was wrong.
>
> **No rename after all.** §3 below originally called for renaming the setting
> carrier-neutral, as part of consolidating it with `alfa_credit_cost_lbp`. That
> consolidation was retracted (the two measure different acquisition channels),
> and `telecom_credit_cost_rate_lbp` was already carrier-neutral — so the rename
> would have been pure churn. Both sites now carry a comment explaining why two
> keys holding the same number is deliberate.
>
> **Why the exact value matters less than it looks:** R is an *allocation* knob.
> Total profit on an Only-Days sale is independent of it — the `credits × R`
> term cancels between `profit_days` and `profit_credit`. So this migration
> moves no money and changes no total; it re-attributes cost between the two
> reporting lines, lifting the days share from 6.67% to **15% of card cost**.
> A "negative credit margin" is therefore attribution, not loss — which is why
> the resale decision aid must state what it compares against.
>
> **Gates:** core **1474/1474** (130 suites, +10 for v146) · frontend **702**
> passed +1 skipped · backend **500/500** · typecheck clean · lint 0 errors /
> 524 warnings · tenant-scoping 0 violations.
>
> **Rule 17:** the override-preservation guard was proven failing-first —
> removing it clobbered a hand-entered 900,000 to 1,159,200 on `up()` and to
> 515,200 on `down()`, then it was restored and the tree verified clean.
>
> **Still open:** §6 Q2(b) per-card anchoring; Q3 — owner ruled **leave `3.79`
> sellable** ("most people buy it as a whole"); and the owner's days sell prices
> so `sell_days_lbp` can be seeded (365d ≈ 2,000,000 known; 10d / 30d / 60d /
> 90d outstanding).

---

## 1. Owner notes driving this (2026-08-04 / 2026-08-05, verbatim intent)

1. **The MTC/Alfa pages use 85,000 LBP as the credit cost.** That is the number
   actually configured (`alfa_credit_cost_lbp`, written by Settings → Shop
   Config) and read by the credit-sale path.
2. **We normally sell 1 credit for 100,000 LBP**, sometimes 120,000.
3. **The 77.28 card's days sell for about $20 — roughly 2,000,000 LBP** — with
   the customer returning the maximum credits. So a days *cost* of 515,200
   "doesn't make sense; it should be more."
4. **Raising the days cost lowers the cost per dollar of credit held**, which is
   what removes the negative resale margins.
5. **The credit sell price must be editable at sale time**, for the case where
   the customer keeps some credit instead of returning the maximum.

---

## 2. What was wrong with `R = 93,333.33`

It came from iPick → mtc → Credits (280,000 ÷ 3$, exactly linear across five
entries). Three independent checks say it is too high, and each one was
available at the time:

| Check | At R = 93,333 | Verdict |
| ----- | ------------- | ------- |
| That price list's own **sell** column | 50,000/$ — **half its cost** | The source is stale. Linearity proved arithmetic, not currency. |
| Cheapest **delivered** cost of $1 | 104,075 vs a 100,000 sell price | Guaranteed loss on every resale. Cannot be true of a daily operation. |
| Cost of $1 **recovered from a card** | 98,805 vs 85,000 to buy directly | Nobody would ever buy cards for credit. |
| Implied **days cost per day** | 1,000–2,500 vs 6,500 standalone | Days priced 4× cheaper bundled than standalone. Implausible. |

The owner's §1.3 objection is the same finding from the days side: the model was
allocating too little cost to days and too much to credit.

---

## 3. The two rates are DIFFERENT quantities (retracting an earlier call)

An earlier recommendation in this workstream was to consolidate onto ONE
credit-cost setting. **That was wrong.** There are two acquisition channels and
they legitimately cost different amounts:

| Quantity | Value | Who uses it |
| -------- | ----- | ----------- |
| Cost of $1 of credit bought **directly** as a top-up | **85,000** (`alfa_credit_cost_lbp`) | The MTC/Alfa credit-sale path. Unchanged. |
| Cost of $1 of credit arriving **embedded in a prepaid card** | **R**, the Only-Days split rate | `days_cost_lbp = cost_lbp − credits × R` |

A card is a bundle: the credit is cheaper per dollar, but you are forced to take
days you may not want, and you pay an SMS haircut to extract it.

**The consistency check that settles it:** at R = 78,433 the card-embedded
credit costs **83,032 per dollar actually recovered** — just under the 85,000
direct price. The two channels come out nearly arbitrage-neutral, which is what
a real market looks like. At R = 93,333 that figure was 98,805, i.e. buying
cards for credit would have been strictly irrational.

**Consequence:** keep both settings. They are not duplicates. Name the new one
so nobody "consolidates" them later — see §6 Q2.

---

## 4. The window R must sit in

Two hard constraints, from the 77.28 card (cost 7,728,000, credits 77.28,
recoverable 73.00, days sell 2,000,000, credit sell 100,000):

```
days margin ≥ 0        →  R >  74,120
credit margin ≥ 0 @3$  →  R ≤  89,679
credit margin ≥ 0 @2$  →  R ≤  87,465
```

So **R ∈ (74,120, 87,465]**. Note 85,000 *is* inside this window — the 77.28
card is fine at 85,000. The problem is the smaller faces (§4.2).

### 4.1 Candidate rates, from the days-margin anchor

| Days margin on 77.28 | days_cost | R | cost/$ held | 3$ deliv | 2$ deliv |
| -------------------- | --------- | - | ----------- | -------- | -------- |
| 0% (cost = sell) | 2,000,000 | 74,120 | 78,466 | 82,651 | 84,743 |
| 10% | 1,818,182 | 76,473 | 80,956 | 85,274 | 87,433 |
| **20%** | **1,666,667** | **78,433** | **83,032** | **87,460** | **89,674** |
| 30% | 1,538,462 | 80,092 | 84,788 | 89,310 | 91,571 |
| 50% | 1,333,333 | 82,747 | 87,598 | 92,270 | 94,606 |

### 4.2 Full picture at R = 78,433 vs R = 85,000 (credit sell 100,000)

| face | recovers | lost | cost/$ held @78.4k | 3$ margin | 2$ margin | @85k 3$ margin | @85k 2$ margin | items |
| ---- | -------- | ---- | ------------------ | --------- | --------- | -------------- | -------------- | ----- |
| **3.79** | 3.00 | **20.8%** | 99,087 | **−4,372** | **−7,014** | **−13,110** | **−15,974** | 3 |
| 4.5 | 4.00 | 11.1% | 88,237 | +7,057 | +4,704 | **−725** | **−3,275** | 6 |
| 7.58 | 7.00 | 7.7% | 84,932 | +10,539 | +8,274 | +3,048 | +594 | 6 |
| 10 | 9.00 | 10.0% | 87,148 | +8,204 | +5,880 | +519 | **−2,000** | 6 |
| 15.15 | 14.00 | 7.6% | 84,876 | +10,598 | +8,334 | +3,112 | +659 | 6 |
| 22.73 | 21.00 | 7.6% | 84,894 | +10,578 | +8,314 | +3,091 | +637 | 6 |
| 77.28 | 73.00 | 5.5% | 83,032 | +12,540 | +10,326 | +5,217 | +2,818 | 6 |

**Items losing money: 3/39 at R = 78,433 · 9/39 (3$) or 15/39 (2$) at
R = 85,000.**

`cost_lbp` cancels out of the delivered-cost algebra (`creditCost = credits × R`
by construction), so every provider's copy of the same face has identical
economics. That is why this table is by face value, not by item.

### 4.3 The `3.79` card is structurally unprofitable at ANY rate in the window

Making it break even at 3$ chunks needs `R ≤ 75,148`; at 2$ chunks
`R ≤ 73,241`, which is **below** the 74,120 floor the days margin imposes. There
is no rate that saves it. It loses 20.8% on recovery — $3.79 of face returns
only $3.00, because 3.79 lands badly against the $3-per-SMS cap, the $0.16 fee
and the $0.50 step.

**This is not about small denominations.** The $10 card (10.0% lost) is *worse*
than the $7.58 card (7.7%). The driver is how the face value lands on the
transfer grid, not its size.

### 4.4 Independent cross-check: implied LBP/day

At R = 78,433, against the standalone iPick mtc Validity list at 6,500 LBP/day:

| Card | days | days_cost | LBP/day |
| ---- | ---- | --------- | ------- |
| 3.79 | 10 | 81,739 | 8,174 |
| 4.5 | 30 | 97,052 | 3,235 |
| 7.58 | 30 | 163,478 | 5,449 |
| 10 | 30 | 215,670 | 7,189 |
| 15.15 | 60 | 337,740 | 5,629 |
| 22.73 | 90 | 490,218 | 5,447 |
| 77.28 | 365 | 1,666,698 | 4,566 |

3,235–8,174, bracketing 6,500 — plausible for bundled days against standalone.
At R = 93,333 the same figures were 1,000–2,500, four times cheaper than buying
days on their own, which should have been treated as a red flag.

---

## 5. Implementation consequences

1. **Migration v144 already wrote `days_cost_lbp` at 93,333.33.** Changing R
   requires a **new migration to re-backfill all 39 items** — values roughly
   double or triple. It must recompute from `cost_lbp` and `credits`, not scale
   the existing value, so a shop that hand-edited an item is not silently
   overwritten (respect a `days_cost_lbp` that no longer equals the old
   formula's output).
2. **The rate setting is renamed** (owner-approved 2026-08-04) to a
   carrier-neutral name, with the migration copying the value. Per §3 it must
   NOT be merged with `alfa_credit_cost_lbp`.
3. **`frontend/src/data/mobileServices.ts` needs no change** — `days_cost_lbp`
   is derived at seed time from `credits` and the rate, so a fresh install picks
   the new rate up automatically.
4. **`lira-132`'s e2e asserts the GROSS cost debit**, which is independent of R,
   so it keeps passing. The unit tests that pin exact `days_cost_lbp` values
   (`telecomCredit.test.ts`, the v144 migration suite) DO encode 93,333-era
   numbers and must be re-derived — rule 17 applies: change them to the new
   expected values only after watching them fail for the right reason.

---

## 6. Decisions needed

**Q1 — What is R?** §4.1 gives the menu. Recommendation: **78,433**, i.e. a 20%
margin on the 77.28 card's days. It puts 36 of 39 items in profit, keeps the two
credit channels arbitrage-neutral, and lands the implied days cost either side
of the standalone 6,500/day. If the true days margin is fatter than 20%, R rises
and margins thin; the window closes entirely above 87,465.

**Q2 — Global rate, or per-card from the days sell price?**

- **(a) One global R.** One number, ships immediately, `days_cost_lbp` derived
  everywhere. Downside: it implies a per-day cost that varies 3,235–8,174 across
  cards, because it is an allocation rule rather than a measured price.
- **(b) Per-card, anchored on `sell_days_lbp`.** The owner knows what the days
  sell for on each card ($20 on the 77.28). Set
  `days_cost_lbp = sell_days_lbp / (1 + target margin)` per item. More accurate,
  makes `sell_days_lbp` — a field currently read by NOTHING — finally load
  bearing, and each card's days cost reflects its real market price. Needs ~7
  numbers from the owner (one per face value).

Recommendation: **(a) now, (b) as the target.** They are compatible — the global
rate is the fallback for any card without a days sell price.

**Q3 — `3.79`?** No rate in the window makes it profitable (§4.3). Exclude it
from Only-Days like `1.22`/`3.03`, or keep it sellable and let the resale
table's break-even column warn per card.

**Q4 — Editable credit sell price at sale time** (owner note §1.5). Belongs with
the deferred `sell_days_lbp` pricing ticket, whose model is already recorded in
`done_plans/TELECOM_DAYS_COST_PLAN.md` §8: the customer pays
`sell_days_lbp + kept_credits × credit_sell_price`, the days price is fixed, and
any operator price edit lands on the credit side. This note adds the
requirement that **`credit_sell_price` be editable per sale** (100,000 normally,
120,000 sometimes) rather than read-only from settings. Confirm that ticket
covers it.

---

## 7. What is NOT in question

The **model** from `TELECOM_DAYS_COST_PLAN.md` stands unchanged:

- `days_cost_lbp = round(cost_lbp − credits × R)`, guarded to
  `0 < days_cost < cost_lbp`
- the catalog price lists contain no extractable days component (a least-squares
  fit returns a *negative* day coefficient), so this is an allocation anchored on
  an external rate, not a measurement
- `days_cost_lbp` drives no drawer amount today — it gates the split and feeds
  the Settings decision aid, so re-backfilling it is money-neutral

Only the rate changes.
