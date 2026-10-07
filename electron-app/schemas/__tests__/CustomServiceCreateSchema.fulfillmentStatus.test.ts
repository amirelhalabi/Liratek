/**
 * Rule 23: `fulfillment_status` is in the core createCustomServiceSchema and
 * the preload type, and the Services page sends "ORDERED" for Insurance
 * services — but the desktop schema lacked it, so Zod silently stripped it and
 * desktop Insurance services never started fulfilment tracking (web kept it).
 */
import { CustomServiceCreateSchema } from "../index";

describe("CustomServiceCreateSchema — fulfillment_status parity with core", () => {
  const base = { description: "Car insurance", cost_usd: 80, price_usd: 100 };

  it("keeps fulfillment_status ORDERED (does not strip it)", () => {
    const r = CustomServiceCreateSchema.safeParse({
      ...base,
      fulfillment_status: "ORDERED",
    });
    expect(r.success).toBe(true);
    expect((r as { data: Record<string, unknown> }).data.fulfillment_status).toBe(
      "ORDERED",
    );
  });

  it("rejects an unknown fulfillment_status", () => {
    const r = CustomServiceCreateSchema.safeParse({
      ...base,
      fulfillment_status: "LOST",
    });
    expect(r.success).toBe(false);
  });
});
