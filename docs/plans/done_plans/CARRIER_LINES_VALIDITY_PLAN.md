# Carrier Lines, Validity Days & Shop Credit Buy-Back — Implementation Plan

> **Status: COMPLETE 2026-08-07.** All waves (1–5) landed and merged to
> `main` via `dbbb710`. Migrations **v148** (`add_daily_closing_carrier_lines`)
> and **v149** (adds `CREDIT_BUYBACK` to `recharges.recharge_type`) both
> present with `down()`. E2E: `lira-133-telecom-credit-buyback-ui-driven.spec.ts`
> (desktop) + `lira-web-019-telecom-buyback.spec.ts` (web). The "Outbound
> A/B/C/D" items at the end of this doc are explicitly separate, already-
> tracked future tickets (cross-referenced to `WEB_PARITY_ROADMAP.md`), not
> unfinished parts of this plan.

**Status:** approved in interview 2026-08-06. Verified against source by an 8-agent audit on 2026-08-06 (87 claims: 54 confirmed, 33 corrected). **All decisions resolved — §0. Ready to implement.**
**Migration baseline:** last applied is **v147** (`seed_sell_days_lbp_from_validity_days`, `packages/core/src/db/migrations/index.ts:7713`). New migrations start at **v148**. *(CLAUDE.md still says v97 — stale; the migrations file is authoritative. Updating CLAUDE.md is a Phase 1 task.)*
**Data situation:** one test install with a pilot client; no production installs. Data disposable **by agreement with that client**. That agreement is load-bearing once — Phase 0, where existing `DAYS` rows carry the 33x over-deduction — so query the pilot install before Phase 0 rather than assuming zero rows. (Phase 1 no longer collapses any data; see §0.5.)

---

## 0. Decisions — resolved 2026-08-06

### 0.1 — Credits model: **line-level credits, drawer = sum of that carrier's lines**

The audit found that D1 was not true today and no phase made it true: `RechargeRepository` moves the MTC/Alfa drawer on every sale and top-up (`:242`, `:796`, `:941`) with **zero** references to `carrier_lines`; only `FinancialServiceRepository` (`:1425`, `:3284`) writes carrier-line movements. They diverge on the first sale after any baseline.

**Owner ruling:** keep `carrier_lines.credits` as-is. The target model is that **each line carries its own credits and the provider drawer shows the SUM of that carrier's active lines** — with multiple lines per carrier as a later capability.

So the source of truth is the **line**, and the drawer is the **aggregate**. Today, with one line per carrier, the sum is that one line — which is why D1 reads as an identity. The invariant to build toward is:

```
drawer_balances[MTC][USD]  ==  Σ credits of active carrier_lines WHERE carrier = 'mtc'
```

Consequences for this plan:
- Do **not** drop `carrier_lines.credits`, and do not make the drawer authoritative.
- Every phase that moves the provider drawer must attribute the movement to a **specific line**, or the sum invariant breaks the moment a second line exists.
- Phase 3 counts credits **per line**; the drawer delta follows from the line delta, never the reverse.
- The existing drift (drawer moves, line doesn't) is pre-existing. Phase 3 is where the invariant lands; Phase 0 only corrects a magnitude and need not pair a line movement.
- The single-line rule is therefore a **UI** rule, not a schema one — see §0.5.

### 0.2 — Day counts snap up to the next multiple of 10

Each SMS adds exactly 10 days, so 25 days means 3 messages and $0.90. Snap the free-text Days input up on blur. All eight Quick Days buttons are already multiples of 10 (10/20/30/60/90/120/180/360), so after this, prorated `costOfValidityDaysUsd` and the per-SMS model agree on **every reachable value** — no formula change needed.

### 0.3 — The Days `Cost ($)` field stays operator-editable

Therefore **the drawer must be debited from the submitted `data.cost`**, converted LBP→USD at the stamped rate — *not* recomputed from the day count. Recomputing would make the drawer and the profit stamp disagree about the same sale whenever the operator overrides. `costOfValidityDaysUsd` keeps its job of prefilling the field.

### 0.4 — Setup stays desktop-only

The wizard already gates on raw `window.api` (`StepComplete.tsx:18`) and there is no `/api/setup` mount, so web tenants are provisioned some other way today — this feature does not create the gap. Phase 2 is desktop-only; setup-over-REST is Outbound Ticket C.

### 0.5 — One line per carrier is enforced in the **UI only**, not the schema

§0.1's "sum of the lines" model implies multiple lines per carrier later, so a DB-level `UNIQUE INDEX … WHERE is_active = 1` would have to be added now and dropped then. **Owner ruling: no hard constraint.** The schema stays multi-line-capable (it already is); setup and the Recharge panel offer one slot per carrier for now. Today's behaviour is identical, nothing has to be undone, and there is **no destructive collapse migration**.

Three consequences:

- **Phase 1 needs no migration at all.** Migration numbers shift down: Phase 3's closing table is **v148**, Phase 6's `recharges` CHECK rebuild is **v149**.
- **`is_primary` stays fully live and meaningful** — it is how `getPrimary()` picks which line receives automated credit returns once there are several. The earlier plan to retire the badge and the `Make primary` button is **cancelled**. No UI change is needed: the button's existing gate is `is_active === 1 && is_primary !== 1`, so with a single line (always primary) it simply never renders.
- Every phase that targets "the line" resolves it via `getPrimary(carrier)` — which already exists and is already self-charge's fallback — so the code survives multi-line unchanged.

### 0.6 — Drawer attribution is built in Phase 3 only

Under the sum model every drawer movement must be attributed to a specific line, or the sum breaks once a second line exists. **Owner ruling: build it in Phase 3, for the paths Phase 3 touches.** The checkpoint writes per-line credits and the drawer follows.

This grandfathers **existing** paths only: recharge sales, both top-up paths, and Phase 0's corrected days-cost leg keep moving the drawer alone. Harmless while there is one line per carrier — the sum is unambiguous — but it is **the gap that must close before multi-line ships** (Outbound Ticket D).

**New** paths do not get the exemption. Phase 6's buy-back writes the line movement *and* the drawer from day one; shipping a fresh path that violates the invariant just enlarges the debt.

---

## 1. Decisions locked in the interview

| # | Decision | Consequence |
|---|---|---|
| D1 | **One line per carrier** (UI-enforced, not schema), and the provider drawer = **Σ credits of that carrier's active lines** | Multi-line is a later capability, so no DB constraint — §0.5. The sum invariant must be *built*; it does not hold today — §0.1 |
| D2 | Checkpoint **counts credits + validity** and posts the delta | The MTC/Alfa drawer USD row is the credits count; validity is the new field |
| D3 | Setup collects carrier lines **inside "Starting Drawer Amounts"** (step 6) | No 7th step; one MTC slot + one Alfa slot |
| D4 | **One per carrier, soft nudge** — never blocks Launch | Summary shows "Skipped"; Dashboard banner follows up |
| D5 | Self-charge entry point on the **iPick/Katsh item card** | Not on the MTC/Alfa chip; the Settings button stays |
| D6 | Self-charge allowed for non-admins | **The role is `staff`, not `cashier`** — there is no cashier role (`validators/auth.ts:20`; migration `:4680` migrated legacy `cashier` → `staff`). Writing `"cashier"` ships a silent no-op |
| D7 | Shop-number detection flips the form to buy-back, full pay sheet, **transaction-level** direction OUT | The transaction reads as cash-out (`cashFlow.ts`, red ↑). **Payment legs stay IN legs with no `direction` key** — see Phase 6 "Legs" |
| D8 | Buy-back is a **new reversible transaction type** | Generic void path; `_reverseCarrierLineMovements` already exists |
| D9 | Buy-back moves **credits only, never validity** | Validity changes only via iPick/Katsh self-charge |
| D10 | Remove the in-form Payment Method dropdown from **all transaction forms that mount the pay sheet** | Telecom and Financial. **KatchForm has no such control** — nothing to remove there |
| D11 | Dashboard expiry banner at **≤ 7 days or expired** | Recharge-page chip keeps its own ≤3-day amber |
| D12 | A **DAYS sale costs credits only** — `(days / 10) × $0.30`; the shop's expiry never moves | Phase 0 rewires the drawer deduction. LIRA-091's auto-decrement half is closed, not built |

---

## 2. What "Top-Up" actually is

Seven backend functions behind six modal arms, all reached from one **`Top-Up`** button on the Recharge header ([Recharge/index.tsx:1309](frontend/src/features/recharge/pages/Recharge/index.tsx#L1309)). The arm is selected by which callbacks the parent passes, so each provider silently reaches a different one.

**Live arms:**

| Provider | Arm | Backend | What actually moves |
|---|---|---|---|
| MTC / Alfa | Customer credit purchase | `topUpFromCustomer` | General −cash, provider drawer +credits, profit = spread |
| iPick / Katsh | Supplier credit | `topUpFromSupplier` | Provider drawer +amount, supplier ledger +liability. No cash moves |
| Whish App | Via Partner | `topUpFromPartner` | Whish_App +amount, partner ledger CREDIT. No cash moves |
| Whish App | From Client | `topUpFromClient` | General −cash, Whish_App +amount, 1% fee as profit |
| OMT App | Generic from-drawer | `topUpApp` | Any drawer → **OMT_App** (the only reachable destination) |

Plus two dead ones — the `onConfirmExternal` external-cash arm (`topUpAppExternal`) and the caller-less `topUp` — making seven functions behind six arms. **The unifying purpose: acquiring provider credit stock from a counterparty.** The name is a leftover from the original MTC/Alfa credit-loading panel.

**Dead weight:**

- `topUp` ([RechargeRepository.ts:235](packages/core/src/repositories/RechargeRepository.ts#L235)) — raises the MTC/Alfa drawer with **no counter-leg**. Zero callers.
- `topUpAppExternal` ([RechargeRepository.ts:421](packages/core/src/repositories/RechargeRepository.ts#L421)) — zero callers; its only trigger is a modal branch nothing passes.
- `TopUpProvider` includes `OMT_SYSTEM` / `WHISH_SYSTEM`, which `handleTopUpClick` can never produce.

**Kept, with a caveat:** `topUpApp` is reachable for exactly one provider and is the only path to the `OMT_App` drawer. The PCD plan called it obsolete ([Services/index.tsx:1202-1210](frontend/src/features/services/pages/Services/index.tsx#L1202-L1210)) on the false assumption that `DrawerTopUpModal` covers it — that modal only moves General ↔ `OMT_System`/`Whish_System`. See Phase 8.3.

**Three latent Whish-arm defects** — inert `includingFees`, USD-hardcoded fee label on LBP top-ups, never-sent `client_id`. Full detail and disposition in §7.

**End state after Phase 0b + 8.2:** four functions behind four arms (supplier, partner, client, app).

---

## 3. Implementation phases

**Ship order:** 0b → 0 → 1 → 2 → 3 → 4 → 5 → 6a → 6 → 8.2 → 7 → 8.3/8.4.

**Hard dependencies:** 0b is independent and ships first. 0 blocks 3. 1 blocks 2 and 3. 5 blocks 6 (the Days/Alfa-Gift redirect needs a self-charge target). 6a (schema consolidation) blocks 6 and 7. 6 blocks 8.2, and **8.2 must land in the same release as 6** — between them, two buy-back doors exist and D1 is knowingly broken. 8.1 is a security deletion folded into 0b; only 8.3 is a no-op decision.

Each phase leaves the app green, except the 6 → 8.2 window, which is why they ship together.

### Phase 0b — Delete the `topUp` chain, gate the recharge router

**Ships first. Independent of everything else.**

The previous draft claimed `POST /api/recharge/top-up` was a live drawer-inflation hole. **That was wrong** and the correction matters:

The route never injects `userId` from the JWT (contrast `/process` at `:35-38`), and `validateRequest` replaces the body with the parsed object ([validation.ts:69](backend/src/middleware/validation.ts#L69)), stripping any client-supplied one. So `topUp` runs with `userId === undefined`, better-sqlite3 binds it as SQL NULL, and `transactions.user_id INTEGER NOT NULL` throws **inside** the `db.transaction` — rolling back the recharges row *and* the drawer delta. The endpoint **fails closed**. It is dead code, not an exploit.

**The real gap in the same file is `/process`.** `backend/src/api/recharge.ts` imports only `authenticateJWT` (`:2`, applied router-level at `:12`) and never imports `requireRole` — while the IPC twin is admin-only ([rechargeHandlers.ts:51](electron-app/handlers/rechargeHandlers.ts#L51)). `/process` is functional, injects `userId`, moves drawers, and is reachable by any authenticated role over REST. That is a genuine role-escalation seam (rule 19c), and Phase 6 is about to turn that same route into a cash-payout endpoint.

**Work:**

1. Add `requireRole(["admin"])` to `POST /process` and `GET /stock`, matching the IPC roles exactly. Backend API test: a `staff` JWT is refused on both transports.
2. Delete the `topUp` chain, in order:
   `RechargeRepository.ts:235-303` · `RechargeService.ts:81-91` · `rechargeHandlers.ts:83-106` *(no Zod schema to remove — that handler is unvalidated)* · `preload.ts:436-440` · `frontend/src/types/electron.d.ts:1049-1053` · `frontend/src/api/backendApi.ts:1087-1102` · `frontend/src/api/ElectronApiAdapter.ts:127-131` · **`packages/ui/src/api/types.ts:551-555`** (the `ApiAdapter` interface — omitting this fails typecheck) · **`frontend/src/api/__tests__/adapter.test.ts:44` and `:279`** (mock + exhaustive method list — omitting this fails the frontend suite) · `backend/src/api/recharge.ts:54-76` (route + its local `topUpSchema`).
3. Delete `topUpAppExternal` and the same chain, plus the modal's `onConfirmExternal` branch (`"External (Cash In)"`, `"Add Cash"`, the mode toggle) and the unreachable `OMT_SYSTEM`/`WHISH_SYSTEM` members of `TopUpProvider`.

Zero runtime callers, so no behaviour regresses — but items 2 and 3 each break typecheck or tests if the `ApiAdapter` and adapter-test sweeps are skipped.

*Phase 8.1 in earlier drafts described this same deletion with a third, different scope. This section is now the single normative spec.*

### Phase 0 — BLOCKER: a DAYS sale debits the provider drawer by the day count

**Must land before Phase 3.**

[RechargeRepository.ts:937-948](packages/core/src/repositories/RechargeRepository.ts#L937-L948) — note **both** writes carry `stockDelta`:

```ts
// Telecom balance consumed (shop number stock — always in USD credits)
const stockDelta = -Math.abs(data.amount);
insertPayment.run(txnId, data.provider === "MTC" ? "MTC" : "Alfa",
                  providerDrawerName, "USD", stockDelta, "Telecom balance sent", createdBy);
upsertBalanceDelta.run(providerDrawerName, "USD", stockDelta);
```

`stockDelta` is unconditional — there is no `DAYS` branch. The only two occurrences of `"DAYS"` in the file are the type union ([:56](packages/core/src/repositories/RechargeRepository.ts#L56)) and a label formatter at [:162](packages/core/src/repositories/RechargeRepository.ts#L162) (`` `${amount} days` ``), confirming `amount` carries the **day count**. The frontend agrees: the amount field is labelled `Days` in DAYS mode with a separate `Cost ($)` input ([TelecomForm.tsx:522](frontend/src/features/recharge/components/TelecomForm.tsx#L522), [:544-575](frontend/src/features/recharge/components/TelecomForm.tsx#L544-L575)).

**Effect: selling 30 days debits the MTC drawer $30.00 USD. Correct is $0.90 — a 33× over-deduction.**

#### Owner ruling (2026-08-06)

> *"We charge the customer by sending SMS. Each SMS adds 10 days to the client's phone number. We lose $0.30 per each ten days sent."*

So a DAYS sale costs `(days / 10) × $0.30` in line credits, and the shop's **own expiry never moves**.

The formula already exists — `costOfValidityDaysUsd` ([telecomCredit.ts:374](packages/core/src/utils/telecomCredit.ts#L374)), on `VALIDITY_DAYS_PER_BLOCK = 10` and `VALIDITY_COST_PER_BLOCK_USD = 0.3`. It prefills the Days tab's `Cost ($)` field ([Recharge/index.tsx:1182](frontend/src/features/recharge/pages/Recharge/index.tsx#L1182), [:1199](frontend/src/features/recharge/pages/Recharge/index.tsx#L1199)), whose value is submitted as `cost` and **does** reach profit. It has **no caller in `packages/core`, `backend`, or `electron-app`** — nothing on the credit-stock path calls it.

`SMS_TRANSFER_FEE_USD = 0.16` is a **different** cost — the per-message fee for transferring *credit*, at `ceil(amount / 3)` messages. Not the days cost, and it must not be reused for it. The existing SMS leg is gated to `CREDIT_TRANSFER` only ([:748-751](packages/core/src/repositories/RechargeRepository.ts#L748-L751)), so DAYS gets `smsCount = 0`.

**The fix:**

1. Branch the stock deduction exhaustively by `data.type`. `CREDIT_TRANSFER` and `ALFA_GIFT` keep `-Math.abs(data.amount)` — both carry USD in `amount`. `DAYS` uses the cost. Enumerate every other member of the union explicitly rather than relying on a `default`.
2. **For `DAYS`, `stockDelta` must be `0` — the day count must never reach the drawer** — and exactly **one** leg of the days cost is posted against the provider drawer, labelled `VALIDITY_DAYS_COST`. Net drawer movement for a 30-day sale is exactly **−$0.90**. Copy only the *shape and labelling* of the existing `SMS_COST` leg; the amount comes from the days cost, never from `SMS_TRANSFER_FEE_USD`.
3. **Debit from the submitted `data.cost`, converted LBP→USD at the stamped rate — do not recompute from the day count** (§0.3: the Cost field stays editable, so recomputing would make the drawer and the profit stamp disagree whenever the operator overrides). `costOfValidityDaysUsd` keeps prefilling the field and never reaches the repository.
3b. **Snap the Days input up to the next multiple of 10 on blur** (§0.2) in `TelecomForm.tsx`. Each SMS adds exactly 10 days, so 25 days is 3 messages. After this, prorated and per-SMS agree on every reachable value. Add a unit test: 1→10, 11→20, 25→30, 30→30.
4. **`netRechargeCommission` needs no change for DAYS.** The earlier draft said DAYS profit was overstated — **that was wrong.** The days cost already reaches profit via `data.cost`: the frontend sends `cost = parseFloat(telecomDaysCostUsd) * alfaCreditCostRate` ([Recharge/index.tsx:404-407](frontend/src/features/recharge/pages/Recharge/index.tsx#L404-L407)) and `:742` computes `rechargeCommission = data.price - data.cost`, guarded by `RechargeRepository.sms_cost.test.ts:415-428` (profit 2.0 on price 10 / cost 8). Adding it to `netRechargeCommission` too would **double-subtract**. `smsCostInSaleCurrency` stays 0 for DAYS. The bug is confined to the credit-stock leg.
5. **`ALFA_GIFT` needs no change.** Its `amount` is `parseFloat(giftAmountUsd)` ([Recharge/index.tsx:858](frontend/src/features/recharge/pages/Recharge/index.tsx#L858)) — USD, matching the drawer unit. Owner-confirmed 2026-08-06: a gift consumes credit 1:1 with its USD face value.
6. **Reversal owner unchanged** (rule 20) — the stock delta is a `payments` row, so `_reversePayments` owns it.

**Consequence for LIRA-091: close the auto-decrement half.** The shop's `validity_expires_at` legitimately does not move on a DAYS sale. Nothing to decrement, no drift for Phases 3–4 to chase.

**Pilot data:** query the pilot install for `DAYS` rows before this lands. If any exist, either reset the install or post a corrective drawer entry — do not assume zero.

### Phase 1 — Line resolution and the sum invariant *(no migration)*

Per §0.5 there is **no schema change**: no unique index, no collapse migration, no column drop. `is_primary` stays live and untouched, and the `Make primary` button and `Primary` badge stay — their existing gate (`is_active === 1 && is_primary !== 1`) means the button never renders while a carrier has one line, so no UI work is needed.

**Core:**
- `createLine` auto-sets `is_primary = 1` when it is the carrier's **first active line**, so the single-line case always has a resolvable primary. It must **not** throw on a second line — the schema permits them by design.
- Add `getCarrierCreditsSum(carrier): number` — `Σ credits of active carrier_lines` for that carrier. This is the sum invariant's one definition (rule 14); Phase 3 and any future reconciliation call it rather than re-deriving.
- Everything that targets "the line" resolves via the existing `getPrimary(carrier)`, so the code survives multi-line unchanged.

**Tenant linter:** register `"carrier_lines"` and `"carrier_line_movements"` in `TENANT_SCOPED_TABLES` ([scripts/check-tenant-scoping.mjs:77-139](scripts/check-tenant-scoping.mjs#L77-L139)) — neither is listed today, so every carrier-line query is a blind spot. Run `yarn check:tenant-scoping` and fix what it surfaces **before** Phases 3 and 6 add SQL there.

**UI single-line rule:** setup (Phase 2) and the Recharge panel (Phase 4) offer exactly one slot per carrier, and the add-a-line affordance appears only when the carrier has none. Settings keeps full CRUD — it is the escape hatch if a second line is ever needed early.

**Also:** update CLAUDE.md's stale "v97" migration line.

### Phase 2 — Setup wizard collects carrier lines *(desktop-only — see §0.4)*

**File:** `frontend/src/features/setup/steps/StepDrawerAmounts.tsx`

Add a **Carrier Lines (optional)** section below the drawer grid. Gate it on the `recharge` module (labelled **"MTC/Alfa"**) being enabled — **there is no per-carrier module**; `create_db.sql:1132` seeds one `recharge` module and `StepDrawerAmounts.tsx:21-22` maps both drawers to it. So the section shows two slots (MTC and Alfa) or none.

Per carrier: `Phone Number`, `Label`, `Credits`, `Validity Expires` (`<input type="date">`).

- Render **one** credits field per carrier. It writes the line's credits, and the carrier's drawer is set to `getCarrierCreditsSum(carrier)` (§0.1) — never typed twice.
- The footer `Skip` must clear the carrier-line payload alongside `drawer_amounts` ([StepDrawerAmounts.tsx:167-170](frontend/src/features/setup/steps/StepDrawerAmounts.tsx#L167-L170)).

**Persist:** call `CarrierLineRepository.createLine` (Phase 1) from **inside** the existing `db.transaction` in `setupHandlers.ts` — **not** a hand-written INSERT. A raw insert bypasses Phase 1's one-active-line guard, the `is_primary = 1` default, and `BaseRepository` tenant scoping; `setupHandlers.ts` is also excluded from the tenant linter's scan roots, so a missing `tenant_id` there is invisible to CI. Setup is the path most likely to create the first duplicate and must not be the one path that skips the guard. Must run before `setup_complete = '1'` ([setupHandlers.ts:247](electron-app/handlers/setupHandlers.ts#L247)).

**Summary screen** (`StepComplete.tsx`): add a `Carrier Lines` row reading `"MTC + Alfa set"` / `"MTC only"` / **`"Skipped"`**.

**Ordering hazard** ([StepComplete.tsx:41-52](frontend/src/features/setup/steps/StepComplete.tsx#L41-L52)): `currency_drawers` and the baseline checkpoint are written *after* the IPC and *after* auto-login. Phase 3 must state whether the baseline checkpoint reads carrier lines; if it does, they must be committed before that call.

### Phase 3 — Checkpoint counts credits + validity

Highest-risk phase — it touches the money-count path.

**Model.** `daily_closing_amounts` is `(closing_id, drawer_name, currency_code) → (opening_amount REAL, physical_amount REAL)`, where `opening_amount` holds the **expected** value ([ClosingRepository.ts:307-314](packages/core/src/repositories/ClosingRepository.ts#L307-L314)) and `physical_amount` the counted one. A date does not fit, and neither does a per-line breakdown. Add in **migration v148**:

```sql
CREATE TABLE daily_closing_carrier_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id),
  closing_id INTEGER NOT NULL REFERENCES daily_closings(id) ON DELETE CASCADE,
  carrier_line_id INTEGER NOT NULL REFERENCES carrier_lines(id) ON DELETE CASCADE,
  expected_credits REAL NOT NULL DEFAULT 0,
  counted_credits REAL NOT NULL DEFAULT 0,
  expected_expires_at TEXT,
  counted_expires_at TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(closing_id, carrier_line_id)
);
CREATE INDEX idx_dccl_tenant_id ON daily_closing_carrier_lines(tenant_id);
CREATE INDEX idx_dccl_closing_id ON daily_closing_carrier_lines(closing_id);
```

With `down(db) { db.exec('DROP TABLE IF EXISTS daily_closing_carrier_lines'); }`, mirrored in `create_db.sql` with its `schema_migrations` row (rule 10), and `"daily_closing_carrier_lines"` registered in `TENANT_SCOPED_TABLES`.

Credits appear here *and* in `daily_closing_amounts`. Nothing enforces the duplicate — the single write in `createCheckpoint` must set both from one value, and the test asserts they match for the same closing.

**UI** — `frontend/src/features/closing/components/DrawerCard.tsx`. For the MTC and Alfa cards only, append a validity row after the `currencies.map(...)` at [:242-250](frontend/src/features/closing/components/DrawerCard.tsx#L242-L250), reusing `renderField`'s grammar. Relabel the USD row `Credits` on those two cards and show the phone number in the card header.

**Posting the validity delta — the previous draft's approach does not work.** `applyMovement` has **no absolute-date parameter**: `ApplyCarrierLineMovementInput` ([CarrierLineRepository.ts:118-130](packages/core/src/repositories/CarrierLineRepository.ts#L118-L130)) exposes only `validityDaysDelta`, and `computeAppliedState` ([:613-631](packages/core/src/repositories/CarrierLineRepository.ts#L613-L631)) **rebases**: `base = (expiry && expiry > today) ? expiry : today`. So for an already-expired line, a day-delta lands relative to *today*, not on the counted date — the count would silently post the wrong expiry. `CarrierLineService.applyMovement` also returns `{success:false}` when both deltas are 0, so a credits-match path must not pass zeros.

Choose one and write it down: add an absolute-date variant to `applyMovement`/`computeAppliedState` (still snapshotting `previous_validity_expires_at`), or set the date through the existing manual `updateBalance` path ([CarrierLineRepository.ts:331](packages/core/src/repositories/CarrierLineRepository.ts#L331), reason `manual`). Verify against `:613-631` before implementing.

**Credits delta — this is where the sum invariant gets built (§0.1, §0.6).** The operator counts credits **per line**; the drawer follows, never the reverse:

1. Write the counted value to `carrier_lines.credits` via a `carrier_line_movements` row (`reason: "CHECKPOINT"`, `creditsDelta = counted − current`).
2. Set the provider drawer to `getCarrierCreditsSum(carrier)` (Phase 1), posting the difference as the checkpoint's drawer delta through the existing machinery.

With one line per carrier the sum is that line, so the drawer delta equals the line delta — but writing it as a sum is what makes a second line work later without revisiting this code. The test asserts both moved by the same amount **and** that the drawer equals the sum afterwards.

**Rule 20.** `CHECKPOINT` stays in `NON_REVERSIBLE_TRANSACTION_TYPES`, and its owner is **already documented** at [transactionTypes.ts:293-295](packages/core/src/constants/transactionTypes.ts#L293-L295) (*"correct with a new checkpoint"*) — **extend that comment** to name the new rows rather than adding a note elsewhere. There is no void/delete path for a unified checkpoint (only Loto has `deleteCheckpoint`), so the movement row is terminal by design; `daily_closing_carrier_lines` is disposed by `ON DELETE CASCADE`. Say that explicitly — "the next checkpoint recounts" is a re-count, not a reversal, and nothing nets to zero.

**Also update** `CheckpointTimeline/index.tsx` detail rows ([:463-504](frontend/src/features/closing/pages/CheckpointTimeline/index.tsx#L463-L504)) and the variance summary ([:160-170](frontend/src/features/closing/pages/CheckpointTimeline/index.tsx#L160-L170)).

**Dual transport (rule 19) — five typed layers, not one:** extend `createCheckpointSchema` ([packages/core/src/validators/closing.ts:52](packages/core/src/validators/closing.ts#L52)) with an optional `carrier_lines[]` (new fields absent from it are stripped by Zod on REST); re-export via `electron-app/schemas/index.ts`; widen the `createCheckpoint` param type in `electron-app/preload.ts:735` (rule 12), `frontend/src/api/ElectronApiAdapter.ts:184`, `packages/ui/src/api/types.ts:628`, and `frontend/src/types/electron.d.ts`. `backendApi.createCheckpoint` is already `any`. Extend `lira-web-010-checkpoint.spec.ts` to prove it over REST.

**If `carrier_line_movements.reason` carries a CHECK constraint**, extend it in this migration and mirror in `create_db.sql`. If it is free text, say so here so the next reader doesn't re-check.

### Phase 4 — Dashboard expiry banner + add-a-line from the Recharge page

**Banner** — model on the `"Starting drawer amounts not set"` banner at [frontend/src/features/dashboard/pages/Dashboard.tsx:777-796](frontend/src/features/dashboard/pages/Dashboard.tsx#L777-L796) (text at `:785`). *Note the path: `pages/Dashboard.tsx`, not `pages/Dashboard/index.tsx`.* The sibling `"No starting checkpoint recorded"` banner (`:800-823`) is the better structural model since it navigates via `appEvents.emit` rather than a local modal.

Fires when an active line expires in **≤ 7 days or is already expired** (D11), and separately when a carrier has no line at all (D4's nudge).

**Deep-link caveat:** "clicking opens Settings → Carrier Lines" requires a mechanism that does not exist — `Settings/index.tsx:28` hardcodes the initial tab to `"shop"` with no URL param and no `appEvents` listener. Add one (seed `active` from `?tab=carrier-lines`, or a `settings:open-tab` event) as part of this phase.

**Add-a-line from Recharge** — `CarrierLinesPanel.tsx` returns `null` at zero lines ([:70](frontend/src/features/recharge/components/CarrierLinesPanel.tsx#L70)), which is why a fresh install shows nothing. Replace with an **`+ Add {CARRIER} line`** chip opening an inline create form. Use the same `createLine` path as Settings **via `useApi()`** — no raw `window.api` (rule 19a). Credits entered here set the line and then the drawer via `getCarrierCreditsSum`, exactly as Phase 2 does, or line and drawer start out of sync. Per §0.5 the chip appears only when the carrier has no active line.

Keep the existing ≤3-day amber / expired-red chip colouring.

### Phase 5 — Self-charge from the iPick/Katsh item card

**Frontend** — `KatchForm.tsx`. On each eligible item card (same predicate as [CarrierLinesManager.tsx:28-43](frontend/src/features/settings/pages/Settings/CarrierLinesManager.tsx#L28-L43)), add a **`Charge to shop line`** action. With D1 there is one line per carrier, so no picker — resolve from the item's category and show the target number in the confirm step, restating cost debited / credits added / validity added.

**Role relax (D6):** `["admin", "staff"]` — **not `"cashier"`, which is not a role in this codebase** and would ship a silent no-op. Both sites:
- [electron-app/handlers/omtHandlers.ts:163](electron-app/handlers/omtHandlers.ts#L163) *(the gate is at :163; :165 is blank)*
- [backend/src/api/services.ts:92](backend/src/api/services.ts#L92)

Update the "Admin only" doc comments at `omtHandlers.ts:158` and `services.ts:86` — both currently assert admin-only-on-both-transports and would become lies.

**Gap this phase should also own:** the IPC handler has **no `validatePayload`** — it passes `data` straight through at `:166-169`, while REST validates with `selfChargeTelecomItemSchema`. Envelopes already match.

**Nothing in the repository changes.** `selfChargeTelecomItem` already applies `validityDaysDelta` ([FinancialServiceRepository.ts:3287](packages/core/src/repositories/FinancialServiceRepository.ts#L3287)) and returns `validityDaysAdded` ([:3302](packages/core/src/repositories/FinancialServiceRepository.ts#L3302)); the method opens at `:3158`.

### Phase 6a — Consolidate the recharge schema *(prerequisite for 6 and 7)*

**Without this, Phase 6 silently loses every payout leg on web.** `createRechargeSchema` ([packages/core/src/validators/recharge.ts:12-44](packages/core/src/validators/recharge.ts#L12-L44)) has **no `payments` field** — its own comment admits the gap — and `validateRequest` does `req.body = schema.parse(req.body)`, so Zod strips the legs. A buy-back is 100% payout legs; over REST it would post zero and fall into the unguarded fallback at `:917-935`. `clientName`, `default_price_to_client`, `deferPayment` and `ALFA_GIFT` are stripped the same way today.

Move the IPC `RechargeSchema` body (`electron-app/schemas/index.ts:254-292` — `payments[]` with `direction`, `clientName`, `default_price_to_client`, `ALFA_GIFT`) into `packages/core/src/validators/recharge.ts`, delete the local duplicate, re-export from `electron-app/schemas/index.ts` with the zod-major cast. **Failing-first test:** POST `/api/recharge/process` with two split legs and assert both drawer deltas — it must fail on today's code.

### Phase 6 — Shop-line detection flips the telecom form to buy-back

Largest phase. **Read `docs/FEATURE_GUIDE.md` §13 first (rule 18).**

**Detection.** Compare the typed `Phone Number` against the active line for the carrier. Define `normalizeLebanesePhone(raw)` **once** in `packages/core/src/utils/` and export it from `@liratek/core` (rule 14) — the backend needs the same comparison, since the REST route is directly callable. Unit-test `03 123456`, `+96103123456`, `96103123456`, `003…`.

| Tab | On match |
|---|---|
| **Credit** | Flip to buy-back; inline note beside the field label |
| **Days** | **Block with redirect** into Phase 5 self-charge — validity is added only by charging an iPick/Katsh item |
| **Alfa Gift** | **Block with redirect**, same as Days |

**What flips** — mirroring the OMT RECEIVE contract:

| Concern | Normal (sell) | Buy-back |
|---|---|---|
| `Price to Client` ([TelecomForm.tsx:581](frontend/src/features/recharge/components/TelecomForm.tsx#L581)) | as-is | `Price to Customer` |
| Submit button | `Proceed to Pay` | `Proceed to Pay Out` |
| Pay sheet `label` | `Payment` | `Cashout` |
| `autoDebtRemainder` | `!!telecomClientId` | **`false`** — hard off |
| `paymentMethods` | all | CASH, CUSTOMER_ACCOUNT, OMT, WHISH, BINANCE |
| `requiresClientForDebt` | true | false for cash/wallet legs; **true whenever a CUSTOMER_ACCOUNT leg is present** |
| `clientId`/`clientName` | propagated | propagated identically (rule 11): UI → payload → `createTransaction({ client_id })` |
| Session cart | `+total` | **see below** |
| Profit | `price − cost` | `credits − cash paid` (the same spread the retired modal arm booked) |

`autoDebtRemainder` is the trap — [MultiPaymentInput.tsx:147-158](packages/ui/src/components/ui/MultiPaymentInput.tsx#L147-L158): *"Never enable on money-OUT flows… an auto IN-direction debt leg inverts the sign of the unpaid remainder."*

**Legs.** Payout legs are ordinary **IN legs with no `direction` key**. Precisely: `direction: "OUT"` marks a leg the shared end-of-transaction OUT loop owns — change handed back on the walk-in path, the shop's own disbursement on the FOR-partner path ([Services/index.tsx:1038-1050](frontend/src/features/services/pages/Services/index.tsx#L1038-L1050)). It is **not** the marker for a payout: the RECEIVE payout branch reads IN legs. Marking one OUT strips it via `partitionLegs`, empties the payout loop, fires the single-amount fallback, *and* re-debits it in the OUT loop. Double debit.

**Backend — extract, then reuse (rule 14).** Do **not** copy the ~95-line RECEIVE block. Lift the payout-leg posting loop into a shared `postPayoutLegs({ legs, payoutAmount, cashDrawerCtx, … })` in `packages/core/src/repositories/moneyPosting.ts` (next to `reconcileLegs`), prove `FinancialServiceRepository.receiveSplitPayout.test.ts` still passes unchanged, then call it from both sites.

The reference block is [FinancialServiceRepository.ts:2826-2920](packages/core/src/repositories/FinancialServiceRepository.ts#L2826-L2920) *(not 2723-2817 — that range is the FEE fallback and wallet branches)*: `payoutLegs` filter at `:2844-2846`, `reconcileLegs` against `expectedTotalIn(payoutAmount, currency)` at `:2859-2865`, per-leg negated posting at `:2878-2899`, fallback at `:2900-2919`.

**But that block cannot satisfy CUSTOMER_ACCOUNT.** Its `payoutLegs` filter excludes non-drawer-affecting methods, so a CUSTOMER_ACCOUNT leg is summed into reconciliation yet never credited — a mixed CASH + CUSTOMER_ACCOUNT split silently drops the account credit. Model the per-leg loop on the app-wallet payout at [FinancialServiceRepository.ts:2162-2230](packages/core/src/repositories/FinancialServiceRepository.ts#L2162-L2230), which branches on `leg.method === "CUSTOMER_ACCOUNT"` → `getDebtService().addCredit(...)` at `:2190-2203` before the drawer case.

Further backend requirements:
- **Hard-reject an empty `payments[]`** before any posting. The legacy `paid_by_method` fallback must be unreachable on a payout — it would book IN-direction client debt on a money-OUT flow.
- Reject a CUSTOMER_ACCOUNT payout leg with a null client (`addCredit` requires one; the copied pattern throws `"Client is required for CUSTOMER_ACCOUNT cashout"`).
- **No drawer-sufficiency guard** — the PCD may go negative by design ([FSR:2867-2876](packages/core/src/repositories/FinancialServiceRepository.ts#L2867-L2876), owner reversal 2026-08-01). The doc comment at [FinancialService.ts:38-48](packages/core/src/services/FinancialService.ts#L38-L48) still describes the removed guard — stale, do not copy.
- Credit `getPrimary(carrier)` with a `carrier_line_movements` row (`reason: "CREDIT_BUYBACK"`, `validityDaysDelta: 0` per D9), then set the drawer from `getCarrierCreditsSum(carrier)`. New paths do not get §0.6's grandfather exemption.

**Behaviour change vs the retired modal arm (8.2):** the modal debited **General**; the form routes through `resolveServiceCashDrawer` (the PCD, which may go negative). Intentional — the PCD plan made the PCD the physical cash source. Profit is unchanged in substance.

**New transaction type `TELECOM_CREDIT_BUYBACK`** (D8) — three registrations, two of which the earlier draft missed:
- `transactionTypes.ts`, **kept out of** `NON_REVERSIBLE_TRANSACTION_TYPES`. Reversal owners exist: `_reversePayments`, `_reverseCarrierLineMovements` ([TransactionRepository.ts:2797](packages/core/src/repositories/TransactionRepository.ts#L2797)), and `_cancelDebt` via `CREDIT_DEPOSIT`.
- **`ACTIONABLE_TYPES` in `frontend/src/features/audit/auditConstants.ts:310`** — `actionGating.guard.test.ts` asserts ACTIONABLE ∪ NON_REVERSIBLE covers every type. **Omitting this breaks the build.** Mirror the `TELECOM_SELF_CHARGE` entry at `:355-360`.
- **`PROFIT_TXN_TYPES` is not in `transactionTypes.ts`** — it is a module-private SQL string at [ProfitRepository.ts:364-365](packages/core/src/repositories/ProfitRepository.ts#L364-L365) feeding only `getByUser`/`getByClient`/`getDeferredProfit`. Add it there, or type the row `RECHARGE` and skip this entirely.

**`recharges.recharge_type` has a CHECK constraint** — `CHECK(recharge_type IN ('CREDIT_TRANSFER','VOUCHER','DAYS','TOP_UP','ALFA_GIFT'))` ([create_db.sql:514](electron-app/create_db.sql#L514)). Decide explicitly whether the buy-back writes a `recharges` row. If yes (recommended — it is needed for `source_table`/`source_id`, refunds via `_markSourceRefunded`, and the history list): **migration v149** rebuilding the table with `'CREDIT_BUYBACK'` added (SQLite cannot ALTER a CHECK), mirrored in `create_db.sql`, with a `down()`. If no: state what `source_table`/`source_id` the transaction carries and confirm the refund path handles NULL.

**Which line receives the credits:** `getPrimary(carrier)`. Per §0.6 the buy-back writes the line movement *and* the drawer — it is a Phase 6 path, and leaving it drawer-only would break the sum the moment a second line exists.

**Session basket:** a payout item inside an IN-direction basket is a design problem, not a sign flip — the basket's `formData` deliberately carries no payment fields because checkout collects once. Either design it (does the basket net? can the total go negative? which drawer pays?) or **block buy-back while a session is active** with an explicit message and record why (FEATURE_GUIDE §13 item 11 accepts "document why not"). Default: block.

**Audit viewer:** register the cash-flow direction in `cashFlow.ts` (red ↑, matching `lira-075`), add the display label and type-filter entry, and decide `RECEIPTABLE_TYPES` membership ([auditConstants.ts:366](frontend/src/features/audit/auditConstants.ts#L366)) — a buy-back hands cash to a customer and plausibly wants a slip; `RECHARGE` is already receiptable.

**Dual transport:** schema from Phase 6a; `requireRole` on `/process` from Phase 0b; `frontend/src/types/electron.d.ts` and `packages/ui/src/api/types.ts` updated alongside `preload.ts`.

### Phase 7 — Remove the in-form Payment Method dropdown

**Runs after Phase 6a.**

Targets: [TelecomForm.tsx:728-747](frontend/src/features/recharge/components/TelecomForm.tsx#L728-L747) (labelled dropdown, sets both `initialPaymentMethod` and `setPaidBy`) and [FinancialForm.tsx:799-812](frontend/src/features/services/pages/Services/index.tsx#L799-L812) (unlabelled toolbar quick-select that sets **only** `initialPaymentMethod` — already the divergence case).

**`KatchForm.tsx` has no in-form payment-method control.** Its `paymentMethod` state (`:589`) is already sheet-driven only (written at `:2108-2113`); nothing to delete, only the client auto-switch (`:575-587`, `:2131-2136`) to keep working. `CryptoForm` and `OmtWhishAppTransferForm` share that same no-dropdown shape.

**This is a money-routing change.** When the sheet produces no legs, [RechargeRepository.ts:917-935](packages/core/src/repositories/RechargeRepository.ts#L917-L935) uses `paid_by_method` alone to pick the drawer or turn the sale into client debt, and `reconcileLegs` no-ops on empty payments, leaving the branch unguarded.

1. Keep sending `paid_by_method`, derived from the sheet — first leg, or `"MULTI"` when >1, matching crypto ([Recharge/index.tsx:1087](frontend/src/features/recharge/pages/Recharge/index.tsx#L1087)), FinancialForm (`:402`) and KatchForm (`:1323`). The telecom path never sends `"MULTI"` today.
2. **The divergence is narrower than the earlier draft claimed.** Neither client-selection site ([TelecomForm.tsx:231-248](frontend/src/features/recharge/components/TelecomForm.tsx#L231-L248), the *new-client* effect; [:897-903](frontend/src/features/recharge/components/TelecomForm.tsx#L897-L903), the search-result click) calls `setPaidBy` — but on the single-leg path it self-heals: `MultiPaymentInput` re-emits on mount ([:483-501](packages/ui/src/components/ui/MultiPaymentInput.tsx#L483-L501)) and `onPaymentChange` sets `paidBy` when there is exactly one line ([TelecomForm.tsx:798-803](frontend/src/features/recharge/components/TelecomForm.tsx#L798-L803)), before any submit is possible. **The real defect is the split case:** with 2+ legs the `lines.length === 1` guard never fires and `paid_by_method` is sent stale. Deriving from the sheet fixes both.
3. **Guard it in the backend, not by frontend inspection.** On desktop the sheet always emits ≥1 leg (`MultiPaymentInput` seeds one at mount, `removePaymentLine` will not drop below one). **On web the fallback is already live** — see Phase 6a. Throw on an empty/absent `payments[]` where legs are expected, with a failing-first core test.
4. `frontend/src/utils/__tests__/legsGate.guard.test.ts` fails the build if a form gates `payments:` behind a split flag — do not reintroduce that shape.

### Phase 8 — Remaining Top-Up disposition

**8.1** — folded into **Phase 0b**. See there.

**8.2 — Delete the modal's MTC/Alfa arm *and its whole backend chain*, in the same release as Phase 6.**
Hiding the UI alone leaves `topUpFromCustomer` reachable over IPC and REST, still moving the provider drawer with no paired carrier-line row — the exact D1 drift this item exists to prevent, one layer down. Remove: repo + service method, IPC handler, Zod schema, preload binding, `electron.d.ts` type, adapter fn, `packages/ui/src/api/types.ts` member, REST route. Update or delete any e2e spec driving the arm.

**8.3 — Keep `topUpApp`.** It is the only path to the `OMT_App` drawer on desktop. Retiring it now removes a capability with no replacement. **Inherited debt to note:** it has no REST route (`backendApi.ts:1114` posts `/api/recharge/top-up-app`, which `backend/src/api/recharge.ts` never defines) and `Recharge/index.tsx:682` calls raw `window.api` — a live rule-19 gap.

**8.4 — Close the rule-19 gap on every kept arm.** `topUpFromSupplier` (`:764`), `topUpFromPartner` (`:793`), `topUpFromClient` (`:821`) and `topUpApp` (`:682`) are all raw `window.api` with zero REST routes; `WEB_PARITY_ROADMAP.md:246` already logs this. Lift their schemas from `electron-app/schemas/index.ts` into `packages/core/src/validators/recharge.ts`, add mirroring routes with `requireRole` matching the IPC handlers, and migrate those call sites onto `useApi()`.

---

## 4. Testing

**Rule 17 throughout:** a guard test counts only once shown failing against the pre-fix code.
**Rule 15 on every e2e:** one accumulating DB. Match by identity, assert **deltas** snapshotted immediately before the action.

| Phase | Core unit | E2E |
|---|---|---|
| 0b | `POST /api/recharge/top-up` 404s; a `staff` JWT is refused on `/process` over REST *and* IPC; no `topUp` symbol remains anywhere | existing recharge specs green |
| 0 | 30-day sale moves the MTC drawer −$0.90 not −$30 (**must fail pre-fix**); `RechargeRepository.sms_cost.test.ts:367-381` updated from `before - 10` to `before - 0.30`; `:415-428` (profit = price − cost) **stays green and untouched**; `ALFA_GIFT`/`CREDIT_TRANSFER` unchanged; void returns the drawer to its pre-sale value | sell 30 days from the real Days tab, assert the drawer delta |
| 1 | `getCarrierCreditsSum` returns Σ of active lines and ignores archived ones; `createLine` sets `is_primary = 1` on the carrier's first active line and **does not** throw on a second; `yarn check:tenant-scoping` clean with the two new tables registered | — |
| 2 | `CarrierLineRepository.createLine` is transaction-safe and rejects a duplicate active line | **desktop only** — setup has no REST transport (§0.4) |
| 3 | (a) counted == expected writes a zero delta and no expiry mutation; (b) a variance moves the drawer and credits by the **same** delta (D1), before/after snapshot; (c) a second checkpoint at the same values does not double-apply; (d) `daily_closing_carrier_lines.counted_credits` matches the drawer row for that closing. **No reversal assertion** — CHECKPOINT is non-reversible by design | count a variance, verify both surfaces and the timeline; extend `lira-web-010-checkpoint.spec.ts` |
| 4 | credits entered on create land on the line **and** the drawer equals the carrier sum afterwards; banner boundary at 7 / 8 / expired | add-line from an empty Recharge panel; banner appears and clears |
| 5 | — | a `staff` user can self-charge; snapshot the line before, assert credits moved by exactly the item's `credits` and expiry advanced by exactly its `validityDays`, matching the movement by `transaction_id` + `reason='SELF_CHARGE'` |
| 6a | POST `/api/recharge/process` with two split legs moves both drawers (**must fail pre-fix**) | — |
| 6 | split-payout per-currency debit via the extracted `postPayoutLegs`; `receiveSplitPayout.test.ts` unchanged; create+void nets to 0 across drawer, line, payments, debt; zero legs rejected; CUSTOMER_ACCOUNT leg with no client rejected; same profit as the retired modal arm for identical input | **UI-driven** desktop spec (`lira-131` shape) **and** `lira-web-017-telecom-buyback.spec.ts` over REST — assert per-currency drawer deltas and the movement row, then void and assert every ledger returns to snapshot |
| 7 | repository rejects empty `payments[]`; drawer still resolves from `paid_by_method` where legitimate | frontend vitest: selecting a client emits `paid_by_method === 'CUSTOMER_ACCOUNT'` — **shown failing** against today's code; existing recharge **and financial-service** specs green |
| 8 | — | existing top-up specs green after deletion; `topUpApp` still reaches OMT_App (8.3); the modal offers no MTC/Alfa arm (8.2) |

**Phase 6 needs the UI-driven e2e specifically.** [lira-131's header](frontend/tests/e2e-electron/lira-131-omt-fee-ui-driven.spec.ts) records that 42 of 84 desktop specs hand-build IPC payloads — *including every OMT/Whish money spec* — so they verify the repository against itself. A reversed-direction flow carries exactly the frontend↔repository double-subtraction risk they cannot see.

---

## 5. Risks

1. **Phase 6 is a new money direction in a form that has only ever taken money in.** Every OMT RECEIVE invariant must be copied deliberately. IN-legs-not-OUT-legs is the one that silently double-debits.
2. **Phase 3 touches the count path.** A wrong delta corrupts the drawer *and* the line in one transaction, and `CHECKPOINT` is non-reversible.
3. **Phase 7 looks like a UI deletion and is a money-routing change** — the legacy fallback is the hazard, and it is already live on web.
4. **The single-line rule is UI-only (§0.5), so nothing stops a second line being created in Settings.** If one is, the sum invariant immediately depends on the grandfathered paths from §0.6 — recharge sales and top-ups still move the drawer without attributing to a line, so the drawer stops equalling the sum. Ticket D must land before multi-line is offered anywhere in the UI.
5. **Staff self-charge (D6) is a shrinkage vector** — it moves stock out of the iPick/Katsh drawer onto a SIM with no customer. Void-able and audited, but nothing flags it for review.
6. **Phase 0 changes a live cost formula.** DAYS profit figures do not move (see fix item 4), but drawer history does; confirm no reporting surface caches the old stock value.
7. **Phase 0b deletes a shipped REST route and an `ApiAdapter` type member.** The web-test shim and `packages/ui/src/api/types.ts` must be swept or web typecheck breaks.
8. **Phase 2 writes inside the setup transaction** — the documented ordering hazard means a late write lands after `setup_complete`.
9. **Between Phase 6 shipping and 8.2 landing, D1 is broken by design.** Ship them together, or the first checkpoint after Phase 6 reconciles to a drifted drawer.

---

## 6. Quality gates

```
cd packages/core && npm run build
xcopy /e /y /q "packages\core\dist" "node_modules\@liratek\core\dist\"
yarn typecheck
yarn lint
yarn check:tenant-scoping          # CI-blocking; new tenant-scoped tables
yarn check:bind-arity              # CI-blocking; new parameterized SQL
node scripts/check-schema-equivalence.mjs   # rule 10: migrations ↔ create_db.sql
yarn rebuild:node
core jest
yarn workspace @liratek/backend typecheck
yarn workspace @liratek/backend test
yarn test:e2e:web
yarn rebuild:native
yarn dev   (then stop)
yarn test:e2e
```

Backend jest cannot run while `yarn dev` holds `better_sqlite3.node` — hence the ordering. The two ABIs are mutually exclusive, hence `rebuild:node` before core/backend jest and `rebuild:native` before desktop e2e.

**For every deletion phase (0b, 8.2):** after removing each chain, grep the symbol across `packages/core`, `electron-app`, `backend`, `packages/ui`, `frontend/src`, and `frontend/tests` — zero hits before the gate passes. Update or delete any e2e spec driving the removed arm.

**Every migration** — **v148** (Phase 3, `daily_closing_carrier_lines`) and **v149** (Phase 6, `recharges` CHECK rebuild, if the buy-back writes a `recharges` row), plus any `carrier_line_movements.reason` enum extension — lands in **both** `packages/core/src/db/migrations/index.ts` and `electron-app/create_db.sql` (rule 10), each with a `down()`. **Phase 1 has no migration** (§0.5).

---

## 7. Tickets — inbound disposition and outbound spawns

### Inbound — LIRA-091 (`OWNER_NOTES_TASK_PLAN.md:92`, Note 6): absorbed, note is stale

- **"Extension on shop-number self-charge" is already shipped** — `selfChargeTelecomItem` applies `validityDaysDelta` ([FinancialServiceRepository.ts:3287](packages/core/src/repositories/FinancialServiceRepository.ts#L3287)) and returns `validityDaysAdded` (`:3302`). Update the note, don't scope work.
- **"Auto-decrement on selling days" should be closed, not built.** Its premise — that selling days moves the shop's expiry — is wrong (owner, 2026-08-06: a DAYS sale is SMS-based and costs credits). What the note was really pointing at is the drawer bug, now Phase 0.
- Confirmed: `RechargeRepository.ts` has **zero** references to `carrier_lines` / `CarrierLine`. That is what surfaced Phase 0 — and §0.1.

### Inbound — `days_cost_lbp` attribution: out of scope, no action

Two cost-of-days models coexist and disagree (2.23× on the 10-day card, 1.25× on the 365-day card): the Days tab's `(days / 10) × $0.30` versus `days_cost_lbp`'s residual `cost_lbp − credits × 85,000`. The analysis that `days_cost_lbp` never participates in money movement is correct — it gates the Only-Days computed flow via `isTelecomSplitComplete` and feeds Settings margin figures, nothing else. Phase 3 makes the drawer authoritative for credits and `days_cost_lbp` still does not touch it. **Deliberately excluded so the two are not conflated.** Raise only if the Settings margin display is judged misleading.

### Outbound A — Whish top-up arm defects *(after this plan)*

1. **`includingFees` is inert** — declared at `TopUpModal.tsx:164`, reset at `:227`, checkbox at `:543-544`, display gate at `:552`. `whishCashPaid = max(0, amount − fee)` (`:213`) is computed identically either way and `handleSubmit` sends it at `:269` without reference to the flag.
2. **Currency mislabel** — `Fee Amount (USD)` label at `:493-495` with a `$` prefix at `:497-499`, shown even on LBP top-ups; two further hardcoded `$` displays at `:523` and `:534`. Auto-fee is `currency === "USD" ? amount * 0.01 : 0` (`:209-210`).
3. **`client_id` never sent — the money-consequential one, lead with it.** The backend chain already carries `clientId` end-to-end (`preload.ts:482`, `TopUpFromClientSchema`, `RechargeRepository.ts:1310`/`:1370`). Only the UI drops it: `TopUpModal.tsx:89-94` (prop type) and `Recharge/index.tsx:814-821`. Fix is UI-only — add `clientId` to `onConfirmClient`, swap the free-text field for a `ClientSelector`, forward it.

### Outbound B — Extend `DrawerTopUpModal` to target `OMT_App`

Today it only moves General ↔ `OMT_System`/`Whish_System`. Once it can target `OMT_App`, `topUpApp` can finally be retired (Phase 8.3).

### Outbound D — Attribute every drawer movement to a line *(blocks multi-line)*

Per §0.6, the recharge sale path, both top-up paths, and Phase 0's days-cost leg move the provider drawer without writing a `carrier_line_movements` row. Harmless with one line per carrier; the moment a second exists, `drawer == Σ lines` stops holding.

Scope: make `RechargeRepository`'s sale and top-up paths resolve `getPrimary(carrier)` and write a paired movement, then assert `drawer == getCarrierCreditsSum(carrier)` after every one of them. **This must ship before multi-line is offered in any UI** — including before Settings is allowed to create a second active line without a warning.

### Outbound C — Setup over REST

No `backend/src/api/setup.ts`, no `/api/setup` mount, and `StepComplete.tsx:18` gates on raw `window.api`. Needs `setupCompleteSchema` in core, a mounted route, a dual-mode `completeSetup`, and `useApi()` in the wizard. Tracked against `WEB_PARITY_ROADMAP.md`.
