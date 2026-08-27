/**
 * Harness regression guard — NOT a product ticket, so it's named outside the
 * `lira-*` convention (same precedent as app.spec.ts).
 *
 * Proves fixtures.ts's suite-wide notification-duration override
 * (`E2E_NOTIFICATION_DURATION_MS`, default 2ms) is wired as a
 * BrowserContext-level init script, not just applied once to whatever
 * document happens to be loaded when the fixture resolves. The one-time
 * `evaluate()` this replaced looked fine in isolation but silently died the
 * moment any spec called `appPage.reload()` mid-test — a plain
 * `window.__e2eNotificationDurationMs` property does not survive tearing
 * down and recreating the document, and reload() IS a real thing specs do:
 * lira-123-auto-debt-scenarios.spec.ts, lira-071-profits-admin-only.spec.ts
 * and lira-142-exchange-lot-settlement.spec.ts all call it mid-test. Nothing
 * previously re-armed the flag afterward, so notifications reverted to the
 * normal 3s/5s dismiss for the rest of any file that reloaded — exactly the
 * overlay/click-interception failure mode the override exists to prevent.
 *
 * Follow-up (owner feedback): the 11 specs that assert on `[role="alert"]`
 * toast visibility used to opt out with a per-spec
 * `await appPage.evaluate(() => { window.__e2eNotificationDurationMs =
 * undefined; })` in their own `beforeEach` — boilerplate that INJECTED the
 * override rather than DECLARING intent. fixtures.ts now exposes it as a
 * proper Playwright option fixture instead: a test-scoped
 * `notificationDurationMs` option (default `E2E_NOTIFICATION_DURATION_MS`,
 * `null` = real 3s/5s dismiss) plus a `_notificationDurationApplier` auto
 * fixture that applies it before every test body/retry. Opt-out specs now
 * just declare `test.use({ notificationDurationMs: null })` once, at file or
 * describe scope — the second `test.describe` below guards THAT mechanism
 * generically, not just trusting each of the 11 files individually.
 *
 * Scope: this file proves the FLAG value survives navigation (part 1) and
 * that the opt-out option actually reaches `window` (part 2), both inside a
 * real Electron window. Proving that the component actually SHORTENS its
 * dismiss timer once the flag is set is the unit-level job of
 * `frontend/src/shared/components/__tests__/NotificationCenter.e2eOverride.test.tsx`
 * (real `@liratek/ui` component + fake timers) — deliberately not repeated
 * here. A real end-to-end toast trigger was considered for a third
 * assertion here, but `appEvents` (the emitter every real "show a toast"
 * call site uses) is never attached to `window`, so the only way to fire one
 * from `page.evaluate` would be driving a specific feature page's UI/copy
 * (e.g. a validation message on Partners or Services). That would make a
 * generic harness-plumbing guard fail whenever unrelated feature copy or
 * markup changes — a coupling this file deliberately avoids. Skipped by
 * design; the unit test above is the timing proof.
 */
import { test, expect } from "./fixtures";

// tsconfig.playwright.json doesn't include window-globals.d.ts, so the
// ambient `Window.__e2eNotificationDurationMs` augmentation isn't visible
// here — same locally-typed cast used by fixtures.ts and every opt-out spec
// (e.g. lira-144-inventory-filters.spec.ts) rather than a file-level
// `declare global`, which would leak into every other spec's compilation
// unit in this same tsconfig program.
function readOverrideFlag(page: import("@playwright/test").Page) {
  return page.evaluate(
    () =>
      (window as unknown as { __e2eNotificationDurationMs?: number })
        .__e2eNotificationDurationMs,
  );
}

test.describe("Harness — __e2eNotificationDurationMs survives navigation", () => {
  test("the flag is set on first load and is still set after a reload", async ({
    appPage,
  }) => {
    const initial = await readOverrideFlag(appPage);
    expect(initial).toBe(2);

    // The exact action that broke the old one-time-evaluate wiring: a fresh
    // document, same as lira-123/071/142's mid-test reload().
    await appPage.reload();
    await appPage.waitForLoadState("load");
    await appPage.waitForSelector('nav a[href], [data-testid="sidebar"]', {
      timeout: 15_000,
    });

    const afterReload = await readOverrideFlag(appPage);
    expect(afterReload).toBe(2);
  });
});

test.describe("Harness — notificationDurationMs: null opts out generically", () => {
  // Exactly the declarative line every [role="alert"]-asserting spec now
  // uses (app.spec.ts's nested "Debts (self-seeded)" describe,
  // lira-089/094/095/096/097/105/107/137/141/143) — proving the MECHANISM
  // here means those 11 files don't each need their own end-to-end guard.
  test.use({ notificationDurationMs: null });

  test("window.__e2eNotificationDurationMs is unset, restoring the real dismiss timing", async ({
    appPage,
  }) => {
    const flag = await readOverrideFlag(appPage);
    expect(flag).toBeUndefined();
  });
});
