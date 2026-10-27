/**
 * lira-web-055 — LIRA-306 US1 end to end over the real web backend: a PC
 * paired through POST /api/offline/pair uploads the work it did offline
 * YESTERDAY at 23:50 shop time, and the server books it once, on that day,
 * through the same rules as the web app.
 *
 *   e1 new client          (PC id in the clients range)
 *   e2 sale on account to that client
 *   e3 repayment ticking that sale
 *   e4 refund of a sale booked ONLINE (web) before the outage
 *
 * Asserted by identity (client name/phone, the server ids each event
 * returned) and by deltas (General USD drawer, the client's debt) — never
 * by row position or absolute totals (rule 15). Re-uploading the same events
 * changes nothing (FR-024). A web sale made while the PC's events are being
 * booked is never refused (SC-007, N1).
 *
 * Written AFTER the implementation — an end-to-end proof, not a
 * failing-first guard. The PC is unpaired by global-setup on the next run
 * (no revoke route until US3, T071).
 */
import { randomUUID } from "node:crypto";
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";
import {
  buildEvent,
  currentRates,
  offlineId,
  pairPc,
  uploadEvents,
  waitProcessed,
} from "./helpers/offlineDevice";

const SHOP_OFFSET_MIN = 180; // Beirut

test("offline work replays once, on its own day, through the web's rules", async ({ page }) => {
  await loginAsAdmin(page);
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  const auth = { Authorization: `Bearer ${token}` };
  const api = page.request;
  const ts = Date.now();

  /** The REST replies this test reads (only the fields it uses). */
  interface Reply {
    success: boolean;
    id?: number;
    total?: number;
    data?: { id: number };
    balances?: { generalDrawer: { usd: number } };
    transactions?: Array<{ id: number; type: string; source_id: number | null }>;
    sale?: { client_id: number | null; created_at: string };
    transaction?: { created_at: string };
  }
  const json = async (p: Promise<{ json(): Promise<unknown> }>) => (await (await p).json()) as Reply;
  const generalUsd = async (): Promise<number> => {
    const r = await json(api.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, { headers: auth }));
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return r.balances!.generalDrawer.usd;
  };

  // A product with no stock batches yet, and a cash sale booked ONLINE
  // before the outage (the PC will refund it).
  const product = await json(
    api.post(`${BACKEND_URL}/api/inventory/products`, {
      headers: auth,
      data: { name: `L055 Cable ${ts}`, category: "General", cost_price_usd: 2, retail_price_usd: 5, stock: 50, min_stock_threshold: 0 },
    }),
  );
  expect(product.success, JSON.stringify(product)).toBeTruthy();
  const productId = product.data!.id;
  const sale = (over: Record<string, unknown>) => ({
    items: [{ product_id: productId, quantity: 2, price: 5 }],
    total_amount: 10,
    discount: 0,
    final_amount: 10,
    payment_usd: 10,
    payment_lbp: 0,
    payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
    change_given_usd: 0,
    change_given_lbp: 0,
    exchange_rate: 89500,
    status: "completed",
    client_id: null,
    ...over,
  });
  const s0 = await json(api.post(`${BACKEND_URL}/api/sales/process`, { headers: auth, data: sale({}) }));
  expect(s0.success, JSON.stringify(s0)).toBeTruthy();
  const recent = await json(api.get(`${BACKEND_URL}/api/transactions/recent?limit=200`, { headers: auth }));
  const s0Tx = recent.transactions!.find(
    (t) => t.type === "SALE" && t.source_id === s0.id,
  )!.id;

  // The PC.
  const pc = await pairPc(api, { shop: "default", username: "admin", password: "admin123", deviceName: `L055 PC ${ts}` });
  const rates = await currentRates(api, auth);

  // Yesterday 23:50 in the shop (UTC+3) = yesterday 20:50Z.
  const shopNow = new Date(ts + SHOP_OFFSET_MIN * 60_000);
  const yesterday = new Date(Date.UTC(shopNow.getUTCFullYear(), shopNow.getUTCMonth(), shopNow.getUTCDate() - 1))
    .toISOString()
    .slice(0, 10);
  const occurredAt = `${yesterday}T20:50:00.000Z`;
  const AT_SQL = `${yesterday} 20:50:00`;
  const copyId = randomUUID();
  const base = { actorUserId: 1, occurredAt, clientDay: yesterday, clientTzOffsetMinutes: SHOP_OFFSET_MIN, copyId, rates };

  const name = `L055 Rami ${ts}`;
  const phone = `0377${String(ts).slice(-6)}`;
  const C1 = offlineId(pc, "clients", 1);
  const S1 = offlineId(pc, "sales", 1);
  const tx = (n: number) => offlineId(pc, "transactions", n);
  const e1 = buildEvent({
    ...base,
    seq: 1,
    channel: "clients:create",
    payload: { full_name: name, phone_number: phone, whatsapp_opt_in: 1 },
    created: { clients: [C1], transactions: [tx(1)] },
  });
  const e2 = buildEvent({
    ...base,
    seq: 2,
    channel: "sales:process",
    payload: sale({
      client_id: C1,
      items: [{ product_id: productId, quantity: 3, price: 5 }],
      total_amount: 15,
      final_amount: 15,
      payment_usd: 0,
      payments: [{ method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 15 }],
    }),
    created: {
      sales: [S1],
      sale_items: [offlineId(pc, "sale_items", 1)],
      transactions: [tx(2)],
      debt_ledger: [offlineId(pc, "debt_ledger", 1)],
    },
    dependsOn: [e1.eventId],
  });
  const e3 = buildEvent({
    ...base,
    seq: 3,
    channel: "debt:add-repayment",
    payload: { clientId: C1, amountUSD: 15, payments: [{ method: "CASH", currencyCode: "USD", amount: 15 }], targets: [{ kind: "sale", id: S1 }] },
    created: { transactions: [tx(3)], debt_ledger: [offlineId(pc, "debt_ledger", 2)], payments: [offlineId(pc, "payments", 1)] },
    dependsOn: [e1.eventId, e2.eventId],
  });
  const e4 = buildEvent({
    ...base,
    seq: 4,
    channel: "transactions:refund",
    payload: { transactionId: s0Tx },
    created: { transactions: [tx(4)], payments: [offlineId(pc, "payments", 2)] },
  });
  const events = [e1, e2, e3, e4];

  const schemaVersion = pc.serverSchemaVersion;

  // LIRA-335 (checkpoint open differences): money saved back-timed — custom
  // time OR an offline event replayed with its event time — before a
  // checkpoint that counted an Over on its drawer is ALREADY inside that
  // count, so the engine offsets it (a CHECKPOINT_RESOLUTION leg on the same
  // transaction) instead of moving the drawer twice. The suite shares one DB
  // (rule 15c): lira-web-010 leaves a +10 General/USD Over open and
  // lira-web-050's back-timed $7 sale resolves 7 of it, so here the replayed
  // $15 repayment (timed before that checkpoint) resolves whatever is still
  // open. Snapshot exactly what the engine can absorb at our event time — the
  // same `open-after` the Transaction-time hint uses — and prove the drawer
  // moved by 12 minus what OUR transactions resolved, by identity.
  interface OpenDiff {
    id: number;
    closing_id: number;
    drawer_name: string;
    currency_code: string;
    direction: "OVER" | "SHORT";
    open: number;
    resolutions?: Array<{ transaction_id: number; amount: number }>;
  }
  const openOverAt = async (): Promise<Map<number, number>> => {
    const r = (await (
      await api.get(
        `${BACKEND_URL}/api/closing/differences/open-after?at=${encodeURIComponent(occurredAt)}`,
        { headers: auth },
      )
    ).json()) as { success: boolean; data?: OpenDiff[] };
    expect(r.success, JSON.stringify(r)).toBeTruthy();
    return new Map(
      (r.data ?? [])
        .filter((d) => d.drawer_name === "General" && d.currency_code === "USD" && d.direction === "OVER")
        .map((d) => [d.id, d.open]),
    );
  };
  const openBefore = await openOverAt();

  const drawerBefore = await generalUsd();
  const up = await uploadEvents(api, pc, events, schemaVersion);
  expect(up.success, JSON.stringify(up)).toBeTruthy();
  expect(up.data!.acked).toEqual(events.map((e) => e.eventId));

  // A web sale while the PC's work is being booked is never refused.
  const webSale = await json(api.post(`${BACKEND_URL}/api/sales/process`, { headers: auth, data: sale({ items: [{ product_id: productId, quantity: 1, price: 7 }], total_amount: 7, final_amount: 7, payment_usd: 7, payments: [{ method: "CASH", currency_code: "USD", amount: 7 }] }) }));
  expect(webSale.success, JSON.stringify(webSale)).toBeTruthy();

  const outcomes = await waitProcessed(api, pc, 4);
  expect(outcomes.map((o) => [o.seq, o.status])).toEqual([
    [1, "booked"],
    [2, "booked"],
    [3, "booked"],
    [4, "booked"],
  ]);

  // Identity: the server client, the server sale on account to it.
  const clientId = outcomes[0].serverIds!.clients[0];
  const saleId = outcomes[1].serverIds!.sales[0];
  expect(clientId).toBeLessThan(1e12);
  const got = await json(api.get(`${BACKEND_URL}/api/sales/${saleId}`, { headers: auth }));
  expect(got.success, JSON.stringify(got)).toBeTruthy();
  expect(got.sale!.client_id).toBe(clientId);
  expect(String(got.sale!.created_at)).toBe(AT_SQL);
  for (const o of outcomes) {
    const t = o.serverIds!.transactions[0];
    const row = await json(api.get(`${BACKEND_URL}/api/transactions/${t}`, { headers: auth }));
    expect(String(row.transaction?.created_at), `event ${o.seq}`).toBe(AT_SQL);
  }

  // Deltas: the client owes nothing (charged 15, repaid 15); the drawer got
  // +15 (repayment) −10 (refund of the online sale) +7 (the web sale), less
  // whatever of the back-timed +15 an open checkpoint Over had already
  // counted (LIRA-335, see `openBefore`). Refunds never resolve (FR-009) and
  // the web sale is timed now (no checkpoint after it), so only the
  // repayment can — and never more than its own 15.
  const owed = await json(api.get(`${BACKEND_URL}/api/debts/clients/${clientId}/total`, { headers: auth }));
  expect(owed.success, JSON.stringify(owed)).toBeTruthy();
  expect(Number(owed.total)).toBeCloseTo(0, 2);
  const openAfter = await openOverAt();
  let absorbed = 0;
  for (const [id, open] of openBefore) absorbed += open - (openAfter.get(id) ?? 0);
  const expectedAbsorbed = Math.min(15, [...openBefore.values()].reduce((a, b) => a + b, 0));
  expect(absorbed, "the repayment resolves min(15, open Over) — no more, no less").toBeCloseTo(expectedAbsorbed, 2);
  // Identity: what was resolved was resolved by OUR repayment transaction.
  const repaymentTx = outcomes[2].serverIds!.transactions[0];
  const shopToday = shopNow.toISOString().slice(0, 10);
  const timeline = (await (
    await api.get(
      `${BACKEND_URL}/api/closing/checkpoint-timeline?date_from=${yesterday}&date_to=${shopToday}&type=ALL`,
      { headers: auth },
    )
  ).json()) as { success: boolean; checkpoints?: Array<{ differences?: OpenDiff[] }> };
  expect(timeline.success, JSON.stringify(timeline)).toBeTruthy();
  const replayTxIds = new Set(outcomes.flatMap((o) => o.serverIds!.transactions));
  const resolvedByReplay = (timeline.checkpoints ?? [])
    .flatMap((c) => c.differences ?? [])
    .filter((d) => d.drawer_name === "General" && d.currency_code === "USD")
    .flatMap((d) => d.resolutions ?? [])
    .filter((r) => replayTxIds.has(r.transaction_id));
  expect(resolvedByReplay.every((r) => r.transaction_id === repaymentTx)).toBe(true);
  expect(resolvedByReplay.reduce((a, r) => a + Math.abs(r.amount), 0)).toBeCloseTo(absorbed, 2);
  const drawerAfter = await generalUsd();
  expect(drawerAfter - drawerBefore).toBeCloseTo(15 - 10 + 7 - absorbed, 2);

  // Re-upload: acked again, nothing booked twice.
  const again = await uploadEvents(api, pc, events, schemaVersion);
  expect(again.data!.acked).toEqual(events.map((e) => e.eventId));
  const outcomes2 = await waitProcessed(api, pc, 4);
  expect(outcomes2.map((o) => o.serverIds)).toEqual(outcomes.map((o) => o.serverIds));
  expect(await generalUsd()).toBeCloseTo(drawerAfter, 2);
});
