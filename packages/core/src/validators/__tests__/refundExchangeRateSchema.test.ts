/**
 * LIRA-236 (REFUND_EXCHANGE_RATE_PLAN.md §3) — schema-level proof that
 * `exchangeRate` is accepted (as a positive finite number), optional, and
 * rejects garbage, on every refund payload schema it was added to.
 *
 * Coordinator follow-up (2026-09-28, rule 14 dedup) —
 * `sessionItemRefundPreviewSchema.exchangeRate` used to be a SEPARATE,
 * hand-written `z.coerce.number().positive().finite().optional()` copy
 * instead of reusing the shared `refundExchangeRateSchema` fragment (it
 * couldn't reuse it directly — that fragment starts from `z.number()`, not
 * `z.coerce.number()`, since this field alone reads off query-string text).
 * The drift that copy introduced: it dropped the shared fragment's
 * `.nullish()` handling (F13's own doc, above), so a literal `null` —
 * which the write-path schemas treat as "no rate given", identical to
 * omitting the key — was REJECTED here as "expected number, received
 * null" instead. `refundExchangeRateQuerySchema` (validators/common.ts) is
 * now the one query-string variant, built from the SAME base as
 * `refundExchangeRateSchema` (`_buildRefundExchangeRateSchema`), so the two
 * can't drift again.
 */
import { z } from "zod";
import {
  refundExchangeRateSchema,
  refundExchangeRateQuerySchema,
  saleRefundSchema,
  saleRefundItemSchema,
  sessionItemRefundSchema,
  sessionItemRefundPreviewSchema,
} from "../index.js";

describe("refundExchangeRateSchema (shared fragment)", () => {
  it("accepts a positive number", () => {
    expect(refundExchangeRateSchema.safeParse(89000).success).toBe(true);
  });
  it("accepts undefined (optional)", () => {
    expect(refundExchangeRateSchema.safeParse(undefined).success).toBe(true);
  });
  it("rejects 0", () => {
    expect(refundExchangeRateSchema.safeParse(0).success).toBe(false);
  });
  it("rejects a negative number", () => {
    expect(refundExchangeRateSchema.safeParse(-89000).success).toBe(false);
  });
  it("rejects Infinity", () => {
    expect(refundExchangeRateSchema.safeParse(Infinity).success).toBe(false);
  });
  it("rejects a non-number", () => {
    expect(refundExchangeRateSchema.safeParse("89000").success).toBe(false);
  });
});

describe("saleRefundSchema / saleRefundItemSchema — exchangeRate", () => {
  it("saleRefundSchema accepts exchangeRate", () => {
    const parsed = saleRefundSchema.safeParse({ saleId: 1, exchangeRate: 89000 });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.exchangeRate).toBe(89000);
  });
  it("saleRefundSchema omits exchangeRate cleanly (backward compatible)", () => {
    const parsed = saleRefundSchema.safeParse({ saleId: 1 });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.exchangeRate).toBeUndefined();
  });
  it("saleRefundSchema rejects a negative exchangeRate", () => {
    expect(
      saleRefundSchema.safeParse({ saleId: 1, exchangeRate: -1 }).success,
    ).toBe(false);
  });
  it("saleRefundItemSchema accepts exchangeRate", () => {
    const parsed = saleRefundItemSchema.safeParse({
      saleId: 1,
      saleItemId: 2,
      refundQuantity: 1,
      exchangeRate: 89000,
    });
    expect(parsed.success).toBe(true);
  });
});

describe("refundExchangeRateQuerySchema (query-string coerced variant, rule 14 dedup)", () => {
  // Rule 17 — reproduces the PRE-FIX schema shape as a local fixture (never
  // by reverting the real, now-fixed source file) to prove the drift this
  // dedup closes actually existed: the old inline copy in
  // `sessionItemRefundPreviewSchema` really did reject `null`, where the
  // shared body-schema fragment (`refundExchangeRateSchema`) always
  // accepted it as "no rate given".
  const preFixInlineCopy = z.coerce.number().positive().finite().optional();

  it("RED (pre-fix shape): the old hand-written copy rejected a literal null", () => {
    expect(preFixInlineCopy.safeParse(null).success).toBe(false);
  });

  it("GREEN (rule 14 fragment): refundExchangeRateSchema (the body variant) already accepted null as 'no rate given'", () => {
    const parsed = refundExchangeRateSchema.safeParse(null);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBeUndefined();
  });

  it("accepts a numeric string, matching every other field on this query schema", () => {
    const parsed = refundExchangeRateQuerySchema.safeParse("89000");
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBe(89000);
  });

  it("accepts a real number", () => {
    expect(refundExchangeRateQuerySchema.safeParse(89000).success).toBe(true);
  });

  it("accepts undefined (key omitted)", () => {
    const parsed = refundExchangeRateQuerySchema.safeParse(undefined);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBeUndefined();
  });

  it("now also accepts null, mapped to undefined — the exact fix over the pre-fix inline copy above", () => {
    const parsed = refundExchangeRateQuerySchema.safeParse(null);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data).toBeUndefined();
  });

  it("rejects a non-numeric string", () => {
    expect(refundExchangeRateQuerySchema.safeParse("abc").success).toBe(false);
  });

  it("rejects 0", () => {
    expect(refundExchangeRateQuerySchema.safeParse(0).success).toBe(false);
    expect(refundExchangeRateQuerySchema.safeParse("0").success).toBe(false);
  });

  it("rejects a negative number/string", () => {
    expect(refundExchangeRateQuerySchema.safeParse(-89000).success).toBe(false);
    expect(refundExchangeRateQuerySchema.safeParse("-89000").success).toBe(false);
  });

  it("rejects NaN", () => {
    expect(refundExchangeRateQuerySchema.safeParse(NaN).success).toBe(false);
  });

  it("rejects Infinity (number or string)", () => {
    expect(refundExchangeRateQuerySchema.safeParse(Infinity).success).toBe(false);
    expect(refundExchangeRateQuerySchema.safeParse("Infinity").success).toBe(false);
  });
});

describe("sessionItemRefundSchema / sessionItemRefundPreviewSchema — exchangeRate", () => {
  it("sessionItemRefundSchema accepts exchangeRate", () => {
    const parsed = sessionItemRefundSchema.safeParse({
      sessionId: 1,
      transactionId: 2,
      exchangeRate: 89000,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.exchangeRate).toBe(89000);
  });
  it("sessionItemRefundPreviewSchema accepts exchangeRate (coerced, matching the rest of that schema's query-string fields)", () => {
    const parsed = sessionItemRefundPreviewSchema.safeParse({
      sessionId: "1",
      transactionId: "2",
      exchangeRate: "89000",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.exchangeRate).toBe(89000);
  });
  it("sessionItemRefundPreviewSchema rejects a non-numeric exchangeRate", () => {
    const parsed = sessionItemRefundPreviewSchema.safeParse({
      sessionId: "1",
      transactionId: "2",
      exchangeRate: "not-a-number",
    });
    expect(parsed.success).toBe(false);
  });
  it("sessionItemRefundPreviewSchema now accepts a literal null exchangeRate (rule 14 dedup fix)", () => {
    const parsed = sessionItemRefundPreviewSchema.safeParse({
      sessionId: "1",
      transactionId: "2",
      exchangeRate: null,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.exchangeRate).toBeUndefined();
  });
  it("sessionItemRefundPreviewSchema omits exchangeRate cleanly — the key stays optional on both sides (rule 21)", () => {
    const parsed = sessionItemRefundPreviewSchema.safeParse({
      sessionId: "1",
      transactionId: "2",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.exchangeRate).toBeUndefined();
      expect("exchangeRate" in parsed.data).toBe(false);
    }
    // Compile-time half of rule 21: `exchangeRate` omitted entirely must
    // still satisfy the schema's own INPUT type — if the dedup ever made
    // the key required again (the exact F13 regression this fragment's own
    // header describes), this object literal stops compiling (`yarn
    // typecheck`/`tsc --noEmit` would catch it, not this runtime assertion).
    const inputWithoutRate: z.input<typeof sessionItemRefundPreviewSchema> = {
      sessionId: 1,
      transactionId: 2,
    };
    const inputWithRate: z.input<typeof sessionItemRefundPreviewSchema> = {
      sessionId: 1,
      transactionId: 2,
      exchangeRate: 89000,
    };
    expect(inputWithoutRate.sessionId).toBe(1);
    expect(inputWithRate.exchangeRate).toBe(89000);
  });
});
