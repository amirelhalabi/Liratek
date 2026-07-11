/**
 * lira-web-002 — sessions browse over REST.
 *
 * Guards WP1-WP3 of the sessions web-parity work: the /customer-sessions page
 * reads session data through the adapter's HTTP transport (backend REST), not
 * just curl. Seeds a session via the REST API, then asserts the page renders
 * it — proving the frontend migration off window.api.session reaches the
 * server in a browser. Checkout (WP4) is covered separately.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

test.describe.serial("web sessions", () => {
  test("customer-sessions page shows a session seeded over REST", async ({
    page,
  }) => {
    await loginAsAdmin(page);

    // Seed a session directly via the REST API using the logged-in JWT.
    const token = await page.evaluate(() =>
      localStorage.getItem("liratek.jwt"),
    );
    expect(token).toBeTruthy();
    const uniqueName = "WEB-E2E Session Cust";
    const started = await page.request.post(
      `${BACKEND_URL}/api/sessions/start`,
      {
        headers: { Authorization: `Bearer ${token}` },
        data: { customer_name: uniqueName, customer_phone: "03777888" },
      },
    );
    const startedBody = await started.json();
    expect(startedBody.success, JSON.stringify(startedBody)).toBeTruthy();

    // Load the page — it must fetch today's sessions over REST and render ours.
    await page.goto("/#/customer-sessions");
    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );
    await expect(page.getByText(uniqueName).first()).toBeVisible({
      timeout: 10_000,
    });

    // Clean up so the accumulating DB does not carry an active session into
    // later specs (the lira-064 leak lesson).
    const active = await page.request.get(
      `${BACKEND_URL}/api/sessions/active-list`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    const list = await active.json();
    for (const s of list.sessions ?? []) {
      await page.request.post(`${BACKEND_URL}/api/sessions/${s.id}/close`, {
        headers: { Authorization: `Bearer ${token}` },
      });
    }
  });

  test("basket checkout runs over REST (WP4 — shared core SessionCheckoutService)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const token = await page.evaluate(() =>
      localStorage.getItem("liratek.jwt"),
    );
    const auth = { Authorization: `Bearer ${token}` };

    // Start a session, add a custom-service basket item.
    const started = await (
      await page.request.post(`${BACKEND_URL}/api/sessions/start`, {
        headers: auth,
        data: { customer_name: "WP4 Web Checkout", customer_phone: "03222111" },
      })
    ).json();
    const sid = started.sessionId as number;
    expect(sid).toBeTruthy();

    // Checkout the basket with ONE $30 CASH leg through the REST route — the
    // same core SessionCheckoutService the desktop IPC path uses.
    const checkout = await (
      await page.request.post(`${BACKEND_URL}/api/sessions/checkout`, {
        headers: auth,
        data: {
          sessionId: sid,
          cartItems: [
            {
              id: "wp4-web-cs",
              module: "custom_services",
              label: "WP4 Web Service",
              amount: 30,
              currency: "USD",
              ipcChannel: "custom-services:add",
              formData: {
                description: "WP4 Web Service",
                price_usd: 30,
                cost_usd: 0,
                status: "completed",
              },
            },
          ],
          payments: [{ method: "CASH", currency_code: "USD", amount: 30 }],
          exchangeRate: 90000,
          userId: 1,
        },
      })
    ).json();
    expect(checkout.success, JSON.stringify(checkout)).toBeTruthy();
    expect(checkout.checkoutTotalUsd).toBe(30);
    expect(checkout.itemCount).toBe(1);

    // The session must now be closed (checkout posted + closed it). The
    // per-currency totals are asserted on the checkout response above; the
    // getSessionDetails projection does not surface checkout_total_usd.
    const details = await (
      await page.request.get(`${BACKEND_URL}/api/sessions/${sid}`, {
        headers: auth,
      })
    ).json();
    expect(details.session.is_active).toBe(0);
  });
});
