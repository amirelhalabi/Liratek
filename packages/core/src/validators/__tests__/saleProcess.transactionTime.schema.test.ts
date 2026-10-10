/**
 * LIRA-298 — `saleProcessSchema` keeps the cashier's backdated
 * `transaction_time`. The POS checkout (`CheckoutModal.tsx`) sends it when the
 * time is overridden, and both transports (IPC `sales:process`, REST
 * `POST /api/sales/process`) validate with this ONE schema. Zod strips
 * unknown keys silently (rule 23), so without the key every backdated sale
 * was booked at "now".
 *
 * `deferPayment` is deliberately NOT accepted over the wire: it is the
 * session-basket flag that skips the customer-cash drawer post, change,
 * gift-card redemption and debt — only the server (`processCartItem`) may set
 * it (same stance as validators/recharge.ts and validators/customService.ts).
 */
import { saleProcessSchema } from "../sale.js";

const base = {
  client_id: null,
  items: [{ product_id: 1, quantity: 1, price: 10 }],
  total_amount: 10,
  discount: 0,
  final_amount: 10,
  payment_usd: 10,
  payment_lbp: 0,
  exchange_rate: 89500,
};

describe("saleProcessSchema — LIRA-298 transaction_time", () => {
  it("keeps a backdated transaction_time (the ISO string the checkout sends)", () => {
    const parsed = saleProcessSchema.parse({
      ...base,
      transaction_time: "2026-10-05T09:00:00.000Z",
    });
    expect(parsed.transaction_time).toBe("2026-10-05T09:00:00.000Z");
  });

  it("leaves transaction_time absent when not backdated", () => {
    expect(saleProcessSchema.parse(base)).not.toHaveProperty(
      "transaction_time",
    );
  });

  it("rejects a transaction_time that is not an ISO datetime", () => {
    expect(
      saleProcessSchema.safeParse({ ...base, transaction_time: "05/10/2026" })
        .success,
    ).toBe(false);
  });

  it("never lets a client set deferPayment (server-only session flag)", () => {
    expect(
      saleProcessSchema.parse({ ...base, deferPayment: true }),
    ).not.toHaveProperty("deferPayment");
  });
});
