/**
 * LIRA-306 T018 — the offline contracts (contracts/rest-offline.md): pairing,
 * check-in, one event, an upload batch, the manifest, review actions.
 * Fixtures are typed from the schemas' own input types (rule 24).
 */
import type { z } from "zod";
import {
  pairDeviceSchema,
  checkinSchema,
  offlineRatesSchema,
  offlineEventSchema,
  uploadEventsSchema,
  manifestSchema,
  eventsStatusQuerySchema,
  reviewDismissSchema,
  reviewListQuerySchema,
  reviewIdParamSchema,
  offlineRatesToRows,
} from "../offline";

const RATES: z.input<typeof offlineRatesSchema> = {
  LBP: { sell: 90000, buy: 89500, market: 89750, direction: 1 },
};

const EVENT: z.input<typeof offlineEventSchema> = {
  eventId: "6f1c1f7e-8a3b-4c2d-9e10-0a1b2c3d4e5f",
  seq: 1,
  channel: "sales:process",
  payload: { client_id: 1_017_000_000_001 },
  actorUserId: 2,
  occurredAt: "2026-10-10T20:50:00.000Z",
  clientDay: "2026-10-10",
  clientTzOffsetMinutes: 180,
  copyId: "0b7f6a1e-1111-4222-8333-444455556666",
  schemaShape: { type: "object", keys: {} },
  rates: RATES,
  created: { sales: [1_023_000_000_001] },
  dependsOn: [],
};

describe("pairDeviceSchema", () => {
  it("accepts a pairing with and without deviceNo (re-key)", () => {
    const base = { shop: "corner", username: "admin", password: "x", deviceName: "Front PC" };
    expect(pairDeviceSchema.safeParse(base).success).toBe(true);
    expect(pairDeviceSchema.parse({ ...base, deviceNo: 2 }).deviceNo).toBe(2);
    expect(pairDeviceSchema.safeParse({ ...base, deviceNo: 0 }).success).toBe(false);
    expect(pairDeviceSchema.safeParse({ ...base, deviceNo: 9007 }).success).toBe(false);
    expect(pairDeviceSchema.safeParse({ ...base, deviceName: "" }).success).toBe(false);
    expect(pairDeviceSchema.safeParse({ ...base, deviceName: "x".repeat(81) }).success).toBe(false);
  });
});

describe("checkinSchema", () => {
  it("accepts the four PC states only", () => {
    const base: z.input<typeof checkinSchema> = {
      state: "standby",
      pendingCount: 0,
      appVersion: "1.2.3",
      schemaVersion: 210,
      pcClock: "2026-10-10T20:50:00.000Z",
    };
    for (const state of ["standby", "blocked", "offline", "finishing"] as const) {
      expect(checkinSchema.safeParse({ ...base, state }).success).toBe(true);
    }
    expect(checkinSchema.safeParse({ ...base, state: "online" }).success).toBe(false);
    expect(checkinSchema.safeParse({ ...base, pendingCount: -1 }).success).toBe(false);
  });
});

describe("offlineEventSchema", () => {
  it("accepts a well-formed event", () => {
    expect(offlineEventSchema.safeParse(EVENT).success).toBe(true);
  });

  it.each([
    ["eventId not a uuid", { eventId: "e1" }],
    ["seq 0", { seq: 0 }],
    ["clientDay malformed", { clientDay: "10/10/2026" }],
    ["offset below −720", { clientTzOffsetMinutes: -721 }],
    ["offset above 840", { clientTzOffsetMinutes: 841 }],
    ["occurredAt not ISO", { occurredAt: "yesterday" }],
    ["dependsOn not uuids", { dependsOn: ["x"] }],
    ["created not ints", { created: { sales: ["a"] } }],
    ["missing schemaShape", { schemaShape: undefined }],
  ])("rejects %s", (_name, patch) => {
    expect(offlineEventSchema.safeParse({ ...EVENT, ...patch }).success).toBe(false);
  });

  it("rates are strict: every field for every currency", () => {
    expect(offlineEventSchema.safeParse({ ...EVENT, rates: { LBP: { sell: 90000, buy: 89500, market: 89750 } } }).success).toBe(false);
    expect(
      offlineEventSchema.safeParse({ ...EVENT, rates: { LBP: { ...RATES.LBP, extra: 1 } } }).success,
    ).toBe(false);
    expect(offlineEventSchema.safeParse({ ...EVENT, rates: { LBP: { ...RATES.LBP, direction: 2 } } }).success).toBe(false);
    expect(offlineEventSchema.safeParse({ ...EVENT, rates: {} }).success).toBe(false);
  });

  it("offlineRatesToRows maps to exchange_rates rows", () => {
    expect(offlineRatesToRows(offlineRatesSchema.parse(RATES))).toEqual([
      { to_code: "LBP", market_rate: 89750, buy_rate: 89500, sell_rate: 90000, is_stronger: 1 },
    ]);
  });
});

describe("uploadEventsSchema", () => {
  const batch = (n: number): z.input<typeof uploadEventsSchema> => ({
    appVersion: "1.2.3",
    schemaVersion: 210,
    pcClock: "2026-10-10T20:50:00.000Z",
    events: Array.from({ length: n }, (_, i) => ({ ...EVENT, seq: i + 1 })),
  });
  it("accepts 1–100 events", () => {
    expect(uploadEventsSchema.safeParse(batch(1)).success).toBe(true);
    expect(uploadEventsSchema.safeParse(batch(100)).success).toBe(true);
    expect(uploadEventsSchema.safeParse(batch(0)).success).toBe(false);
    expect(uploadEventsSchema.safeParse(batch(101)).success).toBe(false);
  });
});

describe("manifest and query/review schemas", () => {
  it("manifest: tables and readWrites", () => {
    const m: z.input<typeof manifestSchema> = {
      copyId: EVENT.copyId,
      tables: { sales: [1_023_000_000_001] },
      readWrites: [{ channel: "sales:get", changes: 1 }],
    };
    expect(manifestSchema.safeParse(m).success).toBe(true);
    expect(manifestSchema.safeParse({ ...m, readWrites: undefined }).success).toBe(false);
  });

  it("events/status, review list, id param, dismiss", () => {
    expect(eventsStatusQuerySchema.parse({ fromSeq: "3" }).fromSeq).toBe(3);
    expect(eventsStatusQuerySchema.parse({}).fromSeq).toBe(0);
    expect(reviewListQuerySchema.safeParse({ state: "open", kind: "possible_duplicate" }).success).toBe(true);
    expect(reviewListQuerySchema.safeParse({ kind: "nope" }).success).toBe(false);
    expect(reviewIdParamSchema.parse({ id: "12" }).id).toBe(12);
    expect(reviewDismissSchema.safeParse({ note: "x".repeat(501) }).success).toBe(false);
    expect(reviewDismissSchema.safeParse({}).success).toBe(true);
  });
});
