/**
 * LIRA-321 T004 — the shared "Customer pays" legs fragment.
 *
 * `customerLegSchema` is one line the customer hands over (method, currency,
 * amount); `customerPaymentsField` is the pair of optional keys the Exchange
 * and financial-service schemas spread in. The server's balance rules live in
 * `bookCustomerLegs` (moneyPosting.ts) — these tests pin only the shape.
 */
import { z } from "zod";
import { customerLegSchema, customerPaymentsField } from "../customerLegs";

const fieldSchema = z.object(customerPaymentsField);

describe("customerLegSchema", () => {
  it("accepts a positive amount with a method and currency", () => {
    expect(
      customerLegSchema.safeParse({
        method: "CASH",
        currencyCode: "USD",
        amount: 10,
      }).success,
    ).toBe(true);
  });

  it.each([0, -5])("refuses amount %p", (amount) => {
    expect(
      customerLegSchema.safeParse({ method: "CASH", currencyCode: "USD", amount })
        .success,
    ).toBe(false);
  });

  it("refuses an empty method", () => {
    expect(
      customerLegSchema.safeParse({ method: "", currencyCode: "USD", amount: 5 })
        .success,
    ).toBe(false);
  });
});

describe("customerPaymentsField", () => {
  it("is optional — an old payload without it still parses", () => {
    expect(fieldSchema.safeParse({}).success).toBe(true);
  });

  it("refuses an empty customerPayments array", () => {
    expect(fieldSchema.safeParse({ customerPayments: [] }).success).toBe(false);
  });

  it("refuses a negative customer_waived_amount", () => {
    expect(
      fieldSchema.safeParse({ customer_waived_amount: -1 }).success,
    ).toBe(false);
  });

  it("accepts a zero customer_waived_amount", () => {
    expect(fieldSchema.safeParse({ customer_waived_amount: 0 }).success).toBe(
      true,
    );
  });
});
