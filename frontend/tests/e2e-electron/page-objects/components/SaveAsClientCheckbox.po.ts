import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export class SaveAsClientCheckboxPO {
  constructor(private page: Page) {}

  get checkbox(): Locator {
    return this.page.getByTestId("save-as-client-checkbox");
  }

  async check(): Promise<void> {
    await this.checkbox.check();
  }

  async uncheck(): Promise<void> {
    await this.checkbox.uncheck();
  }

  async expectVisible(): Promise<void> {
    await expect(this.checkbox).toBeVisible();
  }

  async expectHidden(): Promise<void> {
    // Component returns null when hidden — element should not exist in DOM
    await expect(this.checkbox).not.toBeAttached();
  }

  async expectChecked(): Promise<void> {
    await expect(this.checkbox).toBeChecked();
  }

  async expectUnchecked(): Promise<void> {
    await expect(this.checkbox).not.toBeChecked();
  }
}
