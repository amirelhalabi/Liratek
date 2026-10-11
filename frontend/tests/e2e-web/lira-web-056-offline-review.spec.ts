/**
 * lira-web-056 — LIRA-306 US3 end to end over the real web backend: two
 * paired PCs send what they did offline; what the server could not book by
 * itself lands on the admin's "Offline work to review" page, and each action
 * there does what it says (SC-004).
 *
 *   PC 1 e1  the same sale a cashier also typed on the web 1 min apart → held (possible duplicate)
 *   PC 1 e2  a sale of a product whose count says 0                  → booked + "stock count was off"
 *   PC 2 e1  an OMT send whose reference was booked on the web       → skipped (certain duplicate)
 *   PC 2 e2  a drawer count                                         → held (N8)
 *
 * On the page: Apply the duplicate (booked once — identity + General USD
 * delta), Book anyway the OMT send, Dismiss the drawer count, Mark reviewed
 * the stock note. Staff are refused. Both PCs are unpaired at the end (one
 * from Settings › Paired PCs, one over the API). Items are found by their
 * event ids, never by position (rule 15). Written after the implementation —
 * an end-to-end proof, not a failing-first guard.
 */
import { randomUUID } from "node:crypto";
import { test, expect, loginAsAdmin, gotoAndSettle, seedStaffUser, staffHeaders, BACKEND_URL } from "./fixtures";
import { buildEvent, currentRates, offlineId, pairPc, uploadEvents, waitProcessed, type PairedPc } from "./helpers/offlineDevice";

const SHOP_OFFSET_MIN = 180; // Beirut

test("offline work to review: duplicates, drawer count and stock note on the admin page", async ({ page }) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };
  const api = page.request;
  const ts = Date.now();

  interface Reply {
    success: boolean;
    id?: number;
    error?: string;
    data?: Record<string, unknown> & { id?: number };
    balances?: { generalDrawer: { usd: number } };
  }
  const json = async (p: Promise<{ json(): Promise<unknown> }>) => (await (await p).json()) as Reply;
  const generalUsd = async (): Promise<number> => {
    const r = await json(api.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, { headers: auth }));
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.balances!.generalDrawer.usd;
  };
  const product = async (name: string, stock: number) => {
    const r = await json(
      api.post(`${BACKEND_URL}/api/inventory/products`, {
        headers: auth,
        data: { name, category: "General", cost_price_usd: 2, retail_price_usd: 9, stock, min_stock_threshold: 0 },
      }),
    );
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.data!.id as number;
  };

  // A price nobody else uses, so the duplicate can only match OUR web sale.
  const price = 10 + (ts % 900) / 100;
  const pA = await product(`L056 Case ${ts}`, 50);
  const pB = await product(`L056 Last one ${ts}`, 0);
  const sale = (productId: number, unit: number) => ({
    items: [{ product_id: productId, quantity: 1, price: unit }],
    total_amount: unit,
    discount: 0,
    final_amount: unit,
    payment_usd: unit,
    payment_lbp: 0,
    payments: [{ method: "CASH", currency_code: "USD", amount: unit }],
    change_given_usd: 0,
    change_given_lbp: 0,
    exchange_rate: 89500,
    status: "completed",
    client_id: null,
  });
  const reference = `L056-${ts}`;
  const omt = {
    provider: "OMT",
    serviceType: "SEND",
    amount: 50,
    currency: "USD",
    omtServiceType: "INTRA",
    omtFee: 4,
    referenceNumber: reference,
    payments: [{ method: "CASH", currencyCode: "USD", amount: 54 }],
  };

  // Two PCs, each holding a fresh copy of the shop (the outage starts now).
  const pc1 = await pairPc(api, { shop: "default", username: "admin", password: "admin123", deviceName: `L056 PC-A ${ts}` });
  const pc2 = await pairPc(api, { shop: "default", username: "admin", password: "admin123", deviceName: `L056 PC-B ${ts}` });
  const copyOf = async (pc: PairedPc): Promise<string> => {
    const res = await api.get(`${BACKEND_URL}/api/offline/snapshot?schemaVersion=${pc.serverSchemaVersion}`, {
      headers: { "x-liratek-device-key": pc.key },
    });
    const copyId = res.headers()["x-copy-id"];
    expect(copyId, await res.text().catch(() => "")).toBeTruthy();
    return copyId;
  };
  const copy1 = await copyOf(pc1);
  const copy2 = await copyOf(pc2);

  // Meanwhile on the web: the same sale typed again, and the OMT send.
  const webSale = await json(api.post(`${BACKEND_URL}/api/sales/process`, { headers: auth, data: sale(pA, price) }));
  expect(webSale.success, JSON.stringify(webSale)).toBeTruthy();
  const webOmt = await json(api.post(`${BACKEND_URL}/api/services/transactions`, { headers: auth, data: omt }));
  expect(webOmt.success, JSON.stringify(webOmt)).toBeTruthy();

  // What the PCs recorded, 1 minute ago.
  const at = new Date(Date.now() - 60_000);
  const occurredAt = at.toISOString();
  const clientDay = new Date(at.getTime() + SHOP_OFFSET_MIN * 60_000).toISOString().slice(0, 10);
  const rates = await currentRates(api, auth);
  const base = { actorUserId: 1, occurredAt, clientDay, clientTzOffsetMinutes: SHOP_OFFSET_MIN, rates };
  const saleCreated = (pc: PairedPc, n: number) => ({
    sales: [offlineId(pc, "sales", n)],
    sale_items: [offlineId(pc, "sale_items", n)],
    transactions: [offlineId(pc, "transactions", n)],
    payments: [offlineId(pc, "payments", n)],
  });
  const p1e1 = buildEvent({ ...base, copyId: copy1, seq: 1, eventId: randomUUID(), channel: "sales:process", payload: sale(pA, price), created: saleCreated(pc1, 1) });
  const p1e2 = buildEvent({ ...base, copyId: copy1, seq: 2, eventId: randomUUID(), channel: "sales:process", payload: sale(pB, 9), created: saleCreated(pc1, 2) });
  const p2e1 = buildEvent({ ...base, copyId: copy2, seq: 1, eventId: randomUUID(), channel: "omt:add-transaction", payload: omt, created: {} });
  const p2e2 = buildEvent({
    ...base,
    copyId: copy2,
    seq: 2,
    eventId: randomUUID(),
    channel: "closing:create-checkpoint",
    payload: {
      drawer_name: "General",
      closing_date: clientDay,
      notes: `L056 count ${ts}`,
      amounts: [{ drawer_name: "General", currency_code: "USD", expected_amount: 100, physical_amount: 95 }],
    },
    created: {},
  });

  expect((await uploadEvents(api, pc1, [p1e1, p1e2], pc1.serverSchemaVersion)).success).toBeTruthy();
  expect((await uploadEvents(api, pc2, [p2e1, p2e2], pc2.serverSchemaVersion)).success).toBeTruthy();
  expect((await waitProcessed(api, pc1, 2)).map((o) => o.status)).toEqual(["held", "booked"]);
  expect((await waitProcessed(api, pc2, 2)).map((o) => o.status)).toEqual(["skipped", "held"]);

  // The review items, found by event id.
  interface Item { id: number; kind: string; eventId: string | null }
  const openItems = async (): Promise<Item[]> => {
    const r = await json(api.get(`${BACKEND_URL}/api/offline/review?state=open`, { headers: auth }));
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return (r.data!.items as Item[]) ?? [];
  };
  const find = (items: Item[], eventId: string, kind: string) => items.find((i) => i.eventId === eventId && i.kind === kind);
  const items = await openItems();
  const dup = find(items, p1e1.eventId, "possible_duplicate")!;
  const stock = find(items, p1e2.eventId, "stock_count_off")!;
  const certain = find(items, p2e1.eventId, "certain_duplicate")!;
  const count = find(items, p2e2.eventId, "held_checkpoint")!;
  for (const [label, it] of Object.entries({ dup, stock, certain, count })) expect(it, label).toBeTruthy();

  // The admin page shows all four, each with its actions.
  await gotoAndSettle(page, "/#/offline-review");
  await expect(page.getByRole("heading", { name: "Offline work to review" })).toBeVisible();
  for (const name of [`Apply item ${dup.id}`, `Mark reviewed item ${stock.id}`, `Book anyway item ${certain.id}`, `Dismiss item ${count.id}`]) {
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  }

  const clickConfirmed = async (name: string) => {
    await page.getByRole("button", { name, exact: true }).click();
    await page.getByRole("dialog", { name: "Confirm" }).getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByRole("button", { name, exact: true })).toHaveCount(0);
  };

  // Apply the duplicate: booked once (+price cash in General).
  const drawerBefore = await generalUsd();
  await clickConfirmed(`Apply item ${dup.id}`);
  const afterApply = await waitProcessed(api, pc1, 2);
  expect(afterApply[0].status).toBe("applied");
  const appliedSale = afterApply[0].serverIds!.sales[0];
  expect(appliedSale).toBeLessThan(1e12);
  expect(appliedSale).not.toBe(webSale.id);
  expect(await generalUsd() - drawerBefore).toBeCloseTo(price, 2);
  // a repeat changes nothing
  const repeat = await json(api.post(`${BACKEND_URL}/api/offline/review/${dup.id}/apply`, { headers: auth }));
  expect(repeat.success, JSON.stringify(repeat)).toBeTruthy();
  expect(await generalUsd() - drawerBefore).toBeCloseTo(price, 2);

  // Book anyway the OMT send; Dismiss the drawer count; Mark reviewed the stock note.
  await clickConfirmed(`Book anyway item ${certain.id}`);
  await clickConfirmed(`Dismiss item ${count.id}`);
  await page.getByRole("button", { name: `Mark reviewed item ${stock.id}`, exact: true }).click();
  await expect(page.getByRole("button", { name: `Mark reviewed item ${stock.id}`, exact: true })).toHaveCount(0);
  const pc2After = await waitProcessed(api, pc2, 2);
  expect(pc2After.map((o) => o.status)).toEqual(["applied", "dismissed"]);
  const left = await openItems();
  for (const it of [dup, stock, certain, count]) expect(left.find((i) => i.id === it.id), `item ${it.id}`).toBeUndefined();

  // Staff are refused.
  seedStaffUser("l056_staff", "Staff-pass-056");
  const staff = await staffHeaders(page, "l056_staff", "Staff-pass-056");
  expect((await api.get(`${BACKEND_URL}/api/offline/review`, { headers: staff })).status()).toBe(403);

  // Unpair: PC-B from Settings › Paired PCs, PC-A over the API.
  await gotoAndSettle(page, "/#/settings?tab=paired-pcs");
  await page.getByRole("button", { name: `Unpair L056 PC-B ${ts}`, exact: true }).click();
  await page.getByRole("dialog", { name: "Confirm" }).getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByRole("button", { name: `Unpair L056 PC-B ${ts}`, exact: true })).toHaveCount(0);
  const devices = await json(api.get(`${BACKEND_URL}/api/offline/devices`, { headers: auth }));
  const list = devices.data!.devices as Array<{ id: number; name: string; revokedAt: string | null }>;
  expect(list.find((d) => d.name === `L056 PC-B ${ts}`)!.revokedAt).toBeTruthy();
  const a = list.find((d) => d.name === `L056 PC-A ${ts}`)!;
  expect((await json(api.post(`${BACKEND_URL}/api/offline/devices/${a.id}/revoke`, { headers: auth }))).success).toBeTruthy();
});
