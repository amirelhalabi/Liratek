/**
 * LIRA-296 (T009) — `warrantySearchSchema`, shared by IPC `warranty:search`
 * and REST `GET /api/warranty/search` (rule 14).
 *
 * The REST route validates the QUERY STRING, where every value is a string —
 * so `limit` must coerce ("20" → 20), exactly the trap `saleIdParamSchema`
 * documents. `client_day` is required: warranty state depends on the shop's
 * own day, never the server's (rule 27).
 */
import { warrantySearchSchema, type WarrantySearchInput } from "../warranty.js";

const base = { client_day: "2026-10-10" };

describe("warrantySearchSchema", () => {
  it("accepts the minimal input and defaults limit to 50", () => {
    const parsed = warrantySearchSchema.parse(base);
    expect(parsed).toEqual({ client_day: "2026-10-10", limit: 50 });
  });

  it("accepts every field", () => {
    const input: WarrantySearchInput = {
      q: "RCP-12",
      from: "2026-01-01",
      to: "2026-10-10",
      state: "COVERED",
      client_day: "2026-10-10",
      limit: 200,
    };
    expect(warrantySearchSchema.parse(input)).toEqual(input);
  });

  it("coerces a query-string limit", () => {
    expect(warrantySearchSchema.parse({ ...base, limit: "20" }).limit).toBe(20);
  });

  it("requires client_day in YYYY-MM-DD", () => {
    expect(warrantySearchSchema.safeParse({}).success).toBe(false);
    expect(
      warrantySearchSchema.safeParse({ client_day: "10/10/2026" }).success,
    ).toBe(false);
  });

  it.each([
    [{ q: "x".repeat(101) }],
    [{ from: "2026-1-1" }],
    [{ to: "yesterday" }],
    [{ state: "NONE" }],
    [{ state: "covered" }],
    [{ limit: 0 }],
    [{ limit: 201 }],
    [{ limit: 2.5 }],
  ])("rejects %p", (extra) => {
    expect(warrantySearchSchema.safeParse({ ...base, ...extra }).success).toBe(
      false,
    );
  });

  it("trims q and drops an empty one", () => {
    expect(warrantySearchSchema.parse({ ...base, q: "  Rami  " }).q).toBe(
      "Rami",
    );
    expect(warrantySearchSchema.parse({ ...base, q: "   " }).q).toBeUndefined();
  });
});
