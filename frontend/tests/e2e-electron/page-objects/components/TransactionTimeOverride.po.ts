import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export class TransactionTimeOverridePO {
  constructor(private page: Page) {}

  get toggle(): Locator {
    return this.page.getByTestId("txn-time-toggle");
  }

  get input(): Locator {
    return this.page.getByTestId("txn-time-input");
  }

  get clearBtn(): Locator {
    return this.page.getByTestId("txn-time-clear");
  }

  async expand(): Promise<void> {
    await this.toggle.click();
  }

  async clear(): Promise<void> {
    await this.clearBtn.click();
  }

  /** Set a past datetime. isoString e.g. "2026-01-15T10:30" */
  async setDate(datetimeLocalValue: string): Promise<void> {
    await this.input.fill(datetimeLocalValue);
    await this.input.blur();
  }

  async expectCollapsed(): Promise<void> {
    await expect(this.toggle).toBeVisible();
    await expect(this.input).not.toBeAttached();
  }

  async expectExpanded(): Promise<void> {
    await expect(this.input).toBeVisible();
  }

  async expectValue(datetimeLocalValue: string): Promise<void> {
    await expect(this.input).toHaveValue(datetimeLocalValue);
  }
}
