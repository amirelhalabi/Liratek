/**
 * LIRA-306 T010 — the channel policy's offline/checkpoint entries carry what
 * the recorder and the replay need: family, label, roles, the core schema
 * that parses their payload (or membership in `PENDING_LIFT`, the 23
 * channels with no core schema yet — contracts/channel-policy.md), and
 * `argNames` where the IPC handler takes positional arguments.
 */
import {
  CHANNEL_POLICY,
  PENDING_LIFT,
  classOf,
  policyEntry,
  recordedSchema,
  type ChannelPolicyEntry,
} from "../channelPolicy";
import * as validators from "../../validators/index";

/** 23 at design time; the US1 lifts (T041) removed clients:create/update,
 *  transactions:void/refund and db:add-expense. */
const PENDING_23: string[] = []; // every Phase 6 family lifted its channels (T077)

const recordable = (): ChannelPolicyEntry[] =>
  CHANNEL_POLICY.filter((e) => e.cls === "offline" || e.cls === "checkpoint");

describe("channel policy — recordable entries", () => {
  it("has 77 recordable channels (70 offline + 7 checkpoint; voucher:cancel moved online-only, O-impl-C-1)", () => {
    expect(recordable()).toHaveLength(77);
  });

  it("each carries a family, a plain label and the handler's roles", () => {
    for (const e of recordable()) {
      expect({ c: e.channel, family: typeof e.family, label: typeof e.label }).toEqual({
        c: e.channel, family: "string", label: "string",
      });
      expect(e.label!.length).toBeGreaterThan(2);
      expect(e.roles!.length).toBeGreaterThan(0);
      for (const r of e.roles!) expect(["admin", "staff"]).toContain(r);
    }
  });

  it("PENDING_LIFT is exactly the channels still without a core schema (23 − 5 lifted in US1)", () => {
    expect([...PENDING_LIFT].sort()).toEqual([...PENDING_23].sort());
  });

  it("every other recordable entry names a core schema exported from the validators barrel", () => {
    const v = validators as Record<string, unknown>;
    for (const e of recordable()) {
      if (PENDING_LIFT.includes(e.channel)) {
        expect({ c: e.channel, schema: recordedSchema(e.channel) }).toEqual({ c: e.channel, schema: null });
        continue;
      }
      expect({ c: e.channel, has: typeof e.coreSchema === "string" }).toEqual({ c: e.channel, has: true });
      const s = v[e.coreSchema!] as { safeParse?: unknown } | undefined;
      expect({ c: e.channel, schema: e.coreSchema, ok: typeof s?.safeParse === "function" }).toEqual({
        c: e.channel, schema: e.coreSchema, ok: true,
      });
      expect(recordedSchema(e.channel)).not.toBeNull();
    }
  });

  it("declares argNames for positional handlers", () => {
    expect(policyEntry("transactions:void")?.argNames).toEqual(["transactionId"]);
    expect(policyEntry("session:cart:remove")?.argNames).toEqual(["sessionId", "itemId"]);
    expect(policyEntry("session:update")?.argNames).toEqual(["sessionId"]);
    expect(policyEntry("loto:checkpoint:update")?.argNames).toEqual(["id"]);
    expect(policyEntry("sales:process")?.argNames).toBeUndefined();
  });

  it("classOf: known classes, and fail-closed 'unclassified' for anything unknown", () => {
    expect(classOf("sales:process")).toBe("offline");
    expect(classOf("closing:create-checkpoint")).toBe("checkpoint");
    expect(classOf("settings:update")).toBe("online_only");
    expect(classOf("voucher:create")).toBe("online_only");
    expect(classOf("auth:login")).toBe("local");
    expect(classOf("offline:status")).toBe("local");
    expect(classOf("no:such-channel")).toBe("unclassified");
  });
});
