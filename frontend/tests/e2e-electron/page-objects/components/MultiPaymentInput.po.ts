import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export class MultiPaymentInputPO {
  constructor(private page: Page) {}

  get root(): Locator {
    return this.page.getByTestId("multi-payment-input");
  }

  get splitToggle(): Locator {
    return this.page.getByTestId("split-toggle");
  }

  get summary(): Locator {
    return this.page.getByTestId("payment-summary");
  }

  line(id: string): Locator {
    return this.page.getByTestId(`payment-line-${id}`);
  }

  methodSelect(id: string): Locator {
    return this.page.getByTestId(`payment-method-${id}`);
  }

  amountInput(id: string): Locator {
    return this.page.getByTestId(`payment-amount-${id}`);
  }

  /** Get the first line's id by reading data-testid from the first payment-line element */
  async firstLineId(): Promise<string> {
    const el = this.page.locator('[data-testid^="payment-line-"]').first();
    const testId = await el.getAttribute("data-testid");
    return testId!.replace("payment-line-", "");
  }

  async enableSplit(): Promise<void> {
    await this.splitToggle.click();
  }

  async fillLine(
    lineId: string,
    amount: number,
    method?: string,
  ): Promise<void> {
    if (method) await this.methodSelect(lineId).selectOption(method);
    await this.amountInput(lineId).fill(String(amount));
  }

  async fillFirstLine(amount: number, method?: string): Promise<void> {
    const id = await this.firstLineId();
    await this.fillLine(id, amount, method);
  }

  async expectVisible(): Promise<void> {
    await expect(this.root).toBeVisible();
  }

  async expectMethodOption(lineId: string, method: string): Promise<void> {
    await expect(
      this.methodSelect(lineId).locator(`option[value="${method}"]`),
    ).toBeAttached();
  }
}
