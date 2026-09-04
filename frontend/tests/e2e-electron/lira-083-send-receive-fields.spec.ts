/**
 * E2E: LIRA-083 (A2) — per-mode party fields
 *
 * A2: SEND collects only the sender (receiver fields hidden); RECEIVE collects
 * only the receiver (sender fields hidden) — OMT/WHISH system form and the
 * OMT/Whish App transfer form. (Binance has a single client pair — n/a.)
 *
 * Pure DOM spec (UI visibility), per the LEFT_TO_DO plan.
 */

import { test, expect, navigateTo } from "./fixtures";

test.describe.configure({ retries: 0 });

test.describe("LIRA-083 (A2) — send/receive field visibility", () => {
  test("system form: SEND shows sender only; RECEIVE shows receiver only", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/omt-whish");

    const senderName = appPage.locator("#service-sender-name");
    const receiverName = appPage.locator("#service-receiver-name");

    // Provider/mode tabs render as "OMT ↑" (SEND) / "OMT ↓" (RECEIVE) —
    // there is no "Send"/"Receive" text on these buttons.
    const omtSendTab = appPage
      .locator("button", { hasText: "OMT" })
      .filter({ hasText: "↑" })
      .first();
    const omtReceiveTab = appPage
      .locator("button", { hasText: "OMT" })
      .filter({ hasText: "↓" })
      .first();

    // Default mode is SEND: sender visible, receiver hidden.
    await expect(omtSendTab).toBeVisible({ timeout: 10_000 });
    await omtSendTab.click();
    await expect(senderName).toBeVisible();
    await expect(receiverName).toHaveCount(0);

    // Toggle RECEIVE: the inverse.
    await omtReceiveTab.click();
    await expect(receiverName).toBeVisible();
    await expect(senderName).toHaveCount(0);

    // Back to SEND: receiver fields hidden again.
    await omtSendTab.click();
    await expect(receiverName).toHaveCount(0);
  });

  test("app transfer form: SEND shows sender only; RECEIVE shows receiver only", async ({
    appPage,
  }) => {
    await navigateTo(appPage, "/recharge");

    // Open the OMT App provider tab, then its transfer view.
    await appPage
      .locator("button")
      .filter({ hasText: /^OMT App$/ })
      .first()
      .click();

    const senderName = appPage.locator("#sender-name");
    const receiverName = appPage.locator("#receiver-name");

    // Default SEND: sender visible, receiver absent.
    await expect(senderName).toBeVisible({ timeout: 10_000 });
    await expect(receiverName).toHaveCount(0);

    // Toggle Receive.
    await appPage
      .getByRole("button", { name: /^Receive$/i })
      .first()
      .click();
    await expect(receiverName).toBeVisible();
    await expect(senderName).toHaveCount(0);
  });
});
