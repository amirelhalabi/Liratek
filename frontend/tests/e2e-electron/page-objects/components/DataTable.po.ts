import type { Page, Locator } from "@playwright/test";
import { expect } from "@playwright/test";

export class DataTablePO {
  constructor(private page: Page) {}

  get table(): Locator {
    return this.page.getByTestId("data-table");
  }

  get excelBtn(): Locator {
    return this.page.getByTestId("export-excel-btn");
  }

  get pdfBtn(): Locator {
    return this.page.getByTestId("export-pdf-btn");
  }

  get paginationNext(): Locator {
    return this.page.getByTestId("pagination-next");
  }

  get paginationPrev(): Locator {
    return this.page.getByTestId("pagination-prev");
  }

  get selectAllCheckbox(): Locator {
    return this.page.getByTestId("select-all-checkbox");
  }

  /** Get visible tbody rows */
  rows(): Locator {
    return this.table.locator("tbody tr");
  }

  async expectRowCount(n: number): Promise<void> {
    await expect(this.rows()).toHaveCount(n);
  }

  async expectMinRowCount(n: number): Promise<void> {
    const count = await this.rows().count();
    expect(count).toBeGreaterThanOrEqual(n);
  }

  async clickSort(headerText: string): Promise<void> {
    await this.table
      .locator("thead th")
      .filter({ hasText: headerText })
      .click();
    await this.page.waitForTimeout(300);
  }

  async clickExcelExport(): Promise<void> {
    await this.excelBtn.click();
  }

  async clickPdfExport(): Promise<void> {
    await this.pdfBtn.click();
  }

  async clickPaginationNext(): Promise<void> {
    await this.paginationNext.click();
  }

  async clickPaginationPrev(): Promise<void> {
    await this.paginationPrev.click();
  }

  async shiftClickRow(index: number): Promise<void> {
    await this.rows().nth(index).click({ modifiers: ["Shift"] });
  }

  async expectEmptyState(): Promise<void> {
    await expect(this.rows()).toHaveCount(0);
  }

  async expectExcelBtnVisible(): Promise<void> {
    await expect(this.excelBtn).toBeVisible();
  }

  async expectPdfBtnVisible(): Promise<void> {
    await expect(this.pdfBtn).toBeVisible();
  }
}
