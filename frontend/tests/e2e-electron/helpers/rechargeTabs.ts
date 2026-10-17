/**
 * Mobile Recharge provider tabs — ONE selector for every spec.
 *
 * Since the tab polish (961e5a3f / c08cf728) an unselected provider tab is a
 * bare brand logo with no visible text, and any tab may carry a corner count
 * pill ("Katsh" + "2"). Text filters like `hasText: /^Katsh$/` therefore stop
 * matching. Every tab keeps `aria-label={provider.label}` inside the
 * `role="group" aria-label="Providers"` row (ProviderTabs.tsx), so select by
 * accessible role + exact name, scoped to that row.
 */
import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

export function rechargeProviderTab(page: Page, label: string): Locator {
  return page
    .getByRole("group", { name: "Providers", exact: true })
    .getByRole("button", { name: label, exact: true })
    .first();
}

/**
 * Select a provider tab and wait until it is the ACTIVE one
 * (`aria-pressed="true"`). The switch runs inside `startTransition`, so the
 * previous provider's form can stay on screen for a moment after the click —
 * acting on it then books the wrong provider (lira-web-071 step 0.6 once
 * topped up Katsh twice because Top-Up was clicked before iPick took over).
 *
 * A normal click, never `{ force: true }`: a forced click lands on whatever
 * sits at the tab's coordinates, and when the MTC/Alfa shop-line chip
 * overlapped the tab it silently opened "Record usage" instead (web CI,
 * 2026-10-17). If something covers the tab, this should fail, not misfire.
 */
export async function selectRechargeProvider(
  page: Page,
  label: string,
): Promise<Locator> {
  const tab = rechargeProviderTab(page, label);
  await expect(tab).toBeVisible({ timeout: 15_000 });
  if ((await tab.getAttribute("aria-pressed")) !== "true") {
    await tab.click();
  }
  await expect(tab).toHaveAttribute("aria-pressed", "true", {
    timeout: 15_000,
  });
  return tab;
}
