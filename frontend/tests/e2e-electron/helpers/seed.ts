import type { Page } from "@playwright/test";

// Web mode (E2E_MODE=web): seed over the REST API instead of window.api IPC.
// The JWT is read from the logged-in page's localStorage (set by the web
// appPage fixture); response envelopes vary per route (flat vs data-wrapped),
// so ids are resolved from either shape.
const IS_WEB = process.env.E2E_MODE === "web";
const WEB_BACKEND_URL =
  process.env.E2E_WEB_BACKEND_URL ?? "http://127.0.0.1:3101";

type SeedResponse = {
  success?: boolean;
  id?: number;
  error?: string;
  data?: { id?: number };
};

async function webPost(
  page: Page,
  apiPath: string,
  body: unknown,
): Promise<SeedResponse> {
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  if (!token) throw new Error(`webPost ${apiPath}: no JWT in localStorage`);
  const res = await page.request.post(`${WEB_BACKEND_URL}${apiPath}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: body,
  });
  const json = (await res.json().catch(() => ({}))) as SeedResponse;
  if (!res.ok() || json.success === false) {
    throw new Error(
      `webPost ${apiPath} failed (${res.status()}): ${json.error ?? "unknown"}`,
    );
  }
  return json;
}

function seedId(res: SeedResponse, name: string): number {
  const id = res.id ?? res.data?.id;
  if (id == null) throw new Error(`${name}(web) returned no id`);
  return id;
}

/**
 * Seed a client via window.api.clients.create (or REST in web mode).
 * Returns the created client's id.
 */
export async function seedClient(
  page: Page,
  data: { name: string; phone: string },
): Promise<number> {
  if (IS_WEB) {
    const res = await webPost(page, "/api/clients", {
      full_name: data.name,
      phone_number: data.phone,
      whatsapp_opt_in: false,
    });
    return seedId(res, "seedClient");
  }
  const result = await page.evaluate(
    ({ name, phone }) =>
      window.api.clients.create({
        full_name: name,
        phone_number: phone,
        whatsapp_opt_in: false,
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
  if (IS_WEB) {
    // REST createProductSchema field names differ from the IPC payload
    const res = await webPost(page, "/api/inventory/products", {
      name: data.name,
      cost_price_usd: data.cost_price,
      retail_price_usd: data.sell_price,
      stock: data.quantity ?? 0,
      category: "General",
      min_stock_threshold: 0,
    });
    return seedId(res, "seedProduct");
  }
  const result = await page.evaluate(
    ({ name, cost_price, sell_price, quantity }) =>
      window.api.inventory.createProduct({
        name,
        cost_price,
        retail_price: sell_price,
        stock_quantity: quantity ?? 0,
        category: "General",
        barcode: "",
        min_stock_level: 0,
      }),
    data,
  );
  if (!result.success || result.id == null) {
    throw new Error(`seedProduct failed: ${result.error ?? "no id returned"}`);
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
  if (IS_WEB) {
    const res = await webPost(page, "/api/custom-services", {
      description: data.description,
      price_usd: data.amount_usd,
      cost_usd: 0,
      status: "completed",
      ...(data.client_id != null ? { client_id: data.client_id } : {}),
    });
    return seedId(res, "seedCustomService");
  }
  const result = await page.evaluate(
    ({ description, amount_usd, client_id }) =>
      window.api.customServices.add({
        description,
        price_usd: amount_usd,
        cost_usd: 0,
        status: "completed",
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
  if (IS_WEB) {
    // EXCHANGE_LOT_SETTLEMENT.md "Named follow-up" F3: the REST route now
    // validates the same full leg-based schema the IPC branch below always
    // has (`exchangeSubmitSchema`) — a bare `rate` no longer validates.
    // Mirrors the IPC branch's payload exactly: a seeded rate marker has no
    // spread and no profit, so leg1Rate IS the market rate and both profit
    // fields are 0.
    await webPost(page, "/api/exchange/transactions", {
      fromCurrency: "USD",
      toCurrency: "LBP",
      amountIn: 1,
      amountOut: rate,
      leg1Rate: rate,
      leg1MarketRate: rate,
      leg1ProfitUsd: 0,
      totalProfitUsd: 0,
    });
    return;
  }
  const result = await page.evaluate(
    ({ rate }) =>
      window.api.exchange.addTransaction({
        fromCurrency: "USD",
        toCurrency: "LBP",
        amountIn: 1,
        amountOut: rate,
        // A seeded rate marker has no spread and no profit: leg1Rate IS the
        // market rate, and both profit fields are 0.
        leg1Rate: rate,
        leg1MarketRate: rate,
        leg1ProfitUsd: 0,
        totalProfitUsd: 0,
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
  if (IS_WEB) {
    const res = await webPost(page, "/api/expenses", {
      description: data.description,
      category: "General",
      amount_usd: data.amount_usd,
      amount_lbp: 0,
      expense_date: today,
    });
    return seedId(res, "seedExpense");
  }
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
    throw new Error(`seedExpense failed: ${result.error ?? "no id returned"}`);
  }
  return result.id;
}
