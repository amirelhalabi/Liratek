/**
 * LIRA-306 T078 — sales family (rest): `sales:delete-draft` (lifted),
 * `sales:refund`, `sales:refund-item`, `sales:undo-item-refund`,
 * `sales:update-metadata`. Replayed through the ReplayEngine each books what
 * the REST route's service call books online (drawers, payment lines, stock,
 * transactions, profit, debt per currency — SC-001), at the event's own time
 * (FR-021), with the route's schema object.
 *
 * Three-way key diff for the `sales:delete-draft` lift (rule 23):
 *   (a) new core `saleDeleteDraftSchema`: { saleId };
 *   (b) preload `sales.deleteDraft(saleId: number)` → positional → { saleId };
 *   (c) the handler forwards `saleId` only → `salesService.deleteDraft(saleId)`.
 *   Nothing missing. The REST route (`DELETE /api/sales/drafts/:id`) parses
 *   `{ saleId: Number(req.params.id) }` with the same schema.
 */
import type Database from "better-sqlite3";
import type { z } from "zod";
import { runWithTenant } from "../../../db/tenantContext";
import {
  saleDeleteDraftSchema,
  saleProcessSchema,
  saleRefundItemSchema,
  saleRefundSchema,
  saleUndoItemRefundSchema,
  saleUpdateMetadataSchema,
} from "../../../validators/sale";
import { recordedSchema, PENDING_LIFT } from "../../channelPolicy";
import { getSalesService, resetSalesService } from "../../../services/SalesService";
import { getTransactionService, resetTransactionService } from "../../../services/TransactionService";
import { resetSalesRepository } from "../../../repositories/SalesRepository";
import { resetTransactionRepository } from "../../../repositories/TransactionRepository";
import { resetStockBatchRepository } from "../../../repositories/StockBatchRepository";
import { SALES_REST_BINDINGS } from "../salesRest";
import { bindingLookup, runParity, tableState, type ParityCase } from "../../testHelpers/familyHarness";

const bindings = bindingLookup(SALES_REST_BINDINGS);
type SaleInput = z.input<typeof saleProcessSchema>;

function reset(): void {
  resetSalesService();
  resetTransactionService();
  resetSalesRepository();
  resetTransactionRepository();
  resetStockBatchRepository();
}

const SALE = (over: Partial<SaleInput> = {}): SaleInput =>
  ({
    client_id: null,
    items: [
      { product_id: 33, quantity: 2, price: 5 },
      { product_id: 34, quantity: 1, price: 8 },
    ],
    total_amount: 18,
    discount: 0,
    final_amount: 18,
    payment_usd: 18,
    payment_lbp: 0,
    payments: [{ method: "CASH", currency_code: "USD", amount: 18 }],
    exchange_rate: 90000,
    status: "completed",
    client_day: "2026-10-09",
    ...over,
  }) as SaleInput;

/** Sale #1 completed (cash USD), sale #2 a draft, sale #3 on Rami's account; an item refund of sale #1 line 2 (refund txn id in REFUND_TXN). */
let REFUND_TXN = 0;
function seed(db: Database.Database): void {
  db.exec(`
    UPDATE exchange_rates SET market_rate = 89750, buy_rate = 89500, sell_rate = 90000 WHERE tenant_id = 1 AND to_code = 'LBP';
    INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'General', 'USD', 500), (1, 'General', 'LBP', 45000000);
    INSERT INTO products (id, tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity)
      VALUES (33, 1, 'Cable', 'Product', 'General', 2, 5, 10), (34, 1, 'Charger', 'Product', 'General', 3, 8, 10);
    INSERT INTO clients (id, tenant_id, full_name, phone_number) VALUES (7, 1, 'Rami', '70123456');
  `);
  runWithTenant(1, () => {
    const s = getSalesService();
    for (const sale of [
      SALE(),
      SALE({ status: "draft", payments: [], payment_usd: 0 }),
      SALE({ client_id: 7, payments: [{ method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 18 }], payment_usd: 0 }),
      SALE({ items: [{ product_id: 33, quantity: 3, price: 5 }], total_amount: 15, final_amount: 15, payment_usd: 15, payments: [{ method: "CASH", currency_code: "USD", amount: 15 }] }),
    ]) {
      const r = s.processSale(saleProcessSchema.parse(sale) as never, 1);
      if (!r.success) throw new Error(String(r.error));
    }
    const item = db.prepare(`SELECT id FROM sale_items WHERE sale_id = 4 ORDER BY id LIMIT 1`).get() as { id: number };
    const r = s.refundSaleItem({ saleId: 4, saleItemId: item.id, refundQuantity: 1, userId: 1 });
    if (!r.success) throw new Error(String(r.error));
    REFUND_TXN = (db.prepare(`SELECT id FROM transactions WHERE type = 'REFUND' ORDER BY id DESC LIMIT 1`).get() as { id: number }).id;
  });
}

const state = (db: Database.Database) => tableState(db, ["sales", "sale_items", "debt_ledger"], ["due_date"]);

function c(over: Partial<ParityCase> & Pick<ParityCase, "channel" | "payload" | "online">): ParityCase {
  return { seed, reset, bindings, state, ...over };
}

describe("sales (rest) bindings (T078)", () => {
  it("each channel validates with its REST route's schema object; delete-draft lifted", () => {
    expect(recordedSchema("sales:delete-draft")).toBe(saleDeleteDraftSchema);
    expect(recordedSchema("sales:refund-item")).toBe(saleRefundItemSchema);
    expect(recordedSchema("sales:undo-item-refund")).toBe(saleUndoItemRefundSchema);
    expect(recordedSchema("sales:update-metadata")).toBe(saleUpdateMetadataSchema);
    // positional saleId is already a key of the route's schema → no envelope
    expect(recordedSchema("sales:refund")).toBe(saleRefundSchema);
    expect(PENDING_LIFT).not.toContain("sales:delete-draft");
  });

  it("sales:delete-draft — replay equals online", async () => {
    const run = await runParity(c({ channel: "sales:delete-draft", payload: { saleId: 2 }, online: () => getSalesService().deleteDraft(2) }));
    expect(run.online.result).toMatchObject({ success: true });
    expect(run.replay.outcome.status).toBe("booked");
    expect(run.replay.state).toEqual(run.online.state);
  });

  it("sales:refund-item — replay equals online (stock back, cash out), every row at the event's time", async () => {
    const run = await runParity(
      c({
        channel: "sales:refund-item",
        payload: { saleId: 1, saleItemId: 1, refundQuantity: 1 },
        online: () => getSalesService().refundSaleItem({ saleId: 1, saleItemId: 1, refundQuantity: 1, userId: 1 }),
      }),
    );
    expect(run.online.result).toMatchObject({ success: true });
    expect(run.replay.outcome.status).toBe("booked");
    expect(run.replay.state).toEqual(run.online.state);
    expect(run.replay.offTime).toEqual([]);
  });

  it("sales:refund-item of a sale on the customer's account — replay equals online (debt reduced)", async () => {
    const run = await runParity(
      c({
        channel: "sales:refund-item",
        payload: { saleId: 3, saleItemId: 5, refundQuantity: 2 },
        online: () => getSalesService().refundSaleItem({ saleId: 3, saleItemId: 5, refundQuantity: 2, userId: 1 }),
      }),
    );
    expect(run.online.result).toMatchObject({ success: true });
    expect(run.replay.outcome.status).toBe("booked");
    expect(run.replay.state).toEqual(run.online.state);
    expect(run.replay.offTime).toEqual([]);
  });

  it("sales:undo-item-refund — replay equals online, every row at the event's time", async () => {
    const run = await runParity(
      c({
        channel: "sales:undo-item-refund",
        payload: () => ({ refundTransactionId: REFUND_TXN }),
        online: () => getSalesService().undoItemRefund({ refundTransactionId: REFUND_TXN, userId: 1 }),
      }),
    );
    expect(REFUND_TXN).toBeGreaterThan(0);
    expect(run.online.result).toMatchObject({ success: true });
    expect(run.replay.outcome.status).toBe("booked");
    expect(run.replay.state).toEqual(run.online.state);
    expect(run.replay.offTime).toEqual([]);
  });

  it("sales:refund (whole sale) — replay equals online, every row at the event's time", async () => {
    const run = await runParity(
      c({
        channel: "sales:refund",
        payload: { saleId: 1 },
        online: () => getTransactionService().refundBySaleId(1, 1, {}),
      }),
    );
    expect(typeof run.online.result).toBe("number");
    expect(run.replay.outcome.status).toBe("booked");
    expect(run.replay.state).toEqual(run.online.state);
    expect(run.replay.offTime).toEqual([]);
  });

  it("sales:refund of a sale already refunded online is refused with the service's reason (R7)", async () => {
    const run = await runParity(
      c({
        channel: "sales:refund",
        payload: { saleId: 1 },
        seed: (db) => {
          seed(db);
          runWithTenant(1, () => getTransactionService().refundBySaleId(1, 1, {}));
        },
        online: () => {
          try {
            return getTransactionService().refundBySaleId(1, 1, {});
          } catch (e) {
            return { success: false, error: (e as Error).message };
          }
        },
      }),
    );
    expect(run.online.result).toMatchObject({ success: false });
    expect(run.replay.outcome).toMatchObject({ status: "refused", error: (run.online.result as { error: string }).error });
    expect(run.replay.state).toEqual(run.online.state);
  });

  it("sales:update-metadata — editedBy is the event actor's username", async () => {
    const run = await runParity(
      c({
        channel: "sales:update-metadata",
        payload: { id: 1, note: "gift wrap" },
        actorUserId: 2,
        online: () => getSalesService().updateSaleMetadata(1, { note: "gift wrap" }, "cashier"),
      }),
    );
    expect(run.replay.outcome.status).toBe("booked");
    expect(run.replay.state).toEqual(run.online.state);
  });
});
