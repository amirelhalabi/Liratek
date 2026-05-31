import type { Page } from "@playwright/test";

/**
 * Seed a client via window.api.clients.create.
 * Returns the created client's id.
 */
export async function seedClient(
  page: Page,
  data: { name: string; phone: string },
): Promise<number> {
  const result = await page.evaluate(
    ({ name, phone }) =>
      window.api.clients.create({
        full_name: name,
        phone_number: phone,
        updated_at: new Date().toISOString(),
      }),
    data,
  );
  if (!result.success || result.id == null) {
    throw new Error(`seedClient failed: ${result.error ?? "no id returned"}`);
  }
  return result.id;
}

/**
 * Seed a product via window.api.inventory.createProduct.
 * Returns the product's id.
 */
export async function seedProduct(
  page: Page,
  data: {
    name: string;
    cost_price: number;
    sell_price: number;
    quantity?: number;
  },
): Promise<number> {
  const result = await page.evaluate(
    ({ name, cost_price, sell_price, quantity }) =>
      window.api.inventory.createProduct({
        name,
        cost_price,
        sell_price,
        retail_price: sell_price,
        quantity: quantity ?? 0,
        category: "",
        barcode: null,
        imei: null,
        unit: null,
        min_stock_level: 0,
        supplier_id: null,
        updated_at: new Date().toISOString(),
      }),
    data,
  );
  if (!result.success || result.id == null) {
    throw new Error(
      `seedProduct failed: ${result.error ?? "no id returned"}`,
    );
  }
  return result.id;
}

/**
 * Seed a custom service record (submitted status).
 * Returns the record id.
 */
export async function seedCustomService(
  page: Page,
  data: { description: string; amount_usd: number; client_id?: number },
): Promise<number> {
  const result = await page.evaluate(
    ({ description, amount_usd, client_id }) =>
      window.api.customServices.add({
        description,
        price_usd: amount_usd,
        cost_usd: 0,
        status: "submitted",
        ...(client_id != null ? { client_id } : {}),
      }),
    data,
  );
  if (!result.success || result.id == null) {
    throw new Error(
      `seedCustomService failed: ${result.error ?? "no id returned"}`,
    );
  }
  return result.id;
}

/**
 * Seed an exchange rate (USD to LBP) by recording an exchange transaction.
 */
export async function seedExchangeRate(
  page: Page,
  rate: number,
): Promise<void> {
  const result = await page.evaluate(
    ({ rate }) =>
      window.api.exchange.addTransaction({
        fromCurrency: "USD",
        toCurrency: "LBP",
        amountIn: 1,
        amountOut: rate,
        rate,
      }),
    { rate },
  );
  if (!result.success) {
    throw new Error(`seedExchangeRate failed: ${result.error ?? "unknown"}`);
  }
}

/**
 * Seed an expense record.
 * Returns the record id.
 */
export async function seedExpense(
  page: Page,
  data: { description: string; amount_usd: number },
): Promise<number> {
  const today = new Date().toISOString().slice(0, 10);
  const result = await page.evaluate(
    ({ description, amount_usd, today }) =>
      window.api.expenses.add({
        description,
        category: "General",
        amount_usd,
        amount_lbp: 0,
        expense_date: today,
      }),
    { ...data, today },
  );
  if (!result.success || result.id == null) {
    throw new Error(
      `seedExpense failed: ${result.error ?? "no id returned"}`,
    );
  }
  return result.id;
}
