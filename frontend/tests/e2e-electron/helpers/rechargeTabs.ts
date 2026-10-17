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
import type { Locator, Page } from "@playwright/test";

export function rechargeProviderTab(page: Page, label: string): Locator {
  return page
    .getByRole("group", { name: "Providers", exact: true })
    .getByRole("button", { name: label, exact: true })
    .first();
}
