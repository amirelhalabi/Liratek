/**
 * E2E: LIRA-116 — OMT/Whish route rename `/services` → `/omt-whish`.
 *
 * WHY THIS RENAME. The `omt_whish` module (UI label "OMT/Whish") used to
 * live at route `/services`. The unrelated `custom_services` module (UI
 * label "Services") lives at `/custom-services`. The near-identical label
 * ("Services") next to a route literally named `/services` that actually
 * belonged to a DIFFERENT module misled three separate investigations in a
 * row into reading `/services` code/specs as `custom_services` coverage (or
 * vice versa). The fix moves `omt_whish` off the misleading path onto
 * `/omt-whish` (migration v162 / `create_db.sql` — the `modules.route`
 * column `Sidebar.tsx` builds nav links from) and keeps `/services`
 * registered in `App.tsx` only as a transitional
 * `<Navigate to="/omt-whish" replace />` redirect for anyone with an old
 * bookmark/link. `custom_services` at `/custom-services` is completely
 * untouched by this ticket — do not confuse the two modules again.
 *
 * RULE 15 — this suite shares ONE accumulating SQLite DB across every spec
 * run in order. This file asserts NOTHING about database rows, transaction
 * counts, drawer totals, or row position — only routing/DOM state (page
 * anchors, `window.location.hash`, sidebar link hrefs). That is what makes
 * it safe to run in any position relative to every other spec.
 */

import { test, expect, navigateTo } from "./fixtures";

test.describe.configure({ retries: 0 });

test("OMT/Whish: /omt-whish loads the real page", async ({ appPage }) => {
  await navigateTo(appPage, "/omt-whish");

  // Same anchor `fixtures.ts`'s routeAnchors map now waits on for this path
  // — proves the route resolves to the OMT/Whish component, not a blank/
  // error boundary.
  const omtBtn = appPage.locator("button").filter({ hasText: "OMT" }).first();
  await expect(omtBtn).toBeVisible({ timeout: 10_000 });
});

test("OMT/Whish: transitional /services redirect lands on /omt-whish", async ({
  appPage,
}) => {
  // Drive the hash directly rather than through navigateTo(): there is
  // deliberately no sidebar link for the retired path any more, so
  // navigateTo's "click nav a[href=...]" path would have nothing to click
  // and would silently fall back to the same hash write anyway. Writing the
  // hash ourselves proves the redirect independent of that helper.
  await appPage.evaluate(() => {
    window.location.hash = "#/services";
  });

  // Assert on the URL, not just page content — the redirect's whole job is
  // to rewrite the location, and `replace` means the old `#/services` entry
  // must not remain in place once React Router processes it.
  await expect(appPage).toHaveURL(/#\/omt-whish/, { timeout: 10_000 });

  const omtBtn = appPage.locator("button").filter({ hasText: "OMT" }).first();
  await expect(omtBtn).toBeVisible({ timeout: 10_000 });
});

test("OMT/Whish: sidebar link is retargeted to /omt-whish", async ({
  appPage,
}) => {
  // The sidebar is built from the `modules` table `route` column
  // (Sidebar.tsx maps `to: m.route` into a NavLink, which HashRouter
  // renders as `<a href="#/omt-whish">`). This is the one assertion in the
  // file that actually proves the DB-side rename (migration v162 /
  // create_db.sql) reached the UI — the two tests above would still pass
  // even if the `modules` row were never renamed, since App.tsx's static
  // <Route> and the transitional redirect don't depend on it at all.
  await navigateTo(appPage, "/");

  await expect(appPage.locator('nav a[href="#/omt-whish"]')).toHaveCount(1);
  await expect(appPage.locator('nav a[href="#/services"]')).toHaveCount(0);
});
