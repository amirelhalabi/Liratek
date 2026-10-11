/**
 * LIRA-308 decision 5 — a target the amount ticked by itself carries
 * `auto: true` so the server pays it only after the cashier's ticks. Zod
 * strips unknown keys silently (CLAUDE.md rule 23), so the schema must
 * carry the key or the flag vanishes on both transports.
 */
import { addRepaymentSchema } from "../debt";

describe("addRepaymentSchema — LIRA-308 auto targets", () => {
  it("keeps `auto` on a target", () => {
    const parsed = addRepaymentSchema.parse({
      clientId: 7,
      amountUSD: 15,
      targets: [
        { kind: "charge", id: 13 },
        { kind: "charge", id: 11, auto: true },
      ],
    });
    expect(parsed.targets).toEqual([
      { kind: "charge", id: 13 },
      { kind: "charge", id: 11, auto: true },
    ]);
  });
});

// LIRA-308 owner answer 2 (2026-10-11) — the "Earlier balance (no items)"
// line is sent as a `kind: "balance"` target. Rule 23: without the key in
// the schema the tick would be refused on both transports.
describe("addRepaymentSchema — LIRA-308 earlier-balance target", () => {
  it("accepts a `balance` target (cashier's or auto)", () => {
    const parsed = addRepaymentSchema.parse({
      clientId: 7,
      amountUSD: 40,
      targets: [
        { kind: "charge", id: 13 },
        { kind: "balance", id: 1, auto: true },
      ],
    });
    expect(parsed.targets).toEqual([
      { kind: "charge", id: 13 },
      { kind: "balance", id: 1, auto: true },
    ]);
  });
});
