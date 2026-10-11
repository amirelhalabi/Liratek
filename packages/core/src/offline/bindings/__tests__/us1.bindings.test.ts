/**
 * LIRA-306 T044 — the US1 bindings end to end, PC → server (SC-003).
 *
 * A PC working copy is a byte copy of the server's database with every
 * id-range table seeded to PC 1's offline range (what go-offline does). The
 * cashier's actions run on it through the SAME bindings (the PC runs the same
 * core services), their created rows are captured, and the events are then
 * replayed on the server:
 *   e1 new client Rami → e2 sale on account to Rami → e3 repayment ticking
 *   that sale → e4 refund of a sale booked ONLINE before the outage.
 * Every link must land on SERVER rows; voiding the replayed repayment online
 * afterwards nets the drawers and the client's debt back to 0 per currency
 * (rule 20).
 */
import Database from "better-sqlite3";
import { runWithTenant } from "../../../db/tenantContext";
import { ReplayEngine } from "../../ReplayEngine";
import { getOfflineBinding } from "../index";
import { RowCaptureRepository } from "../../../repositories/RowCaptureRepository";
import { OfflineIdMapRepository } from "../../../repositories/OfflineIdMapRepository";
import { OfflineReviewRepository } from "../../../repositories/OfflineReviewRepository";
import { OFFLINE_ID_TABLES, encodeOfflineId, isOfflineId } from "../../idRange";
import { recordedSchema } from "../../channelPolicy";
import { offlineIdsInPositions } from "../../idPositions";
import { getSalesService, resetSalesService } from "../../../services/SalesService";
import { getTransactionService, resetTransactionService } from "../../../services/TransactionService";
import { resetSalesRepository } from "../../../repositories/SalesRepository";
import { resetTransactionRepository } from "../../../repositories/TransactionRepository";
import { resetStockBatchRepository } from "../../../repositories/StockBatchRepository";
import { resetClientService } from "../../../services/ClientService";
import { resetDebtService } from "../../../services/DebtService";
import { resetDebtRepository } from "../../../repositories/DebtRepository";
import { installReplayDb, uninstallReplayDb, storeEvent, resetSeq } from "../../testHelpers/replayHarness";

type G = typeof globalThis & { __LIRATEK_TEST_DB__?: Database.Database };
const use = (db: Database.Database) => ((globalThis as G).__LIRATEK_TEST_DB__ = db);

let server: Database.Database;
let pc: Database.Database;
let deviceId = 0;

function resetAll(): void {
  for (const r of [
    resetSalesService, resetTransactionService, resetSalesRepository, resetTransactionRepository,
    resetStockBatchRepository, resetClientService, resetDebtService, resetDebtRepository,
  ]) r();
}

/** go-offline: sqlite_sequence of every id-range table → PC 1's range. */
function seedPcRange(db: Database.Database): void {
  const upd = db.prepare(`UPDATE sqlite_sequence SET seq = ? WHERE name = ?`);
  const ins = db.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)`);
  OFFLINE_ID_TABLES.forEach((t, i) => {
    const seq = encodeOfflineId(1, i, 1) - 1;
    if (upd.run(seq, t).changes === 0) ins.run(t, seq);
  });
}

interface Recorded {
  channel: string;
  payload: Record<string, unknown>;
  created: Record<string, number[]>;
  result: Record<string, unknown>;
  eventId: string;
  dependsOn: string[];
}
const recorded: Recorded[] = [];
const createdBy = new Map<number, string>();

/** What the recorder does on the PC: parse, run the binding, capture rows. */
function onPc(channel: string, payload: Record<string, unknown>): Recorded {
  use(pc);
  const parsed = recordedSchema(channel)!.parse(payload) as Record<string, unknown>;
  const capture = new RowCaptureRepository();
  let rec!: Recorded;
  runWithTenant(1, () => {
    pc.transaction(() => {
      const before = capture.snapshotSequences();
      const result = getOfflineBinding(channel)!.run(parsed, { tenantId: 1, actorUserId: 2, eventId: "pc", deviceId: 0 }) as Record<string, unknown>;
      if (result.success !== true) throw new Error(`PC refused ${channel}: ${String(result.error)}`);
      const created = capture.createdSince(before);
      const eventId = `00000000-0000-4000-8000-${String(recorded.length + 1).padStart(12, "0")}`;
      const dependsOn = [...new Set(offlineIdsInPositions(channel, parsed).map((id) => createdBy.get(id)).filter((e): e is string => !!e))];
      for (const ids of Object.values(created)) for (const id of ids) createdBy.set(id, eventId);
      rec = { channel, payload: parsed, created, result, eventId, dependsOn };
    })();
  });
  recorded.push(rec);
  return rec;
}

function replayAll(): Promise<Array<{ status: string }>> {
  use(server);
  resetAll();
  return (async () => {
    const outs = [];
    for (const r of recorded) {
      const row = storeEvent({
        deviceId,
        channel: r.channel,
        payload: r.payload,
        created: r.created,
        dependsOn: r.dependsOn,
        eventId: r.eventId,
        // the refund is admin-only (the IPC handler's role) — O-new-7 checks it
        actorUserId: r.channel === "transactions:refund" ? 1 : 2,
      });
      outs.push(await runWithTenant(1, () => new ReplayEngine().process(row, { mode: "auto" })));
    }
    return outs;
  })();
}

const SALE = (over: Record<string, unknown>) => ({
  items: [{ product_id: 33, quantity: 3, price: 5 }],
  total_amount: 15,
  discount: 0,
  final_amount: 15,
  payment_usd: 0,
  payment_lbp: 0,
  exchange_rate: 90000,
  status: "completed",
  ...over,
});

beforeEach(() => {
  resetAll();
  recorded.length = 0;
  createdBy.clear();
  resetSeq();
  ({ db: server, deviceId } = installReplayDb());
  server.exec(`
    INSERT INTO products (id, tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity)
      VALUES (33, 1, 'Cable', 'Product', 'General', 2, 5, 50);
  `);
});
afterEach(() => {
  pc?.close();
  uninstallReplayDb(server);
});

function balances(db: Database.Database, clientId: number) {
  return {
    drawers: db
      .prepare(`SELECT drawer_name, currency_code, ROUND(balance, 4) AS b FROM drawer_balances WHERE tenant_id = 1 ORDER BY 1, 2`)
      .all(),
    debt: db
      .prepare(`SELECT ROUND(COALESCE(SUM(amount_usd), 0), 4) AS usd, ROUND(COALESCE(SUM(amount_lbp), 0), 4) AS lbp FROM debt_ledger WHERE client_id = ? AND tenant_id = 1`)
      .get(clientId),
  };
}

describe("US1 bindings: client → sale on account → repayment ticking it → refund of an online sale", () => {
  it("lands every link on server rows; void-after-replay nets 0 per currency", async () => {
    // an online sale before the outage
    use(server);
    const s0 = runWithTenant(1, () =>
      getSalesService().processSale(SALE({ client_id: null, payment_usd: 15, payments: [{ method: "CASH", currency_code: "USD", amount: 15 }] }) as never, 1),
    ) as { success: boolean; id: number };
    expect(s0.success).toBe(true);
    const s0Tx = (server.prepare(`SELECT id FROM transactions WHERE source_table = 'sales' AND source_id = ?`).get(s0.id) as { id: number }).id;

    // the PC's working copy
    pc = new Database(server.serialize());
    seedPcRange(pc);
    resetAll();

    const e1 = onPc("clients:create", { full_name: "Rami", phone_number: "70123456", whatsapp_opt_in: 1 });
    const pcClient = e1.created.clients[0];
    expect(isOfflineId(pcClient)).toBe(true);
    const e2 = onPc("sales:process", SALE({ client_id: pcClient, payments: [{ method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 15 }] }));
    const pcSale = e2.created.sales[0];
    onPc("debt:add-repayment", {
      clientId: pcClient,
      amountUSD: 15,
      payments: [{ method: "CASH", currencyCode: "USD", amount: 15 }],
      targets: [{ kind: "sale", id: pcSale }],
    });
    onPc("transactions:refund", { transactionId: s0Tx });
    expect(recorded[1].dependsOn).toEqual([e1.eventId]);
    if (process.env.US1_DUMP) process.stdout.write("US1CREATED " + JSON.stringify(recorded.map((r) => [r.channel, Object.fromEntries(Object.entries(r.created).map(([t, ids]) => [t, ids.length]))])) + "\n");

    // replay on the server
    const outs = await replayAll();
    expect(outs.map((o) => o.status)).toEqual(["booked", "booked", "booked", "booked"]);
    runWithTenant(1, () => {
      expect(new OfflineReviewRepository().list({ state: "open" }).map((i) => i.kind)).toEqual([]);
    });
    const map = new OfflineIdMapRepository();
    const client = runWithTenant(1, () => map.lookup(pcClient))!;
    const sale = runWithTenant(1, () => map.lookup(pcSale))!;
    expect(client).toBeLessThan(1e12);
    expect(sale).toBeLessThan(1e12);
    expect(server.prepare(`SELECT full_name FROM clients WHERE id = ?`).get(client)).toEqual({ full_name: "Rami" });
    expect(server.prepare(`SELECT client_id FROM sales WHERE id = ?`).get(sale)).toEqual({ client_id: client });
    const repayTx = server
      .prepare(`SELECT id, client_id FROM transactions WHERE type = 'DEBT_REPAYMENT'`)
      .get() as { id: number; client_id: number };
    expect(repayTx.client_id).toBe(client);
    // the ticked sale is the server sale and it is now paid
    expect((server.prepare(`SELECT ROUND(paid_usd, 2) AS p FROM sales WHERE id = ?`).get(sale) as { p: number }).p).toBe(15);
    expect(server.prepare(`SELECT COUNT(*) AS n FROM transactions WHERE type = 'REFUND' AND reverses_id = ?`).get(s0Tx)).toEqual({ n: 1 });
    // no PC id leaked into a server row
    expect(server.prepare(`SELECT COUNT(*) AS n FROM sales WHERE client_id >= 1000000000000`).get()).toEqual({ n: 0 });

    // void-after-replay nets 0 per currency (rule 20)
    const beforeRepay = (() => {
      const b = balances(server, client);
      return b;
    })();
    runWithTenant(1, () => getTransactionService().voidTransaction(repayTx.id, 1));
    const afterVoid = balances(server, client);
    expect(afterVoid.debt).toEqual({ usd: 15, lbp: 0 });
    // the cash the repayment put in the drawer is gone again
    const usdDrawer = (rows: unknown) =>
      (rows as Array<{ drawer_name: string; currency_code: string; b: number }>).find(
        (r) => r.drawer_name === "General" && r.currency_code === "USD",
      )?.b ?? 0;
    expect(usdDrawer(beforeRepay.drawers) - usdDrawer(afterVoid.drawers)).toBeCloseTo(15);
  });
});
