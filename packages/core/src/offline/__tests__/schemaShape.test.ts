/**
 * LIRA-306 T027 — schema shape descriptors and compatibility (R9, FR-016).
 *
 * An event carries the shape of the schema its payload was parsed with. The
 * server books it only if every event key exists unchanged in today's schema
 * and every key only the server has is optional WITHOUT a default (Zod strips
 * renamed keys and fills `.default()`s silently — rules 22/23). The server
 * re-parses a payload the PC already parsed, so parse(parse(x)) must equal
 * parse(x) for every recorded schema.
 */
import { z } from "zod";
import { describeShape, isCompatible, sampleFor } from "../schemaShape";
import { CHANNEL_POLICY, PENDING_LIFT, recordedSchema } from "../channelPolicy";

const base = z.object({
  clientId: z.number().int().positive(),
  note: z.string().optional(),
  amountUSD: z.number().default(0),
  items: z.array(z.object({ product_id: z.number(), qty: z.number() })),
  kind: z.enum(["a", "b"]),
});

describe("describeShape", () => {
  it("is stable and records keys, types, optional and defaults", () => {
    const a = describeShape(base);
    const b = describeShape(base);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a).toMatchObject({
      type: "object",
      keys: {
        clientId: { type: "number" },
        note: { type: "string", optional: true },
        amountUSD: { type: "number", hasDefault: true },
        items: { type: "array", element: { type: "object" } },
        kind: { type: "enum", values: ["a", "b"] },
      },
    });
    // JSON round trip — it is stored in the event
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
});

describe("isCompatible", () => {
  const event = describeShape(base);

  it("same schema → compatible", () => {
    expect(isCompatible(event, describeShape(base))).toBe(true);
  });

  it("server added an optional key without default → compatible", () => {
    expect(isCompatible(event, describeShape(base.extend({ extra: z.string().optional() })))).toBe(true);
  });

  it("server added a key with .default() → incompatible", () => {
    expect(isCompatible(event, describeShape(base.extend({ extra: z.number().default(0) })))).toBe(false);
  });

  it("server added a required key → incompatible", () => {
    expect(isCompatible(event, describeShape(base.extend({ extra: z.string() })))).toBe(false);
  });

  it("a renamed key → incompatible", () => {
    const renamed = base.omit({ clientId: true }).extend({ client_id: z.number().int().positive() });
    expect(isCompatible(event, describeShape(renamed))).toBe(false);
  });

  it("a changed type or nested change → incompatible", () => {
    expect(isCompatible(event, describeShape(base.extend({ clientId: z.string() })))).toBe(false);
    const nested = base.extend({ items: z.array(z.object({ product_id: z.number(), quantity: z.number() })) });
    expect(isCompatible(event, describeShape(nested))).toBe(false);
  });
});

describe("parse(parse(x)) === parse(x) for every recorded core schema", () => {
  const recorded = CHANNEL_POLICY.filter(
    (e) => (e.cls === "offline" || e.cls === "checkpoint") && !PENDING_LIFT.includes(e.channel),
  );

  // Cross-field refinements the generic sampler cannot satisfy: one key is
  // changed, and the test asserts it is a key of the schema (rule 24).
  const TWEAKS: Record<string, Record<string, unknown>> = {
    "drawer-topup:transfer": { toDrawer: "Whish_App" },
    "wallet-exchange:create": { toCurrency: "LBP" },
  };

  it.each(recorded.map((e) => e.channel))("%s", (channel) => {
    const schema = recordedSchema(channel)!;
    const tweak = TWEAKS[channel] ?? {};
    const keys = Object.keys(describeShape(schema).keys ?? {});
    for (const k of Object.keys(tweak)) expect(keys).toContain(k);
    const fixture = { ...(sampleFor(schema) as Record<string, unknown>), ...tweak };
    const once = schema.safeParse(fixture);
    expect({ channel, ok: once.success, issues: once.success ? [] : once.error.issues.slice(0, 2) }).toEqual({
      channel,
      ok: true,
      issues: [],
    });
    if (!once.success) return;
    const twice = schema.safeParse(once.data);
    expect(twice.success).toBe(true);
    if (twice.success) expect(twice.data).toEqual(once.data);
  });
});

/**
 * Found by the web e2e (rule 28): the BUILT core resolves the repo's hoisted
 * zod 3 at runtime (backend, desktop), while core's jest uses zod 4. The same
 * schema written in either must describe identically, or no event would ever
 * be compatible in production.
 */
describe("zod 3 and zod 4 describe the same schema identically", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const z3 = require(require("node:path").join(__dirname, "../../../../../node_modules/zod")) as {
    z: typeof import("zod").z;
  };
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const z4 = require("zod") as { z: typeof import("zod").z };

  const build = (zz: typeof import("zod").z) =>
    zz
      .object({
        clientId: zz.number().int().positive(),
        note: zz.string().max(5).optional(),
        amountUSD: zz.number().default(0),
        rate: zz.number().nullish(),
        items: zz.array(zz.object({ product_id: zz.number(), kind: zz.enum(["a", "b"]) })).min(1),
        mode: zz.union([zz.literal(0), zz.literal(1), zz.boolean()]),
        meta: zz.record(zz.string(), zz.unknown()).optional(),
      })
      .refine((d) => d.clientId > 0, { message: "x" });

  it("is not comparing one zod with itself", () => {
    expect((z3.z.string() as unknown as { _def?: { typeName?: string } })._def?.typeName).toBe("ZodString");
  });

  it("same descriptor, and compatible both ways", () => {
    const a = describeShape(build(z3.z) as never);
    const b = describeShape(build(z4.z) as never);
    expect(a).toEqual(b);
    expect(isCompatible(a, b)).toBe(true);
    expect(a).toMatchObject({ type: "object", keys: { amountUSD: { hasDefault: true, default: "0" } } });
  });
});
