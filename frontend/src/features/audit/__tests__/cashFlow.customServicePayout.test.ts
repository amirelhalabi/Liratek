/**
 * NOT RUN — proven at the end-of-batch gate.
 *
 * OWNER_NOTES_REMAINING_BUILD.md #16 — a Via-Partner custom service can now
 * be a payout (the Syria "Pay out" flow, migration v185). The IN/OUT badge
 * must say OUT for it, and keep saying IN for every other custom service
 * (the type used to be a fixed "in" — CUSTOM_SERVICE is now "dynamic" in
 * transactionPresentation.ts).
 */
import { getCashFlowDirection } from "../cashFlow";

const meta = (direction?: string) =>
  direction === undefined ? "{}" : JSON.stringify({ direction });

describe("getCashFlowDirection — CUSTOM_SERVICE direction branch", () => {
  it("is 'out' for a payout (metadata.direction === 'OUT')", () => {
    expect(getCashFlowDirection("CUSTOM_SERVICE", meta("OUT"))).toBe("out");
  });

  it("is 'in' for the ordinary flow (metadata.direction === 'IN')", () => {
    expect(getCashFlowDirection("CUSTOM_SERVICE", meta("IN"))).toBe("in");
  });

  it("falls back to 'in' when metadata has no direction key (every pre-v185 row)", () => {
    expect(getCashFlowDirection("CUSTOM_SERVICE", meta())).toBe("in");
  });

  it("falls back to 'in' when metadata is missing or malformed", () => {
    expect(getCashFlowDirection("CUSTOM_SERVICE", null)).toBe("in");
    expect(getCashFlowDirection("CUSTOM_SERVICE", undefined)).toBe("in");
    expect(getCashFlowDirection("CUSTOM_SERVICE", "not-json{")).toBe("in");
  });

  it("ignores an unrecognised direction value and falls back to 'in'", () => {
    expect(getCashFlowDirection("CUSTOM_SERVICE", meta("SIDEWAYS"))).toBe(
      "in",
    );
  });
});
