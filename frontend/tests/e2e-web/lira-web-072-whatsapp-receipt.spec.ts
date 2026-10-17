/**
 * lira-web-072 — LIRA-333: send the receipt on WhatsApp, over the web app
 * (quickstart.md scenarios 1–5).
 *
 *  1. A POS sale to a client with a phone: the "Sale completed — RCP-n"
 *     strip appears; its Send opens `https://wa.me/<digits>?text=…` ONCE,
 *     and the LiraTek page stays where it was (SC-005).
 *  2. The same sale's details window sends the SAME text, word for word
 *     (SC-003).
 *  3. A partly on-account sale: the message carries "On account" on its own
 *     line, never inside "Paid" (FR-008).
 *  4. A walk-in sale asks for a number: `abc` is refused, `+33 6 12 34 56 78`
 *     opens wa.me/33612345678, and the sale's own phone is unchanged
 *     afterwards (FR-013).
 *  5. A blocked pop-up (window.open → null) shows the "could not be opened"
 *     message (FR-018).
 *
 * `window.open` is stubbed before the page loads and records every call, so
 * no real tab opens. Sales are matched by the id the sale request returned
 * (rule 15), never by row position.
 *
 * Status: written for LIRA-333; see the ticket for whether it was run.
 */
import type { Locator, Page } from "@playwright/test";
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";
import {
  addLine,
  payLine,
  pickClientOption,
  splitOn,
  waitPost,
} from "./shopDayHelpers";

type Auth = { Authorization: string };
type Opened = { url: string; target: string };

const BLOCKED = "WhatsApp could not be opened — allow pop-ups and try again";
const PRICE = 12;

async function stubWindowOpen(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const w = window as unknown as {
      __opens: Array<{ url: string; target: string }>;
      __openReturnsNull: boolean;
      open: (url?: string, target?: string) => unknown;
    };
    w.__opens = [];
    w.__openReturnsNull = false;
    w.open = (url?: string, target?: string) => {
      w.__opens.push({ url: String(url ?? ""), target: String(target ?? "") });
      return w.__openReturnsNull ? null : { opener: window, closed: false };
    };
  });
}

async function opens(page: Page): Promise<Opened[]> {
  return page.evaluate(
    () => (window as unknown as { __opens: Opened[] }).__opens,
  );
}

function textOf(url: string): string {
  return decodeURIComponent(url.split("?text=")[1] ?? "");
}

async function authOf(page: Page): Promise<Auth> {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  return { Authorization: `Bearer ${token}` };
}

async function closeActiveSessions(page: Page, auth: Auth): Promise<void> {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/sessions/active-list`, {
      headers: auth,
    })
  ).json();
  for (const s of (r.sessions ?? []) as Array<{ id: number }>) {
    await page.request.post(`${BACKEND_URL}/api/sessions/${s.id}/close`, {
      headers: auth,
    });
  }
}

async function createProduct(page: Page, auth: Auth, name: string) {
  const r = await (
    await page.request.post(`${BACKEND_URL}/api/inventory/products`, {
      headers: auth,
      data: {
        name,
        category: "General",
        cost_price_usd: 5,
        retail_price_usd: PRICE,
        stock: 20,
        min_stock_threshold: 0,
      },
    })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
}

async function createClient(
  page: Page,
  auth: Auth,
  name: string,
  phone: string,
) {
  const r = await (
    await page.request.post(`${BACKEND_URL}/api/clients`, {
      headers: auth,
      data: { full_name: name, phone_number: phone },
    })
  ).json();
  expect(r.success ?? true, JSON.stringify(r)).toBeTruthy();
}

async function getSale(page: Page, auth: Auth, id: number) {
  const r = await (
    await page.request.get(`${BACKEND_URL}/api/sales/${id}`, { headers: auth })
  ).json();
  expect(r.success, JSON.stringify(r)).toBeTruthy();
  return r.sale as Record<string, unknown>;
}

/** Put one product in the cart and open checkout. */
async function checkoutWith(page: Page, product: string): Promise<Locator> {
  const search = page.getByPlaceholder("Search products by name or barcode...");
  await expect(search).toBeVisible({ timeout: 15_000 });
  await search.fill(product);
  await page.locator(`text=${product}`).first().click();
  await search.fill("");
  await page.getByRole("button", { name: /Proceed to Checkout/i }).click();
  const modal = page.getByTestId("checkout-modal");
  await expect(modal).toBeVisible({ timeout: 10_000 });
  return modal;
}

async function complete(page: Page, modal: Locator): Promise<number> {
  const sale = waitPost(page, "/api/sales/process");
  await modal.getByTestId("checkout-complete-btn").click();
  const { body } = await sale;
  expect(body.success, JSON.stringify(body)).toBeTruthy();
  return body.id as number;
}

function strip(page: Page): Locator {
  return page.getByRole("status", { name: "Sale completed" });
}

test.describe.serial("lira-web-072 LIRA-333 WhatsApp receipt", () => {
  test("LIRA-333: strip Send, details Send (same text), account line, walk-in number, blocked pop-up", async ({
    page,
  }) => {
    await stubWindowOpen(page);
    const auth = await authOf(page);
    await closeActiveSessions(page, auth);

    const stamp = Date.now();
    const product = `L333 Charger ${stamp}`;
    const client = `L333 Client ${stamp}`;
    const six = String(stamp).slice(-6);
    const phone = `03 ${six.slice(0, 3)} ${six.slice(3)}`;
    const digits = `9613${six}`;
    await createProduct(page, auth, product);
    await createClient(page, auth, client, phone);

    await page.goto("/#/pos");
    await expect(page.locator("#root")).not.toContainText(
      "Something went wrong",
    );

    // ── 1. strip Send ────────────────────────────────────────────────────
    let modal = await checkoutWith(page, product);
    await pickClientOption(
      page,
      modal.getByPlaceholder("Search Name or Phone..."),
      client,
    );
    // picking a client may default line 1 to the account — pay cash
    await payLine(modal, 0, "CASH", PRICE, "USD");
    const saleId = await complete(page, modal);

    await expect(strip(page)).toBeVisible();
    await expect(strip(page)).toContainText(`RCP-${saleId}`);
    const urlBefore = page.url();
    const send = strip(page).getByRole("button", { name: /send on whatsapp/i });
    await expect(send).toBeEnabled();
    await send.click();
    let calls = await opens(page);
    expect(calls).toHaveLength(1);
    expect(calls[0].target).toBe("_blank");
    expect(calls[0].url).toMatch(
      new RegExp(`^https://wa\\.me/${digits}\\?text=`),
    );
    const stripText = textOf(calls[0].url);
    expect(stripText).toContain(`Receipt: RCP-${saleId}`);
    expect(stripText).toContain(`*Total: $${PRICE.toFixed(2)}*`);
    expect(page.url()).toBe(urlBefore);

    // ── 2. details Send = strip Send (SC-003) ────────────────────────────
    await strip(page).getByRole("button", { name: "Close" }).click();
    await page.getByText(client).first().click();
    const details = page.getByRole("button", { name: /send on whatsapp/i });
    await expect(details).toBeEnabled({ timeout: 10_000 });
    await details.click();
    calls = await opens(page);
    expect(calls).toHaveLength(2);
    expect(textOf(calls[1].url)).toBe(stripText);
    expect(page.url()).toBe(urlBefore);
    await page.getByRole("button", { name: "Close", exact: true }).click();

    // ── 3. partly on account ─────────────────────────────────────────────
    modal = await checkoutWith(page, product);
    await pickClientOption(
      page,
      modal.getByPlaceholder("Search Name or Phone..."),
      client,
    );
    await splitOn(modal);
    await payLine(modal, 0, "CASH", 4, "USD");
    await addLine(modal);
    await payLine(modal, 1, "CUSTOMER_ACCOUNT", PRICE - 4, "USD");
    const accountSale = await complete(page, modal);
    await expect(strip(page)).toContainText(`RCP-${accountSale}`);
    await strip(page)
      .getByRole("button", { name: /send on whatsapp/i })
      .click();
    calls = await opens(page);
    const accountText = textOf(calls[calls.length - 1].url);
    expect(accountText).toContain(`On account: $${(PRICE - 4).toFixed(2)}`);
    expect(accountText).toContain("Paid USD: $4.00");

    // ── 4. walk-in: number prompt ────────────────────────────────────────
    modal = await checkoutWith(page, product);
    await payLine(modal, 0, "CASH", PRICE, "USD");
    const walkIn = await complete(page, modal);
    await expect(strip(page)).toContainText(`RCP-${walkIn}`);
    const before = (await opens(page)).length;
    await strip(page)
      .getByRole("button", { name: /send on whatsapp/i })
      .click();
    const field = strip(page).getByLabel("Customer's WhatsApp number");
    await expect(field).toBeVisible();
    await field.fill("abc");
    await strip(page)
      .getByRole("button", { name: /^send$/i })
      .click();
    await expect(strip(page)).toContainText("not a valid phone number");
    expect(await opens(page)).toHaveLength(before);
    await field.fill("+33 6 12 34 56 78");
    await strip(page)
      .getByRole("button", { name: /^send$/i })
      .click();
    calls = await opens(page);
    expect(calls).toHaveLength(before + 1);
    expect(calls[before].url).toMatch(/^https:\/\/wa\.me\/33612345678\?text=/);
    const walkInSale = await getSale(page, auth, walkIn);
    expect(walkInSale.sale_phone ?? null).toBeNull();
    expect(walkInSale.client_phone ?? null).toBeNull();

    // ── 5. blocked pop-up ────────────────────────────────────────────────
    await page.evaluate(() => {
      (window as unknown as { __openReturnsNull: boolean }).__openReturnsNull =
        true;
    });
    await field.fill("+33 6 12 34 56 78");
    await strip(page)
      .getByRole("button", { name: /^send$/i })
      .click();
    await expect(strip(page)).toContainText(BLOCKED);
    expect(page.url()).toBe(urlBefore);
  });
});
