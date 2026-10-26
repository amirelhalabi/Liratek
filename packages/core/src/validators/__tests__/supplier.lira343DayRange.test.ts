/**
 * LIRA-343 T033a — the shared optional shop-day range for the supplier
 * Transactions reads (`{ from?, to? }`, YYYY-MM-DD, from <= to). One schema
 * for the IPC handlers and the REST routes (rules 14, 23). An empty string
 * is the window's cleared field and means "no bound".
 */
import * as validators from "../supplier";

type SafeParse = (v: unknown) => { success: boolean };
const schema = (validators as unknown as Record<string, { safeParse?: SafeParse }>)
  .supplierDayRangeSchema;

describe("supplierDayRangeSchema (LIRA-343 T033a)", () => {
  it("is exported", () => {
    expect(schema?.safeParse).toBeInstanceOf(Function);
  });

  it.each([
    {},
    { from: "2026-10-25" },
    { to: "2026-10-25" },
    { from: "2026-10-01", to: "2026-10-31" },
    { from: "2026-10-25", to: "2026-10-25" },
    { from: "", to: "" },
    { from: "", to: "2026-10-25" },
  ])("accepts %p", (v) => {
    expect(schema!.safeParse!(v).success).toBe(true);
  });

  it.each([
    { from: "2026-10-31", to: "2026-10-01" },
    { from: "2026-13-01" },
    { from: "2026-10-32" },
    { from: "2026-10-1" },
    { to: "25/10/2026" },
    { from: "2026-10-25T00:00" },
    { from: 20261025 },
    { from: ["2026-10-25"] },
  ])("refuses %p", (v) => {
    expect(schema!.safeParse!(v).success).toBe(false);
  });
});
