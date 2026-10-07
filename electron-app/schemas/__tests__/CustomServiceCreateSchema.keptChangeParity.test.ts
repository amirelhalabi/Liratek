/**
 * CustomServiceCreateSchema (desktop IPC) — keeps the fields the kept-change
 * check needs (POSTING_MAP G42).
 *
 * `custom-services:add` validates with this LOCAL duplicate of core's
 * `createCustomServiceSchema`. Zod strips unknown keys silently (rule 23),
 * and the local copy never declared `exchange_rate` — so on desktop the
 * rate the payment sheet converted at never reached the repository. Once the
 * repository reconciles the payment lines (`resolveKeptChange`), a missing
 * rate means reconciling a USD-paid LBP service at the server's fallback
 * rate instead of the till's, and refusing a valid sale.
 *
 * Field names are read off the CORE schema's shape (rule 24): if core renames
 * one, the lookup below fails instead of this test asserting a stale name.
 */
import { createCustomServiceSchema } from "@liratek/core";
import { CustomServiceCreateSchema } from "../index";

// zod 4 keeps `.shape` on a refined object; zod 3 wraps it in ZodEffects.
type ShapeCarrier = {
  shape?: Record<string, unknown>;
  _def?: { schema?: { shape?: Record<string, unknown> } };
};
const carrier = createCustomServiceSchema as unknown as ShapeCarrier;
const coreKeys = Object.keys(carrier.shape ?? carrier._def?.schema?.shape ?? {});

function coreKey(name: string): string {
  if (!coreKeys.includes(name)) {
    throw new Error(`core createCustomServiceSchema has no "${name}" key`);
  }
  return name;
}

const payload: Record<string, unknown> = {
  description: "Unlock",
  price_lbp: 450_000,
  paid_by: "CASH",
  payments: [
    { method: "CASH", currency_code: "USD", amount: 10 },
    { method: "CASH", currency_code: "LBP", amount: 400_000, direction: "OUT" },
  ],
  [coreKey("exchange_rate")]: 90_000,
  [coreKey("kept_change_usd")]: 0,
  [coreKey("kept_change_lbp")]: 50_000,
};

describe("CustomServiceCreateSchema — desktop keeps the kept-change inputs", () => {
  it.each(["exchange_rate", "kept_change_usd", "kept_change_lbp"])(
    "does not strip %s",
    (name) => {
      const parsed = CustomServiceCreateSchema.parse(payload) as Record<
        string,
        unknown
      >;
      expect(parsed[coreKey(name)]).toBe(payload[name]);
    },
  );
});
