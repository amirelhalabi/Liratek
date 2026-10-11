/**
 * LIRA-306 T051 — the two-PC outage of plan §C, end to end through the merge
 * processor (US2, SC-001, SC-004).
 *
 *  10:00 both PCs hold copy c1 · 10:05 the shop's internet dies
 *  PC 1: e1 new client Rami (10:10) · e2 sale on account to Rami (10:12) ·
 *        e3 OMT send ref OM-7731 (10:15) · e4 repay Rami ticking e2 (10:20)
 *  PC 2: e1 $40 cash sale (10:10) · e2 OMT send ref OM-7731 (10:12) ·
 *        e3 drawer count (10:20)
 *  online: S#880 a $25 sale (10:06) · S#881 the same $40 sale typed on the web (10:12)
 *  PC 1 reconnects first (one round), PC 2 later (another round).
 *
 * Expected: every PC 1 event booked; PC 2 e1 HELD (likely duplicate of
 * S#881), e2 SKIPPED (certain duplicate of PC 1's e3), e3 HELD (drawer
 * count, N8); the review list shows exactly those three; money per currency
 * equals the booked actions only (the same actions done online on a second
 * database).
 */
import Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { OfflineMergeProcessor } from "../../services/OfflineMergeProcessor";
import { OfflineEventRepository } from "../../repositories/OfflineEventRepository";
import { OfflineReviewRepository } from "../../repositories/OfflineReviewRepository";
import { OfflineIdMapRepository } from "../../repositories/OfflineIdMapRepository";
import { RowCaptureRepository } from "../../repositories/RowCaptureRepository";
import { addDevice, insertCopy, installReplayDb, storeEvent, uninstallReplayDb, resetSeq } from "../testHelpers/replayHarness";
import { DUP_SEED_SQL, OMT_SEND, SALE, bookOnline } from "../testHelpers/dupHarness";
import { PcCopy, useDb } from "../testHelpers/pcCopy";
import { moneyState } from "../testHelpers/parity";

let server: Database.Database;
let reference: Database.Database;
let pc1Id = 0;
let pc2Id = 0;
const copies: PcCopy[] = [];

const S880 = SALE({ items: [{ product_id: 34, quantity: 1, price: 25 }], total_amount: 25, final_amount: 25, payment_usd: 25, payments: [{ method: "CASH", currency_code: "USD", amount: 25 }] });
const S40 = SALE();
const RAMI = { full_name: "Rami", phone_number: "70123456", whatsapp_opt_in: 0 };
const ON_ACCOUNT = (clientId: number) =>
  SALE({ client_id: clientId, items: [{ product_id: 34, quantity: 3, price: 10 }], total_amount: 30, final_amount: 30, payment_usd: 0, payments: [{ method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 30 }] });
const REPAY = (clientId: number, saleId: number) => ({
  clientId,
  amountUSD: 30,
  payments: [{ method: "CASH", currencyCode: "USD", amount: 30 }],
  targets: [{ kind: "sale", id: saleId }],
});
const DRAWER_COUNT = {
  drawer_name: "General",
  closing_date: "2026-10-10",
  notes: "counted offline",
  amounts: [{ drawer_name: "General", currency_code: "USD", expected_amount: 100, physical_amount: 95 }],
};

beforeEach(() => {
  resetSeq();
  ({ db: server, deviceId: pc1Id } = installReplayDb());
  pc2Id = addDevice(2);
  server.exec(DUP_SEED_SQL);
  insertCopy("2026-10-10T10:00:00.000Z", runWithTenant(1, () => new RowCaptureRepository().highWaterMarks()));
});
afterEach(() => {
  copies.splice(0).forEach((c) => c.close());
  reference?.close();
  uninstallReplayDb(server);
});

function upload(deviceId: number, pc: PcCopy, actorFor: (channel: string) => number = () => 2): void {
  useDb(server);
  pc.recorded.forEach((r, i) =>
    storeEvent({
      deviceId,
      channel: r.channel,
      payload: r.payload,
      created: r.created,
      dependsOn: r.dependsOn,
      eventId: r.eventId,
      seq: i + 1,
      occurredAt: r.occurredAt,
      clientDay: "2026-10-10",
      actorUserId: actorFor(r.channel),
    }),
  );
}
const round = () => new OfflineMergeProcessor().runRound(1);
const statusOf = (eventId: string) => runWithTenant(1, () => new OfflineEventRepository().findByEventId(eventId)!.status);

describe("two PCs offline at once (plan §C)", () => {
  it("books PC 1, holds/skips PC 2's duplicates and drawer count; money = booked actions only", async () => {
    const pc1 = new PcCopy(server, 1, "11111111-0000-4000-8000-");
    const pc2 = new PcCopy(server, 2, "22222222-0000-4000-8000-");
    copies.push(pc1, pc2);

    // online during the outage
    bookOnline("sales:process", S880, "2026-10-10T10:06:00.000Z");
    bookOnline("sales:process", S40, "2026-10-10T10:12:00.000Z");

    // PC 1
    const p1e1 = pc1.act("clients:create", RAMI, "2026-10-10T10:10:00.000Z");
    const rami = p1e1.created.clients[0];
    const p1e2 = pc1.act("sales:process", ON_ACCOUNT(rami), "2026-10-10T10:12:00.000Z");
    pc1.act("omt:add-transaction", OMT_SEND(), "2026-10-10T10:15:00.000Z");
    pc1.act("debt:add-repayment", REPAY(rami, p1e2.created.sales[0]), "2026-10-10T10:20:00.000Z");
    // PC 2
    pc2.act("sales:process", S40, "2026-10-10T10:10:00.000Z");
    pc2.act("omt:add-transaction", OMT_SEND(), "2026-10-10T10:12:00.000Z");
    pc2.recorded.push({ channel: "closing:create-checkpoint", payload: DRAWER_COUNT, created: {}, eventId: "22222222-0000-4000-8000-000000000003", dependsOn: [], occurredAt: "2026-10-10T10:20:00.000Z", actorUserId: 1 });

    // 10:40 PC 1 reconnects
    upload(pc1Id, pc1);
    await round();
    expect(pc1.recorded.map((r) => statusOf(r.eventId))).toEqual(["booked", "booked", "booked", "booked"]);
    expect(runWithTenant(1, () => new OfflineReviewRepository().list({ state: "open" }))).toEqual([]);
    const serverRami = runWithTenant(1, () => new OfflineIdMapRepository().lookup(rami))!;
    const serverSale = runWithTenant(1, () => new OfflineIdMapRepository().lookup(p1e2.created.sales[0]))!;
    expect(server.prepare(`SELECT client_id, ROUND(paid_usd, 2) AS paid FROM sales WHERE id = ?`).get(serverSale)).toEqual({ client_id: serverRami, paid: 30 });

    // 11:30 PC 2 reconnects
    upload(pc2Id, pc2, (ch) => (ch === "closing:create-checkpoint" ? 1 : 2));
    await round();
    expect(pc2.recorded.map((r) => statusOf(r.eventId))).toEqual(["held", "skipped", "held"]);
    const open = runWithTenant(1, () => new OfflineReviewRepository().list({ state: "open" }).map((i) => i.kind).sort());
    expect(open).toEqual(["certain_duplicate", "held_checkpoint", "possible_duplicate"]);

    // money = the booked actions only, done online on a second database
    const server2 = server;
    ({ db: reference } = installReplayDb());
    reference.exec(DUP_SEED_SQL);
    // (same booking order as on the server: the web sales were booked during
    // the outage, PC 1's work when it reconnected)
    bookOnline("sales:process", S880, "2026-10-10T10:06:00.000Z");
    bookOnline("sales:process", S40, "2026-10-10T10:12:00.000Z");
    const c = bookOnline("clients:create", RAMI, "2026-10-10T10:10:00.000Z", 2).result.id as number;
    const s = bookOnline("sales:process", ON_ACCOUNT(c), "2026-10-10T10:12:00.000Z", 2).result.id as number;
    bookOnline("omt:add-transaction", OMT_SEND(), "2026-10-10T10:15:00.000Z", 2);
    bookOnline("debt:add-repayment", REPAY(c, s), "2026-10-10T10:20:00.000Z", 2);
    expect(moneyState(server2)).toEqual(moneyState(reference));
    useDb(server2);
  });
});
