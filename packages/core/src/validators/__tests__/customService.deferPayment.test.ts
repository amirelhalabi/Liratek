/**
 * `deferPayment` must never be accepted from the client on
 * `custom-services:add` / `POST /api/custom-services`.
 *
 * It tells CustomServiceRepository.createService "the session basket owns
 * the customer's payment" — so it skips the selling-price refusal AND every
 * customer-cash posting (no drawer leg, no debt). Only the server-side
 * session checkout replay (SessionCheckoutService.processCartItem) may set
 * it, after validation. Accepting it over the wire let a hand-crafted
 * request book a service that collects nothing, with no basket at all.
 * Mirrors validators/recharge.ts, which already refuses the field.
 */
import { createCustomServiceSchema } from "../customService.js";

describe("createCustomServiceSchema — deferPayment is server-only", () => {
  it("strips deferPayment sent by a client", () => {
    const parsed = createCustomServiceSchema.parse({
      description: "Screen fix",
      cost_usd: 10,
      deferPayment: true,
    });
    expect(parsed).not.toHaveProperty("deferPayment");
  });
});
