# Telecom Days & Credit Validity Model (MTC/Alfa)

**Status:** NEEDS INTERVIEW
**Created:** 2026-07-20
**Origin:** Owner feedback batch 2026-07-20, notes 6–12 (verbatim intent below). Ticketed as
**LIRA-090** in root `current_sprint.md`, Sprint 4 — Owner Notes Batch (2026-07-20). Full
per-note disposition log: root `LEFT_TO_DO.md`, dated section "2026-07-20 — Owner notes batch
(32 notes)".

---

## Owner ask (notes 6–12, verbatim intent)

- **Note 6 — shop-number validity days.** Track validity days per provider (MTC/Alfa) for the
  shop's OWN number(s). Selling telecom items decrements the remaining validity days; the shop
  can extend its own validity by self-charging its own number (e.g. buying the 77-dollar cart
  item for itself instead of a customer).
- **Notes 7/8/9 — per-item cost split.** Instead of one flat cost, split each catalog item's
  cost into three components:
  - `daysCost` — the cost attributable to the validity-day extension
  - `creditCost` — the cost attributable to the SMS/credit allowance
  - `itemCost` — the cost of the physical card/voucher itself
- **Owner's worked example (the 77-cart item) — recorded verbatim, NOT independently
  re-derived here; the exact formula must be confirmed with the owner (see Open Questions
  below) before it is implemented:**
  - `7,600,000 LBP = 77$ × creditCost + 1,160,000 LBP daysCost`
  - Credit rates: **101,000 / 94,500 / 92,000 LBP** per **$1 / $2 / $3**-per-SMS tier
  - Each SMS costs **$0.16**
  - Max returnable ≈ **73.5$** of the 77$
- **Note 10 — credit-sell mapping.** A map of 3 cases for how the credit-sell rate applies to
  each item (i.e. which of the three per-SMS tiers governs a given item).
- **Note 11 — drawer effects of "only days."** What happens to the drawers when an operator
  charges "only days" (the credit/SMS portion is not sold, only the validity extension).
- **Note 12 — self-charge to the shop's own number.** Ability to charge a telecom item to the
  shop's OWN number instead of selling it to a customer (e.g. an MTC item consumed against the
  shop's own MTC line) — this should hit the MTC drawer, not book a customer sale.
- **Sell-side management.** `sellItem` / `sellDays` / `sellCredit` need to be independently
  manageable in **Settings → Mobile Recharge**, instead of today's single flat sell price per
  item.
- **"Only days" gating.** Charging "only days" should only be available once an item has BOTH
  cost and price fully defined under the new split model — not the legacy flat
  cost_lbp/sell_lbp pair.

---

## Current-state facts (verified against code, 2026-07-20)

- `mobile_service_items` (as of migration **v135**, landed 2026-07-19 as part of a separate
  workstream, W6) carries a single `cost_lbp`/`sell_lbp` per item, plus two nullable
  **informational** columns added by that same migration: `validity_days` (INTEGER) and
  `credits` (REAL). These carry ONE value each — they are NOT the three-way
  `daysCost`/`creditCost`/`itemCost` split notes 7–9 describe, and the migration's own comment
  states they are "not shown at checkout, not on receipts" — purely a display-only reference.
- `carrier_lines` (also v135) tracks the SHOP's own SIM lines (`carrier`, `phone_number`,
  `credits`, `validity_expires_at`) with a manual `CarrierLineService.updateBalance` that is
  explicitly "informational only — no drawer legs, no checkout/closing involvement." This is
  shop-SIM bookkeeping the owner can hand-edit in Settings; it is NOT the automatic
  decrement-on-sale / extend-on-self-charge behavior notes 6 and 12 ask for.
- **"Only days" exists TODAY, but only as a manual override in `KatchForm.tsx`**
  (`frontend/src/features/recharge/components/KatchForm.tsx`): a per-item checkbox gated on the
  item's category/subcategory being `alfa`/`mtc` (the `isTelecom` check), with a manual numeric
  `returnedCreditsUsd` input the operator types by hand. `calcReturnedCredits`/`calcReturnedCost`
  simply subtract `returnedCredits × sellRate` (or `costRate`) from the item's flat sell/cost —
  there is no cost-model split backing this number; it is an ad-hoc manual adjustment, not a
  computed value.
- MTC/Alfa provider-balance top-ups (`packages/core/src/repositories/RechargeRepository.ts`)
  always force `Math.abs(data.amount)` — there is no signed/decrement path for "the shop
  consumed X of its own provider credit," and no drawer-neutral self-charge flow exists today.
  (The balance-decrement half of this gap is filed separately as **LIRA-088** — this plan is
  about the days/credit-cost MODEL, LIRA-088 is about the raw balance adjustment primitive it
  would need.)
- No sell-side management screen splits `sellItem`/`sellDays`/`sellCredit` — Settings → Mobile
  Recharge (`MobileServicesManager.tsx`) edits one flat `sell_lbp`/`sell_usd` per item, plus
  (since v135) the single informational `validity_days`/`credits` display fields.

---

## Open owner questions (block implementation)

1. **Max-returned-credits formula + rounding.** Is "≈73.5$ of the 77$" a fixed ratio for that
   one item, a formula derived from the credit-rate table, or item-specific per denomination?
   What rounding rule applies?
2. **The 3-case creditSell map (note 10).** Which items map to the $1 / $2 / $3-per-SMS tier?
   Is that mapping fixed per provider (all MTC one tier, all Alfa another) or configurable
   per item?
3. **Drawer effects of "only days" (note 11).** Is charging "only days" always drawer-neutral
   (informational, like `carrier_lines` today), or does it move cash in some scenario (e.g. a
   customer pays only for the day-extension, not the credit)?
4. **What extends validity, and by how much (note 6).** Does EVERY day-sale extend the shop
   number's validity, only specific items, or only the dedicated self-charge path (note 12)?
5. **Scope of the split model.** Which catalog items get the three-way cost split — every
   alfa/mtc item, or only specific denominations (e.g. the 77-cart item used in the worked
   example)?
6. **Self-charge flow specifics (note 12).** Confirm the drawer mapping "MTC item → MTC
   drawer" — is self-charge always same-provider (an MTC item can only be self-charged against
   an MTC shop number, never Alfa)? Does self-charging book any profit/cost line at all, or is
   it a pure internal transfer with no P&L effect?

---

## Phase breakdown (rough — pending answers above)

1. **Schema.** Extend `mobile_service_items` (or a new child table) with the three-way cost
   split (`days_cost`, `credit_cost`, `item_cost` — additive nullable columns, no
   `CURRENT_TIMESTAMP` default per the v104 prod-brick lesson) and a per-provider credit-rate
   tier table ($1/$2/$3-per-SMS rates). Extend `carrier_lines` (or add a join) if self-charge
   needs to decrement a SPECIFIC shop line's validity/credits rather than a global counter.
2. **Settings UI.** Mobile Recharge settings manager gains `sellItem`/`sellDays`/`sellCredit` as
   independently editable fields per item, plus the credit-rate tiers as a small
   provider-level settings table.
3. **Sale-time calc.** Replace `KatchForm`'s manual `returnedCreditsUsd` override with a value
   computed from the cost-split + credit-rate tiers once an item has the split fully defined
   (the "only days" gate from the owner's ask); legacy flat-cost items keep today's manual path
   until migrated.
4. **Self-charge flow.** A new flow (or an extension of the `topUpFromCustomer`-style pattern)
   for charging a telecom item to the shop's own number: decrements the target `carrier_lines`
   row's credits/validity, books the item's cost against the matching provider drawer (MTC item
   → MTC drawer, per note 12), and creates no customer-facing sale row.

Each phase is blocked on the corresponding open question(s) above being answered first — do not
start schema work until questions 1, 2, and 5 are resolved (they determine the shape of the new
columns).
