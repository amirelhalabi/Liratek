/**
 * LIRA-360 — insurance renewal reminders over REST (web app).
 *
 * Two insurances sold 360 days ago (expiring in 5 days) appear on the
 * Dashboard "Insurance renewals" card and in the daily bell summary. A
 * renewal of the same type to the same phone, typed in another format,
 * takes the first off the list; "Won't renew" takes the second off.
 *
 * Rule 15: rows are found by a phone number unique to this run, never by
 * position or count (earlier specs leave their own insurances behind).
 * Also saves the What's new screenshot (rule 30).
 */
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import {
  test,
  expect,
  loginAsAdmin,
  gotoAndSettle,
  BACKEND_URL,
} from "./fixtures";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/insurance-renewals.png",
);

type Auth = { Authorization: string };

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  d.setHours(12, 0, 0, 0);
  return d.toISOString();
}

async function sellInsurance(
  page: Page,
  auth: Auth,
  data: { client_name: string; phone_number: string; daysAgo: number },
): Promise<number> {
  const res = await (
    await page.request.post(`${BACKEND_URL}/api/custom-services`, {
      headers: auth,
      data: {
        description: "Car insurance",
        category: "insurance",
        insurance_type: "COMPULSORY",
        cost_usd: 80,
        price_usd: 100,
        paid_by: "CASH",
        client_name: data.client_name,
        phone_number: data.phone_number,
        ...(data.daysAgo > 0
          ? { transaction_time: daysAgoIso(data.daysAgo) }
          : {}),
      },
    })
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  return res.id as number;
}

test("insurance renewals: card, daily bell, renewal and Won't renew", async ({
  page,
}) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };

  const tail = String(Date.now()).slice(-6);
  const phoneA = `71${tail}`;
  const phoneB = `76${tail}`;
  const idA = await sellInsurance(page, auth, {
    client_name: "Ali Haddad",
    phone_number: phoneA,
    daysAgo: 360,
  });
  const idB = await sellInsurance(page, auth, {
    client_name: "Rana Khoury",
    phone_number: phoneB,
    daysAgo: 360,
  });

  // ── 1. Card lists both, "in 5 days"; the bell sums it up once ──────────
  await page.evaluate(() =>
    localStorage.removeItem("liratek.insuranceRenewals.lastBellDay"),
  );
  await gotoAndSettle(page, "/#/dashboard");
  const card = page.getByTestId("insurance-renewals-card");
  await expect(card).toBeVisible({ timeout: 15_000 });
  const rowA = page.getByTestId(`insurance-renewal-row-${idA}`);
  await expect(rowA).toContainText("Ali Haddad");
  await expect(rowA).toContainText(phoneA);
  await expect(rowA).toContainText("Compulsory");
  await expect(rowA).toContainText("in 5 days");
  await expect(page.getByTestId(`insurance-renewal-row-${idB}`)).toBeVisible();
  await expect(card).not.toContainText("$");

  mkdirSync(path.dirname(SCREENSHOT), { recursive: true });
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: SCREENSHOT });

  await expect
    .poll(() =>
      page.evaluate(() =>
        localStorage.getItem("liratek.insuranceRenewals.lastBellDay"),
      ),
    )
    .not.toBeNull();
  const bellLines = await page.evaluate(
    () =>
      (window.notificationHistory ?? []).filter((n) =>
        n.message.startsWith("Insurance:"),
      ).length,
  );
  expect(bellLines).toBe(1);

  // ── 2. Renewal: same type, same phone typed differently ────────────────
  await sellInsurance(page, auth, {
    client_name: "Ali Haddad",
    phone_number: `+961 ${phoneA.slice(0, 2)} ${phoneA.slice(2)}`,
    daysAgo: 0,
  });
  // Same route: reload so the card fetches the list again.
  await page.reload();
  await expect(page.getByTestId(`insurance-renewal-row-${idB}`)).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByTestId(`insurance-renewal-row-${idA}`)).toHaveCount(0);

  // ── 3. Won't renew ──────────────────────────────────────────────────────
  page.once("dialog", (d) => void d.accept());
  await page.getByTestId(`insurance-renewal-dismiss-${idB}`).click();
  await expect(page.getByTestId(`insurance-renewal-row-${idB}`)).toHaveCount(0, {
    timeout: 15_000,
  });

  const list = await (
    await page.request.get(
      `${BACKEND_URL}/api/custom-services/insurance-renewals`,
      { headers: auth },
    )
  ).json();
  expect(list.success).toBeTruthy();
  const ids = (list.renewals as Array<{ id: number }>).map((r) => r.id);
  expect(ids).not.toContain(idA);
  expect(ids).not.toContain(idB);
});
