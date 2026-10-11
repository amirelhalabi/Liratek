/**
 * LIRA-306 T131 — uploading the PC's events (FR-015, FR-001a;
 * contracts/rest-offline.md POST /events, GET /events/status). Fake server,
 * REAL outbox (core OfflineOutboxRepository on a real working copy).
 *
 * Bodies are checked against the core `uploadEventsSchema` (rule 24).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import {
  getOfflineOutboxRepository,
  initFixedTenantContext,
  uploadEventsSchema,
} from "@liratek/core";
import { PairingStore, type SafeStorageLike } from "../pairingStore";
import { OfflineSender } from "../sender";
import type { FetchLike, FetchResponseLike } from "../syncClient";

const SCHEMA = fs.readFileSync(
  path.join(__dirname, "../../create_db.sql"),
  "utf8",
);
const safe: SafeStorageLike = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from(`enc:${s}`),
  decryptString: (b) => b.toString().slice(4),
};
const KEY1 = `ltd_7_abcdef012345_${"a".repeat(64)}`;
const KEY2 = `ltd_7_0123456789ab_${"b".repeat(64)}`;
const COPY = "c0000000-0000-4000-8000-000000000001";

let dir = "";
let db: Database.Database;
let store: PairingStore;

const eid = (n: number) =>
  `e0000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function addEvents(n: number, startSeq = 1): void {
  const repo = getOfflineOutboxRepository();
  for (let i = 0; i < n; i++) {
    repo.append({
      eventId: eid(startSeq + i),
      seq: startSeq + i,
      channel: "clients:create",
      payloadJson: JSON.stringify({
        full_name: `C${i}`,
        phone_number: "1",
        whatsapp_opt_in: 0,
      }),
      payloadHash: "h".repeat(64),
      actorUserId: 20,
      occurredAt: "2026-10-11T10:10:00.000Z",
      clientDay: "2026-10-11",
      clientTzOffsetMinutes: 180,
      copyId: COPY,
      appVersion: "1.2.3",
      schemaVersion: 210,
      schemaShapeJson: JSON.stringify({ type: "object" }),
      ratesJson: JSON.stringify({
        LBP: { sell: 90000, buy: 89000, market: 89500, direction: 1 },
      }),
      createdJson: "{}",
      dependsOnJson: "[]",
    });
  }
}

function rows(): Array<{
  event_id: string;
  device_seq: number;
  delivery: string;
  server_status: string | null;
}> {
  return db
    .prepare(
      `SELECT event_id, device_seq, delivery, server_status FROM offline_outbox ORDER BY device_seq`,
    )
    .all() as Array<{
    event_id: string;
    device_seq: number;
    delivery: string;
    server_status: string | null;
  }>;
}

function res(body: unknown): FetchResponseLike {
  return {
    ok: true,
    status: 200,
    headers: { get: () => "application/json" },
    json: async () => body,
    arrayBuffer: async () => new ArrayBuffer(0),
  };
}

interface FakeServer {
  fetch: FetchLike;
  uploads: Array<{ key: string; seqs: number[] }>;
  stored: Map<string, { seq: number; status: string }>;
}

/** Stores by event id (idempotent), acks every stored event, answers status from its store. */
function server(
  opts: {
    reject?: Record<string, string>;
    failNextUpload?: "network" | "after-store";
    envelope?: Record<string, unknown>;
  } = {},
): FakeServer {
  const uploads: FakeServer["uploads"] = [];
  const stored = new Map<string, { seq: number; status: string }>();
  let fail = opts.failNextUpload;
  return {
    uploads,
    stored,
    fetch: async (url, init) => {
      if (url.includes("/api/offline/events/status")) {
        const from = Number(new URL(url).searchParams.get("fromSeq") ?? 0);
        return res({
          success: true,
          data: {
            outcomes: [...stored.entries()]
              .filter(([, v]) => v.seq >= from)
              .map(([eventId, v]) => ({
                eventId,
                seq: v.seq,
                status: v.status,
                error: null,
                serverIds: null,
              })),
          },
        });
      }
      const body = JSON.parse(String(init?.body));
      expect(uploadEventsSchema.safeParse(body).success).toBe(true);
      const key = String(init?.headers?.["X-LiraTek-Device-Key"]);
      uploads.push({
        key,
        seqs: body.events.map((e: { seq: number }) => e.seq),
      });
      if (fail === "network") {
        fail = undefined;
        throw new Error("ECONNRESET");
      }
      if (opts.envelope) return res(opts.envelope);
      const acked: string[] = [];
      const rejected: Array<{ eventId: string; code: string; error: string }> =
        [];
      for (const e of body.events as Array<{ eventId: string; seq: number }>) {
        const code = opts.reject?.[e.eventId];
        if (code) {
          rejected.push({ eventId: e.eventId, code, error: code });
          continue;
        }
        if (!stored.has(e.eventId))
          stored.set(e.eventId, { seq: e.seq, status: "received" });
        acked.push(e.eventId);
      }
      if (fail === "after-store") {
        fail = undefined;
        throw new Error("response lost");
      }
      return res({ success: true, data: { acked, rejected } });
    },
  };
}

function sender(fetchImpl: FetchLike): OfflineSender {
  return new OfflineSender({
    store,
    fetch: fetchImpl,
    now: () => Date.parse("2026-10-11T11:00:00.000Z"),
    appVersion: "1.2.3",
    schemaVersion: 210,
    outbox: getOfflineOutboxRepository(),
    exclusive: async (fn) => fn(),
  });
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "lira306-send-"));
  db = new Database(path.join(dir, "offline-work.db"));
  db.exec(SCHEMA);
  db.exec(
    `INSERT OR IGNORE INTO tenants (id, name, slug, status) VALUES (7, 'Corner Tech', 'cornertech', 'active')`,
  );
  (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
  initFixedTenantContext(7);
  store = new PairingStore(dir, { safeStorage: safe });
  store.savePairing(
    {
      tenantId: 7,
      shopSlug: "c",
      shopName: "C",
      serverUrl: "https://api.test",
      deviceNo: 3,
      serverSchemaVersion: 210,
    },
    KEY1,
  );
});
afterEach(() => {
  delete (globalThis as unknown as Record<string, unknown>).__LIRATEK_TEST_DB__;
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("OfflineSender", () => {
  it("uploads waiting events in seq order, in batches of at most 100, then records the server's outcomes", async () => {
    addEvents(230);
    const s = server();
    const r = await sender(s.fetch).sendWaiting();
    expect(r).toEqual({ sent: 230, waiting: 0 });
    expect(s.uploads.map((u) => u.seqs.length)).toEqual([100, 100, 30]);
    expect(s.uploads.flatMap((u) => u.seqs)).toEqual(
      Array.from({ length: 230 }, (_, i) => i + 1),
    );
    expect(
      rows().every(
        (x) => x.delivery === "acked" && x.server_status === "received",
      ),
    ).toBe(true);
  });

  it("marks events done when the server reports booked/applied/dismissed", async () => {
    addEvents(2);
    const s = server();
    const snd = sender(s.fetch);
    await snd.sendWaiting();
    s.stored.get(eid(1))!.status = "booked";
    s.stored.get(eid(2))!.status = "held";
    await snd.refreshStatus();
    expect(rows().map((x) => [x.delivery, x.server_status])).toEqual([
      ["done", "booked"],
      ["acked", "held"],
    ]);
  });

  it("an interrupted send resumes without duplicates (same event ids, same seqs)", async () => {
    addEvents(3);
    const s = server({ failNextUpload: "after-store" });
    const snd = sender(s.fetch);
    await snd.sendWaiting();
    expect(rows().every((x) => x.delivery === "waiting")).toBe(true);
    await snd.sendWaiting();
    expect(s.uploads.map((u) => u.seqs)).toEqual([
      [1, 2, 3],
      [1, 2, 3],
    ]);
    expect(s.stored.size).toBe(3);
    expect(rows().every((x) => x.delivery === "acked")).toBe(true);
  });

  it("a network error keeps everything waiting and never throws", async () => {
    addEvents(2);
    const s = server({ failNextUpload: "network" });
    await expect(sender(s.fetch).sendWaiting()).resolves.toEqual({
      sent: 0,
      waiting: 2,
    });
  });

  it("VERSION_AHEAD keeps the events and says why", async () => {
    addEvents(2);
    const s = server({
      envelope: { success: false, code: "VERSION_AHEAD", error: "newer" },
    });
    expect(await sender(s.fetch).sendWaiting()).toEqual({
      sent: 0,
      waiting: 2,
    });
    expect(store.read()?.lastError).toMatch(/newer than the server/i);
  });

  it("a revoked key → 're-pair this PC', events kept", async () => {
    addEvents(1);
    const s = server({
      envelope: { success: false, code: "DEVICE_REVOKED", error: "revoked" },
    });
    await sender(s.fetch).sendWaiting();
    expect(store.read()?.lastError).toMatch(/re-pair this PC/i);
    expect(rows()[0]!.delivery).toBe("waiting");
  });

  it("re-pairing (same PC number, new key) keeps events and sequence; the new key sends them", async () => {
    addEvents(2);
    store.savePairing(
      {
        tenantId: 7,
        shopSlug: "c",
        shopName: "C",
        serverUrl: "https://api.test",
        deviceNo: 3,
        serverSchemaVersion: 210,
      },
      KEY2,
    );
    const s = server();
    await sender(s.fetch).sendWaiting();
    expect(s.uploads).toEqual([{ key: KEY2, seqs: [1, 2] }]);
  });

  it("SEQ_CONFLICT / EVENT_ID_REUSED stop sending and show on screen", async () => {
    addEvents(3);
    const s = server({ reject: { [eid(2)]: "SEQ_CONFLICT" } });
    const r = await sender(s.fetch).sendWaiting();
    expect(r.waiting).toBe(1); // the refused one stays on the PC
    expect(rows().find((x) => x.event_id === eid(2))!.delivery).toBe("waiting");
    expect(store.read()?.lastError).toMatch(/SEQ_CONFLICT|numbering/i);
    expect(s.uploads).toHaveLength(1);
  });

  it("the server's 'renumber unsent work' renumbers every waiting event above its max, keeping event ids", async () => {
    addEvents(3);
    getOfflineOutboxRepository().markAcked([eid(1)]);
    const snd = sender(server().fetch);
    await snd.renumberUnsent(10);
    expect(rows().map((x) => [x.event_id, x.device_seq, x.delivery])).toEqual([
      [eid(1), 1, "acked"],
      [eid(2), 11, "waiting"],
      [eid(3), 12, "waiting"],
    ]);
    expect(store.read()?.lastSeq).toBe(12);
  });

  it("when every event of the last period has left 'received', the period is settled", async () => {
    store.update({
      lastPeriod: { finishedAt: "2026-10-11T10:30:00.000Z", settledAt: null },
    });
    addEvents(1);
    const s = server();
    const snd = sender(s.fetch);
    await snd.sendWaiting();
    expect(store.read()?.lastPeriod?.settledAt).toBeNull();
    s.stored.get(eid(1))!.status = "held";
    await snd.refreshStatus();
    expect(store.read()?.lastPeriod?.settledAt).toBe(
      "2026-10-11T11:00:00.000Z",
    );
  });
});
