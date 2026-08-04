# Telecom Days Cost — Plan (2026-08-03, implemented 2026-08-04)

> **Status: IMPLEMENTED, UNCOMMITTED.** `R = 93,333.33 LBP/$` owner-confirmed
> 2026-08-04. `days_cost_lbp = round(cost_lbp − credits × R)`, ceiling 98,603
> (§4.4). All gates green; nothing committed at the owner's instruction.
>
> **Shipped in the working tree**
>
> | Piece | Where |
> | ----- | ----- |
> | `TELECOM_CREDIT_COST_RATE_LBP` + `deriveDaysCostLbp()` | `packages/core/src/utils/telecomCredit.ts` |
> | `credits` on all 22 alfa + 21 mtc Prepaid cards | `frontend/src/data/mobileServices.ts` |
> | alfa `validity_days` (6 faces × 3 providers) | same file |
> | v143 credits backfill · v144 rate + days_cost · v145 alfa days | `packages/core/src/db/migrations/index.ts` |
> | `create_db.sql` mirror (3 migration rows + the R setting) | `electron-app/create_db.sql` |
> | Fresh-install path (parser → preload → handler → Zod → repo) | `parseCatalogToSeedData.ts` + the IPC chain |
> | `R` seeded for newly provisioned tenants | `packages/core/src/repositories/TenantRepository.ts` |
>
> **Gates (run directly, not delegated):** core 1462/1462 · frontend 693 passed
> +1 skipped (86 suites) · backend 500/500 · typecheck clean · lint 0 errors /
> 524 warnings (baseline) · tenant-scoping 0 violations.
>
> **Still open:** §10 Q2 (alfa 1.22/3.03 day counts), §10 Q6 / §8 (wiring
> `sell_days_lbp` — owner deferred to its own ticket), and plan §6 steps 4–5
> (set-primary + self-charge UI), which are also what keeps
> `TELECOM_DAYS_VALIDITY_PLAN.md` from being archivable.

Follow-up to LIRA-090 (`TELECOM_DAYS_VALIDITY_PLAN.md`, `LIRA_090_HANDOFF.md`).
Answers the question: **where does `mobile_service_items.days_cost_lbp` come
from**, so items stop reading "No split" in Settings → Mobile Services.

---

## 1. The Only-Days item inventory (iPick, Katsh, WHISH_APP)

An item is an **Only-Days candidate** only if it bundles BOTH USD credit and
validity days — the customer keeps the days, the credit is SMSed back. Cards
that carry only one of the two are out of scope: nothing to return, or no days
to sell.

**39 candidate items** (revised 2026-08-04 — was 43 before the owner ruled `1.22`/`3.03` credit-only). Costs are LBP; `credits` = card face value in USD.

### 1.1 alfa Prepaid — 22 items, of which **18 are Only-Days candidates**

| Card | iPick cost | Katsh cost | WHISH_APP cost | credits | validity_days |
| ---- | ---------- | ---------- | -------------- | ------- | ------------- |
| 1.22  | 140,000   | —         | —         | 1.22  | — *(credit-only, excluded)* |
| 3.03  | 322,000   | 318,978   | 318,978   | 3.03  | — *(credit-only, excluded)* |
| 4.5   | 466,000   | 462,075   | 462,075   | 4.5   | **10** |
| 7.58  | 770,000   | 765,007   | 765,007   | 7.58  | **30** |
| 10    | 1,000,000 | 1,003,274 | 1,003,274 | 10    | **30** |
| 15.15 | 1,515,000 | 1,511,601 | 1,511,601 | 15.15 | **60** |
| 22.73 | 2,273,000 | 2,256,769 | 2,256,769 | 22.73 | **90** |
| 77.28 | 7,728,000 | 7,620,030 | 7,620,030 | 77.28 | **365** |

`1.22` exists on iPick only. `credits` seeded 2026-08-03; `validity_days` seeded 2026-08-04 from the owner's Katsh alfa reading and mirrored to all three providers (migration v145).

**`1.22` and `3.03` carry NO validity_days and are NOT Only-Days candidates** — the owner could not confirm a day count for them (2026-08-04), so they are treated as credit-only, the alfa equivalent of mtc `1`/`1.67`. Pinned by tests in `parseCatalogToSeedData.test.ts` and the v145 suite.

Note the alfa day counts deliberately DIVERGE from the mtc card of the same face value on `4.5` (alfa 10 vs mtc 30). `15.15` was first reported as 30 and owner-corrected to 60 after a per-day cost cross-check flagged it as the outlier of the alfa set.

### 1.2 mtc Prepaid — 21 items, all Only-Days candidates (`credits` seeded 2026-08-04)

| Card | iPick cost | Katsh cost | WHISH_APP cost | validity_days | credits |
| ---- | ---------- | ---------- | -------------- | ------------- | ------- |
| 3.79  | 379,000   | 398,723   | 398,723   | 10  | **3.79** |
| 4.5   | 450,000   | 462,518   | 462,518   | 30  | **4.5** |
| 7.58  | 758,000   | 765,007   | 765,007   | 30  | **7.58** |
| 10    | 1,000,000 | 1,003,274 | 1,003,274 | 30  | **10** |
| 15.15 | 1,526,000 | 1,509,829 | 1,509,829 | 60  | **15.15** |
| 22.73 | 2,273,000 | 2,255,883 | 2,255,883 | 90  | **22.73** |
| 77.28 | 7,728,000 | 7,620,030 | 7,620,030 | 365 | **77.28** |

### 1.3 Explicitly OUT of scope

| Items | Why |
| ----- | --- |
| mtc Prepaid `1`, `1.67` (all 3 providers) | credit-only, no validity days — nothing to sell as "days" |
| **alfa Prepaid `1.22`, `3.03`** | credit-only — owner could not confirm a day count (2026-08-04); same treatment as mtc `1`/`1.67` |
| iPick mtc **Credits** (`3$`…`15$`) | direct credit top-up, no days |
| iPick mtc **Validity** (`10 days`…`360 days`) | days-only, no credit to return |
| mtc `start`, `startSOS`, `smart`, `super` | named plans, no face value or day count |
| alfa Mobile Internet / Alfa Go / Weekly data / Boosters / Weekender | data & bundles, not credit+days cards |

---

## 2. The blocking finding: cost does NOT decompose

The obvious approach — "subtract the days portion out of the card cost" — does
not work, and the catalog proves it.

**iPick mtc Prepaid cost is exactly `face_value × 100,000 LBP` on 6 of 7 cards:**

| Card | cost | face × 100,000 | difference |
| ---- | ---- | -------------- | ---------- |
| 3.79  | 379,000   | 379,000   | **0** |
| 4.5   | 450,000   | 450,000   | **0** |
| 7.58  | 758,000   | 758,000   | **0** |
| 10    | 1,000,000 | 1,000,000 | **0** |
| 15.15 | 1,526,000 | 1,515,000 | 11,000 |
| 22.73 | 2,273,000 | 2,273,000 | **0** |
| 77.28 | 7,728,000 | 7,728,000 | **0** |

The card price is **entirely** the credit face value. The validity days are
bundled at no separately identifiable cost. There is no days component sitting
inside `cost_lbp` waiting to be extracted — which is why no formula over the
catalog can produce `days_cost_lbp`.

**The standalone validity price list does not rescue it.** iPick → mtc →
Validity is a perfectly linear days-only price list at **6,500 LBP/day**
(65,000/10, 195,000/30, 390,000/60, 585,000/90, 1,170,000/180, 2,340,000/360 —
zero deviation). Tempting, but pricing the bundled days at that rate is
incoherent: it charges the 365-day card 2,372,500 LBP for its days — 31% of the
whole card — and leaves an implied credit rate that swings from 56,667 to
82,850 LBP/$ across the same seven cards. A single commodity cannot cost that
many different amounts. Standalone days ≠ bundled days.

*(Note: this price list exists only on iPick. Katsh and WHISH_APP carry mtc
Prepaid only — no Validity or Credits categories at all.)*

---

## 3. What is already true, and what is missing

### 3.1 Done (uncommitted, working tree) ✅

`credits` = card face value on **all 22 alfa + 21 mtc** Prepaid cards across
iPick, Katsh and WHISH_APP (`frontend/src/data/mobileServices.ts`), plus alfa
`validity_days` for the 6 confirmed faces. Owner-confirmed 2026-08-03/04.
Existing installs are covered by migrations v143 (credits) and v145 (alfa
days), because `parseCatalogToSeedData` only runs when the table is empty.

### 3.2 The mutual-exclusivity invariant — RETIRED ✅

`ItemPricing` documents `credits` and `validity_days` as *mutually exclusive*
("Mutually exclusive with validity_days on every card that carries one of the
two"). **Only-Days requires both on the same item.** That invariant was written
when the catalog recorded one attribute per card; it now blocks the feature.
Retiring it is a prerequisite for §1.2 — the mtc cards cannot gain `credits`
while it stands.

This is a doc/comment change plus a check of anything branching on "has credits
XOR has days" (`KatchForm.tsx:197` renders on either, so it is already tolerant).

### 3.3 Missing data

| Gap | Items | Status |
| --- | ----- | ------ |
| `validity_days` | 18 alfa Prepaid | ✅ seeded + migration v145 (2026-08-04) |
| `validity_days` | alfa `1.22`, `3.03` | ⏳ **owner** — excluded as credit-only until confirmed |
| `credits` | 21 mtc Prepaid | ✅ seeded + migration v143 |
| `days_cost_lbp` | all 39 candidates | ✅ derived from `R` (§4.3) + migration v144 |
| `sell_days_lbp` | all 39 | ⏳ owner pricing decision — deferred to its own ticket (§8, §10 Q6); nothing reads it today (§3.4) |
| `sell_credit_lbp` | all 39 | ⏳ owner pricing decision (decision-aid only) |

### 3.4 The three split fields are NOT the same kind of thing

The edit row shows "Days cost / Sell days / Sell credit" as one group, which
hides that they have completely different standing. Only one of them does any
work today. Verified against the code at HEAD, 2026-08-03:

| Field | Kind | Gates "Split"? | What actually reads it |
| ----- | ---- | -------------- | ---------------------- |
| `days_cost_lbp` | **cost** — what the shop pays | **YES** | `isTelecomSplitComplete`, `deriveItemEconomics`, and `KatchForm`'s Only-Days default. **CORRECTION 2026-08-04:** an earlier revision of this table also credited it with "the repository's `processTelecomCreditReturn` netting" — that is wrong. `days_cost_lbp` appears exactly ONCE in `FinancialServiceRepository.ts`, in a comment. Its only repository use is inside the `isTelecomSplitComplete(item)` call at `:1349`, which picks a *fallback* returned-credit default — and the frontend always sends an explicit `returnedCreditsUsd`, so `:1347` wins and that fallback never fires today. **No drawer amount depends on it.** Backfilling it is therefore money-neutral, which the adversarial review confirmed independently by tracing the LBP debit to the frontend's `cost`. |
| `sell_credit_lbp` | **price** — what the shop charges per $1 of resold credit | no | Settings' hover resale table only (`sellCreditRef`), falling back to a hardcoded 100,000 when empty. Display/decision aid — the migration's own words. |
| `sell_days_lbp` | **price** — what the customer pays for a days-only sale | no | **Nothing.** Written, stored, and read back into the edit form. No computation, no sale-path use, no display anywhere else. |

Consequences:

1. **Filling in "Sell days" changes nothing.** An Only-Days sale still prices
   itself through the normal recharge flow; this field is never consulted. It
   is either (a) unfinished wiring from LIRA-090, or (b) a field that should be
   removed from the form until something uses it. Leaving it as-is invites the
   owner to set a price that silently does not apply.
2. **Neither "sell" field is derivable, ever.** They are pricing decisions, not
   carrier facts — no formula can produce them, and §4's Model A/B debate does
   not touch them. They should never be seeded with computed values.
3. Only `days_cost_lbp` needs the §4 decision. The other two can be left empty
   indefinitely with no loss of function beyond the resale table's reference
   price falling back to 100,000.

**Recommendation:** resolve `days_cost_lbp` per §4 and seed it. Leave both
"sell" fields empty and owner-entered. Separately decide whether to wire
`sell_days_lbp` into the Only-Days sale price or drop it from the form — a
field that accepts input and ignores it is worse than no field.

---

## 4. RESOLVED (2026-08-04) — anchor on the credit rate

**`days_cost_lbp` = `cost_lbp − credits × R`**, where **R is the shop's cost of
$1 of credit** — one owner-supplied number for the whole catalog. Rationale and
the rejected alternatives below; the resolution itself is §4.3.

### 4.0 Why every "derive it" route fails

The identity `cost = N × rate + days_cost` has **two unknowns and one
equation**. Fixing `N` does not help: a rate can only be computed as
`(cost − days_cost)/N`, so feeding it back returns the days cost you assumed.
The historical **1,162,000** is exactly this — reconstructed 2026-08-04 as
`7,600,000 − 68 × 94,676 = 1,162,032`, where 94,676 is itself `6,438,000 / 68`.
It is a restatement of its own input, not a measurement, and `N = 68` matches
no SMS scenario (1$/SMS delivers 66, 2$ delivers 70, 3$ delivers 72 from a 77$
balance). **Do not treat 1,162,000 as evidence.**

The days **sell** price cannot fill the gap either: `cost_lbp` is a cost, so
putting a sell price on the right-hand side forces `profit_days = 0` by
construction and collapses the §8 profit split.

Below are the two definitions considered before the anchor was chosen.

### 4.1 Rejected — Model A: carrier's days price (what LIRA-090 assumes)

`days_cost_lbp` is what the validity days genuinely cost the shop from the
carrier. Not derivable from the catalog (§2) — it is a number the carrier or
the owner supplies, one per card. LIRA-090's worked example uses
**1,162,000 on a 7,600,000 / 77-credit card — 15.3% of cost.**

- Honest to the model's stated meaning; `recoveredRateLbp` stays informative.
- Requires 43 hand-supplied numbers (or 8, if one value per face is reused
  across providers).

### 4.2 Rejected — Model B: the recovery haircut (derivable but circular)

The days cost us exactly the credit we **cannot** get back through SMS:

```
days_cost_lbp = cost_lbp × (1 − maxReturnableCredits(credits) / credits)
```

Every value is positive, below `cost_lbp`, and satisfies
`isTelecomSplitComplete` — all 43 items would flip to "Split" immediately:

| Card | cost | credits | maxReturnable | days_cost | % of cost |
| ---- | ---- | ------- | ------------- | --------- | --------- |
| iPick alfa 1.22 | 140,000 | 1.22 | 1.00 | 25,246 | 18.0% |
| iPick alfa 3.03 | 322,000 | 3.03 | 2.50 | 56,323 | 17.5% |
| iPick alfa 77.28 | 7,728,000 | 77.28 | 73.00 | 428,000 | 5.5% |
| Katsh alfa 77.28 | 7,620,030 | 77.28 | 73.00 | 422,020 | 5.5% |
| iPick mtc 3.79 | 379,000 | 3.79 | 3.00 | 79,000 | 20.8% |
| iPick mtc 4.5 | 450,000 | 4.5 | 4.00 | 50,000 | 11.1% |
| iPick mtc 77.28 | 7,728,000 | 77.28 | 73.00 | 428,000 | 5.5% |

**The catch, stated plainly:** Model B moves the SMS haircut out of
`recoveredRateLbp` and into `days_cost_lbp`. The algebra then collapses
`recoveredRateLbp` to exactly `cost_lbp / credits` — the card's own per-dollar
price. The resale decision table still works (`deliveredCostLbp` adds its own
chunk fee on top) but it stops telling you anything about recovery losses,
because those are now booked as days cost. On the spec's card, Model B yields
394,805 (5.2%) against Model A's 1,162,000 (15.3%).

### 4.3 THE RESOLUTION — credit-rate anchored

```
days_cost_lbp = cost_lbp − credits × R
```

`R` = what $1 of credit costs the shop. **One number, owner-supplied, applies
to every card in the catalog.** It replaces both models above.

**Why this and not Model A or B.** It makes the *known* the input and the
*unknown* the output. `R` is a price the shop actually transacts at and can
verify against the market; the days cost is the thing nobody quotes. Model A
needs 8+ numbers nobody has; Model B derives days cost from the SMS haircut and
collapses `recoveredRateLbp` to `cost/credits`.

**Why `credits` (face) and not `maxReturnableCredits`.** The card is *bought*
carrying its full face credit — the SMS loss happens later, only if the credit
is transferred. Allocating the purchase cost at face value keeps that loss
visible as an operating cost of the Only-Days flow instead of burying it in the
days cost, and it avoids Model B's circularity.

**Precedent — this repo already used this exact formula.** Pre-LIRA-090,
`KatchForm.calcCost` sent `cost − credits × 85,000` with 85,000 hardcoded. That
is where lira-132's "only charged ~1,055,000 LBP" comes from:
`7,600,000 − 77 × 85,000 = 1,055,000` exactly. **The B1 bug was the repository
double-netting the same recovery, not this formula.** Its shape survives; only
the hardcoded rate needs replacing with a configured `R`.

**Independent convergence.** At `R = 85,000` the iPick 77.28 card yields
**1,159,200** — within **0.24%** of the historical 1,162,000, reached by a
completely different route. Weak evidence (the historical figure is circular),
but the two not contradicting is worth recording.

### 4.4 Guard rail — R has a hard ceiling

`days_cost_lbp` must stay `> 0` and `< cost_lbp` or `isTelecomSplitComplete`
rejects the item. That caps `R` below `min(cost/credits)` across the catalog:

**R must be below 98,603 LBP/$** (set by Katsh/WHISH alfa 77.28,
7,620,030 / 77.28). Above it, that card's days cost goes negative and the item
silently stops offering the computed flow. At R = 100,000 several cards go to
exactly 0 — the iPick mtc cards price at precisely face × 100,000 (§2).

Any migration seeding `days_cost_lbp` must assert this per card, not assume it.

### 4.5 Worked values

`days_cost_lbp = cost_lbp − credits × R`:

| Card | cost | R=80k | R=85k | R=90k |
| ---- | ---- | ----- | ----- | ----- |
| iPick alfa 1.22 | 140,000 | 42,400 | 36,300 | 30,200 |
| iPick alfa 3.03 | 322,000 | 79,600 | 64,450 | 49,300 |
| iPick alfa 77.28 | 7,728,000 | 1,545,600 | **1,159,200** | 772,800 |
| Katsh alfa 77.28 | 7,620,030 | 1,437,630 | 1,051,230 | 664,830 |
| iPick mtc 3.79 | 379,000 | 75,800 | 56,850 | 37,900 |
| iPick mtc 4.5 | 450,000 | 90,000 | 67,500 | 45,000 |
| iPick mtc 77.28 | 7,728,000 | 1,545,600 | 1,159,200 | 772,800 |

All 43 items stay positive at R ≤ 90,000. Full table regenerable from the
catalog — no per-card owner input needed.

### 4.6 Where R should live

Not hardcoded (that was the bug). Options, in preference order:

1. **A tenant setting** — `telecom_credit_cost_rate_lbp`, alongside the existing
   `telecom_credit_sell_price_lbp` (seeded 100,000, currently read by nothing,
   §3.4). Cost and sell rate then sit together and both feed the resale table.
2. Per-carrier settings if Alfa and MTC credit genuinely costs different amounts
   — check before assuming they don't.

Note the existing `alfa_credit_cost_rate_lbp` key belongs to the separate Alfa
Gift channel (v140's own description says so) — do **not** overload it.

**Open item:** the sweep found the Recharge page had been ignoring the
configured Alfa credit-cost setting and falling back to a hardcoded 85,000.
Confirm what the shop actually pays for credit before fixing `R` — if it is not
85,000, every figure in §4.5 moves.

---

## 5. Self-charge: the measuring instrument (and the owner's actual ask)

> "recharging this item would add days to our phone number if we recharge our
> own one"

That is `FinancialServiceRepository.selfChargeTelecomItem` + `TELECOM_SELF_CHARGE`
— **fully built in core, with correct void/refund reversal, and reachable from
no button anywhere in the app** (confirmed 2026-08-03). Building its UI does two
things at once:

1. Delivers the capability the owner is describing — charge a card to the shop's
   own MTC/Alfa line, extending that line's credits and validity.
2. **Measures the split empirically.** Self-charge one card per face value on a
   shop line, then read the carrier's response: days added and credit added.
   That is Model A's missing number, observed rather than guessed — and it is
   the only route that also fills the 22 missing alfa `validity_days`.

Prerequisite: a **primary carrier line** must be settable. That is also built
end-to-end with no UI control (`setPrimary`/`getPrimary`), so nothing can be
self-charged until a "Set primary" action exists in Settings → Carrier Lines.

---

## 6. Implementation order — steps 1,2,3,7a,7b DONE; 4,5,8 open

| # | Step | Blocked by |
| - | ---- | ---------- |
| 1 ✅ | Retire the mutual-exclusivity comment; confirm no code branches on it (§3.2) | — |
| 2 ✅ | Seed `credits` on the 21 mtc Prepaid cards (= label, same rule as alfa) | 1 |
| 3 ✅ | **Migration v143**: backfill `credits` for existing installs, alfa + mtc Prepaid, `WHERE credits IS NULL`; mirrored into `create_db.sql` (rule 10). GLOB guard stops SQLite's silent `CAST('start' AS REAL) = 0.0`, proven failing-first | 2 |
| 4 ❌ | "Set primary" control in Settings → Carrier Lines — **also blocks archiving TELECOM_DAYS_VALIDITY_PLAN.md** | — |
| 5 ❌ | Self-charge UI (Recharge or Settings → Mobile Services), admin-only per LIRA-090's role decision — **also blocks archiving TELECOM_DAYS_VALIDITY_PLAN.md** | 4 |
| 6 ⏸ | Measure days + credit per face value via §5 — no longer needed for the 6 confirmed alfa faces; still the route for / | 5 |
| 7a ✅ | **Added the `R` setting** (§4.6) and compute `days_cost_lbp = cost_lbp − credits × R` for all 39 candidates; **migration v144** backfills, asserting `0 < days_cost < cost` per card (§4.4). `R = 93,333.33` | done 2026-08-04 |
| 7b ✅ | Seed `validity_days` for the alfa cards + **migration v145** — 6 faces × 3 providers = 18 rows. `1.22`/`3.03` deliberately excluded (owner could not confirm a day count), so they stay credit-only and out of Only-Days: **candidate count 43 → 39** | owner numbers, 2026-08-04 |
| 8 ❌ | E2E: an Only-Days sale on a real seeded card, asserting drawer deltas by identity and delta (rule 15) — and un-skip `lira-132`'s `test.fixme` money case. The adversarial review flagged this as the one plan-mandated gap nothing closed; it is lower-risk than it reads, since §3.4 now shows the backfill is money-neutral | 7a |

**7a no longer waits on 4–6.** Since §4.3 anchors on a single rate rather than
per-card carrier figures, `days_cost_lbp` can ship as soon as the owner names
`R` — the self-charge measurement is now only needed for `validity_days` (7b).
Steps 1–3 are safe now and change nothing visible; **7a is the step that clears
"No split"** on all 43 items at once. Steps 4–5 remain the owner's separate
feature request.

## 7. Testing notes ✅ (except step 8's e2e)

- Rule 17 applies to every money-affecting step: prove each guard fails on the
  pre-fix code before it counts.
- `days_cost_lbp` changes profit on every Only-Days sale. Any backfill migration
  needs a test asserting a create+void nets to 0 across every ledger, per
  currency (rule 20).
- The seed is frontend data; its guard belongs in
  `frontend/src/data/__tests__/mobileServices.test.ts`. The migration's guard
  belongs in `packages/core/src/db/migrations/__tests__/`.

## 8. Only-Days pricing & profit attribution (owner model, 2026-08-04)

The owner's pricing rules for an Only-Days sale, which make `sell_days_lbp`
worth wiring (see §9 for the resale rate it depends on):

1. **Days price is FIXED** (`sell_days_lbp`). It does not move.
2. **Customer returns the max credit** → charged `sell_days_lbp`.
   `profit_days = sell_days_lbp − days_cost_lbp`.
3. **Customer keeps some credit** → charged
   `sell_days_lbp + kept_credits × credit_sell_price`.
4. **Operator edits the total price** up or down → the delta is attributed to
   the **credit** side, never to days. Days stay fixed by rule 1.

Attribution that falls out, and the reason this model is worth having:

```
revenue_days   = sell_days_lbp                         (fixed)
revenue_credit = total_charged − sell_days_lbp         (absorbs any price edit)
profit_days    = sell_days_lbp − days_cost_lbp
profit_credit  = revenue_credit − kept_credits × credit_cost_per_dollar
```

This gives two separately reportable profit lines — days and credit — instead
of one blended number, which is exactly what the shop wants to see.

**Blocked on the same input.** `profit_days` is `sell_days_lbp − days_cost_lbp`,
so it is only as trustworthy as the §4 decision. And `credit_cost_per_dollar`
is the §9 resale rate.

**Not a free addition.** Today an Only-Days sale charges the customer the GROSS
card cost (`lira-132` asserts the iPick/Katsh LBP drawer takes the full
`+7,600,000` IN). Rules 2–4 change what is charged, so drawer deltas, profit
stamping and that spec all move. Own ticket, own failing-first tests (rule 17).

## 9. RESOLVED 2026-08-04 — the credit RESALE rate is TWO hops

**Owner ruling:** a customer who keeps some credit sends the rest back to the
shop's line; the shop then **resells that recovered credit through the MTC or
Alfa tabs, and yes, it costs $0.16 per message** to send out. Both hops are
real, so the code's two-hop model is correct:

```
cost per $1 delivered = creditCost / maxReturnableCredits(credits) × (1 + 0.16/chunk)
                      = 6,438,000 / 73 × 1.08  =  95,247 LBP   (2$ chunks)
```

**Already implemented — nothing to build.** `RechargeRepository.ts:747-756`
computes `smsCount = ceil(amount / MAX_CREDIT_PER_SMS_USD)` on a
`CREDIT_TRANSFER`, multiplies by `SMS_TRANSFER_FEE_USD`, converts to the sale
currency for LBP-priced transfers, and subtracts it from the recharge
commission. It imports both constants from `telecomCredit.ts` rather than
redeclaring them, so rule 14 already holds.

**Open nuance:** that sale path assumes **3$ per SMS** (`ceil(amount / 3)`, the
cheapest chunking), while the §4.5 resale decision table uses **2$** as the
house average. Two different chunk assumptions inside one feature. Not a bug —
they answer different questions — but they will disagree, and whichever is
adopted as the house convention should be applied to both.

### 9.1 The reconstruction that resolved it (kept for provenance)

The owner's working figure was **96,676 LBP per $1**, described as the
2$-per-SMS scenario. It could not be reproduced from the code's chain. Nearest
reconstruction, within 0.04%:

```
creditCost / credits × (1 + 0.16/1) = 6,438,000 / 77.28 × 1.16 = 96,637
```

— which uses the **1$** multiplier over the **face** credit (77.28), not the 2$
multiplier over the **recoverable** credit (73). Every other candidate is off by
≥1,400.

Two independent modelling choices are being conflated:

| Choice | Option A | Option B |
| ------ | -------- | -------- |
| Divisor | face credits (77.28) — assumes all of it comes back | recoverable credits (73) — books the SMS loss on the way IN |
| Multiplier | none | `(1 + 0.16/chunk)` — books the SMS fee on the way OUT |

The code counts **both hops** (card → shop's own line → customer). The owner's
figure counts roughly **one**. The physical question that settles it:

> When the shop resells recovered credit, does it go **card → our line →
> customer** (two SMS hops, two sets of fees) or **card → customer** directly
> (one hop)?

Cost per $1 delivered, cost 7,600,000 / days 1,162,000 / credits 77:

| Chunk | Two hops (code: `deliveredCostLbp`) | One hop (`creditCost / delivered`) |
| ----- | ---------------------------------- | ---------------------------------- |
| 1$ | 102,302 | 97,545 |
| **2$** | **95,247** | **91,971** |
| 3$ | 92,896 | 89,417 |

Also note the two models disagree on how much comes back at a fixed chunk size:
`maxReturnableCredits(77) = 73` optimises the message count freely (25 messages),
but a fixed 2$ chunk recovers only **70$** (35 messages), and a fixed 1$ chunk
only **66$**. The code's `deliveredCostLbp` does not re-derive recovery per
chunk — it applies the chunk fee on top of the optimum. If the shop really does
send fixed-size chunks, that is a second correction to make.

Taking the 2$ column as the house reference is a sound convention; it just has
to be applied to whichever chain is physically true.

## 10. Owner questions — answers of record

| # | Question | Answer (2026-08-04) |
| - | -------- | ------------------- |
| 1 | **What is `R`, the shop's cost of $1 of credit?** | **93,333.33 LBP/$** — observed, not assumed: iPick > mtc > Credits is the one category where credit is bought with no days attached, and it is exactly linear across all five entries (280,000/3$). Below the 98,603 ceiling with 5.3% headroom. The old hardcoded 85,000 was rejected as unsourced. |
| 2 | Days per **alfa** card | 4.5 → 10, 7.58 → 30, 10 → 30, 15.15 → **60**, 22.73 → 90, 77.28 → 365. Read off the Katsh shelf, mirrored to iPick/WHISH_APP. **`1.22` and `3.03` STILL OPEN** — owner could not confirm; excluded as credit-only until they can. |
| 3 | Is `R` per-carrier? | **One global rate.** The 93,333.33 evidence is MTC-only; assuming Alfa matches. Revisit if Alfa credit turns out to cost differently. |
| 4 | Same days across the three providers? | **Yes** — owner: "match by item name". The mtc block is already byte-identical across all three, and migration v135 established the same cross-provider rule. |
| 5 | `telecom_credit_sell_price_lbp` seeded at 100,000, read by nothing | **STILL OPEN.** Should the resale table use it instead of its hardcoded 100,000 fallback? |
| 6 | Wire `sell_days_lbp`? | **Deferred to its own ticket.** Wiring it changes what the customer is charged (today an Only-Days sale takes the gross card cost), so it moves drawer deltas, profit stamping and `lira-132`. Owner's pricing model is recorded in §8. |
| 7 | *(new, from §9)* 2$ vs 3$ chunk | **STILL OPEN.** The sale path charges the SMS fee at `ceil(amount / 3)` while the resale decision table uses 2$ as the house average. They will disagree; pick one convention. |

---

## 11. Status — what shipped, what is left

### Shipped (uncommitted working tree, all gates green)

| Step | What |
| ---- | ---- |
| 1 | Mutual-exclusivity invariant retired in `ItemPricing` |
| 2 | `credits` on 21 mtc Prepaid cards (alfa's 22 were done 2026-08-03) |
| 3 | **v143** credits backfill — GLOB guard against SQLite's silent `CAST('start' AS REAL) = 0.0`, proven failing-first |
| 7a | `TELECOM_CREDIT_COST_RATE_LBP` + `deriveDaysCostLbp()`, **v144** rate setting + days_cost backfill (per-tenant, reads each tenant's own rate) |
| 7b | alfa `validity_days` + **v145** backfill, `1.22`/`3.03` excluded, proven failing-first |
| — | Fresh-install path: `parseCatalogToSeedData` → preload type → handler → Zod → repository insert |
| — | `R` seeded for newly provisioned tenants (`TenantRepository`) |

**Gates, run directly rather than delegated:** core 1462/1462 · frontend 693
passed + 1 skipped (86 suites) · backend 500/500 · typecheck clean · lint 0
errors / 524 warnings (baseline) · tenant-scoping 0 violations.

### Three defects found by running the full suite myself

The delegated agents ran only core + frontend and reported green. The full
sweep caught what that scope missed:

1. **`TenantRepository` never seeded `R`.** Migration v144 covers tenants that
   exist when it runs; a tenant provisioned afterwards got nothing, so every
   Only-Days item in a newly provisioned shop would silently read "No split".
   Caught by `wp5_wp6_admin_tenant.api.test.ts` counting 5 settings against
   tenant 1's 6.
2. **Frontend jest resolved core's NODE entry** (`src/index.ts`, which
   re-exports `./db/dbPath.js`) while Vite resolves the **browser** entry. Tests
   had been papering over this by mocking the whole package; the moment a real
   module imported core, the suite failed. jest now resolves `browser.ts`, the
   same file the app loads — and 9 previously-unrunnable tests started running.
3. **`errors.ts` violated `exactOptionalPropertyTypes`** once compiled under the
   frontend's stricter tsconfig. Fixed by spreading `details`/`field`
   conditionally, which is also the more accurate shape.

### Left to do

| # | Item | Blocked by |
| - | ---- | ---------- |
| 4 | "Set primary" control in Settings → Carrier Lines | — (backend ready) |
| 5 | Self-charge UI | step 4 |
| 8 | E2E Only-Days sale + un-skip `lira-132`'s `test.fixme` | — |
| — | alfa `1.22`/`3.03` day counts | owner |
| — | §10 Q5 and Q7 | owner |

**Steps 4 and 5 are the same work that keeps `TELECOM_DAYS_VALIDITY_PLAN.md`
out of `done_plans/`** — its own validation note marks it PARTIAL for exactly
these two missing UI entry points. Building them retires both plans.

### Archival criteria

Neither plan moves to `done_plans/` until: steps 4, 5 and 8 land; the alfa
`1.22`/`3.03` question is closed; and §10 Q5/Q7 are answered. Per rule 20 and
§7, step 8 must include a create+void test netting to 0 per currency — noting
that §3.4's correction shows the backfill itself is money-neutral, so this is a
missing safety net rather than an active risk.
