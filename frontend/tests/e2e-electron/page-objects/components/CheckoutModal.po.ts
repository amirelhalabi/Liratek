import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export class CheckoutModalPO {
  constructor(private page: Page) {}

  get modal(): Locator {
    return this.page.getByTestId("checkout-modal");
  }

  get completeBtn(): Locator {
    return this.page.getByTestId("checkout-complete-btn");
  }

  get saveDraftBtn(): Locator {
    return this.page.getByTestId("checkout-save-draft-btn");
  }

  async complete(): Promise<void> {
    await this.completeBtn.click();
  }

  async saveDraft(): Promise<void> {
    await this.saveDraftBtn.click();
  }

  async expectOpen(): Promise<void> {
    await expect(this.modal).toBeVisible();
  }

  async expectClosed(): Promise<void> {
    const count = await this.page.getByTestId("checkout-modal").count();
    if (count > 0) await expect(this.modal).not.toBeVisible();
  }

  async expectCompleteBtnEnabled(): Promise<void> {
    await expect(this.completeBtn).toBeEnabled();
  }

  async expectCompleteBtnDisabled(): Promise<void> {
    await expect(this.completeBtn).toBeDisabled();
  }
}
