/**
 * LIRA-306 T011 — HIGH guard (analyze pass 3, D1).
 *
 * A positional IPC argument (`session:update`'s `sessionId`, …) becomes a key
 * of the recorded payload. If the recorded schema did not declare that key,
 * Zod would strip it silently (rule 23) and the replay would update NOTHING
 * (or the wrong row). `recordedSchema()` therefore wraps the core body schema
 * in an envelope that declares every `argNames` key, and the id-position walk
 * must see those keys.
 */
import { z } from "zod";
import { CHANNEL_POLICY, PENDING_LIFT, recordedSchema } from "../channelPolicy";
import { collectIdPositions } from "../idPositions";

const OFFLINE_SESSION = 1_004_000_000_001;

function shapeKeys(schema: z.ZodType): string[] {
  const def = (schema as unknown as { def?: { type?: string; in?: z.ZodType } }).def;
  if (def?.type === "pipe" && def.in) return shapeKeys(def.in);
  const shape = (schema as unknown as { shape?: Record<string, unknown> }).shape;
  return shape ? Object.keys(shape) : [];
}

describe("recordedSchema envelope keeps positional ids", () => {
  it("session:update keeps sessionId", () => {
    const parsed = recordedSchema("session:update")!.parse({
      sessionId: OFFLINE_SESSION,
      customer_name: "Rami",
    }) as Record<string, unknown>;
    expect(parsed.sessionId).toBe(OFFLINE_SESSION);
    expect(parsed.customer_name).toBe("Rami");
  });

  it("session:cart:add keeps sessionId", () => {
    const parsed = recordedSchema("session:cart:add")!.parse({
      sessionId: OFFLINE_SESSION,
      item_id: "c0ffee",
      module: "pos",
      label: "x",
      amount: 1,
      currency: "USD",
      form_data: "{}",
      ipc_channel: "sales:process",
    }) as Record<string, unknown>;
    expect(parsed.sessionId).toBe(OFFLINE_SESSION);
  });

  it("loto:checkpoint:update keeps id", () => {
    const parsed = recordedSchema("loto:checkpoint:update")!.parse({
      id: 1_071_000_000_001,
      note: "n",
    }) as Record<string, unknown>;
    expect(parsed.id).toBe(1_071_000_000_001);
  });

  it("collectIdPositions sees the positional key for those three channels", () => {
    expect(collectIdPositions("session:update", { sessionId: OFFLINE_SESSION }).map((p) => p.path)).toContain(
      "sessionId",
    );
    expect(
      collectIdPositions("session:cart:add", { sessionId: OFFLINE_SESSION, item_id: "u" }).map((p) => p.path),
    ).toContain("sessionId");
    expect(collectIdPositions("loto:checkpoint:update", { id: 1_071_000_000_001 }).map((p) => p.path)).toContain(
      "id",
    );
  });

  it("for EVERY entry with argNames and a schema, each argName is a key of the recorded schema", () => {
    const missing: string[] = [];
    for (const e of CHANNEL_POLICY) {
      if (!e.argNames || PENDING_LIFT.includes(e.channel)) continue;
      const schema = recordedSchema(e.channel);
      if (!schema) {
        missing.push(`${e.channel}: no schema`);
        continue;
      }
      const keys = shapeKeys(schema);
      for (const a of e.argNames) if (!keys.includes(a)) missing.push(`${e.channel}.${a}`);
    }
    expect(missing).toEqual([]);
  });
});
