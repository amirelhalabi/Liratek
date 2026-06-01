import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export class DateRangeFilterPO {
  constructor(private page: Page) {}

  get fromInput(): Locator {
    return this.page.getByTestId("date-range-from");
  }

  get toInput(): Locator {
    return this.page.getByTestId("date-range-to");
  }

  async setFrom(date: string): Promise<void> {
    await this.fromInput.fill(date);
    await this.fromInput.blur();
    await this.page.waitForTimeout(200);
  }

  async setTo(date: string): Promise<void> {
    await this.toInput.fill(date);
    await this.toInput.blur();
    await this.page.waitForTimeout(200);
  }

  async clearBoth(): Promise<void> {
    await this.fromInput.fill("");
    await this.toInput.fill("");
    await this.page.waitForTimeout(200);
  }

  async expectFromValue(date: string): Promise<void> {
    await expect(this.fromInput).toHaveValue(date);
  }

  async expectToValue(date: string): Promise<void> {
    await expect(this.toInput).toHaveValue(date);
  }
}
