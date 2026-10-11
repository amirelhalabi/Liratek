/**
 * LIRA-306 T059 — HIGH guard (pass 3 D3, FR-026/FR-027, O-new-28): when a
 * duplicate is resolved by LINKING it to the existing row (Dismiss of a likely
 * duplicate; Mark reviewed of a certain one), only the MAIN row is mapped —
 * an independently typed row may list its items in another order. A later
 * offline action naming one of the unmapped child rows is held "booked, but
 * this part could not be linked" and moves no stock and no money.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { ReplayEngine } from "../ReplayEngine";
import { getOfflineBinding } from "../bindings/index";
import type { OfflineBinding } from "../bindings/types";
import { OfflineReviewRepository } from "../../repositories/OfflineReviewRepository";
import { OfflineEventRepository } from "../../repositories/OfflineEventRepository";
import { RowCaptureRepository } from "../../repositories/RowCaptureRepository";
import { OfflineReviewService } from "../../services/OfflineReviewService";
import { insertCopy, installReplayDb, storeEvent, uninstallReplayDb, resetSeq } from "../testHelpers/replayHarness";
import { DUP_SEED_SQL, OMT_SEND, SALE, bookOnline, pcCreatedLike } from "../testHelpers/dupHarness";

let db: Database.Database;
let pc1 = 0;
let n = 0;
beforeEach(() => {
  resetSeq();
  n = 0;
  ({ db, deviceId: pc1 } = installReplayDb());
  db.exec(DUP_SEED_SQL);
  insertCopy("2026-10-10T10:00:00.000Z", runWithTenant(1, () => new RowCaptureRepository().highWaterMarks()));
});
afterEach(() => uninstallReplayDb(db));

const eventId = (k: number) => `00000000-0000-4000-8000-${String(k).padStart(12, "0")}`;
const store = (channel: string, payload: Record<string, unknown>, at: string, extra: { created?: Record<string, number[]>; dependsOn?: string[] } = {}) => {
  n += 1;
  return storeEvent({ deviceId: pc1, channel, payload, seq: n, eventId: eventId(n), occurredAt: at, ...extra });
};
const replay = (row: ReturnType<typeof store>) =>
  runWithTenant(1, () => new ReplayEngine().process(new OfflineEventRepository().findById(row.id)!, { mode: "auto" }));
const mapRowsFor = (table: string) => db.prepare(`SELECT * FROM offline_id_map WHERE table_name = ?`).all(table);
const stock = (id: number) => (db.prepare(`SELECT stock_quantity AS s FROM products WHERE id = ?`).get(id) as { s: number }).s;
const drawers = () => db.prepare(`SELECT drawer_name, currency_code, balance FROM drawer_balances ORDER BY 1, 2`).all();
const itemOf = (kind: string) =>
  runWithTenant(1, () => new OfflineReviewRepository().list({ state: "open" }).find((i) => i.kind === kind)!);

const TWO = (items: Array<Record<string, unknown>>) =>
  SALE({ items, total_amount: 60, final_amount: 60, payment_usd: 60, payments: [{ method: "CASH", currency_code: "USD", amount: 60 }] });
const A = { product_id: 33, quantity: 1, price: 40 };
const B = { product_id: 34, quantity: 2, price: 10 };

describe("duplicate links map the MAIN row only", () => {
  it("Dismiss of a likely duplicate (A,B offline vs B,A online): only the sale is mapped; a refund of item A is held and moves nothing", async () => {
    const online = bookOnline("sales:process", TWO([B, A]), "2026-10-10T10:12:00.000Z");
    const pc = pcCreatedLike(online.created, 1, 1);
    const e1 = store("sales:process", TWO([A, B]), "2026-10-10T10:10:00.000Z", { created: pc });
    expect((await replay(e1)).status).toBe("held");

    const r = await runWithTenant(1, () => new OfflineReviewService().dismiss(itemOf("possible_duplicate").id, 1));
    expect(r.success).toBe(true);
    expect(mapRowsFor("sales")).toHaveLength(1);
    expect(mapRowsFor("sale_items")).toHaveLength(0);

    // a later offline refund of the OFFLINE sale_item of A — a stub binding
    // that would move stock if it ever ran
    let ran = false;
    const refundStub: OfflineBinding = {
      channel: "sales:refund-item",
      run: () => {
        ran = true;
        db.prepare(`UPDATE products SET stock_quantity = stock_quantity + 1 WHERE id = 33`).run();
        return { success: true };
      },
    };
    const stockA = stock(33);
    const stockB = stock(34);
    const drawersBefore = drawers();
    const e2 = store("sales:refund-item", { saleId: pc.sales[0], saleItemId: pc.sale_items[0], refundQuantity: 1 }, "2026-10-10T10:20:00.000Z", {
      dependsOn: [eventId(1)],
    });
    const out = await runWithTenant(1, () =>
      new ReplayEngine({ bindings: (ch) => (ch === "sales:refund-item" ? refundStub : getOfflineBinding(ch)) }).process(
        new OfflineEventRepository().findById(e2.id)!,
        { mode: "auto" },
      ),
    );
    expect(out.status).toBe("held");
    expect(out.error).toMatch(/booked, but this part could not be linked/);
    expect(ran).toBe(false);
    const stockDeltaA = stock(33) - stockA;
    const stockDeltaB = stock(34) - stockB;
    expect(stockDeltaA).toBe(0);
    expect(stockDeltaB).toBe(0);
    expect(drawers()).toEqual(drawersBefore);
  });

  it("Mark reviewed of a certain duplicate maps only the transfer itself, never its child rows", async () => {
    const online = bookOnline("omt:add-transaction", OMT_SEND(), "2026-10-10T10:06:00.000Z");
    const pc = pcCreatedLike(online.created, 1, 1);
    const e1 = store("omt:add-transaction", OMT_SEND(), "2026-10-10T10:40:00.000Z", { created: pc });
    expect((await replay(e1)).status).toBe("skipped");
    const r = await runWithTenant(1, () => new OfflineReviewService().markReviewed(itemOf("certain_duplicate").id, 1));
    expect(r.success).toBe(true);
    expect(mapRowsFor("financial_services")).toHaveLength(1);
    expect(mapRowsFor("payments")).toHaveLength(0);
    expect(mapRowsFor("transactions")).toHaveLength(0);
  });
});
