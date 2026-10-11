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
