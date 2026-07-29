/**
 * lotoTicketUpdateSchema — public update path is now METADATA ONLY.
 *
 * Ticket voiding/refunding is a real, reversible flow now
 * (TransactionRepository._reverseLotoSupplierLedger /
 * _assertLotoTicketVoidable). An in-place edit of sale_amount /
 * commission_rate / commission_amount / is_winner / prize_amount would
 * silently desync the unified transaction, the supplier_ledger TOP_UP row,
 * and (if checkpointed) the checkpoint's frozen totals — none of which this
 * endpoint re-stamps. Those fields must be rejected/stripped by the schema;
 * void-then-resell (or refund) is the sanctioned correction now. Metadata
 * fields (ticket_number, payment_method, currency, prize_paid_date, note)
 * must keep working — this is a narrowing of the public boundary only, the
 * repository-internal LotoTicketUpdate type / updateTicket() SQL are
 * untouched (see LotoService.markWinner/payPrize, which call the repo
 * directly and never go through this schema).
 */

import { describe, it, expect } from "@jest/globals";
import { lotoTicketUpdateSchema } from "../loto.js";

describe("lotoTicketUpdateSchema", () => {
  it("strips the money-math fields (sale_amount, commission_rate, commission_amount, is_winner, prize_amount) rather than passing them through", () => {
    const result = lotoTicketUpdateSchema.parse({
      sale_amount: 100000,
      commission_rate: 0.15,
      commission_amount: 15000,
      is_winner: true,
      prize_amount: 50000,
      note: "attempted amount edit",
    });

    expect(result).not.toHaveProperty("sale_amount");
    expect(result).not.toHaveProperty("commission_rate");
    expect(result).not.toHaveProperty("commission_amount");
    expect(result).not.toHaveProperty("is_winner");
    expect(result).not.toHaveProperty("prize_amount");
    // Metadata field on the same payload survives untouched.
    expect(result.note).toBe("attempted amount edit");
  });

  it("still accepts and round-trips every metadata-only field", () => {
    const payload = {
      ticket_number: "T-001",
      payment_method: "CASH",
      currency: "LBP",
      prize_paid_date: "2026-07-28",
      note: "paid out at counter",
    };

    const result = lotoTicketUpdateSchema.parse(payload);

    expect(result).toEqual(payload);
  });

  it("accepts an empty object (all fields optional)", () => {
    expect(() => lotoTicketUpdateSchema.parse({})).not.toThrow();
  });

  it("rejects a blank ticket_number (min(1) still enforced)", () => {
    expect(() =>
      lotoTicketUpdateSchema.parse({ ticket_number: "" }),
    ).toThrow();
  });
});
