/**
 * LIRA-306 T033 — ReplayEngine: one event = one transaction that books
 * through a binding (FR-016, FR-018–FR-021a).
 *
 * Bindings here are test doubles registered for the real channel
 * `sales:update-metadata` (its core schema `{ id, note?, client_name?,
 * client_phone? }`), so policy, schema and shape checks are the real ones.
 */
import type Database from "better-sqlite3";
import { runWithTenant, getContextClientDay, getContextClientTzOffsetMinutes, getContextEffectiveNow, getContextEffectiveRates } from "../../db/tenantContext";
import { getDatabase } from "../../db/connection";
import { requestNow } from "../../utils/requestNow";
import { OfflineEventRepository } from "../../repositories/OfflineEventRepository";
import { OfflineIdMapRepository } from "../../repositories/OfflineIdMapRepository";
import { OfflineReviewRepository } from "../../repositories/OfflineReviewRepository";
import { ReplayEngine } from "../ReplayEngine";
import type { OfflineBinding } from "../bindings/types";
import { installReplayDb, uninstallReplayDb, storeEvent, resetSeq } from "../testHelpers/replayHarness";

const CH = "sales:update-metadata";
const C1 = 1_017_000_000_001; // PC 1, clients #1
const C2 = 1_017_000_000_002;

let db: Database.Database;
let deviceId = 0;
let binding: OfflineBinding;
const engine = () => new ReplayEngine({ bindings: (c) => (c === CH ? binding : undefined) });
const events = new OfflineEventRepository();
const idMap = new OfflineIdMapRepository();
const reviews = new OfflineReviewRepository();

function clients(): number {
  return (db.prepare(`SELECT COUNT(*) AS n FROM clients`).get() as { n: number }).n;
}
function addClientBinding(names: string[] = ["Rami"]): OfflineBinding {
  return {
    channel: CH,
    run: (payload, ctx) => {
      const ids = names.map((n) =>
        Number(
          getDatabase()
            .prepare(`INSERT INTO clients (tenant_id, full_name, notes, created_at) VALUES (1, ?, ?, ?)`)
            .run(n, `by ${ctx.actorUserId} for sale ${String(payload.id)}`, requestNow()).lastInsertRowid,
        ),
      );
      return { success: true, ids };
    },
  };
}
const ev = (over: Partial<Parameters<typeof storeEvent>[0]> = {}) =>
  storeEvent({ deviceId, channel: CH, payload: { id: 5, note: "n" }, ...over });
const reload = (id: number) => runWithTenant(1, () => events.findById(id)!);
const process = (row: ReturnType<typeof ev>, e = engine()) => runWithTenant(1, () => e.process(row, { mode: "auto" }));

beforeEach(() => {
  ({ db, deviceId } = installReplayDb());
  resetSeq();
  binding = addClientBinding();
});
afterEach(() => uninstallReplayDb(db));

describe("ReplayEngine", () => {
  it("books through the binding, maps created rows per table in order, stores the outcome", async () => {
    binding = addClientBinding(["A", "B"]);
    const row = ev({ created: { clients: [C1, C2] } });
    const out = await process(row);
    expect(out.status).toBe("booked");
    const ids = (db.prepare(`SELECT id FROM clients ORDER BY id`).all() as Array<{ id: number }>).map((r) => r.id);
    runWithTenant(1, () => {
      expect(idMap.lookup(C1)).toBe(ids[0]);
      expect(idMap.lookup(C2)).toBe(ids[1]);
      expect(reload(row.id)).toMatchObject({ status: "booked" });
      expect(JSON.parse(reload(row.id).result_json!).serverIds.clients).toEqual(ids);
    });
  });

  it("a throw after the service call books nothing, leaves the event received, attempts+1; refused after 5", async () => {
    const e = new ReplayEngine({
      bindings: () => binding,
      duplicateHook: () => {
        throw new Error("disk hiccup");
      },
    });
    const row = ev({ created: { clients: [C1] } });
    for (let i = 1; i <= 4; i++) {
      const out = await process(reload(row.id), e);
      expect(out).toMatchObject({ status: "received", technical: true });
      expect(clients()).toBe(0);
      expect(reload(row.id).attempts).toBe(i);
    }
    const last = await process(reload(row.id), e);
    expect(last.status).toBe("refused");
    expect(reload(row.id)).toMatchObject({ status: "refused", attempts: 5 });
    expect(clients()).toBe(0);
    runWithTenant(1, () => expect(reviews.list({ kind: "refused" })).toHaveLength(1));
  });

  it("no-yield guard: a binding that awaits a macrotask is rolled back as a technical failure", async () => {
    binding = {
      channel: CH,
      run: async () => {
        getDatabase().prepare(`INSERT INTO clients (tenant_id, full_name) VALUES (1, 'X')`).run();
        await new Promise((r) => setImmediate(r));
        return { success: true };
      },
    };
    const out = await process(ev());
    expect(out).toMatchObject({ status: "received", technical: true });
    expect(out.error).toMatch(/yield/i);
    expect(clients()).toBe(0);
  });

  it("a business refusal is stored with the service's message and nothing is booked", async () => {
    binding = {
      channel: CH,
      run: () => {
        getDatabase().prepare(`INSERT INTO clients (tenant_id, full_name) VALUES (1, 'X')`).run();
        throw new Error("Sale already refunded");
      },
    };
    const row = ev();
    const out = await process(row);
    expect(out).toMatchObject({ status: "refused", error: "Sale already refunded" });
    expect(clients()).toBe(0);
    expect(reload(row.id)).toMatchObject({ status: "refused", error: "Sale already refunded" });
    runWithTenant(1, () => expect(reviews.list({ kind: "refused" })).toHaveLength(1));
  });

  it("a {success:false} result is a refusal too", async () => {
    binding = { channel: CH, run: () => ({ success: false, error: "Not enough stock" }) };
    expect(await process(ev())).toMatchObject({ status: "refused", error: "Not enough stock" });
  });

  it("rewrites offline ids before the binding runs", async () => {
    runWithTenant(1, () => idMap.insert({ offlineId: 1_023_000_000_007, deviceId, tableName: "sales", serverId: 77, eventId: "e0" }));
    let seen: Record<string, unknown> = {};
    binding = { channel: CH, run: (p) => ((seen = p), { success: true }) };
    await process(ev({ payload: { id: 1_023_000_000_007, note: "x" } }));
    expect(seen.id).toBe(77);
  });

  it("an offline id with no map entry holds the event as waiting", async () => {
    const row = ev({ payload: { id: 1_023_000_000_008 } });
    const out = await process(row);
    expect(out.status).toBe("held");
    expect(reload(row.id).error).toMatch(/not booked/i);
    runWithTenant(1, () => expect(reviews.list({ kind: "waiting" })).toHaveLength(1));
  });

  it("a per-table count mismatch leaves those rows unmapped with a came_out_differently note", async () => {
    binding = addClientBinding(["A", "B"]);
    const out = await process(ev({ created: { clients: [C1] } }));
    expect(out.status).toBe("booked");
    runWithTenant(1, () => {
      expect(idMap.lookup(C1)).toBeUndefined();
      expect(reviews.list({ kind: "came_out_differently" })).toHaveLength(1);
    });
  });

  it("an incompatible schema shape is refused as another app version, content kept, no Apply", async () => {
    const row = ev({ schemaShape: { type: "object", keys: { saleId: { type: "number" } } } });
    const out = await process(row);
    expect(out.status).toBe("refused");
    expect(reload(row.id).error).toMatch(/different app version/i);
    runWithTenant(1, () => {
      const item = reviews.list({ kind: "refused" })[0];
      expect(JSON.parse(item.details_json)).toMatchObject({ noApply: true, payload: { id: 5, note: "n" } });
    });
    expect(clients()).toBe(0);
  });

  it("a payload the schema rejects is refused likewise", async () => {
    const row = ev({ payload: { id: "five" } });
    expect((await process(row)).status).toBe("refused");
    expect(reload(row.id).error).toMatch(/different app version/i);
  });

  it("books with the actor passed in, and writes the audit row with that actor", async () => {
    await process(ev({ actorUserId: 2 }));
    expect((db.prepare(`SELECT notes FROM clients`).get() as { notes: string }).notes).toBe("by 2 for sale 5");
    const audit = db.prepare(`SELECT user_id, username FROM audit_log ORDER BY id DESC LIMIT 1`).get() as {
      user_id: number;
      username: string;
    };
    expect(audit).toEqual({ user_id: 2, username: "cashier" });
  });

  it("an actor who is not a user of the shop is refused", async () => {
    const out = await process(ev({ actorUserId: 999 }));
    expect(out.status).toBe("refused");
  });

  it("the context carries the event's day, offset, effective now and recorded rates", async () => {
    let ctx: unknown[] = [];
    binding = {
      channel: CH,
      run: () => {
        ctx = [getContextClientDay(), getContextClientTzOffsetMinutes(), getContextEffectiveNow(), getContextEffectiveRates(), requestNow()];
        return { success: true };
      },
    };
    await process(ev({ occurredAt: "2026-10-10T20:50:00.000Z", clientDay: "2026-10-10", clientTzOffsetMinutes: 180 }));
    expect(ctx).toEqual([
      "2026-10-10",
      180,
      "2026-10-10T20:50:00.000Z",
      [{ to_code: "LBP", market_rate: 89750, buy_rate: 89500, sell_rate: 90000, is_stronger: 1 }],
      "2026-10-10 20:50:00",
    ]);
  });

  it("a service's own db.transaction() nests as a savepoint inside the replay transaction", async () => {
    binding = {
      channel: CH,
      run: () => {
        getDatabase().transaction(() => {
          getDatabase().prepare(`INSERT INTO clients (tenant_id, full_name) VALUES (1, 'Inner')`).run();
        })();
        return { success: true };
      },
    };
    const e = new ReplayEngine({
      bindings: () => binding,
      duplicateHook: () => {
        throw new Error("after the inner transaction");
      },
    });
    await process(ev(), e);
    expect(clients()).toBe(0); // the inner commit was only a savepoint release
  });

  it("a stored outcome is returned again for an already processed event (no re-booking)", async () => {
    const row = ev();
    await process(row);
    const again = await process(reload(row.id));
    expect(again.status).toBe("booked");
    expect(clients()).toBe(1);
  });
});

describe("ReplayEngine — an unexpected error before booking", () => {
  it("is a technical failure of that event (attempts+1), never a thrown round", async () => {
    ({ db, deviceId } = { db, deviceId });
    const row = storeEvent({ deviceId, channel: CH, payload: { id: 5 } });
    const e = new ReplayEngine({
      bindings: () => binding,
      actorHook: () => {
        throw new Error("users table unreachable");
      },
    });
    const out = await runWithTenant(1, () => e.process(row, { mode: "auto" }));
    expect(out).toMatchObject({ status: "received", technical: true, error: "users table unreachable" });
    expect(runWithTenant(1, () => events.findById(row.id)!.attempts)).toBe(1);
  });
});
