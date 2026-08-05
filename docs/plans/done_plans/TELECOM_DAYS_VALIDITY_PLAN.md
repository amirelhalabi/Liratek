# Telecom Days & Credit Validity Model (MTC/Alfa)

**Status:** COMPLETE (2026-08-04)

> Schema, Settings split editor, sale-time calc and the self-charge/reversal
> backend shipped in `8391056`. The two UI entry points that were the last gap
> shipped on `feat/telecom-days-cost` (PR #72):
>
> 1. **"Set primary" in Settings → Carrier Lines** — amber `Primary` badge plus
>    a `Make primary` action on active, non-primary lines. Building it also
>    surfaced a real bug: `toggleActive()` cleared `is_active` but not
>    `is_primary` (only `archive()` did), so deactivating via the row's pill
>    left a line claiming "Primary" while `getPrimary()` returned null and
>    Only-Days sales silently stopped updating carrier-line tracking. Fixed at
>    the repository with a failing-first proof.
> 2. **Self-charge UI** — a per-line "Charge item to this line" modal, with the
>    item picker mirroring the repository's own guard clauses so it cannot
>    offer something the backend would reject, and a preview of the credits and
>    validity days the line will gain before confirming. Note 12 is usable.
>
> **Notes 7/8/9's `daysCost` split** is answered in
> `TELECOM_DAYS_COST_PLAN.md`: the catalog price lists contain no days
> component to extract (a least-squares fit returns a _negative_ day
> coefficient), so `days_cost_lbp` is an allocation anchored on the shop's own
> credit rate — `R = 93,333.33 LBP/$`, observed from the one category where
> credit is bought with no days attached.
>
> **Note 6's** shop-line validity tracking now works end to end, and
> `lira-132`'s Only-Days money case is un-skipped and passing against a real
> shipped catalog card.
>
> Gates at archival: desktop e2e 242/242, core 1464/1464, frontend 703 +1
> skipped, backend 500/500, typecheck clean, lint 0 errors.
> **Created:** 2026-07-20
> **Origin:** Owner feedback batch 2026-07-20, notes 6–12 (verbatim intent below). Ticketed as
> **LIRA-090** in root `current_sprint.md`, Sprint 4 — Owner Notes Batch (2026-07-20). Full
> per-note disposition log: root `LEFT_TO_DO.md`, dated section "2026-07-20 — Owner notes batch
> (32 notes)".

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

## Open owner questions (block implementation) ✅ DONE

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

## Phase breakdown (rough — pending answers above) ❌ NOT DONE

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

## Left TODO

<!--
//TODO — Validation pass 2026-08-04. Verdict: PARTIAL — schema, Settings split editor, sale-time
//TODO   calc, and the self-charge/reversal BACKEND are all shipped and verified in code; the one
//TODO   gap is that self-charge and "set primary carrier line" have zero UI entry point, so note
//TODO   12's "ability to charge a telecom item to the shop's own number" is not yet usable by shop
//TODO   staff (API/IPC-only today).
//TODO
//TODO   VERIFIED DONE (do not redo) — all via commit 8391056 "LIRA-090: Telecom Days & Credit
//TODO   Validity Model (MTC/Alfa Only-Days) (#67)", merged to main 2026-08-02:
//TODO   - Schema: migration v141 `add_telecom_days_credit_validity_schema` (NOT v140/v141 as
//TODO     LIRA_090_HANDOFF.md guessed) — packages/core/src/db/migrations/index.ts:7162-7303 —
//TODO     mobile_service_items.{days_cost_lbp,sell_days_lbp,sell_credit_lbp} (nullable, defaultless
//TODO     ALTER), carrier_lines.is_primary + partial unique index, carrier_line_movements table,
//TODO     telecom_credit_sell_price_lbp setting. v142 (index.ts:7305-7336) adds
//TODO     carrier_line_movements.previous_validity_expires_at for exact reversal. Both mirrored in
//TODO     electron-app/create_db.sql:755-827 and the schema_migrations seed rows
//TODO     (create_db.sql:1633-1635).
//TODO   - Calc core: packages/core/src/utils/telecomCredit.ts — `maxReturnableCredits` (integer-cent
//TODO     exact, 77→73), `isTelecomSplitComplete` (the one shared gate predicate, rule 14),
//TODO     `deriveItemEconomics`, `deliveredCostLbp` (the 1$/2$/3$ resale decision aid — computed per
//TODO     item, not a stored per-provider tier table as the plan's Phase 1/2 literally worded it;
//TODO     this is an intentional, better resolution of Open Question 2, not a gap).
//TODO   - Settings UI: frontend/src/features/settings/pages/Settings/MobileServicesManager.tsx —
//TODO     days_cost_lbp/sell_days_lbp/sell_credit_lbp are independently editable fields (lines
//TODO     82-115, 949-1181, 1216-1333), satisfying the "sellItem/sellDays/sellCredit" ask.
//TODO   - Sale-time calc: frontend/src/features/recharge/components/KatchForm.tsx — `calcCost`
//TODO     (line 53-55) sends GROSS cost_lbp (B1 double-count fix), `isTelecomSplitComplete` gates
//TODO     the computed `maxReturnableCredits` default (lines 563-585, 962-990, 1107-1128), manual
//TODO     `returnedCreditsUsd` override kept only for split-incomplete legacy items exactly as
//TODO     Phase 3 specified.
//TODO   - Self-charge BACKEND: packages/core/src/repositories/FinancialServiceRepository.ts:3045-3194
//TODO     `selfChargeTelecomItem` — same-provider guard (carrier must match target line, line
//TODO     3095-3099), debits the provider LBP drawer, credits the Alfa/MTC USD drawer, calls
//TODO     `CarrierLineService.applyMovement` with both creditsDelta and validityDaysDelta, stamps
//TODO     `profit_usd:0, profit_lbp:0` (no P&L, confirmed against note-12's open question 6), source
//TODO     table is `mobile_service_items` (never `sales` — no customer-facing sale row). Transaction
//TODO     type `TELECOM_SELF_CHARGE` (packages/core/src/constants/transactionTypes.ts:51) is absent
//TODO     from `PROFIT_TXN_TYPES` and from `NON_REVERSIBLE_TRANSACTION_TYPES` — stays voidable via
//TODO     the generic path, reversed by `TransactionRepository._reverseCarrierLineMovements`
//TODO     (TransactionRepository.ts:1117-1120, 1288-1290, 2799-2817) — confirmed NOT commented out
//TODO     (the shipped BLOCKER B1 from LIRA_090_HANDOFF.md is fixed).
//TODO   - Transport: IPC handlers registered and admin-gated (electron-app/handlers/omtHandlers.ts:
//TODO     159-179 self-charge; electron-app/handlers/carrierLineHandlers.ts:221,243 get/setPrimary),
//TODO     Zod schemas carry the new fields (electron-app/schemas/index.ts:383-397,
//TODO     packages/core/src/validators/financial.ts:168-289 — the B2 "Zod strips the fields" bug is
//TODO     fixed), REST routes mirror every write path (backend/src/api/services.ts:96-108,
//TODO     backend/src/api/carrierLines.ts:60,110), dual-mode adapter functions exist
//TODO     (frontend/src/api/backendApi.ts:4415-4468, frontend/src/api/ElectronApiAdapter.ts:147-151,
//TODO     410-413).
//TODO   - Tests: the tautological invariant test HANDOFF flagged for replacement is already replaced
//TODO     with real snapshot-then-delta drawer assertions (packages/core/src/repositories/__tests__/
//TODO     FinancialServiceRepository.telecomOnlyDays.test.ts:593-639, "Real drawer-delta invariant").
//TODO     E2E spec frontend/tests/e2e-electron/lira-132-telecom-only-days.spec.ts exists (Settings
//TODO     split-editor badge test passes; the real-KatchForm money-flow test is `test.fixme` per a
//TODO     documented catalog-refetch limitation, not silently skipped).
//TODO
//TODO   REMAINING:
//TODO   - No UI anywhere calls `selfChargeTelecomItem` or `setPrimaryCarrierLine`/`getPrimaryCarrierLine`
//TODO     — grepped every .tsx under frontend/src for both names and for "self charge"/"set primary"
//TODO     text: zero matches outside api/adapter/type-definition/test files.
//TODO     frontend/src/features/settings/pages/Settings/CarrierLinesManager.tsx has no "Set Primary"
//TODO     control; frontend/src/features/recharge/components/CarrierLinesPanel.tsx and
//TODO     MobileServicesManager.tsx have no self-charge trigger either. This matters because note
//TODO     12's actual ask ("ability to charge a telecom item to the shop's own number") is not
//TODO     usable by a shop operator today — the capability exists only at the API/IPC layer.
//TODO   - Consequently `days_cost_lbp` is NULL on every real catalog item today (no seed/backfill
//TODO     migration for it was ever part of this plan or LIRA-090) — the computed-default sale-time
//TODO     path in KatchForm is wired but dormant for all production data until items get a completed
//TODO     split. This is explicitly NOT this plan's gap — it is the exact subject of the sibling
//TODO     follow-up plan (see SUPERSESSION below), which is correctly the place to close it.
//TODO
//TODO   SUPERSESSION:
//TODO   - This plan (status "NEEDS INTERVIEW" at the top, still listing 6 open owner questions as
//TODO     blocking) was ticketed as LIRA-090 and fully implemented + merged in commit 8391056 on
//TODO     main (2026-08-02), per docs/plans/done_plans/LIRA_090_HANDOFF.md which independently
//TODO     confirms "STATUS 2026-08-01: COMPLETE — all gates green, adversarially reviewed, safe to
//TODO     merge." All 6 "Open owner questions" this file lists as blocking were, in fact, resolved
//TODO     (dated 2026-07-30 per the migration's own description text) and are reflected in the
//TODO     shipped code — but the resolutions were never written back into THIS file, which is why it
//TODO     still reads as unresolved/blocked at rest.
//TODO   - docs/plans/todo_plans/TELECOM_DAYS_COST_PLAN.md (untracked, in-flight, 2026-08-03/04) is
//TODO     the correct owner of the two things still open: (a) where a real `days_cost_lbp` number
//TODO     comes from for the live catalog (its §4, resolved 2026-08-04, blocked only on the owner
//TODO     naming rate `R`), and (b) building the self-charge UI + "Set primary" control (its §5/§6
//TODO     steps 4-5), which it explicitly documents as "reachable from no button anywhere in the app
//TODO     (confirmed 2026-08-03)" — independently confirmed true again in this pass. Do not duplicate
//TODO     that plan's work here; this file's remaining item is a subset of its steps 4-5.
//TODO
//TODO   CORRECTED DETAILS (stale instructions found):
//TODO   - Multiple shipped files cite section numbers of THIS document — "TELECOM_DAYS_VALIDITY_PLAN.md
//TODO     §2", "§2.1", "§5.1", "§5.2", "§7", "§8" (packages/core/src/utils/telecomCredit.ts:4,
//TODO     packages/core/src/db/migrations/index.ts:7165/7308, electron-app/handlers/omtHandlers.ts:154,
//TODO     and 4 more test files) — but this file, as committed, has NO numbered sections at all (only
//TODO     the four unnumbered headings above). A fuller, numbered version of this spec evidently
//TODO     existed during implementation (probably produced during the 2026-07-30 owner interview
//TODO     referenced throughout the migration comments) but was never committed to this path — anyone
//TODO     opening this file to find "§7" or "§5.2" will find nothing. Treat every in-code "spec §N"
//TODO     citation to this filename as referring to a lost/unwritten expanded draft, not this file's
//TODO     current content.
//TODO   - LIRA_090_HANDOFF.md's own text guessed migration version "v140" for the telecom schema
//TODO     change and flagged "confirm its version number is correct" — the real version, verified in
//TODO     index.ts, is v141 (v140 is a same-day, unrelated migration
//TODO     "rebuild_system_float_topups_as_drawer_transfers"); the "v141-style follow-up" HANDOFF
//TODO     mentioned is v142.
//TODO
//TODO   GATE when picked up: this plan itself specifies no test/build commands beyond the repo
//TODO   defaults — before adding the self-charge/set-primary UI, run `yarn typecheck`, `yarn lint`,
//TODO   `yarn workspace @liratek/backend test`, `yarn workspace @liratek/frontend test`, and the
//TODO   `yarn dev` → stop → `yarn test:e2e` sequence (CLAUDE.md's required E2E procedure) to un-skip
//TODO   lira-132's `test.fixme` money case once a UI path exists to drive it.
-->

**Summary — 1 item(s) left:** Everything this plan asked for at the data/backend layer shipped in
LIRA-090 (commit 8391056) and is independently verified in code — the three-way cost split schema,
the Settings split editor, the computed sale-time "Only Days" calc with its legacy-item fallback,
and the self-charge money flow with correct void/refund reversal. The one thing not done is an
operator-facing trigger: nothing in the UI lets shop staff actually fire a self-charge or mark a
carrier line as primary, so the capability note 12 asked for exists only behind the IPC/REST API
today. That gap is already tracked (not silently dropped) by the newer, still-open
`TELECOM_DAYS_COST_PLAN.md`, whose steps 4-5 are the correct place to close it alongside seeding
real `days_cost_lbp` values for the live catalog.
