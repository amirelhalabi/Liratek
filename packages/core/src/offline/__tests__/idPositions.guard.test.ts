/**
 * LIRA-306 T013 guard — the id-position convention holds across every core
 * schema an offline/checkpoint channel records (R3).
 *
 * Fails on:
 *  (a) a key that LOOKS like a reference (contains an `id`/`ref` word) but
 *      is not an id position and is not explained in NOT_A_ROW_REFERENCE —
 *      an offline id there would never be rewritten;
 *  (b) a declared embedded-JSON position that no recorded schema has;
 *  (c) a money-like key that matches the id convention — it would be
 *      rewritten as if it were an id.
 */
import { CHANNEL_POLICY, PENDING_LIFT, recordedSchema } from "../channelPolicy";
import { EMBEDDED_JSON_KEYS, isIdKey } from "../idPositions";
import { describeShape, shapeKeyPaths } from "../schemaShape";

/** Keys that mention an id/reference but never hold a row id. */
const NOT_A_ROW_REFERENCE: Record<string, string> = {
  reference_number: "OMT/Whish transfer reference text typed by the cashier",
  referenceNumber: "same, camelCase",
  omt_reference: "provider reference text",
  idempotencyKey: "client-generated key, not a row",
  provider_reference: "provider reference text",
};

const REFERENCE_LIKE = /((^|_)(id|ids|ref|reference)($|_))|([a-z](Id|Ids|Ref|Reference)($|[A-Z]))/;
const MONEY_LIKE = /(amount|price|cost|fee|total|rate)/i;

const recorded = CHANNEL_POLICY.filter(
  (e) => (e.cls === "offline" || e.cls === "checkpoint") && !PENDING_LIFT.includes(e.channel),
);

function leafKey(path: string): string {
  return path.split(".").pop()!.replace(/\[\]$/, "");
}

describe("id-position guard over recorded core schemas", () => {
  it("covers every recorded schema (78 recordable − PENDING_LIFT)", () => {
    expect(recorded.length).toBe(78 - PENDING_LIFT.length);
    expect(recorded.length).toBeGreaterThanOrEqual(55);
  });

  it("(a) reference-looking keys are id positions or explained", () => {
    const offenders: string[] = [];
    for (const e of recorded) {
      for (const path of shapeKeyPaths(describeShape(recordedSchema(e.channel)!))) {
        const k = leafKey(path);
        if (REFERENCE_LIKE.test(k) && !isIdKey(k) && !(k in NOT_A_ROW_REFERENCE)) {
          offenders.push(`${e.channel}: ${path}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("(b) every declared embedded-JSON key exists in a recorded schema (or inside an opaque basket item)", () => {
    const allKeys = new Set<string>();
    for (const e of recorded) {
      for (const p of shapeKeyPaths(describeShape(recordedSchema(e.channel)!))) allKeys.add(leafKey(p));
    }
    // `formData` lives inside session:checkout's `cartItems: z.array(z.unknown())`.
    const checkout = describeShape(recordedSchema("session:checkout")!);
    expect(checkout.keys?.cartItems?.element?.type).toBe("unknown");
    const OPAQUE = new Set(["formData"]);
    for (const k of EMBEDDED_JSON_KEYS) {
      expect({ k, found: allKeys.has(k) || OPAQUE.has(k) }).toEqual({ k, found: true });
    }
  });

  it("(c) no money-like key matches the id convention", () => {
    const offenders: string[] = [];
    for (const e of recorded) {
      for (const path of shapeKeyPaths(describeShape(recordedSchema(e.channel)!))) {
        const k = leafKey(path);
        if (isIdKey(k) && MONEY_LIKE.test(k)) offenders.push(`${e.channel}: ${path}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
