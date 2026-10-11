/**
 * LIRA-306 T080 — sessions / baskets family: `session:start`,
 * `session:update`, `session:close` (lifted), `session:delete` (lifted),
 * `session:linkTransaction`, `session:checkout`, `session:cart:add`,
 * `session:cart:remove` (lifted), `session:cart:clear` (lifted),
 * `transactions:void-checkout-group`, `transactions:void-session-basket`,
 * `transactions:refund-session-basket`, `transactions:refund-session-basket-item`.
 * Replayed through the ReplayEngine each books what the REST route's service
 * call books online (drawers, payment lines, transactions, debt, sessions
 * per currency — SC-001), at the event's own time (FR-021). `session:close`
 * takes its actor from the EVENT, never the renderer's `closedBy`.
 *
 * Three-way key diffs (rule 23), taken before the lifts:
 *   session:close  — (a) `sessionIdPayloadSchema` { sessionId }; (b) preload
 *     `session.close(sessionId, closedBy)`; (c) handler forwarded `sessionId`
 *     and the renderer's `closedBy` as the actor. `closedBy` is deliberately
 *     NOT in the schema: the actor is the signed-in user (REST: JWT username;
 *     IPC: the session user's username; replay: the event's actor) — the
 *     policy's argNames drop the positional `closedBy` (reported: the
 *     preload still sends it and nothing reads it now).
 *   session:delete — (a) { sessionId }; (b) `session.delete(sessionId)`;
 *     (c) `sessionId`. Nothing missing.
 *   session:cart:remove — (a) `sessionCartRemoveSchema` { sessionId,
 *     itemId: string (the frontend's cart-line uuid) }; (b)
 *     `session.cart.remove(sessionId, itemId)`; (c) both. Nothing missing.
 *   session:cart:clear — (a) { sessionId }; (b) `session.cart.clear(sessionId)`;
 *     (c) `sessionId`. Nothing missing.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../../db/tenantContext";
import {
  linkSessionTransactionSchema,
  sessionCartAddSchema,
  sessionCartRemoveSchema,
  sessionCheckoutSchema,
  sessionIdPayloadSchema,
  startSessionIpcSchema,
  updateSessionSchema,
} from "../../../validators/session";
import { saleProcessSchema } from "../../../validators/sale";
import { sessionBasketReversalSchema, sessionItemRefundSchema, voidCheckoutGroupSchema } from "../../../validators/transaction";
import { recordedSchema, policyEntry, objectShapeOf, PENDING_LIFT } from "../../channelPolicy";
import { rewriteIdPositions } from "../../idPositions";
import { CustomerSessionService } from "../../../services/CustomerSessionService";
import { getSessionCheckoutService, resetSessionCheckoutService } from "../../../services/SessionCheckoutService";
import { getTransactionService, resetTransactionService } from "../../../services/TransactionService";
import { getSalesService, resetSalesService } from "../../../services/SalesService";
import { resetSessionPaymentService } from "../../../services/SessionPaymentService";
import { resetCustomServiceService } from "../../../services/CustomServiceService";
import { resetCustomerSessionRepository } from "../../../repositories/CustomerSessionRepository";
import { resetSessionPaymentRepository } from "../../../repositories/SessionPaymentRepository";
import { resetTransactionRepository } from "../../../repositories/TransactionRepository";
import { resetCustomServiceRepository } from "../../../repositories/CustomServiceRepository";
import { resetSalesRepository } from "../../../repositories/SalesRepository";
import { SESSIONS_BINDINGS } from "../sessions";
import { bindingLookup, runParity, tableState, type ParityCase } from "../../testHelpers/familyHarness";

const bindings = bindingLookup(SESSIONS_BINDINGS);

function reset(): void {
  resetSessionCheckoutService();
  resetTransactionService();
  resetSalesService();
  resetSessionPaymentService();
  resetCustomServiceService();
  resetCustomerSessionRepository();
  resetSessionPaymentRepository();
  resetTransactionRepository();
  resetCustomServiceRepository();
  resetSalesRepository();
}

const WALK_IN_LINE = {
  item_id: "line-1",
  module: "custom_service",
  label: "Screen protector",
  amount: 20,
  currency: "USD",
  form_data: JSON.stringify({ description: "Screen protector", price_usd: 20, cost_usd: 5 }),
  ipc_channel: "custom-services:add",
};
const cartItem = (id: string, price = 20) => ({
  id,
  module: "custom_service",
  label: "Screen protector",
  amount: price,
  currency: "USD",
  ipcChannel: "custom-services:add",
  formData: { description: "Screen protector", price_usd: price, cost_usd: 5 },
});

/**
 * Session 1 'Walk-in' (active, empty), session 2 'Rami' (active, two basket
 * lines), session 3 'Basket' (checked out: one $20 service paid cash),
 * sale 1 (completed, $10 cash) to link.
 */
async function seed(db: Database.Database): Promise<void> {
  db.exec(`
    UPDATE exchange_rates SET market_rate = 89750, buy_rate = 89500, sell_rate = 90000 WHERE tenant_id = 1 AND to_code = 'LBP';
    INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'USD', 500);
    INSERT INTO products (id, tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity)
      VALUES (33, 1, 'Cable', 'Product', 'General', 2, 5, 10);
    INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (7, 1, 'Rami', '70123456');
  `);
  await runWithTenant(1, async () => {
    const s = new CustomerSessionService();
    for (const name of ["Walk-in", "Rami", "Basket"]) {
      const r = await s.startSession({ customer_name: name, started_by: "admin", user_id: 1 });
      if (!r.success) throw new Error(r.error);
    }
    for (const id of ["line-1", "line-2"]) {
      const r = s.addCartItem(2, { ...WALK_IN_LINE, item_id: id }, 1);
      if (!r.success) throw new Error(r.error);
    }
    const co = await getSessionCheckoutService().checkout(
      { sessionId: 3, cartItems: [cartItem("b-1")] as never, payments: [{ method: "CASH", currency_code: "USD", amount: 20, direction: "IN" }] as never, userId: 1 },
      { username: "admin" },
    );
    if (!co.success) throw new Error(co.error);
    const sale = getSalesService().processSale(
      saleProcessSchema.parse({
        client_id: null,
        items: [{ product_id: 33, quantity: 2, price: 5 }],
        total_amount: 10,
        discount: 0,
        final_amount: 10,
        payment_usd: 10,
        payment_lbp: 0,
        payments: [{ method: "CASH", currency_code: "USD", amount: 10 }],
        exchange_rate: 90000,
        status: "completed",
        client_day: "2026-10-09",
      }) as never,
      1,
    );
    if (!sale.success) throw new Error(String(sale.error));
  });
}

const state = (db: Database.Database) =>
  tableState(db, ["customer_sessions", "customer_session_transactions", "session_cart_items", "custom_services", "clients"], ["due_date"]);

function c(over: Partial<ParityCase> & Pick<ParityCase, "channel" | "payload" | "online">): ParityCase {
  return { seed, reset, bindings, state, ...over };
}
const svc = () => new CustomerSessionService();
const basketTxn = (db: Database.Database) =>
  (db.prepare(`SELECT unified_transaction_id AS id FROM customer_session_transactions WHERE session_id = 3 ORDER BY id LIMIT 1`).get() as { id: number }).id;

describe("sessions / baskets bindings (T080)", () => {
  it("channels validate with their route's schema; close/delete/cart:remove/cart:clear lifted", () => {
    expect(recordedSchema("session:start")).toBe(startSessionIpcSchema);
    expect(recordedSchema("session:linkTransaction")).toBe(linkSessionTransactionSchema);
    expect(recordedSchema("session:checkout")).toBe(sessionCheckoutSchema);
    expect(recordedSchema("session:close")).toBe(sessionIdPayloadSchema);
    expect(recordedSchema("session:delete")).toBe(sessionIdPayloadSchema);
    expect(recordedSchema("session:cart:clear")).toBe(sessionIdPayloadSchema);
    expect(recordedSchema("session:cart:remove")).toBe(sessionCartRemoveSchema);
    expect(recordedSchema("transactions:void-checkout-group")).toBe(voidCheckoutGroupSchema);
    expect(recordedSchema("transactions:void-session-basket")).toBe(sessionBasketReversalSchema);
    expect(recordedSchema("transactions:refund-session-basket")).toBe(sessionBasketReversalSchema);
    expect(recordedSchema("transactions:refund-session-basket-item")).toBe(sessionItemRefundSchema);
    // positional sessionId wrapped around the route's body schema
    for (const [ch, body] of [["session:update", updateSessionSchema], ["session:cart:add", sessionCartAddSchema]] as const) {
      const shape = objectShapeOf(recordedSchema(ch)!)!;
      expect(Object.keys(shape).sort()).toEqual([...Object.keys(objectShapeOf(body)!), "sessionId"].sort());
    }
    expect(policyEntry("session:close")?.argNames).toEqual(["sessionId"]);
    for (const ch of ["session:close", "session:delete", "session:cart:remove", "session:cart:clear"]) expect(PENDING_LIFT).not.toContain(ch);
  });

  it("cartItems[].formData ids are rewritten through the id map (nested, R3)", () => {
    const OFF = 1_017_000_000_001;
    const parsed = sessionCheckoutSchema.parse({
      sessionId: 1,
      userId: 1,
      cartItems: [{ ...cartItem("x"), formData: { ...cartItem("x").formData, client_id: OFF } }],
    }) as Record<string, unknown>;
    const { payload, unmapped } = rewriteIdPositions("session:checkout", parsed, (id) => (id === OFF ? 7 : undefined));
    expect(unmapped).toEqual([]);
    expect((payload.cartItems as Array<{ formData: { client_id: number } }>)[0].formData.client_id).toBe(7);
  });

  const CASES: Array<[string, ParityCase]> = [
    ["session:start", c({ channel: "session:start", payload: { customer_name: "Lina", customer_phone: "71555666" }, online: () => svc().startSession({ customer_name: "Lina", customer_phone: "71555666", started_by: "admin", user_id: 1 }) })],
    ["session:update", c({ channel: "session:update", payload: { sessionId: 1, customer_notes: "vip" }, online: () => svc().updateSession(1, { customer_notes: "vip" }, 1) })],
    ["session:cart:add", c({ channel: "session:cart:add", payload: { sessionId: 1, ...WALK_IN_LINE, item_id: "line-9" }, online: () => svc().addCartItem(1, { ...WALK_IN_LINE, item_id: "line-9" }, 1) })],
    ["session:cart:remove", c({ channel: "session:cart:remove", payload: { sessionId: 2, itemId: "line-1" }, online: () => svc().removeCartItem(2, "line-1") })],
    ["session:cart:clear", c({ channel: "session:cart:clear", payload: { sessionId: 2 }, online: () => svc().clearCart(2) })],
    [
      "session:linkTransaction",
      c({
        channel: "session:linkTransaction",
        payload: { sessionId: 1, transactionType: "sale", transactionId: 1, amountUsd: 10, amountLbp: 0 },
        online: () => svc().linkTransactionToSession(1, "sale", 1, 10, 0, 0, 0),
      }),
    ],
    [
      "session:checkout (two services, cash USD)",
      c({
        channel: "session:checkout",
        payload: { sessionId: 2, cartItems: [cartItem("line-1"), cartItem("line-2", 15)], payments: [{ method: "CASH", currency_code: "USD", amount: 35, direction: "IN" }], userId: 999 },
        online: () =>
          getSessionCheckoutService().checkout(
            { sessionId: 2, cartItems: [cartItem("line-1"), cartItem("line-2", 15)] as never, payments: [{ method: "CASH", currency_code: "USD", amount: 35, direction: "IN" }] as never, userId: 1 },
            { username: "admin" },
          ),
      }),
    ],
    ["session:delete", c({ channel: "session:delete", payload: { sessionId: 2 }, online: () => svc().deleteSession(2) })],
    ["transactions:void-session-basket", c({ channel: "transactions:void-session-basket", payload: { sessionId: 3 }, online: () => ({ success: true, ...getTransactionService().voidSessionBasket(3, 1) }) })],
    ["transactions:refund-session-basket", c({ channel: "transactions:refund-session-basket", payload: { sessionId: 3 }, online: () => ({ success: true, ...getTransactionService().refundSessionBasket(3, 1) }) })],
  ];

  it.each(CASES)("%s — replay equals online, every row at the event's time", async (_n, pc) => {
    const run = await runParity(pc);
    expect(run.online.result).toMatchObject({ success: true });
    expect(run.replay.outcome).toMatchObject({ status: "booked" });
    expect(run.replay.state).toEqual(run.online.state);
    expect(run.replay.offTime).toEqual([]);
  });

  it("transactions:refund-session-basket-item — replay equals online", async () => {
    let txnId = 0;
    const run = await runParity(
      c({
        channel: "transactions:refund-session-basket-item",
        payload: () => ({ sessionId: 3, transactionId: txnId }),
        seed: async (db) => {
          await seed(db);
          txnId = basketTxn(db);
        },
        online: () => ({ success: true, ...getTransactionService().refundSessionBasketItem({ sessionId: 3, transactionId: txnId, userId: 1 } as never) }),
      }),
    );
    expect(run.online.result).toMatchObject({ success: true });
    expect(run.replay.outcome).toMatchObject({ status: "booked" });
    expect(run.replay.state).toEqual(run.online.state);
    expect(run.replay.offTime).toEqual([]);
  });

  it("session:close — closed by the EVENT's actor, never the renderer's closedBy", async () => {
    const run = await runParity(
      c({
        channel: "session:close",
        payload: { sessionId: 1, closedBy: "mallory" },
        actorUserId: 2,
        online: () => svc().closeSession(1, "cashier"),
      }),
    );
    expect(run.replay.outcome.status).toBe("booked");
    expect(run.replay.state).toEqual(run.online.state);
    const rows = (run.replay.state as { extra: { customer_sessions: Array<{ id: number; closed_by: string | null }> } }).extra.customer_sessions;
    expect(rows.find((r) => r.id === 1)?.closed_by).toBe("cashier");
  });

  it("session:start for a customer with an active basket is refused with the service's reason (R7)", async () => {
    const run = await runParity(
      c({ channel: "session:start", payload: { customer_name: "Rami" }, online: () => svc().startSession({ customer_name: "Rami", started_by: "admin", user_id: 1 }) }),
    );
    expect(run.online.result).toMatchObject({ success: false });
    expect(run.replay.outcome).toMatchObject({ status: "refused", error: (run.online.result as { error: string }).error });
  });

  it("session:checkout of a basket closed online is refused (R7)", async () => {
    const run = await runParity(
      c({
        channel: "session:checkout",
        payload: { sessionId: 3, cartItems: [cartItem("z")], payments: [{ method: "CASH", currency_code: "USD", amount: 20, direction: "IN" }], userId: 1 },
        online: () => getSessionCheckoutService().checkout({ sessionId: 3, cartItems: [cartItem("z")] as never, userId: 1 }, { username: "admin" }),
      }),
    );
    expect(run.online.result).toMatchObject({ success: false, error: "Session is already closed" });
    expect(run.replay.outcome).toMatchObject({ status: "refused", error: "Session is already closed" });
  });

  it("transactions:void-checkout-group of an unknown group is refused with the service's reason", async () => {
    const groupId = "6f1c2b3a-1d2e-4f50-8a9b-0c1d2e3f4a5b";
    const run = await runParity(
      c({
        channel: "transactions:void-checkout-group",
        payload: { groupId },
        online: () => {
          try {
            return { success: true, ...getTransactionService().voidCheckoutGroup(groupId, 1) };
          } catch (e) {
            return { success: false, error: (e as Error).message };
          }
        },
      }),
    );
    expect(run.online.result).toMatchObject({ success: false });
    expect(run.replay.outcome).toMatchObject({ status: "refused", error: (run.online.result as { error: string }).error });
  });
});
