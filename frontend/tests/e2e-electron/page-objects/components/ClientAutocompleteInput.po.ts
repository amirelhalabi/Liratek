import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export class ClientAutocompleteInputPO {
  constructor(private page: Page) {}

  get input(): Locator {
    return this.page.getByTestId("client-autocomplete-field").first();
  }

  get dropdown(): Locator {
    return this.page.getByTestId("client-dropdown").first();
  }

  option(clientId: number): Locator {
    return this.page.getByTestId(`client-option-${clientId}`);
  }

  debtBadge(clientId: number): Locator {
    return this.page.getByTestId(`client-debt-badge-${clientId}`);
  }

  async search(query: string): Promise<void> {
    await this.input.fill(query);
    await this.page.waitForTimeout(300);
  }

  async selectClient(clientId: number): Promise<void> {
    await this.option(clientId).click();
  }

  async selectFirstResult(): Promise<void> {
    await this.page.locator('[data-testid^="client-option-"]').first().click();
  }

  async clear(): Promise<void> {
    await this.input.fill("");
  }

  async expectDropdownVisible(): Promise<void> {
    await expect(this.dropdown).toBeVisible();
  }

  async expectDropdownHidden(): Promise<void> {
    const count = await this.page.getByTestId("client-dropdown").count();
    if (count > 0) {
      await expect(this.dropdown).not.toBeVisible();
    }
  }

  async expectDebtBadge(clientId: number): Promise<void> {
    await expect(this.debtBadge(clientId)).toBeVisible();
  }

  async expectNoResults(): Promise<void> {
    const dropdownCount = await this.page
      .getByTestId("client-dropdown")
      .count();
    if (dropdownCount === 0) return;
    await expect(
      this.page.locator('[data-testid^="client-option-"]'),
    ).toHaveCount(0);
  }
}
