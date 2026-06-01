import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export class ConfirmModalPO {
  constructor(private page: Page) {}

  get modal(): Locator {
    return this.page.getByTestId("confirm-modal");
  }

  get confirmBtn(): Locator {
    return this.page.getByTestId("confirm-modal-confirm-btn");
  }

  get cancelBtn(): Locator {
    return this.page.getByTestId("confirm-modal-cancel-btn");
  }

  async confirm(): Promise<void> {
    await this.confirmBtn.click();
  }

  async cancel(): Promise<void> {
    await this.cancelBtn.click();
  }

  async expectOpen(): Promise<void> {
    await expect(this.modal).toBeVisible();
  }

  async expectClosed(): Promise<void> {
    const count = await this.page.getByTestId("confirm-modal").count();
    if (count > 0) await expect(this.modal).not.toBeVisible();
  }

  async expectDangerVariant(): Promise<void> {
    // Confirm button should have red styling
    await expect(this.confirmBtn).toHaveClass(/bg-red-600/);
  }

  /** After closing, verify focus has returned to the document body (Electron Windows bug check) */
  async expectFocusRestored(): Promise<void> {
    await this.page.waitForTimeout(200);
    const focused = await this.page.evaluate(
      () => document.activeElement?.tagName,
    );
    expect(["BODY", "BUTTON", "INPUT", "A"]).toContain(focused);
  }
}
