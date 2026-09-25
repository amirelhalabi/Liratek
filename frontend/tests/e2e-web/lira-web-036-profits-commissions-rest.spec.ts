/**
 * lira-web-036 — `GET /api/profits/commissions` (Commissions tab), web
 * (REST) transport. Round-2 review, LC-6 #3 (OWNER_NOTES_2026-09-21.md §6,
 * lane LC): "no web-mode e2e covers the new REST path" for this lane's new
 * Profits-gated commissions route.
 *
 * Pure `page.request` (no UI), the same pattern lira-web-027 uses: the
 * profits-unlock gate (`middleware/profitsUnlock.ts`) is server-side state
 * keyed `${tenantId}:${userId}`, not a browser cookie/session, so it is
 * reachable directly via `POST /api/profits/unlock` with the JWT this
 * spec's own admin login already holds — no need to drive the
 * profits-lock-screen UI (that flow is covered end-to-end by
 * lira-web-029-profits-password-gate.spec.ts; this file assumes that gate
 * mechanism works and focuses on the Commissions route itself).
 *
 * Rule 15 (shared, accumulating web DB, run in order): lira-web-029 always
 * sets the profits password to "1234" if none is set yet, and no other
 * spec in this suite ever sets a DIFFERENT one (grepped:
 * `profits-password-new` appears only in that file) — lira-web-031's
 * database-reset-guard spec never performs a real reset (see its own file
 * header). Numbered after both (036 > 031 > 029), this spec can rely on
 * SOME profits password already being "1234" by the time it runs; it also
 * tolerates the fresh-DB case (no password set at all yet) by setting one
 * itself, so it does not depend on 029 having run first within a given
 * invocation — only on no OTHER spec ever picking a different password.
 *
 * Covers:
 *   (a) the gated route returns byProvider/excludedProviders and echoes
 *       the requested [from, to] back — proving PA-4.17 (date-range
 *       threading) holds over REST, not just IPC.
 *   (b) LC-2's schema fix: an EMPTY from/to (`?from=&to=`) falls back to
 *       today, matching every other Profits route's `|| todayISO()`,
 *       instead of a 200-envelope validation failure.
 *   (c) a genuinely malformed date still correctly fails with a
 *       200-envelope `{success:false}` (rule 19c) — proving LC-2's fix
 *       widened acceptance for '' specifically, not for garbage generally.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

const PROFITS_PASSWORD = "1234";

test.describe.serial("GET /api/profits/commissions (web/REST, LC-6)", () => {
  test("unlocks profits for this admin (fresh DB: sets the password first)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const token = await page.evaluate(() =>
      localStorage.getItem("liratek.jwt"),
    );
    const auth = { Authorization: `Bearer ${token}` };

    const status = await (
      await page.request.get(`${BACKEND_URL}/api/profits/password-status`, {
        headers: auth,
      })
    ).json();
    expect(status.success, JSON.stringify(status)).toBeTruthy();

    if (!status.isSet) {
      const setRes = await (
        await page.request.put(`${BACKEND_URL}/api/profits/password`, {
          headers: auth,
          data: { password: PROFITS_PASSWORD },
        })
      ).json();
      expect(setRes.success, JSON.stringify(setRes)).toBeTruthy();
    }

    const unlockRes = await (
      await page.request.post(`${BACKEND_URL}/api/profits/unlock`, {
        headers: auth,
        data: { password: PROFITS_PASSWORD },
      })
    ).json();
    expect(unlockRes.success, JSON.stringify(unlockRes)).toBeTruthy();
  });

  test("(a) returns byProvider/excludedProviders and echoes [from, to] back (PA-4.17 over REST)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const token = await page.evaluate(() =>
      localStorage.getItem("liratek.jwt"),
    );
    const auth = { Authorization: `Bearer ${token}` };
    // Re-unlock — this admin's grant from the previous test may have
    // expired or run in a different worker; unlocking is idempotent.
    await page.request.post(`${BACKEND_URL}/api/profits/unlock`, {
      headers: auth,
      data: { password: PROFITS_PASSWORD },
    });

    const from = "2026-01-01";
    const to = "2026-01-31";
    const res = await (
      await page.request.get(
        `${BACKEND_URL}/api/profits/commissions?from=${from}&to=${to}`,
        { headers: auth },
      )
    ).json();

    expect(res.success, JSON.stringify(res)).toBeTruthy();
    expect(res.data.from).toBe(from);
    expect(res.data.to).toBe(to);
    expect(Array.isArray(res.data.byProvider)).toBe(true);
    expect(Array.isArray(res.data.excludedProviders)).toBe(true);
    // LC-1: BINANCE never appears as a reportable provider — it settles in
    // USDT, which this report cannot currently bucket into USD/LBP.
    expect(
      res.data.byProvider.some((p: { provider: string }) => p.provider === "BINANCE"),
    ).toBe(false);

    // A second, DIFFERENT range must echo back differently — proves the
    // query string genuinely reaches the service, not a hard-coded window.
    const from2 = "2026-02-01";
    const to2 = "2026-02-28";
    const res2 = await (
      await page.request.get(
        `${BACKEND_URL}/api/profits/commissions?from=${from2}&to=${to2}`,
        { headers: auth },
      )
    ).json();
    expect(res2.success, JSON.stringify(res2)).toBeTruthy();
    expect(res2.data.from).toBe(from2);
    expect(res2.data.to).toBe(to2);
  });

  test("(b) an empty from/to falls back to today, like every other Profits route (LC-2)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const token = await page.evaluate(() =>
      localStorage.getItem("liratek.jwt"),
    );
    const auth = { Authorization: `Bearer ${token}` };
    await page.request.post(`${BACKEND_URL}/api/profits/unlock`, {
      headers: auth,
      data: { password: PROFITS_PASSWORD },
    });

    const res = await (
      await page.request.get(
        `${BACKEND_URL}/api/profits/commissions?from=&to=`,
        { headers: auth },
      )
    ).json();

    expect(res.success, JSON.stringify(res)).toBeTruthy();
    expect(res.data.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(res.data.from).toBe(res.data.to);
  });

  test("(c) a genuinely malformed date still fails with a 200-envelope {success:false} (rule 19c parity)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const token = await page.evaluate(() =>
      localStorage.getItem("liratek.jwt"),
    );
    const auth = { Authorization: `Bearer ${token}` };
    await page.request.post(`${BACKEND_URL}/api/profits/unlock`, {
      headers: auth,
      data: { password: PROFITS_PASSWORD },
    });

    const response = await page.request.get(
      `${BACKEND_URL}/api/profits/commissions?from=not-a-date`,
      { headers: auth },
    );
    expect(response.status()).toBe(200);
    const res = await response.json();
    expect(res.success).toBe(false);
  });
});
