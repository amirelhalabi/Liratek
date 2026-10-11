/**
 * LIRA-306 T057 — duplicate classification (FR-025–FR-027, SC-004, N7).
 *
 * Pure rules (table-driven): certain = same non-empty OMT/Whish reference, or
 * the same recharge carrier + phone + amount within 10 minutes; likely =
 * every N7 field equal within ±5 minutes, ignoring the user and the seconds;
 * a near-miss on any field → none (booked).
 *
 * Wiring (real engine, real rows): candidates are rows above the copy's
 * high-water mark — online rows and other PCs' rows — minus every row THIS
 * PC's booked events created; the window is applied after clock correction.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { classifyDuplicate } from "../DuplicateDetector";
import type { DuplicateFingerprint } from "../../repositories/DuplicateFingerprintRepository";
import { ReplayEngine } from "../../offline/ReplayEngine";
import { OfflineReviewRepository } from "../../repositories/OfflineReviewRepository";
import { OfflineEventRepository } from "../../repositories/OfflineEventRepository";
import { RowCaptureRepository } from "../../repositories/RowCaptureRepository";
import { addDevice, insertCopy, installReplayDb, storeEvent, uninstallReplayDb, resetSeq } from "../../offline/testHelpers/replayHarness";
import { DUP_SEED_SQL, OMT_SEND, RECHARGE, SALE, bookOnline } from "../../offline/testHelpers/dupHarness";

const fp = (over: Partial<DuplicateFingerprint> & { fields?: Record<string, unknown> } = {}): DuplicateFingerprint => ({
  transactionId: 1,
  family: "sale",
  sourceTable: "sales",
  sourceId: 1,
  at: "2026-10-10 10:10:30",
  userId: 2,
  reference: null,
  recharge: null,
  ...over,
  fields: {
    type: "SALE",
    amountUsd: 40,
    amountLbp: 0,
    client: null,
    legs: [["CASH", "USD", 40]],
    items: [[33, 1, 40]],
    ...(over.fields ?? {}),
  },
});

describe("classifyDuplicate — pure rules", () => {
  it.each([
    ["same fields, 4 min apart, other user → likely", fp(), [fp({ transactionId: 9, at: "2026-10-10 10:14:59", userId: 1 })], "likely"],
    ["same fields, exactly 5 min apart ignoring seconds → likely", fp({ at: "2026-10-10 10:10:59" }), [fp({ transactionId: 9, at: "2026-10-10 10:15:01" })], "likely"],
    ["same fields, 6 min apart → none", fp(), [fp({ transactionId: 9, at: "2026-10-10 10:16:31" })], "none"],
    ["amount differs → none", fp(), [fp({ transactionId: 9, fields: { amountUsd: 41 } })], "none"],
    ["a leg differs → none", fp(), [fp({ transactionId: 9, fields: { legs: [["CASH", "LBP", 3600000]] } })], "none"],
    ["an item differs → none", fp(), [fp({ transactionId: 9, fields: { items: [[33, 2, 20]] } })], "none"],
    ["client differs → none", fp(), [fp({ transactionId: 9, fields: { client: "client:5" } })], "none"],
    ["other family → none", fp(), [fp({ transactionId: 9, family: "expense" })], "none"],
  ])("%s", (_t, event, cands, expected) => {
    expect(classifyDuplicate(event, cands).outcome).toBe(expected);
  });

  const transfer = (over: Partial<DuplicateFingerprint> = {}) =>
    fp({ family: "transfer", sourceTable: "financial_services", reference: "OM-7731", fields: { type: "FINANCIAL_SERVICE" }, ...over });
  it("same non-empty reference → certain, whatever the time and amount", () => {
    const r = classifyDuplicate(transfer(), [transfer({ transactionId: 9, at: "2026-10-10 12:00:00", fields: { amountUsd: 999 } })]);
    expect(r.outcome).toBe("certain");
    expect(r.match?.transactionId).toBe(9);
  });
  it("empty reference never makes a certain duplicate", () => {
    expect(classifyDuplicate(transfer({ reference: "" }), [transfer({ transactionId: 9, reference: "", at: "2026-10-10 12:00:00" })]).outcome).toBe("none");
  });

  const recharge = (over: Partial<DuplicateFingerprint> = {}) =>
    fp({ family: "recharge", sourceTable: "recharges", recharge: { carrier: "alfa", phone: "71006010", amount: 10 }, fields: { type: "RECHARGE", amountUsd: 11 }, ...over });
  it("recharge carrier + phone + amount within 10 min → certain; 10:01 apart → not certain", () => {
    expect(classifyDuplicate(recharge({ at: "2026-10-10 10:00:00" }), [recharge({ transactionId: 9, at: "2026-10-10 10:10:00", fields: { amountUsd: 12 } })]).outcome).toBe("certain");
    expect(classifyDuplicate(recharge({ at: "2026-10-10 10:00:00" }), [recharge({ transactionId: 9, at: "2026-10-10 10:10:01", fields: { amountUsd: 12 } })]).outcome).toBe("none");
  });
  it("certain beats likely", () => {
    const r = classifyDuplicate(recharge(), [recharge({ transactionId: 8 }), recharge({ transactionId: 9 })]);
    expect(r.outcome).toBe("certain");
  });
});

// ---------------------------------------------------------------------------

let db: Database.Database;
let pc1 = 0;
let pc2 = 0;
let n = 0;
beforeEach(() => {
  resetSeq();
  n = 0;
  ({ db, deviceId: pc1 } = installReplayDb());
  pc2 = addDevice(2);
  db.exec(DUP_SEED_SQL);
  // the copy both PCs work on: built 10:00, high-water = today's sequences
  insertCopy("2026-10-10T10:00:00.000Z", runWithTenant(1, () => new RowCaptureRepository().highWaterMarks()));
});
afterEach(() => uninstallReplayDb(db));

const replay = (deviceId: number, channel: string, payload: Record<string, unknown>, occurredAt: string, correctedAt: string | null = null) => {
  const row = storeEvent({
    deviceId,
    channel,
    payload,
    seq: ++n,
    eventId: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    occurredAt,
    clientDay: "2026-10-10",
    correctedAt,
  });
  return runWithTenant(1, () => new ReplayEngine().process(row, { mode: "auto" }));
};
const openKinds = () => runWithTenant(1, () => new OfflineReviewRepository().list({ state: "open" }).map((i) => i.kind));
const count = (sql: string) => (db.prepare(sql).get() as { c: number }).c;

describe("DuplicateDetector wired into the replay", () => {
  it("an online sale 2 min away → the replayed sale is HELD (possible duplicate), nothing booked", async () => {
    bookOnline("sales:process", SALE(), "2026-10-10T10:12:00.000Z");
    const out = await replay(pc1, "sales:process", SALE(), "2026-10-10T10:10:00.000Z");
    expect(out.status).toBe("held");
    expect(openKinds()).toEqual(["possible_duplicate"]);
    expect(count(`SELECT COUNT(*) AS c FROM sales`)).toBe(1);
  });

  it("another PC's replayed row counts; this PC's own earlier row does not", async () => {
    expect((await replay(pc1, "sales:process", SALE(), "2026-10-10T10:10:00.000Z")).status).toBe("booked");
    // the same PC rings the same sale again 1 min later → booked (its own row is excluded)
    expect((await replay(pc1, "sales:process", SALE(), "2026-10-10T10:11:00.000Z")).status).toBe("booked");
    // PC 2 rang it too → held
    expect((await replay(pc2, "sales:process", SALE(), "2026-10-10T10:12:00.000Z")).status).toBe("held");
  });

  it("rows below the copy's high-water mark (before the outage) are not candidates", async () => {
    // an online sale BEFORE the copy was built … then a fresh copy whose high-water includes it
    bookOnline("sales:process", SALE(), "2026-10-10T10:12:00.000Z");
    db.prepare(`DELETE FROM offline_snapshots`).run();
    insertCopy("2026-10-10T10:00:00.000Z", runWithTenant(1, () => new RowCaptureRepository().highWaterMarks()));
    expect((await replay(pc1, "sales:process", SALE(), "2026-10-10T10:10:00.000Z")).status).toBe("booked");
  });

  it("the window is applied after clock correction", async () => {
    bookOnline("sales:process", SALE(), "2026-10-10T10:30:00.000Z");
    // recorded 10:10 by a PC 20 min slow → really 10:30
    expect((await replay(pc1, "sales:process", SALE(), "2026-10-10T10:10:00.000Z", "2026-10-10T10:30:00.000Z")).status).toBe("held");
  });

  it("same OMT reference already booked online → SKIPPED with a certain-duplicate note, no money moved", async () => {
    bookOnline("omt:add-transaction", OMT_SEND(), "2026-10-10T10:06:00.000Z");
    const before = count(`SELECT COUNT(*) AS c FROM payments`);
    const out = await replay(pc1, "omt:add-transaction", OMT_SEND({ amount: 100 }), "2026-10-10T10:40:00.000Z");
    expect(out.status).toBe("skipped");
    expect(openKinds()).toEqual(["certain_duplicate"]);
    expect(count(`SELECT COUNT(*) AS c FROM payments`)).toBe(before);
    expect(count(`SELECT COUNT(*) AS c FROM offline_id_map`)).toBe(0);
  });

  it("recharge same carrier/phone/amount 9 min apart → skipped; a near-miss phone → booked", async () => {
    bookOnline("recharge:process", RECHARGE(), "2026-10-10T10:01:00.000Z");
    expect((await replay(pc1, "recharge:process", RECHARGE(), "2026-10-10T10:10:00.000Z")).status).toBe("skipped");
    expect((await replay(pc1, "recharge:process", RECHARGE({ phoneNumber: "71006011" }), "2026-10-10T10:10:00.000Z")).status).toBe("booked");
  });

  it("Apply on a held duplicate books it once (the duplicate check is bypassed)", async () => {
    bookOnline("sales:process", SALE(), "2026-10-10T10:12:00.000Z");
    const row = storeEvent({ deviceId: pc1, channel: "sales:process", payload: SALE(), seq: 1, eventId: "00000000-0000-4000-8000-000000000777", occurredAt: "2026-10-10T10:10:00.000Z" });
    await runWithTenant(1, () => new ReplayEngine().process(row, { mode: "auto" }));
    const applied = await runWithTenant(1, () =>
      new ReplayEngine().process(new OfflineEventRepository().findById(row.id)!, { mode: "apply", bypass: { duplicate: true } }),
    );
    expect(applied.status).toBe("applied");
    expect(count(`SELECT COUNT(*) AS c FROM sales`)).toBe(2);
  });
});
