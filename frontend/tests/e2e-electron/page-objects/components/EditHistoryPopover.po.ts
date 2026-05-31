import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export class EditHistoryPopoverPO {
  constructor(private page: Page) {}

  /** Scope to a specific row when multiple popovers exist on the page */
  triggerInRow(rowLocator: Locator): Locator {
    return rowLocator.getByTestId("edit-history-trigger");
  }

  get firstTrigger(): Locator {
    return this.page.getByTestId("edit-history-trigger").first();
  }

  get popover(): Locator {
    return this.page.getByTestId("edit-history-popover");
  }

  async clickFirstTrigger(): Promise<void> {
    await this.firstTrigger.click();
    await this.page.waitForTimeout(400);
  }

  async expectPopoverVisible(): Promise<void> {
    await expect(this.popover).toBeVisible();
  }

  async expectPopoverHidden(): Promise<void> {
    const count = await this.page
      .getByTestId("edit-history-popover")
      .count();
    if (count > 0) await expect(this.popover).not.toBeVisible();
  }

  async expectTriggerHidden(): Promise<void> {
    await expect(this.firstTrigger).not.toBeAttached();
  }

  /** Count timeline entries inside the popover */
  async entryCount(): Promise<number> {
    return this.popover.locator("ol li").count();
  }
}
