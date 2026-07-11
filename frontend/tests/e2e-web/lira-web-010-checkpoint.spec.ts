/**
 * lira-web-010 — closing checkpoint (money write) over REST.
 *
 * Guards createCheckpoint over the REST transport into the same core
 * ClosingService. A checkpoint reconciles each drawer/currency to its physical
 * count: it posts delta = (physical − live balance) to the payments journal and
 * bumps drawer_balances (ClosingRepository.createCheckpoint). So submitting a
 * physical count of (live + 10) for General/USD must move that balance by
 * exactly +10 — asserted as a DELTA against the pre-checkpoint balance
 * (rule 15), never an absolute total. Then two read routes + a page-level
 * round-trip: the checkpoint appears in the timeline (matched by unique note),
 * and /checkpoint-timeline renders through the useApi() adapter.
 * Tenant-scoped via authenticateJWT; admin-gated.
 *
 * Pre-feature: POST /api/closing/checkpoint + the timeline/initial-date GETs
 * 404'd (no routes), so this spec cannot pass without the new REST surface.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";

const DRAWER = "General";
const CUR = "USD";

test("checkpoint reconciles General/USD by +10 over REST + timeline renders", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const balOf = async (): Promise<number> => {
    const res = await (
      await page.request.get(
        `${BACKEND_URL}/api/closing/system-expected-balances-dynamic`,
        { headers: auth },
      )
    ).json();
    expect(res.success).toBeTruthy();
    return (res.balances?.[DRAWER]?.[CUR] as number) ?? 0;
  };

  const before = await balOf();
  const note = `web-010 ${Date.now()}`;

  const created = await (
    await page.request.post(`${BACKEND_URL}/api/closing/checkpoint`, {
      headers: auth,
      data: {
        drawer_name: DRAWER,
        notes: note,
        amounts: [
          {
            drawer_name: DRAWER,
            currency_code: CUR,
            expected_amount: before,
            physical_amount: before + 10,
          },
        ],
      },
    })
  ).json();
  expect(created.success, JSON.stringify(created)).toBeTruthy();

  // Money delta: physical (before+10) − live (before) = +10 posted to the drawer.
  const after = await balOf();
  expect(after - before).toBeCloseTo(10, 2);

  // Timeline read: our checkpoint (matched by unique note) is present today.
  const today = new Date().toISOString().split("T")[0];
  const timeline = await (
    await page.request.get(
      `${BACKEND_URL}/api/closing/checkpoint-timeline?date_from=${today}&date_to=${today}&type=ALL`,
      { headers: auth },
    )
  ).json();
  expect(timeline.success, JSON.stringify(timeline)).toBeTruthy();
  expect(
    timeline.checkpoints.some((c: { notes?: string }) => c.notes === note),
  ).toBe(true);

  // Initial-checkpoint-date read responds with the envelope shape.
  const initial = await (
    await page.request.get(
      `${BACKEND_URL}/api/closing/initial-checkpoint-date`,
      { headers: auth },
    )
  ).json();
  expect(initial.success).toBeTruthy();

  // Page-level adapter round-trip: the timeline page renders (getCheckpointTimeline
  // + getInitialCheckpointDate through useApi()) without tripping the ErrorBoundary.
  await page.goto("/#/checkpoint-timeline");
  await expect(page.locator("#root")).not.toContainText("Something went wrong");
  await expect(page.getByText(DRAWER).first()).toBeVisible({ timeout: 15_000 });
});
