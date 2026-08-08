/**
 * lira-web-020 — LIRA-103: Recharge history tab + drawer-balance readout,
 * driven through the REAL browser UI (not just `page.request`).
 *
 * Two gaps this ticket closed, both in Recharge/index.tsx:
 *  1. `loadRechargeHistory` (MTC/Alfa history tab) called
 *     `window.api.recharge.getHistory(provider)` directly — no REST route
 *     backed it at all (`backend/src/api/recharge.ts` had no `/history`),
 *     so in a real browser it threw before `setRechargeHistory` ever ran and
 *     the history tab silently showed nothing.
 *  2. `loadDrawerBalances` called `window.api.recharge.getDrawerBalances()`
 *     directly behind a `!window.api?.recharge` guard, even though the
 *     dual-mode `api.getRechargeDrawerBalances()` twin already existed and
 *     was already wired elsewhere in the same file (`handleTopUpClick`). In
 *     the browser the guard short-circuited, `drawerBalances` state stayed
 *     `[]`, `activeDrawerBalance` stayed `undefined`, and CompactStats never
 *     rendered its "Drawer" metric.
 *
 * This spec proves the FIX end-to-end on web: seed a real MTC recharge over
 * REST (same `POST /api/recharge/process` lira-web-019 already proves), then
 * drive the actual Recharge page in the browser and assert (a) the "Drawer"
 * stat renders (proof `GET /api/recharge/drawer-balances` populated
 * `drawerBalances` on mount) and (b) clicking "History" opens a modal whose
 * table contains the just-seeded row's phone number (proof
 * `GET /api/recharge/history?provider=MTC` populated `rechargeHistory` and
 * the page rendered it) — never a raw, unguarded `window.api.recharge.*`
 * call, which would throw/no-op in this browser context.
 *
 * A third test (LIRA-109) extends this same seed-and-open-history flow one
 * step further: it edits the seeded row's note via the History modal's
 * inline "Edit metadata" pencil — `TelecomForm.tsx`'s `onUpdateMetadata`
 * handler, the last raw `window.api.recharge.updateMetadata` call in the
 * Recharge feature. Pre-fix that call threw in a browser (`window.api` is
 * undefined), `HistoryModal.saveEdit`'s catch swallowed it into an inline
 * `editError`, and the row never left edit mode — no REST route existed for
 * it either. Now it goes through `api.updateRechargeMetadata` ->
 * `POST /api/recharge/update-metadata`.
 *
 * Rule 15 (accumulating shared DB across e2e runs): identity via a
 * freshly-generated, run-unique phone number — never "first/newest row".
 * The edit-metadata test locates its row by that SAME unique phone number
 * (never `tbody tr:first-child`) before clicking its pencil icon, so it
 * cannot collide with any other row a prior run left behind.
 *
 * Rule 17 — NOT YET RUN in this pass (no `yarn test:e2e:web` invocation was
 * permitted here; the CLAUDE.md-mandated procedure is
 * `yarn dev` -> stop -> `yarn test:e2e:web`, which this task was told not to
 * run). Selectors below were verified against source, not against a live
 * run:
 *   - "Drawer" label text: CompactStats.tsx's `Metric` (label="Drawer"),
 *     rendered only when `drawerBalance` is truthy.
 *   - "History" button: Recharge/index.tsx's page-level header button
 *     (visible for MTC because its `formMode` is "telecom").
 *   - "{provider} Transaction History" modal heading + phone-number cell:
 *     HistoryModal.tsx's `<h2>` and the Phone column (rendered because
 *     TelecomForm passes `onUpdateMetadata`).
 *   - Edit-metadata test additionally relies on: the row's pencil button
 *     (`title="Edit metadata"`, HistoryModal.tsx `startEdit` trigger), the
 *     note `<input>` (`placeholder="Add a note (optional)"`, only rendered
 *     in the expanded edit row), the "Save" button (`title="Save"`), and the
 *     post-save "Edited" badge (`EditHistoryPopover`'s trigger text) that
 *     appears next to the client name once `tx.edited_by` is set.
 * Flagging per this ticket's own instruction — orchestrating session should
 * run `yarn test:e2e:web` and, per rule 17, additionally prove this spec
 * FAILS against the pre-fix code (revert the relevant call sites) before
 * trusting it as a guard.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test.describe("Recharge history tab + drawer-balance readout over REST (LIRA-103)", () => {
  test("drawer-balance readout: the 'Drawer' stat renders via GET /api/recharge/drawer-balances", async ({
    page,
  }) => {
    await loginAsAdmin(page);

    await page.goto("/#/recharge");
    // Default provider tab is MTC (first PROVIDER_CONFIGS entry) — let the
    // mount effects (loadDrawerBalances among them) settle, same margin
    // lira-web-001 uses for "known-good pages render without crashing".
    await page.waitForTimeout(1_500);

    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );
    // `drawer_balances` seeds an MTC/USD row for every tenant
    // (electron-app/create_db.sql), so CompactStats' "Drawer" Metric renders
    // as soon as `getRechargeDrawerBalances()` resolves — pre-fix, the
    // window.api guard short-circuited and this label never appeared.
    await expect(page.getByText("Drawer", { exact: true })).toBeVisible();
  });

  test("history tab: History button loads GET /api/recharge/history?provider=MTC and renders the seeded row", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const token = await page.evaluate(() =>
      localStorage.getItem("liratek.jwt"),
    );
    const headers = { Authorization: `Bearer ${token}` };

    // Run-unique phone number — this DB accumulates across every e2e run
    // (rule 15 equivalent for this suite), so identity must never rely on
    // "first/newest row".
    const phone = `03${Date.now().toString().slice(-6)}`;
    const seeded = await (
      await page.request.post(`${BACKEND_URL}/api/recharge/process`, {
        headers,
        data: {
          provider: "MTC",
          type: "CREDIT_TRANSFER",
          amount: 5,
          cost: 4,
          price: 5,
          currency: "USD",
          phoneNumber: phone,
          paid_by_method: "CASH",
          payments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
        },
      })
    ).json();
    expect(seeded.success, JSON.stringify(seeded)).toBeTruthy();

    await page.goto("/#/recharge");
    await page.waitForTimeout(1_500);
    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );

    await page.getByRole("button", { name: "History" }).click();

    await expect(
      page.getByText("MTC Transaction History", { exact: false }),
    ).toBeVisible({ timeout: 10_000 });
    // The phone number is unique to THIS run's seeded row — proves the
    // modal's table is rendering data that came back from the new REST
    // route, not a stale/empty state.
    await expect(page.getByText(phone)).toBeVisible();
  });

  test("edit-metadata: the pencil icon's note edit saves via POST /api/recharge/update-metadata and the UI reflects it (LIRA-109)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const token = await page.evaluate(() =>
      localStorage.getItem("liratek.jwt"),
    );
    const headers = { Authorization: `Bearer ${token}` };

    // Run-unique phone number (rule 15) — this row's identity for BOTH
    // locating it in the table and never colliding with a prior run's rows.
    const phone = `04${Date.now().toString().slice(-6)}`;
    const seeded = await (
      await page.request.post(`${BACKEND_URL}/api/recharge/process`, {
        headers,
        data: {
          provider: "MTC",
          type: "CREDIT_TRANSFER",
          amount: 5,
          cost: 4,
          price: 5,
          currency: "USD",
          phoneNumber: phone,
          paid_by_method: "CASH",
          payments: [{ method: "CASH", currencyCode: "USD", amount: 5 }],
        },
      })
    ).json();
    expect(seeded.success, JSON.stringify(seeded)).toBeTruthy();

    await page.goto("/#/recharge");
    await page.waitForTimeout(1_500);
    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );

    await page.getByRole("button", { name: "History" }).click();
    await expect(
      page.getByText("MTC Transaction History", { exact: false }),
    ).toBeVisible({ timeout: 10_000 });

    // Locate THIS run's row by its unique phone number — never
    // `tbody tr:first-child`/"newest row" (rule 15: the history table
    // accumulates every recharge every prior e2e run has ever seeded).
    const row = page.locator("tr", { hasText: phone });
    await expect(row).toBeVisible();
    // Pre-edit: no "Edited" badge yet (EditHistoryPopover's trigger, shown
    // only once `tx.edited_by` is set).
    await expect(row.getByText("Edited", { exact: true })).toHaveCount(0);

    await row.getByTitle("Edit metadata").click();

    const noteValue = `lira-109 web edit ${Date.now()}`;
    // The note field renders in its own expanded row below, not inside
    // `row` itself (HistoryModal.tsx's `colSpan` note row) — only one row
    // can be in edit mode at a time, so this is unambiguous.
    await page.getByPlaceholder("Add a note (optional)").fill(noteValue);
    await page.getByTitle("Save").click();

    // Save resolves -> onRefreshHistory reloads the table from
    // GET /api/recharge/history -> this row now carries `edited_by`,
    // rendering the "Edited" badge next to the client name. Proves the
    // round trip actually reached POST /api/recharge/update-metadata and
    // came back successful, not silently swallowed into an inline
    // `editError` (the pre-fix failure mode when `window.api` is undefined
    // in a real browser).
    await expect(row.getByText("Edited", { exact: true })).toBeVisible({
      timeout: 10_000,
    });
  });
});
