# OMT/Whish Float Model — Handover

> ## ⚠️ SUPERSEDED 2026-07-30 — read this box before anything below it
>
> The **float model** described in this file (PR #66: `OMT_System`/`Whish_System` as a
> spendable in-system provider balance) was **rejected by the owner on 2026-07-30**, the day
> after they first described it — verbatim: *"we dont have omt system balance.. no need for
> another drawer. we can use our omt system drawer"* and *"I don't really care about this
> float model … I think the float model is something wrongly implemented."* PR #66 does not
> merge as designed; it is superseded, not abandoned mid-review.
>
> **Authoritative spec now:** `docs/plans/todo_plans/PRIMARY_CASH_DRAWER_PLAN.md`. The
> canonical money rules live in `docs/FEATURE_GUIDE.md` §7/§8/§8.1, already rewritten for the
> new **primary-cash-drawer** model — read those, not §1 below, for what the system drawer
> means today.
>
> **Kept LIVE from this file — process lessons, not model claims:**
> - §3.2 REST role-gate parity sweep — still needed, still unswept.
> - §3.3 `check:tenant-scoping` not wired into CI — still true, still worth the two-line fix.
> - §4 (the three process traps: payload-seam blindness, better-sqlite3 ABI mixups,
>   concurrent revert campaigns) — still real, still costly, apply to any money-code work,
>   including the primary-cash-drawer implementation itself.
>
> **Resolved/changed by the new plan:**
> - §2 (the settle-to-zero release blocker) is **MOOTED** — the owner wipes the database and
>   starts fresh instead (`PRIMARY_CASH_DRAWER_PLAN.md` decision #14); there is no cutover
>   balance left to settle.
> - §3.1 (the `"FEE"` payment-method tag audit) is **FOLDED INTO** the new implementation —
>   its routing is covered by Phase B's call-site sweep
>   (`PRIMARY_CASH_DRAWER_PLAN.md` §3 Phase B, §6 item 2), not a separate open thread anymore.
>
> This file is **not deleted** — the traps in §4 and the process gaps in §3.2/§3.3 are real
> regardless of which money model is live. Only the model itself (§1, and the specifics in
> §2/§5) is historical.

**Status as of 2026-07-30 (historical — see banner above).** PR
[#66](https://github.com/amirelhalabi/Liratek/pull/66) on branch `fix/omt-float-model`,
10 commits, **all 7 CI checks green**, not merged, now superseded.

Read this before touching OMT/Whish money code. It exists because the work is complete and
verified but has four open threads, and because two mistakes in this area cost real time and are
easy to repeat.

---

## 1. What shipped in PR #66 (SUPERSEDED — historical model description)

The system drawer (`OMT_System` / `Whish_System`) became a **spendable float**, on the owner's
description of their real provider account (2026-07-29, verbatim):

> "I can put money into OMT at setup, and I can also not pre-fund. A SEND spends my balance down,
> a RECEIVE gives me credit I can immediately use for future sends — I don't have to wait for OMT
> to pay me or settle. OMT tracks what each of us owes and we settle periodically, but I can spend
> a received amount normally."

**This description was superseded 2026-07-30** — the owner reviewed the shipped result against
their actual workflow and rejected it (banner at top). The system drawer is not a provider-side
balance; it is the physical cash drawer at the counter. See `docs/FEATURE_GUIDE.md` §7/§8/§8.1
for the model that replaced this one, and `PRIMARY_CASH_DRAWER_PLAN.md` for the full spec.

The invariant form below is the float-model version, kept for historical comparison — the
current model adds a receivable term and inverts the ledger from fee-only to gross (same
`Σ(drawer deltas) − Δ(owed) = c + kept_change` *shape*, different meaning per term; see
FEATURE_GUIDE §8.1 for the exact current form):

```
Σ(drawer deltas) − Δ(owed to provider) = c + kept_change
```

with `f` = customer-facing fee, `c` = the shop's cut of `f`, `f − c` = owed to the provider
**under the float model** (the current model owes the GROSS `x + f − c` instead — FEATURE_GUIDE
§8). Conflating `x`/`f`/`c` is what made the ORIGINAL (pre-#66) bug hard to see, independent of
which model follows; keep them distinct in any new code.

---

## 2. ⚠️ Release blocker — the cutover — **MOOTED 2026-07-30**

> **MOOTED.** The owner's decision changed: instead of settling to zero and re-seeding, they
> **wipe the database and start fresh** (`PRIMARY_CASH_DRAWER_PLAN.md` decision #14). There is no
> balance spanning a cutover to worry about for this install. The general point — a formula
> change that alters what a stored balance MEANS needs either a migration or a clean cutover,
> never silence — is still correct and is why the new plan documents its own cutover explicitly
> (`PRIMARY_CASH_DRAWER_PLAN.md` §5). Kept below for the historical reasoning only.

**Before this ships, the owner must settle all OMT/Whish balances to zero, then re-seed the true
float via Initial Drawer Amounts.**

`supplier_ledger`'s booking formula changed meaning (principal + fee → fee split only), so any
balance spanning the cutover mixes two conventions. Settling first is what makes a data migration
unnecessary — this was the owner's explicit choice over a backfill, so **do not write a migration
for it**.

If you are asked to merge and release, confirm the cutover happened first. It is not a code step.

---

## 3. Open items

### 3.1 The `"FEE"` payment-method tag is unaudited downstream — **FOLDED INTO the new plan**

> **FOLDED IN.** No longer a standalone open thread — the FEE leg's routing is now part of
> the new implementation's own call-site sweep. `PRIMARY_CASH_DRAWER_PLAN.md` §3 Phase B
> names the FEE leg explicitly as one of its call sites (currently hardcoded to `"General"`),
> and §6 item 2 folds this audit into that phase. The questions below are still the right
> questions to ask — they just get asked and answered as part of Phase B, not as a separate
> pass afterward.

The RECEIVE customer-fee leg is written with a **new** payment-method string, `"FEE"`. Where it
flows was never reviewed (the workflow that was going to do it was killed mid-run).

Check each of these and report what happens when it meets `"FEE"`:

- `packages/core/src/utils/payments.ts` — `paymentMethodToDrawerName`, `isDrawerAffectingMethod`,
  `isNonCashDrawerMethod`, `FALLBACK_DRAWER_MAP`. Does it resolve to a real drawer or fall through
  to a default? Is it treated as drawer-affecting? Wrong either way = the fee is double-counted or
  dropped.
- The `payment_methods` table seed (`packages/core/src/db/migrations/index.ts` **and**
  `electron-app/create_db.sql`) — is `"FEE"` registered? If not, does anything JOIN against that
  table and silently lose the row (a report, closing, the audit viewer's leg detail)?
- Closing / checkpoint — does any expected-vs-counted calculation enumerate methods or drawers in a
  way that misses or double-counts a `"FEE"` leg?
- `frontend/src/features/audit/` — leg-detail rendering, `cashFlow.ts`, and the "Cash only (till)"
  filter. Does it render a sensible label and classify correctly?
- `TransactionRepository._reversePayments` — it reads every `payments` row drawer-name-agnostically,
  so it *should* reverse a `"FEE"` leg. Confirm the leg IS a `payments` row and not a direct
  `applyDrawerDelta`.

**Then form a view:** was a new method string the right design, or should the fee leg have reused
the customer's actual tender method (`CASH`)? Argue from what the consumers above do.

Green e2e is **weak evidence** here — no spec drives a RECEIVE fee through the till.

### 3.2 REST role-gate parity sweep — **STILL LIVE**

> Not model-specific — applies to any REST route regardless of which OMT/Whish money model is
> current, including the routes the primary-cash-drawer plan adds (drawer-transfer endpoint,
> §8.6). Still unswept as of 2026-07-30.

Commit `4c72e9c` fixed **one** route: `POST /api/services/transactions` had `authenticateJWT` but
no `requireRole`, so any authenticated web user could post a financial-service transaction the
desktop restricts to admin/staff. CLAUDE.md rule 19(c) requires every REST route to carry a
`requireRole` matching its IPC handler.

`backend/src/api/debts.ts:62` carries a comment recording the same gap found once before — so this
has been patched one route at a time and never swept.

Do the sweep: enumerate every write route (POST/PUT/PATCH/DELETE) in `backend/src/api/*.ts`, pair
each with its IPC handler in `electron-app/handlers/`, and produce a table of
`MATCH / MISMATCH / REST-HAS-NONE / NO-IPC-TWIN`.

Also check ordering: `requireRole` only reads `req.user`, so it **must** run after
`authenticateJWT`/`requireAuth`. Some route files lack a router-level `authenticateJWT` —
CLAUDE.md names `closing.ts`. Those return 401 with no `success` field, breaking the envelope
contract too.

Rank findings by what a lower-privileged token could actually do (money movement > data mutation >
read).

### 3.3 `check:tenant-scoping` is not in CI — **STILL LIVE**

> Not model-specific. Run it after every repository SQL edit made by the primary-cash-drawer
> implementation too (`PRIMARY_CASH_DRAWER_PLAN.md` §4 says so explicitly) — still not in CI,
> still the only reason it gets run at all is someone remembering to.

`node scripts/check-tenant-scoping.mjs` (wired as `yarn check:tenant-scoping`) statically finds
missing `tenant_id` predicates. It is **not** in `.github/workflows/ci.yml`.

It earned its place this session: a subagent refactoring `TransactionRepository._cancelDebt`
silently dropped `AND tenant_id = ?`, which survived the implementer's report, a rule-17 verifier,
and a money-invariant verifier — and this linter flagged it as the only violation tree-wide, in
seconds. Reproduced: a colliding cross-tenant `transaction_id` reversed another tenant's row,
stamped with the caller's tenant.

Adding it to the Lint job is a two-line change.

### 3.4 [OWNER] Are the fee tiers correct for the RECEIVE direction? — **STILL OPEN**

> Model-independent — the primary-cash-drawer model still has a customer fee on RECEIVE
> (`PRIMARY_CASH_DRAWER_PLAN.md` §6 item 3 carries this forward verbatim: "still awaiting
> owner"). Not resolved by the model change; still needs an answer.

`INTRA_FEE_TIERS` / `WESTERN_UNION_FEE_TIERS` (`packages/core/src/utils/omtFees.ts`) were built
for SEND. RECEIVE now has a customer fee, and the auto-lookup is **not** direction-gated — so a
RECEIVE auto-fills from the SEND tables.

If OMT charges differently on a receive, the operator will be typing over the auto-fill every
time. Only the owner can answer. Asked 2026-07-30, not yet answered.

---

## 4. Three traps that cost real time — **STILL LIVE**

> Process lessons, not model claims — none of these three depend on which OMT/Whish money
> model is current. Apply them to the primary-cash-drawer implementation exactly as they
> applied to PR #66.

### 4.1 Payload-constructing tests cannot see layer-seam bugs

**42 of 84** specs in `frontend/tests/e2e-electron/` call `window.api.*` with a hand-written
payload and never use a UI locator — including every OMT/Whish money spec (`lira-074`, `lira-076`,
`lira-077`). Measure with:

```bash
grep -l "window\.api\." *.spec.ts | xargs grep -L "getByRole\|getByPlaceholder\|getByTestId"
```

Those specs verify the repository's contract **with itself**. Two real bugs hid in the seam, both
green across 2344 unit tests and 284 payload-built e2e:

- the repository re-netted a fee the form had already netted (`7c37b72`) — every fee-included SEND
  hard-rejected in the app
- the form seeded the payment total from the fee-tier table while sending the operator's typed fee
  (`18d401f`) — reconciler wanted \$105, got \$101

`lira-131-omt-fee-ui-driven.spec.ts` is the pattern that catches them: type into
`#service-amount`, fill the real fee input, tick the real `data-testid` toggle, click Record. It
found the second bug on its first run. `Services.legsGate.test.tsx` /
`Services.tenderRate.test.tsx` are the equivalent jest pattern (mount the page, stub
`MultiPaymentInput` to expose its callbacks, assert the real submitted payload).

**Discriminator:** a payload-constructing test is fine when the page merely *forwards* a form. It
is insufficient wherever the **frontend does arithmetic before sending** — fee netting, rate
conversion, split allocation, basket netting — because the same computation then exists on both
sides of the boundary and can drift.

### 4.2 Use the root scripts for the better-sqlite3 ABI; never hand-roll

- `yarn rebuild:native` → **Electron** ABI. Works. (An older internal note claimed it no-ops; that
  was wrong.)
- `yarn rebuild:node` → **Node** ABI. Works.
- `yarn test` is `npm run rebuild:node && …` — **self-correcting from either ABI.**
- `yarn test:e2e` has **no** rebuild prefix. That asymmetry is the entire reason for the documented
  sequence: `yarn dev` (sets Electron ABI **and** compiles `electron-app/dist`) → **stop it**
  (frees port 5173 and the `better_sqlite3.node` file lock) → `yarn test:e2e`.

Running `npx jest` inside a workspace bypasses `rebuild:node` and yields a spurious
`NODE_MODULE_VERSION` error. That is a skipped wrapper, not a repo defect. While `yarn dev` runs it
holds the binary, so any rebuild fails `EBUSY`.

Also: if `ELECTRON_RUN_AS_NODE=1` is set in the shell, Electron boots as plain Node — `yarn dev`
dies with `cjsPreparseModuleExports` and every desktop spec dies at `waitForEvent("window")`. Run
e2e with `env -u ELECTRON_RUN_AS_NODE`.

### 4.3 Never run a revert campaign with concurrent agents

A workflow retried an agent while the original was still alive; both edited the same files, and one
was killed mid-sabotage, leaving `FinancialServiceRepository.ts` with the float sign flipped **back**
— the exact bug the branch fixes — live in the working tree. Caught only by inspecting `git status`.

If you deliberately break production code to prove a guard fails (rule 17), do it **single-agent**,
and finish with a diff check confirming **only** comment lines changed in the test files. Had a
racing agent adjusted an assertion while production was sabotaged, the bug would have been baked
into the guard permanently and every suite would still have reported green.

---

## 5. Verification baseline (historical — float-model era numbers)

> These are PR #66's own baseline numbers, reproduced against the float model before it was
> superseded. The primary-cash-drawer implementation has its own baseline, verified green
> 2026-07-30 pre-implementation on the same working tree (`PRIMARY_CASH_DRAWER_PLAN.md` §4):
> core jest 1205/1205 (113 suites), backend 500/500 (36 suites), frontend 663 passed / 1
> skipped (82 suites), typecheck clean, lint 0 errors / 524 warnings, `check:tenant-scoping`
> 0 violations / 629 statements — desktop/web e2e NOT run at baseline (their OMT assertions
> get re-derived by this feature anyway). Use that table for the current work, not this one —
> the two suite counts already differ (112 vs 113 core-jest suites) because more tests exist
> now than when PR #66 shipped.

Reproduce this before and after any change here:

| Gate | Expected |
|---|---|
| `cd packages/core && npx jest` (after `yarn rebuild:node`) | 1190/1190, 112 suites |
| `yarn workspace @liratek/frontend test` | 657 passed, 1 skipped, 81 suites |
| `yarn workspace @liratek/backend test` | 500/500, 36 suites |
| `yarn typecheck` | clean |
| `yarn check:tenant-scoping` | **0 violations** / 629 statements |
| `yarn lint` | 0 errors, 524 warnings (warning count is the baseline) |
| `yarn test:e2e:web` | 47/47 |
| `yarn test:e2e` (after `yarn dev` → stop) | 240/240 |

All 19 float-model guards are proven failing-first. Each carries a
`// rule 17: proven failing-first 2026-07-30 — …` note recording the revert **and** the wrong value
observed, so the proof is re-runnable without re-deriving it. Do not delete those notes.

Two spots that are environment-sensitive, both now guarded — do not "fix" them back:

- `lira-102` / `lira-103` derive their instant from the machine's UTC offset and **skip** at
  offset ≤ 0. The TZ-independent proof is `ClosingRepository.localBusinessDay.test.ts`.
- The 5 `waitForTimeout` calls in `lira-123` carry documented `eslint-disable` exceptions. They
  wait *past* a reveal window to prove a leg did **not** appear; web-first assertions are
  pass-seeking and would resolve on the first tick, silently proving nothing.

---

## 6. One known gap with no owner — **STILL LIVE**

No money-mutating endpoint in this codebase has an **idempotency key**, so a dropped-response retry
double-applies. Verified against `fundSystemDrawer`: two byte-identical calls posted the transfer
twice in full. This is architecture-wide — `createTopUp`, `createTopUpFromDrawer`, and
`WalletExchangeRepository` share it — so fixing it in one place closes nothing. Flagged, not owned.

> Model-independent, and inherited by the new transfer endpoint: `fundSystemDrawer` is being
> generalized into `transferBetweenDrawers` (`PRIMARY_CASH_DRAWER_PLAN.md` §8.6), and the plan's
> own risk list (§6 item 6) carries this gap forward verbatim: "unchanged, still unowned; the
> new transfer endpoint inherits it." Still nobody's job.
