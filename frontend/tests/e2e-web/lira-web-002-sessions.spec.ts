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
    const started = await page.request.post(`${BACKEND_URL}/api/sessions/start`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { customer_name: uniqueName, customer_phone: "03777888" },
    });
    const startedBody = await started.json();
    expect(startedBody.success, JSON.stringify(startedBody)).toBeTruthy();

    // Load the page — it must fetch today's sessions over REST and render ours.
    await page.goto("/#/customer-sessions");
    await expect(page.locator("#root")).not.toContainText("Something went wrong");
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
});
