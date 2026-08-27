# General Drawer — Unrestricted Currencies

**Status:** ✅ Phase 1 · ✅ Phase 2 · ✅ Phase 3 item 7 — all uncommitted · ⏭ **Phase 3 item 8 is
now urgent, see §8** · **Created:** 2026-08-22 · **Base:** `main` @ `0eb34ba2` (v1.30.2)

**Phase 1 verification record (2026-08-22):** core suite **2018/2018 pass (197 suites)**; core
build + `node_modules/@liratek/core` sync done; backend (14s) and electron-app (6s) typecheck
clean. Rule 17 proven in **two** sabotage runs: (a) `isUnrestrictedDrawer → false` + Layer 2 guard
removed → 9 of 19 new tests fail; (b) registry union reverted to the single-table query → the 2
registry tests fail. In both runs the anti-over-reach guards (`Binance` returns only USDT, `Katsh`
keeps its allowlist, `Loto` stays registered, zero-balance currency not resurrected) kept passing —
that is their purpose, so they must not be "improved" into failing tests.

One existing fixture was corrected, not worked around: `DrawerTopUpRepository.test.ts`'s
`enableDrawerCurrency` seeded a `currency_drawers` row without the parent `currencies` row — a
state the real schema forbids (`currency_drawers` FKs to `currencies(tenant_id, code) ON DELETE
CASCADE`), so the production query was **not** widened to accommodate it.

**The ask (owner, 2026-08-22):** cash-in of an arbitrary currency (EUR 300) into the General
drawer is rejected with _"Currency EUR is not enabled for the General drawer. Enable it in
Settings → Currencies first."_ Since the Exchange module accepts **any** currency and deposits it
into General, General should not be currency-restricted at all.

**Verdict:** the owner is right, and the fix belongs in **one place** — the three
`currency_drawers` read methods in `packages/core/src/repositories/CurrencyRepository.ts`. Every
surface (top-up, Dashboard, Closing, Opening, Setup, Settings) and **both transports** funnel
through those reads, so a policy there fixes all of them at once.

---

## 0. NEXT SESSION — START HERE (handover, 2026-08-27)

**Everything below is UNCOMMITTED.** The owner commits, and they edit this repo in **parallel
sessions** — so an unexplained diff is theirs. Never `git checkout/reset/stash`. Their in-flight
files as of this handover: `current_sprint.md`, `docs/plans/todo_plans/FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md`,
`frontend/src/features/services/**`.

**Done + verified:** Phase 1, Phase 2, Phase 3 item 7 (see the verification record above).
**Outstanding, in priority order:** item 8 → item 9 → item 10 → Phase 4.

> ⚠ **Do item 8 FIRST.** Phase 1 made General's set derive to *every active currency*, and the
> closing screens still read that set raw — so **today the General count sheet is wrong** (§8).
> It is the only user-visible regression left from this work.

### Item 8 — the closing/opening count sheet (URGENT, biggest remaining item)

**Goal (owner decisions D2 + D5):** for **every** drawer, the count sheet = **base ∪ {currencies
with a non-zero balance}**, where base = the configured allowlist (restricted drawers) or
**USD + LBP** (unrestricted, i.e. General). Deduplicated.

**Two bugs it fixes** (both verified live, see §8 for the full trace):
1. **USDT gets two input fields** for General. `Checkpoint/index.tsx:163-172` builds `coreCurrencies`
   (derived ∩ {USD,LBP,EUR,USDT}) and `otherCurrencies` (derived − {USD,LBP,EUR}); USDT is in
   **both**, and `DrawerCard.tsx:307,372` renders the two lists **independently with no dedup**.
   `statusFields` double-counts it in the variance summary too.
2. **EUR/USDT appear at zero balance** — the "all active currencies" option the owner explicitly
   rejected.

**Where the code goes (rule 13):** one named read in `ClosingRepository`, **not** in the page.
`CurrencyRepository.getNonZeroBalancesForDrawer(drawerName)` already exists from Phase 1 — reuse
it, do not write a second balance query (rule 14). `isUnrestrictedDrawer()` from
`constants/drawerCurrencyPolicy.ts` picks the base set.

**Consumers to migrate:** `frontend/src/features/closing/pages/Checkpoint/index.tsx` (kill the
`coreCurrencies`/`otherCurrencies` split for General, or dedupe it), `InitialDrawerAmountsModal.tsx:149`,
`StepDrawerAmounts.tsx:117` — all three iterate the same map.

**Proof required:** failing-first (rule 17) — a drawer whose allowlist omits a currency it still
holds **still gets a count field**; a zero-balance exotic does **not**; General shows no duplicate
USDT field. Plus the `Binance → USDT only` guard must keep passing (it proves acceptance scope
didn't widen).

### Item 9 — drop the redundant exchange auto-register

Remove the General `INSERT OR IGNORE INTO currency_drawers` in `ExchangeRepository`'s
`_applyExchangeLotEffects` region so the policy has ONE owner. **Keep `ensureCurrency`** — it must
still create the `currencies` row for API currencies (GBP, AED).
⚠ **Line numbers in that file drifted ~+22** from the 2026-08-27 exchange-override work — find it
by symbol (`ensureDrawer`), never by the line numbers quoted elsewhere in this doc.

### Item 10 — delete a dead IPC round-trip

`Dashboard.tsx:242` loads `_drawerCurrencyConfig` and never uses it — one wasted call per dashboard
load. Pure deletion.

### Phase 4 — the proof set

- **Rule 20 reversal symmetry:** create a EUR top-up → void it → `payments` **and**
  `drawer_balances` net to **0 in EUR**. Expected to pass (generic `_reversePayments` reverses per
  currency) but it is an unproven path for a non-USD/LBP currency — assert it, don't assume.
- Closing D2 test (non-zero EUR ⇒ count field; zero ⇒ none).
- **E2E:** desktop — cash-in EUR from the dashboard modal → appears in Cash on Hand → appears in
  the closing sheet. Web mirror per rule 19.
- Then the **full** `yarn test` (root, not per-workspace — see the environment note below).

### Environment notes that will save you time

- **better-sqlite3 ABI:** left on the **Node** ABI (core jest works, desktop e2e does not).
  `yarn dev` rebuilds it to Electron automatically. Root `yarn test` runs `rebuild:node` first, so
  it self-corrects.
- **Run the FULL core suite, never just your new files.** The exchange work's CI-red BLOCKER (a
  strict `toEqual` pinning test broken by an added return field) was invisible until the full suite
  finally ran: `cd packages/core && node ../../node_modules/cross-env/src/bin/cross-env.js TZ=Asia/Beirut node ../../node_modules/jest/bin/jest.js --config jest.config.cjs`
  → baseline **230 suites / 2435 tests**.
- After any `packages/core` edit: `cd packages/core && npm run build` (this IS core's typecheck+lint),
  then from the repo root `cp -r packages/core/dist/. node_modules/@liratek/core/dist/`.
  A symbol the renderer imports must also be exported from `packages/core/src/browser.ts` or the
  renderer fails at load and **no typecheck catches it**.
- Git Bash mangles `cmd /c` and long heredocs — use the Write/Edit tools; call `npm`/`npx`/`node`
  directly.

### Sibling workstream (separate, DONE but also uncommitted)

The exchange rate-override fix (signed override profit, `bookedProfitUsd`, cross anchor schema
guard, deferred-profit preview, `lira-146` e2e). Fully verified: core 230/2435, frontend exchange
41/41, desktop e2e green, rule 17 executed. Two cosmetic residuals were deliberately left, if
anyone wants consistency: `HistoryModal.tsx:174` and `PositionsPanel.tsx:153` render a negative as
`$-X.XX` instead of `-$X.XX` (server-persisted values, already correctly signed — cosmetic only).
Also `frontend/tests/e2e-electron/fixtures.ts`'s comment "None of the 11 current opt-out spec
files…" is stale — it is **13** now.

---

## 1. Diagnosis — two sources of truth that disagree

|            | Table              | Semantics                                                          | Read by                                                                    |
| ---------- | ------------------ | ------------------------------------------------------------------ | -------------------------------------------------------------------------- |
| **Fact**   | `drawer_balances`  | any currency; row created on demand by `applyDrawerDelta`'s upsert | Dashboard "Cash on Hand"; closing _expected_ values                        |
| **Config** | `currency_drawers` | a **closed allowlist**                                             | top-up gate, top-up picker, Closing count fields, Opening, Setup, Settings |

The Exchange module writes to the **fact** side for any currency — and even auto-registers the
config row itself (`ExchangeRepository.ts:220-238`, an `INSERT OR IGNORE INTO currency_drawers`
pinned to the General drawer). So General is **open by construction** on one path and **closed by
config** on another. That contradiction is the bug.

**The plumbing already works.** Extra-currency top-up legs already write a `payments` row _and_ a
`drawer_balances` delta per currency (`DrawerTopUpRepository.ts:204-222`). Nothing downstream is
missing — only the config gate at `DrawerTopUpService.ts:85` blocks it.

### Evidence (verified against the live DB, `~/Documents/LiraTek/liratek.db`, 2026-08-22)

- `currencies`: USD, LBP, EUR, USDT — all active
- `currency_drawers` General: **`LBP, USD` only** — EUR absent
- `currency_modules`: EUR enabled for **`exchange` only**
- `drawer_balances` General: `LBP 1,100,000` / `USD 0`; **no exchange transactions yet**, so the
  auto-register path has never run — which is why EUR is still missing
- New web tenants inherit the same restriction: `TenantRepository.ts:485-487`

---

## 1a. The second bug — and it affects EVERY drawer, not just General

`setCurrenciesForDrawer` is a destructive replace-all (DELETE + INSERT,
`CurrencyRepository.ts:258`). Unticking a currency in Settings is **one click + Save**. Closing
then filters its count fields by that allowlist (`Checkpoint/index.tsx:163-165`), so **real cash
in the removed currency stays visible on the Dashboard but becomes uncountable at closing** — a
permanent silent variance.

The first draft of this plan guarded **General only**. That was under-scoped: the mechanism is
identical on every restricted drawer, and it is **live right now**:

```
non-zero balances (live DB, 2026-08-22):
   General   LBP   1,100,000
   Katsh     LBP   2,957,925    <- restricted drawer (allowlist = LBP, USD)
```

One untick + Save on Katsh makes **2,957,925 LBP uncountable at closing**. Real money, one click,
no warning. So the fix is three layers, ordered by what actually eliminates the class:

| Layer | What                                                                                                                                                      | Why                                                                                                                                                        |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1** | **The count sheet must not depend on the config.** For _any_ drawer: sheet = base ∪ {currencies holding a non-zero balance}. Base = allowlist (restricted) or USD+LBP (unrestricted). | The real fix. Money existing is a **fact**; the allowlist is a **display preference** — the fact wins. Makes config drift structurally unable to hide money. |
| **2** | **Refuse to un-configure money.** `setCurrenciesForDrawer` diffs the removed set against non-zero `drawer_balances` and rejects, naming currency + amount.  | Prevents the drift at the source. Zero-balance removals stay allowed. Reject rather than silently re-tick — overriding the operator's click unannounced is worse than a clear refusal. |
| **3** | **Reject any write to an unrestricted drawer** (General).                                                                                                  | The allowlist concept does not apply there at all.                                                                                                          |

---

## 2. Owner decisions (2026-08-22)

| #   | Decision                                                                     | Rationale / consequence                                                                                                                                                                     |
| --- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **General only** is unrestricted — OMT_System / Whish_System stay restricted   | Narrowest change. Verified to have **zero residual gap** today — see §5.                                                                                                                     |
| D2  | Count sheet = **base set, plus any currency with a non-zero balance**         | You count exactly what is physically in the till; the sheet shrinks again once an exotic currency is spent to zero.                                                                          |
| D3  | **EUR stays `exchange`-only** in `currency_modules`                           | EUR can be exchanged, held, cashed in, and counted — but not tendered in POS/services. Separate axis; no work here.                                                                          |
| D4  | Plan doc first, then implement                                               | This document.                                                                                                                                                                              |
| D5  | §1a Layer 1 applies to **all** drawers, not just General (owner-approved)      | Slightly widens D1 — but on a **different axis**. It does not let other drawers _accept_ new currencies; it only makes money they already hold _countable_. Acceptance stays General-only.    |
| D6  | Settings shows **no General card at all** (owner chose this over a read-only card) | Grid = configurable drawers only, plus a footnote explaining the omission so it does not read as a missing drawer. Implemented in Phase 3 item 7.                                          |

---

## 3. The principle (encode this as a named constant)

> `currency_drawers` is a **provider** constraint. Binance genuinely only holds USDT; MTC/Alfa
> hold USD. **General is the shop's own till and is unbounded** — its currency set is _derived_
> from `currencies` ∪ `drawer_balances`, never configured.
>
> And separately: **a drawer's countable set is never smaller than the money it holds.**

---

## 4. Phases

### Phase 1 — core policy (the whole fix)

1. **New** `packages/core/src/constants/drawerCurrencyPolicy.ts`:
   `UNRESTRICTED_DRAWERS = ["General"] as const` + `isUnrestrictedDrawer(name)`. Defined **once**
   (rule 14) — never inline the drawer name at a policy site again. Export from core's index.
2. **`CurrencyRepository`** — make three reads policy-aware. For an unrestricted drawer, return
   all **active** currencies ∪ any code holding a `drawer_balances` row for that drawer (so a
   deactivated currency that still holds cash stays visible):
   - `getCurrenciesForDrawer` (codes)
   - `getFullCurrenciesForDrawer` (entities — this is what the top-up picker reads)
   - `getAllDrawerCurrencies` (substitute the General key only)
3. **`CurrencyService.setCurrenciesForDrawer`** — §1a Layers 2 + 3:
   - reject when the drawer is unrestricted (Layer 3);
   - reject when the removed set contains a currency with a non-zero balance, naming the currency
     and amount (Layer 2).
     Both guards live in the **service**, not the IPC handler, or REST bypasses them (rule 19).
4. **Registry de-coupling (replaces the first draft's "do not delete these rows" comment).**
   `currency_drawers` currently doubles as the **drawer registry**: `getConfiguredDrawerNames()`
   and the keys of `getAllDrawerCurrencies()` decide which drawer cards render in
   Settings/Opening, so deleting a drawer's allowlist rows makes the drawer **vanish from the UI**.
   A warning comment is not enforcement. Fix: key both reads off
   `currency_drawers` **∪** `drawer_balances`. Then money rows keep a drawer alive even with an
   empty allowlist.
   - Verified this changes nothing visible today: `drawer_balances` covers a strict subset of the
     same 10 drawers, and `Loto` exists **only** in `currency_drawers` — which is precisely why
     both halves of the union are needed.
   - **Deliberately NOT adding a `KNOWN_DRAWER_NAMES` constant.** The drawer registry is already
     duplicated five ways (`PRIMARY_CASH_DRAWER_NAMES`, `CARRIER_DRAWER_NAMES`,
     `WalletDrawerName`, the static list at `SalesRepository.ts:1513`, the frontend's
     `DRAWER_LABELS`). A sixth list makes rule 14 worse. The union needs zero new constants.
5. **No migration.** This is read policy, not schema. (If one is ever added here, the next version
   is **156** — the last entry in `migrations/index.ts` is 155; CLAUDE.md's "v153" is stale.)

### Phase 2 — the gate

6. `DrawerTopUpService.addTopUp` — with Phase 1 in place, the existing check naturally becomes "is
   this an active currency" (garbage codes like `XYZ` are still rejected). Reword the message to
   _"Currency X is not an active currency. Add it in Settings → Currencies first."_ Keep the
   duplicate / zero-amount / uppercase-normalisation logic exactly as-is.

### Phase 3 — UI truthfulness

7. ✅ **Settings** (`CurrencyManager.tsx`) — done. Per **D6** the General card is dropped from the
   grid entirely (`drawerNames.filter(name => !isUnrestrictedDrawer(name))`, the predicate imported
   from core rather than re-hardcoding the name), plus a footnote explaining the omission.
   `handleSave` no longer discards the result envelope — a refused save now shows its reason in a
   banner instead of silently snapping the checkbox back. Note `constants/drawerCurrencyPolicy.js`
   had to be re-exported from `packages/core/src/browser.ts`: Vite/Jest resolve `@liratek/core` to
   that file, so a renderer import of a symbol missing there fails at load. Guarded by
   `CurrencyManager.drawerGrid.test.tsx` (4 tests, rule-17 proven).
8. **Closing / Opening count sheets** (D2 + D5 = §1a Layer 1): one named read in
   `ClosingRepository` — base ∪ non-zero balances, for **every** drawer. Not in the page.
   Consumers: `Checkpoint/index.tsx`, `InitialDrawerAmountsModal.tsx`, `StepDrawerAmounts.tsx`.
9. **Exchange**: drop the now-redundant General auto-register in `ExchangeRepository.ts:220-238` so
   there is ONE owner of the policy. **Keep `ensureCurrency`** — it must still create the
   `currencies` row for API currencies (GBP, AED).
10. **Cleanup**: `_drawerCurrencyConfig` in `Dashboard.tsx:242` is loaded and never used — a dead
    IPC round-trip on every dashboard load.

### Phase 4 — proof

Failing-first (rule 17 — each test must be shown to fail on the pre-fix code):

- `DrawerTopUpService`: EUR top-up with no General row → **fails today**, passes after.
- `DrawerTopUpService`: unknown code `XYZ` → still rejected (guards against over-opening).
- `CurrencyRepository`: General returns all active codes; **`Binance` still returns exactly
  `USDT`** — the guard proving D1's acceptance scope held.
- **§1a Layer 2**: removing a currency with a non-zero balance is rejected, on a **restricted**
  drawer (use the live Katsh/LBP shape) — the case the first draft missed.
- **§1a Layer 1**: a drawer whose allowlist omits a currency it still holds **still gets a count
  field** for it.
- **Registry union (Phase 1 step 4)**: General still appears in `getConfiguredDrawerNames()` and
  in `getAllDrawerCurrencies()` keys when `currency_drawers` has **zero** General rows. Fails
  today → this is what forces the union.
- **Rule 20 (reversal symmetry)**: create a EUR top-up, then void it → `payments` and
  `drawer_balances` net to **0 in EUR**. The generic `_reversePayments` reverses legs per
  currency, so this is expected to pass — but it is an unproven path for a non-USD/LBP currency
  and must be asserted, not assumed.
- **Closing (D2)**: a non-zero EUR balance produces an EUR count field; a zero one does not.
- **E2E**: desktop — cash-in EUR from the dashboard modal → appears in Cash on Hand → appears in
  the closing sheet. Web mirror per rule 19.
- Then the **full** `yarn test` (not core-only — backend mocks reach paths core's suite
  structurally cannot).

---

## 5. Why D1 ("General only" acceptance) has no residual gap

Audited every `applyDrawerDelta` call site whose `currencyCode` is not a `"USD"`/`"LBP"` literal.
An exotic currency can reach **only General**:

| Writer                        | Drawer                       | Currency                                                            |
| ----------------------------- | ---------------------------- | ------------------------------------------------------------------- |
| `ExchangeRepository` inflow   | General — **hardcoded**      | any (`data.fromCurrency`)                                           |
| `ExchangeRepository` payout   | method-mapped                | **USD/LBP only** — split payouts hard-reject a non-USD/LBP target    |
| `DrawerTopUpRepository` extra | `GENERAL_DRAWER` — hardcoded | any                                                                 |
| `WalletExchangeRepository`    | wallet drawer                | **USD/LBP only** — `WalletExchangeService.VALID_CURRENCIES` rejects  |
| Service/session/txn legs      | method-mapped                | USD/LBP tender currencies                                           |

Also `payment_methods` (live DB): **`CASH → General`**, so a cash payout leg lands in General, not
the primary cash drawer. The original argument for also unrestricting OMT_System/Whish_System was
therefore weaker than first stated — D1 is the better-supported choice. **Re-open D1 only if** a
future change lets a non-USD/LBP currency post to a cash drawer; that change must add the drawer
to `UNRESTRICTED_DRAWERS` in the same commit.

---

## 6. Non-goals

- Widening `currency_modules` (EUR as a POS/services tender) — D3. Blocked anyway on
  `reconcileLegs` / `expectedTotalIn` being USD/LBP-native (non-LBP currencies fold into the USD
  bucket).
- Unrestricting provider drawers' **acceptance** — those constraints are real (D1/D5).
- Any schema change.
- **Deferred, named:** the honest long-term model is a real `drawers` table (`name`, `label`,
  `is_restricted`, `sort_order`) consolidating the five duplicated drawer lists listed in Phase 1
  step 4. That is a migration plus every drawer consumer — its own project, not this one. Phase 1
  step 4's union is the cheap structural fix that makes the trap harmless in the meantime.

---

## 8. ⚠ Known interim state — why Phase 3 item 8 is now urgent

Phase 1 made General's set derive to **every active currency**, and the Closing/Opening screens
still read that set directly. Until item 8 lands, the General drawer's count sheet is **wider than
decision D2 allows**, and one field is duplicated:

`Checkpoint/index.tsx:163-172` builds two independent lists and `DrawerCard` renders both
(`DrawerCard.tsx:307,372` — no dedup):

- `coreCurrencies` = derived set ∩ {USD, LBP, EUR, USDT} → **USD, LBP, EUR, USDT**
- `otherCurrencies` (General only) = derived set − {USD, LBP, EUR} → **USDT**

So USDT is in **both** lists and gets two inputs, and EUR/USDT appear at all even at zero balance —
exactly the "all active currencies" option the owner rejected. Before Phase 1 this could not happen
(General's allowlist was USD/LBP, so `otherCurrencies` was always empty). `statusFields` also
double-counts USDT for the variance summary.

Item 8's single `ClosingRepository` read (base ∪ non-zero balances) removes the class: it returns
one deduplicated set, and drops zero-balance exotics. **Do item 8 before anyone runs a real
closing.** The same widening affects `InitialDrawerAmountsModal.tsx:149` and
`StepDrawerAmounts.tsx:117`, which iterate the same map.

---

## 9. Note on the reported repro

At `main` tip the top-up picker is **already** drawer-scoped (`DrawerTopUpModal.tsx:100-115`, fixed
in `a1e073b0` / `69f0afa9`, 2026-08-02) and `addCurrencyRow` bails when the drawer list is empty —
so against the live DB it should render _"No other currencies available…"_ and never offer EUR at
all. Build ages on disk: `frontend/dist` = **Jun 13** (≈7 weeks before the fix, and containing
neither marker string from the current code), `electron-app/dist` = **Aug 16** (current).

**Likely:** the owner ran a current main process (gate present) against a stale renderer (the
pre-fix picker unioned `activeCurrencies` with the live FX feed, and EUR is shop-wide active). A
`yarn dev` rebuild changes the symptom to _"No other currencies available"_ — still wrong, just
wrong in the honest direction. **This does not change the plan**: the modal and the service were
made to agree on a _closed_ allowlist, when the correct answer is that General has no allowlist.
