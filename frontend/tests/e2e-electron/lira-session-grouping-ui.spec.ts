/**
 * E2E: LIRA-102 — per-session border-accent UI coverage (WS8).
 *
 * The accent itself already shipped and is unchanged by this spec:
 * TransactionsViewer.tsx computes a per-session hue via the golden-angle hash
 * `sessionHue()` (~L633-635: `round(abs(id * 137.508)) % 360`), stamps it onto
 * every same-session <tr> as the `--session-hue` custom property
 * (`sessionVars()` ~L639-641), and sets a bare `data-session=""` attribute on
 * that row (`buildTr()` ~L996-997). index.css then paints a left border whose
 * lightness differs by theme: `.dark tr[data-session]` uses 78%/62% (L474-482)
 * while `html:not(.dark) tr[data-session]` uses 72%/42% (L483-491) — same hue,
 * different lightness. This spec is the ONLY thing guarding that mechanism:
 * nothing under frontend/ referenced `data-session`/`--session-hue` before it.
 *
 * Setup mirrors lira-session-basket-payment.spec.ts: start a session, then
 * `session.checkout` two custom-service items so both resulting transaction
 * rows share one `session_id`. Row identity (rule 15) comes from a
 * timestamp-unique service label baked into each row's `summary` text
 * (CustomServiceRepository.ts:157 — `Custom Service: ${description}`), never
 * `tbody tr.first()` — this suite's DB accumulates across every spec file.
 *
 * The `--session-hue` custom property is read directly off the row's inline
 * style (no guessing). The expected border-left-color for a given theme is
 * derived by asking the SAME browser engine to resolve
 * `hsla(hue, s%, l%, 1)` via a throwaway probe element — this avoids
 * hand-rolling HSL→RGB conversion math that could silently disagree with
 * what Chromium actually renders.
 *
 * Note: TransactionsViewer.tsx also has a "sandwiched sibling" render path
 * (~L1324-1454) that applies the SAME accent to an auto-generated row (e.g. a
 * SUPPLIER_PAYMENT) sharing a session's id without owning it. That path is
 * permanently dead code today — `sandwichedMap` (~L690-697) is hard-coded to
 * an always-empty Map ("An empty map means no row is treated as sandwiched,
 * so the ⚙ toggle never appears"). Sibling-row inheritance is still
 * exercised here, just via the ORDINARY path: the regular-row branch
 * (~L1457) calls `buildTr(row, row.session_id)` for every row unconditionally
 * — the same call this spec's two custom-service rows go through — so any
 * row of ANY type sharing a session_id gets the accent the same way. A
 * dedicated test forcing a real cost/price-provider sibling row was not
 * added: it would only re-prove the identical `buildTr(row, row.session_id)`
 * call already covered here, at the cost of a materially more complex
 * checkout flow.
 */

import { test, expect, navigateTo } from "./fixtures";
import { closeAllActiveSessions } from "./helpers/nav";
import type { Locator, Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

/** Mirrors TransactionsViewer.tsx's sessionHue() (~L633-635). */
function expectedHue(sessionId: number): number {
  return Math.round(Math.abs(sessionId * 137.508)) % 360;
}

/**
 * Resolve `hsla(hue, s%, l%, 1)` to the exact rgb()/rgba() string
 * getComputedStyle would report, by letting the browser itself do the
 * conversion (a throwaway probe element) instead of computing it by hand.
 */
async function resolvedColor(
  page: Page,
  hue: number,
  s: number,
  l: number,
): Promise<string> {
  return page.evaluate(
    ({ hue, s, l }) => {
      const probe = document.createElement("div");
      probe.style.color = `hsla(${hue}, ${s}%, ${l}%, 1)`;
      document.body.appendChild(probe);
      const rgb = getComputedStyle(probe).color;
      probe.remove();
      return rgb;
    },
    { hue, s, l },
  );
}

function hueOf(row: Locator): Promise<number> {
  return row.evaluate((el) =>
    Number(el.style.getPropertyValue("--session-hue").trim()),
  );
}

function borderLeftColorOf(row: Locator): Promise<string> {
  return row.evaluate((el) => getComputedStyle(el).borderLeftColor);
}

type Api = {
  api: {
    session: {
      start: (data: {
        customer_name: string;
        customer_phone?: string;
        started_by: string;
      }) => Promise<{ success: boolean; sessionId?: number }>;
      getActive: () => Promise<{ success: boolean; session?: { id: number } }>;
      checkout: (data: Record<string, unknown>) => Promise<{
        success: boolean;
        error?: string;
      }>;
    };
  };
};

test.describe("Session grouping UI — per-session border accent (WS8)", () => {
  test.afterEach(async ({ appPage }) => {
    await closeAllActiveSessions(appPage).catch(() => {});
  });

  test("both session rows carry data-session + the golden-angle --session-hue, and the accent recolors on theme toggle", async ({
    appPage,
  }) => {
    // Most session specs leave their session open (README "Known couplings &
    // hazards") — close whatever is active first so session.start below
    // definitely creates OUR new session rather than session.getActive()
    // falling back to some other spec's stray one.
    await closeAllActiveSessions(appPage);

    const ts = Date.now();
    const LABEL_A = `E2E-SessionGrouping-A-${ts}`;
    const LABEL_B = `E2E-SessionGrouping-B-${ts}`;

    // ---- Setup: one session, two custom-service items, one checkout -------
    const setup = await appPage.evaluate(
      async ({ labelA, labelB, ts }) => {
        const w = window as unknown as Api;
        const started = await w.api.session.start({
          customer_name: `E2E Session Grouping ${ts}`,
          customer_phone: `03${String(ts).slice(-6)}`,
          started_by: "admin",
        });
        const sessionId =
          started.sessionId ??
          (await w.api.session.getActive()).session?.id ??
          null;
        if (!sessionId) {
          return { ok: false, error: "no session id", sessionId: null };
        }

        const mkService = (label: string, price: number) => ({
          id: `e2e-${label}`,
          module: "custom_service",
          label,
          amount: price,
          currency: "USD",
          ipcChannel: "custom-services:add",
          formData: {
            description: label,
            cost_usd: 0,
            cost_lbp: 0,
            price_usd: price,
            price_lbp: 0,
            paid_by: "CASH",
          },
        });

        const checkout = await w.api.session.checkout({
          sessionId,
          cartItems: [mkService(labelA, 12), mkService(labelB, 8)],
          paidByMethod: "CASH",
          payments: [
            {
              method: "CASH",
              currency_code: "USD",
              amount: 20,
              direction: "IN",
            },
          ],
          exchangeRate: 90000,
          userId: 1,
        });

        return {
          ok: checkout.success,
          error: checkout.error ?? null,
          sessionId,
        };
      },
      { labelA: LABEL_A, labelB: LABEL_B, ts },
    );

    expect(setup.error).toBeNull();
    expect(setup.ok).toBe(true);
    expect(setup.sessionId).not.toBeNull();
    const sessionId = setup.sessionId as number;
    const hue = expectedHue(sessionId);

    // ---- Navigate: bounce through "/" to force a fresh mount --------------
    // (README "Assertion discipline" — a parked viewer shows a stale list;
    // AuditPage.tsx:22 defaults to the "transactions" tab, so no tab click
    // is needed once there.)
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/audit");

    // ---- Identity match (rule 15): unique labels, never tbody tr.first() --
    const rowA = appPage.locator("tbody tr").filter({ hasText: LABEL_A });
    const rowB = appPage.locator("tbody tr").filter({ hasText: LABEL_B });
    await expect(rowA).toBeVisible({ timeout: 10_000 });
    await expect(rowB).toBeVisible({ timeout: 10_000 });

    // data-session is the EMPTY STRING (TransactionsViewer.tsx:996), not "1".
    await expect(rowA).toHaveAttribute("data-session", "");
    await expect(rowB).toHaveAttribute("data-session", "");

    // Both rows carry the SAME --session-hue, equal to the golden-angle
    // formula for the session id this test created.
    expect(await hueOf(rowA)).toBe(hue);
    expect(await hueOf(rowB)).toBe(hue);

    // ---- Theme toggle: border-left-color must move between the two
    // documented lightness values while the hue holds. ----------------------
    const isDark = () =>
      appPage.evaluate(() =>
        document.documentElement.classList.contains("dark"),
      );
    const startedDark = await isDark();

    const [sBefore, lBefore] = startedDark ? [78, 62] : [72, 42];
    const expectedBefore = await resolvedColor(appPage, hue, sBefore, lBefore);
    expect(await borderLeftColorOf(rowA)).toBe(expectedBefore);
    expect(await borderLeftColorOf(rowB)).toBe(expectedBefore);

    // TopBar.tsx:364-372 — the sun/moon button's title flips with the theme.
    const themeToggle = appPage
      .locator(
        'button[title="Switch to light mode"], button[title="Switch to dark mode"]',
      )
      .first();
    await themeToggle.click();
    await expect.poll(isDark, { timeout: 5000 }).toBe(!startedDark);

    const [sAfter, lAfter] = !startedDark ? [78, 62] : [72, 42];
    const expectedAfter = await resolvedColor(appPage, hue, sAfter, lAfter);
    const afterA = await borderLeftColorOf(rowA);
    const afterB = await borderLeftColorOf(rowB);
    expect(afterA).toBe(expectedAfter);
    expect(afterB).toBe(expectedAfter);
    // The accent actually recolored — not just "some unrelated CSS changed".
    expect(afterA).not.toBe(expectedBefore);

    // Restore the starting theme so later specs sharing this worker's
    // Electron instance see the same default they would without this spec.
    await themeToggle.click();
    await expect.poll(isDark, { timeout: 5000 }).toBe(startedDark);
  });
});
