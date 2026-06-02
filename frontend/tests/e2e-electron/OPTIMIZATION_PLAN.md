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
- The suite runs in CI again (non-blocking → blocking once stable).
- Meaningfully faster wall-clock — but as a *consequence* of the correctness fixes, not the
  primary lever.

**Non-goals**
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

### Phase 5 — Fix & re-enable CI
- Correct the `e2e-tests` job: build `electron-app` (`cd electron-app && npm run build`), invoke
  with `--config playwright.electron.config.ts`, align the webServer/preview wiring with the
  fixture's expectations.
- Set `retries: 2` in CI; keep `trace: "on-first-retry"` (now meaningful) + `video`/`screenshot`
  on failure. Upload the Playwright report (already wired at `ci.yml:174-180`).
- Re-enable **non-blocking first**: run on a nightly `schedule` and/or behind an `e2e` PR label,
  `continue-on-error: true`, until it's green N consecutive runs — *then* make it a required check
  on `main`.
- Consider `--shard` across a small matrix if wall-clock is still high after Phases 1–4.
- **Acceptance:** e2e job runs green on a schedule; promoted to required check once stable.

### Phase 6 — Guardrails (prevent regression)
- ESLint rule (or a CI grep gate) banning `waitForTimeout` and class/`nth()` selectors in
  `e2e-electron/**`, with an allowlist-by-comment escape hatch.
- Document the convention: all selectors live in page objects, `data-testid` only, every test
  asserts unconditionally.
- **Acceptance:** a PR reintroducing a hard wait or class selector fails the lint/grep gate.

---

## 6. Architecture decisions to confirm

1. **Parallelism model.** Current: shared Electron instance per worker + `describe.serial` +
   `fullyParallel: false`. This couples tests (state bleeds; a failure cascades) but avoids
   re-bootstrapping per test. Options:
   - **(A) Keep shared-per-worker, make tests independent** — each test seeds its own data and
     asserts unconditionally; cheap, recommended once Phase 3 makes seeding fast.
   - **(B) Fresh DB per describe block** — stronger isolation, more startup cost.
   - **Recommendation:** (A). Revisit worker count (`PWTEST_WORKERS`) against CI runner cores.

2. **App polling vs tests.** `SessionContext` polling forces `closeAllActiveSessions()` to sleep.
   Options: expose a deterministic "session changed" event the test can await, or a test hook to
   force a re-poll. Small app change, removes a whole class of flake. **Decision needed:** in scope?

---

## 7. Metrics to track (report before/after in each PR)

- Wall-clock for `test:e2e` (local, fixed worker count).
- Count of `waitForTimeout` in `e2e-electron/**` (target → ~0).
- Count of `.catch(() => false)`-guarded assertions (target → 0).
- Number of e2e spec files (target → 1–2) and RTL tests added.
- CI e2e pass rate over the trial (target → green N consecutive nightly runs).

---

## 8. Sequenced rollout (suggested PRs)

1. **PR1 (this doc)** — plan only.
2. **PR2** — Phase 1: honesty fixes (may surface real reds).
3. **PR3** — Phase 2: hard-wait removal, `navigateTo` first.
4. **PR4** — Phase 3: programmatic setup + seeding.
5. **PR5..N** — Phase 4: one component-spec → RTL migration per PR (small, reviewable).
6. **PR (final)** — Phase 5: CI fix + non-blocking re-enable; Phase 6 guardrails.

---

## 9. Open questions for the team

- Is the §6.2 app-side polling change in scope, or should tests keep working around it?
- Acceptable CI wall-clock budget for e2e (drives shard count / smoke-vs-full split)?
- Re-enable as nightly, label-gated PR check, or both before becoming required?
- Any component in §4 we want to *keep* at e2e level for a specific reason?
