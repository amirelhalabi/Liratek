/**
 * lira-web-073 — the Mobile Recharge shop-line chip must never sit on top of
 * the provider tabs.
 *
 * The header was a 3-column grid from `xl` (1280px) up: tabs | chip | stats.
 * The tabs column was `minmax(0,auto)`, so once the stats grew (a busy day:
 * several currencies in the profit/drawer read-outs, wider fonts on Linux)
 * the tabs column shrank below one tab and the MTC tab slid UNDER the chip.
 * Clicking MTC then opened the chip's "Record usage" window instead. The web
 * e2e run on CI (2026-10-17) failed 7 tests that way: recharge.spec,
 * lira-094 and lira-145 (their tab clicks landed on the chip).
 *
 * The busy day is reproduced here by giving the stats block the width CI
 * could reach (720px) at the 1280×720 viewport this suite runs at. The guard
 * then checks that no provider tab's box overlaps the chip or the stats,
 * and that the stats still end inside the window (no fix that
 * just pushes them off the right edge).
 *
 * Read-only: it creates nothing, so it changes no state for later specs.
 */
import { test, expect, loginAsAdmin, gotoAndSettle } from "./fixtures";

test("Mobile Recharge: the shop-line chip never covers a provider tab at 1280px, even with wide stats", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await loginAsAdmin(page);
  await gotoAndSettle(page, "/#/recharge");
  await expect(page.getByTestId("carrier-lines-chip-mtc")).toBeVisible({
    timeout: 15_000,
  });

  const result = await page.evaluate(() => {
    const group = document.querySelector(
      '[role="group"][aria-label="Providers"]',
    );
    const header = group?.parentElement;
    const chip = document.querySelector(
      '[data-testid="carrier-lines-chip-mtc"]',
    );
    if (!group || !header || !chip) return { error: "header not found" };
    // The stats + actions block is the header's last child.
    const stats = header.lastElementChild as HTMLElement;
    stats.style.minWidth = "720px";
    const overlaps = (a: DOMRect, b: DOMRect) =>
      a.left < b.right &&
      b.left < a.right &&
      a.top < b.bottom &&
      b.top < a.bottom;
    const chipBox = chip.getBoundingClientRect();
    const statsBox = stats.getBoundingClientRect();
    const covered: string[] = [];
    for (const tab of Array.from(group.querySelectorAll("button"))) {
      const b = tab.getBoundingClientRect();
      const name = tab.getAttribute("aria-label");
      if (overlaps(b, chipBox)) covered.push(`${name} under the chip`);
      if (overlaps(b, statsBox)) covered.push(`${name} under the stats`);
    }
    return {
      covered,
      statsRight: Math.round(statsBox.right),
      viewport: window.innerWidth,
    };
  });

  expect(result.error).toBeUndefined();
  expect(result.covered, "provider tabs overlapped by another element").toEqual(
    [],
  );
  expect(result.statsRight).toBeLessThanOrEqual(result.viewport!);
});
