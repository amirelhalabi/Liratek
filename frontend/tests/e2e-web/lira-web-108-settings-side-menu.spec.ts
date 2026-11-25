/**
 * Settings side menu (owner request 2026-11-25) — on the web app the Settings
 * tabs are grouped under headings in a side menu (Shop, Catalogue, People,
 * Devices, Data & system) instead of one sideways-scrolling bar. Clicking an
 * entry opens its section. Also saves the What's new screenshot.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "./fixtures";
import { openShopDay } from "./shopDayHelpers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOT = path.join(
  __dirname,
  "../../public/whats-new/1.35.0/settings-side-menu.png",
);

test("Settings tabs are grouped in a side menu", async ({ browser }) => {
  test.setTimeout(120_000);
  const day = await openShopDay(browser);
  const { page } = day;
  try {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/#/settings");

    const menu = page.getByRole("navigation", { name: "Settings" });
    await expect(menu).toBeVisible({ timeout: 20_000 });
    for (const heading of [
      "Shop",
      "Catalogue",
      "People",
      "Devices",
      "Data & system",
    ]) {
      await expect(menu.getByRole("group", { name: heading })).toBeVisible();
    }

    await menu.getByRole("button", { name: "Currencies & Rates" }).click();
    await expect(
      menu.getByRole("button", { name: "Currencies & Rates" }),
    ).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Drawer Currencies")).toBeVisible();

    await page.mouse.move(5, 5); // no hover highlight in the picture
    await page.screenshot({ path: SCREENSHOT, animations: "disabled" });
  } finally {
    await day.context.close();
  }
});
