# E2E Test Optimization Plan

> Status: **Proposed** · Owner: TBD · Target branch for work: `claude/nifty-hopper-Hf9m6`
> Scope: `frontend/tests/e2e-electron/**`, `frontend/playwright*.config.ts`, `.github/workflows/ci.yml`

This document is a **plan only** — no test behavior is changed by adding it. It captures
the current state, the root causes behind "slow + flaky," and a phased, low-risk path to a
fast, trustworthy e2e suite that runs in CI again.

---

## 1. Current state (measured)

| Signal | Value | Source |
|---|---|---|
| Runs in CI today? | **No** — `e2e-tests` job is hard-disabled with `if: false` | `.github/workflows/ci.yml:131-135` |
| Spec files | 10 | `frontend/tests/e2e-electron/**/*.spec.ts` |
| `test()` blocks | ~114 | suite-wide |
| `waitForTimeout` calls | **293** | suite-wide |
| Hard-sleep time baked in | **~168.6 s** of unconditional sleeping | sum of all `waitForTimeout(ms)` |
| Conditional "silent pass" guards | **63** `isVisible(...).catch(() => false)` | suite-wide |
| Component-level specs booting full Electron | **9 of 10** files | see §4 table |
| Retries | `0` (while `trace: "on-first-retry"` — never fires) | `playwright.electron.config.ts:18,31` |
| Parallelism | `fullyParallel: false`, shared Electron instance per worker | `playwright.electron.config.ts:24`, `fixtures.ts:55-150` |

### Per-file hard-wait concentration

```
75  components/MultiPaymentInput.spec.ts
33  components/ClientAutocompleteInput.spec.ts
26  components/SaveAsClientCheckbox.spec.ts
25  components/ConfirmModal.spec.ts
25  app.spec.ts
24  components/DataTable.spec.ts
22  components/TransactionTimeOverride.spec.ts
17  components/CheckoutModal.spec.ts
12  fixtures.ts
10  components/DateRangeFilter.spec.ts
 9  components/EditHistoryPopover.spec.ts
 7  helpers/nav.ts
```

---

## 2. Goals & non-goals

**Goals**
- The suite tells the truth: a green run means the behavior works; a failure is real.
- **Fastest, most efficient execution.** Minimize total Electron boots and bootstrap cost by
  **grouping similar/related tests into shared spec files** so they run together off one boot +
  one setup (each spec file currently = one full Electron launch + one `completeSetup()` — see
  §5 Phase 5 and §6). Wall-clock is a first-class goal here, not just a side effect.
- Faster wall-clock also falls out of the correctness fixes (removing the ~169s of hard sleeps).

**Non-goals**
- **Running e2e in CI (for now).** Per team decision, e2e is *not* required in CI at this time;
  it must stay fast and runnable locally / on demand. The broken CI recipe is documented but
  parked (see §5 "Deferred").
- Rewriting the app to be more testable (out of scope, except the one polling note in §6).
- 100% e2e coverage. E2E should cover **cross-cutting business journeys**, not component units.
- Changing the product's behavior in any way.

---

## 3. Root-cause analysis — why "slow + flaky"

1. **Hard `waitForTimeout` everywhere is the shared root of both symptoms.** A fixed sleep is
   a bet on machine speed: too short on a loaded CI runner → flake; longer than needed
   everywhere else → slow. `navigateTo()` alone sleeps a fixed **3000 ms on every navigation**
   (`fixtures.ts:221`), multiplied across ~114 tests.

2. **63 conditional assertions create false confidence.** The dominant pattern is:
   ```ts
   const visible = await x.isVisible({ timeout }).catch(() => false);
   if (visible) { expect(...) }
   ```
   If the element never appears (exactly the regression we want to catch), the `if` is skipped
   and the test **passes green**. `CheckoutModal.spec.ts` S49–S52 are almost entirely guarded
   this way. This is *why* nobody trusted the suite enough to keep it on.

3. **Wrong layer of the test pyramid.** 9 of 10 spec files exercise **components**
   (DataTable, ConfirmModal, DateRangeFilter, MultiPaymentInput, …) by booting a full
   Electron + SQLite + IPC stack. That's the slowest, flakiest possible way to test a
   modal's button color or a date picker's range logic.

4. **Brittle bootstrap.** `completeSetup()` (`fixtures.ts:411-461`) drives the setup wizard
   through the UI, counting Tailwind classes (`bg-slate-700`), `nth()` inputs, and placeholder
   text. Any restyle breaks every test. It also contains multiple fixed sleeps.

5. **Brittle selectors.** Mixed quality — clean `data-testid` use in page objects, but specs
   and helpers also key on class names (`button[class*="active"]`, `.bg-orange`,
   `div.fixed.inset-0`), `nth()` positions, and free text.

6. **CI recipe is broken independent of flakiness.** `test:e2e:ci` is
   `playwright test --workers=2` with **no `--config`**, so it falls back to
   `playwright.config.ts` → re-exports the Electron config → launches
   `electron-app/dist/main.js`. But the CI job builds only `backend` + `frontend preview` and
   **never builds `electron-app`**. Flipping `if: true` today would not produce a passing job.

7. **Retry/trace mismatch.** `retries: 0` makes `trace: "on-first-retry"` dead config — when a
   test fails in CI there is no trace to debug from.

8. **App-level polling leaks into tests.** `SessionContext` polls on an interval, so
   `closeAllActiveSessions()` (`helpers/nav.ts:16-44`) can't deterministically know when state
   settled and falls back to `waitForTimeout(3000)`. This is an app-shape issue, noted in §6.

---

## 4. Test-layer (pyramid) migration — per spec

E2E should keep only true cross-cutting journeys. Component specs move down to RTL/jest in
`frontend/src/**/__tests__`. **Important:** only `MultiPaymentInput` has an RTL test today —
the rest require *writing* unit tests as part of the move (not just deleting the e2e file).

| e2e spec | Nature | RTL test exists? | Action |
|---|---|---|---|
| `app.spec.ts` | POS sale, exchange, debt, expense journeys | n/a | **Keep as e2e** (the core suite). Harden it. |
| `components/MultiPaymentInput.spec.ts` (75 waits) | component | ✅ `shared/components/__tests__/MultiPaymentInput.test.tsx` + `Services.multi-payment.test.tsx` | **Delete e2e**; fold any missing cases into existing RTL. Triple-covered today. |
| `components/ConfirmModal.spec.ts` | component | ❌ | Write RTL → delete e2e |
| `components/DataTable.spec.ts` | component | ❌ | Write RTL → delete e2e |
| `components/DateRangeFilter.spec.ts` | component | ❌ | Write RTL → delete e2e |
| `components/ClientAutocompleteInput.spec.ts` | component | ❌ | Write RTL (mock IPC search) → delete e2e |
| `components/EditHistoryPopover.spec.ts` | component | ❌ | Write RTL → delete e2e |
| `components/SaveAsClientCheckbox.spec.ts` | component | ❌ | Write RTL → delete e2e |
| `components/TransactionTimeOverride.spec.ts` | component | ❌ | Write RTL → delete e2e |
| `components/CheckoutModal.spec.ts` | component + flow | ❌ | Split: pure UI → RTL; the "partial payment → debt row created" path stays e2e in `app.spec.ts` |

**Net effect:** e2e shrinks from 10 files to ~1–2 journey files; component coverage *improves*
(7 components gain their first unit tests) while running in milliseconds instead of a full app boot.

---

## 5. Phased plan

Each phase is independently shippable and leaves CI green. Recommended PR boundaries.

### Phase 0 — Baseline & safety net (no behavior change)
- Record current wall-clock locally: `yarn workspace @liratek/frontend test:e2e` (note time).
- Add this doc (done).
- **Acceptance:** baseline numbers captured in the PR description.

### Phase 1 — Make the signal honest (highest leverage, do first)
- Remove the 63 `isVisible().catch(() => false)` → conditional-`expect` guards. Each becomes a
  deterministic arrange → act → **assert**. Where a precondition is genuinely
  environment-dependent, convert to an explicit `test.skip(condition, reason)` — never a silent pass.
- Convert the class-based assertions (e.g. `ConfirmModal.po.ts:38` `toHaveClass(/bg-red-600/)`)
  to semantic checks (role, `data-variant`, text) where practical.
- **Acceptance:** zero `.catch(() => false)`-guarded assertions remain in specs; suite may go
  red — that red is *information*, triaged in Phase 2/4.

### Phase 2 — Kill the hard waits (speed + stability, same change)
- Replace `waitForTimeout` with web-first assertions (`expect(locator).toBeVisible()`,
  `toHaveValue()`, `toBeEnabled()`) and `page.waitForResponse` / `waitForFunction`.
- Start with `navigateTo()` (`fixtures.ts:161-222`): drop the trailing `waitForTimeout(3000)`
  and instead wait for a **route-specific anchor** per destination (e.g. POS search input,
  Products "Add Product" button). Biggest single win.
- Then `helpers/nav.ts` and the high-count specs in priority order.
- **Acceptance:** `grep -r waitForTimeout` in `e2e-electron` trends toward ~0; only justified,
  commented exceptions remain. Wall-clock measurably down vs Phase 0 baseline.

### Phase 3 — Programmatic bootstrap & seeding
- Replace UI-driven `completeSetup()` with programmatic setup: seed the DB / app config
  directly (extend the existing `helpers/seed.ts` IPC pattern, or add a test-only setup IPC /
  pre-seeded DB fixture). Removes the most brittle + slow part of every worker's startup.
- In `app.spec.ts`, replace UI-driven "create product"/"create client" *prerequisite* steps
  with `seedProduct`/`seedClient`, while keeping **one** explicit UI-create test per entity for
  real coverage.
- **Acceptance:** no spec depends on Tailwind-class/`nth()`/placeholder selectors for bootstrap;
  worker startup time down.

### Phase 4 — Pyramid migration (per §4 table)
- For each component spec: write/extend the RTL test in `frontend/src/**/__tests__`, confirm
  parity, then delete the e2e component spec and its page object.
- Keep `app.spec.ts` (+ any genuinely cross-cutting flow) as the e2e core.
- **Acceptance:** e2e suite is journeys-only; the 7 currently-untested components have RTL tests;
  `yarn workspace @liratek/frontend test` covers what the deleted specs covered.

### Phase 5 — Consolidate & group remaining e2e specs (fastest execution)
**Boots = spec files.** Each spec file launches its own Electron app and runs its own
`completeSetup()` — workers don't share an instance (`playwright.electron.config.ts:19-24`,
`fixtures.ts`). Boot + bootstrap dominates runtime, so fewer, well-grouped files = fewer boots
= faster. After Phase 4 shrinks the suite to journeys, organize what remains for throughput:

- **Group tests by shared setup / domain** so related journeys share one boot and one seeded
  dataset, e.g.:
  - `pos-checkout.spec.ts` — product search, cart, checkout, partial-payment→debt, time override
  - `financial-services.spec.ts` — OMT/Whish, recharge, exchange
  - `debts-clients.spec.ts` — client create, add credit, settle
- Within a grouped file, keep tests **independent** (each seeds its own data per §3) but sharing
  the single Electron instance + setup — so grouping cuts boots without re-coupling tests.
- **Tune file count to worker count.** With shared-per-worker boots, aim for #spec files ≈
  worker count, balanced so workers finish around the same time (split a too-heavy group, merge
  trivially-small ones). Don't collapse into one giant serial file — that starves parallelism.
- **Acceptance:** total Electron boots per run ≈ worker count; no group runs `completeSetup()`
  more than once; wall-clock measurably down vs the Phase 0 baseline.

### Phase 6 — Guardrails (prevent regression)
- ESLint rule banning `waitForTimeout` and class/`nth()` selectors in `e2e-electron/**`, with an
  allowlist-by-comment escape hatch. (Runs in the existing, enabled `lint` CI job — no e2e job
  needed.)
- Document the convention: all selectors live in page objects, `data-testid` only, every test
  asserts unconditionally, related tests grouped per Phase 5.
- **Acceptance:** a PR reintroducing a hard wait or class selector fails the `lint` job.

### Deferred — CI re-enablement (out of scope for now)
Not doing this now (team decision); captured so it's ready when wanted:
- The `e2e-tests` job (`ci.yml:131`) is broken regardless of `if:` — to revive it, build
  `electron-app` (`cd electron-app && npm run build`), invoke with
  `--config playwright.electron.config.ts`, and align the webServer/preview wiring with the
  fixture's expectations.
- When re-enabled: set `retries: 2` (makes `trace: "on-first-retry"` meaningful), keep the
  report upload (already wired at `ci.yml:174-180`), start non-blocking (nightly/label-gated)
  before becoming a required check, and consider `--shard`.
- Until then, the **local command is the contract**: `yarn workspace @liratek/frontend test:e2e`.

---

## 6. Architecture decisions to confirm

1. **Parallelism model.** Current: shared Electron instance per worker + `describe.serial` +
   `fullyParallel: false`. This couples tests (state bleeds; a failure cascades) but avoids
   re-bootstrapping per test. Options:
   - **(A) Keep shared-per-worker, make tests independent** — each test seeds its own data and
     asserts unconditionally; cheap, recommended once Phase 3 makes seeding fast.
   - **(B) Fresh DB per describe block** — stronger isolation, more startup cost.
   - **Recommendation:** (A). Then size the **number of grouped spec files (§5) to the worker
     count** so every worker boots once and finishes around the same time — this, plus
     `PWTEST_WORKERS` tuned to local/runner cores, is the main efficiency lever.

2. **App polling vs tests.** `SessionContext` polling forces `closeAllActiveSessions()` to sleep.
   Options: expose a deterministic "session changed" event the test can await, or a test hook to
   force a re-poll. Small app change, removes a whole class of flake. **Decision needed:** in scope?

---

## 7. Metrics to track (report before/after in each PR)

- **Wall-clock for `test:e2e`** (local, fixed worker count) — the headline number.
- **Electron boots per run / spec-file count vs worker count** (target → ≈ worker count).
- Count of `waitForTimeout` in `e2e-electron/**` (target → ~0).
- Count of `.catch(() => false)`-guarded assertions (target → 0).
- Number of e2e spec files after grouping, and RTL tests added.
- _(CI pass-rate metric deferred — e2e not in CI for now.)_

---

## 8. Sequenced rollout (suggested PRs)

1. **PR1 (this doc)** — plan only.
2. **PR2** — Phase 1: honesty fixes (may surface real reds).
3. **PR3** — Phase 2: hard-wait removal, `navigateTo` first.
4. **PR4** — Phase 3: programmatic setup + seeding.
5. **PR5..N** — Phase 4: one component-spec → RTL migration per PR (small, reviewable).
6. **PR (next)** — Phase 5: consolidate/group remaining e2e specs for fastest execution.
7. **PR (final)** — Phase 6: guardrails (ESLint rule in the existing lint job).

---

## 9. Open questions for the team

- Is the §6.2 app-side polling change in scope, or should tests keep working around it?
- Target local wall-clock budget for the full e2e run (drives how aggressively we group)?
- Any component in §4 we want to *keep* at e2e level for a specific reason?

> Resolved: **e2e in CI** — out of scope for now (kept local/on-demand; see §5 "Deferred").
