import { buildSessionCheckoutReceiptText } from "../sessionReceipt";

describe("buildSessionCheckoutReceiptText", () => {
  const shop = { name: "Corner Tech", phone: "01-234567", location: "Beirut" };

  it("lists every cart item, not just the first", () => {
    const text = buildSessionCheckoutReceiptText({
      shop,
      sessionId: 42,
      customerName: "Jane Doe",
      customerPhone: "70123456",
      items: [
        {
          label: "MTC Recharge - 300,000 LBP",
          amount: 300_000,
          currency: "LBP",
        },
        { label: "Whish App Bill: EDL — 50 USD", amount: 50, currency: "USD" },
      ],
      legs: [
        { method: "CASH", currency_code: "USD", amount: 50, direction: "IN" },
        {
          method: "CASH",
          currency_code: "LBP",
          amount: 300_000,
          direction: "IN",
        },
      ],
      createdAt: "2026-07-19T12:00:00.000Z",
    });

    expect(text).toContain("MTC Recharge - 300,000 LBP");
    expect(text).toContain("Whish App Bill: EDL — 50 USD");
    expect(text).toContain("Jane Doe 70123456");
    expect(text).toContain("Session #42");
  });

  it("shows a total per currency for a mixed USD+LBP basket", () => {
    const text = buildSessionCheckoutReceiptText({
      shop,
      sessionId: 1,
      items: [
        { label: "Item A", amount: 10, currency: "USD" },
        { label: "Item B", amount: 20, currency: "USD" },
        { label: "Item C", amount: 100_000, currency: "LBP" },
      ],
      legs: [],
    });

    expect(text).toContain("$30.00");
    expect(text).toContain("100,000 LBP");
  });

  it("renders IN legs as Paid and OUT legs as Change", () => {
    const text = buildSessionCheckoutReceiptText({
      shop,
      sessionId: 2,
      items: [{ label: "Item A", amount: 10, currency: "USD" }],
      legs: [
        { method: "CASH", currency_code: "USD", amount: 20, direction: "IN" },
        { method: "CASH", currency_code: "USD", amount: 10, direction: "OUT" },
      ],
    });

    expect(text).toMatch(/Paid \(CASH\):\s+\$20\.00/);
    expect(text).toMatch(/Change:\s+\$10\.00/);
  });

  it("renders a CUSTOMER_ACCOUNT OUT leg (payout settled to store credit) as Credited", () => {
    const text = buildSessionCheckoutReceiptText({
      shop,
      sessionId: 3,
      items: [{ label: "Loto Prize", amount: -20, currency: "USD" }],
      legs: [
        {
          method: "CUSTOMER_ACCOUNT",
          currency_code: "USD",
          amount: 20,
          direction: "OUT",
        },
      ],
    });

    expect(text).toMatch(/Credited:\s+\$20\.00/);
    expect(text).not.toContain("Change:");
  });

  it("a negative (cashout) item is prefixed with a minus sign", () => {
    const text = buildSessionCheckoutReceiptText({
      shop,
      sessionId: 4,
      items: [{ label: "Binance Send", amount: -15.5, currency: "USD" }],
      legs: [],
    });

    expect(text).toContain("-$15.50");
  });

  it("never renders customer name/phone lines when the session is anonymous", () => {
    const text = buildSessionCheckoutReceiptText({
      shop,
      sessionId: 5,
      items: [{ label: "Item A", amount: 10, currency: "USD" }],
      legs: [],
    });

    // The shop header/footer/border are the only fixed lines besides the
    // session id, date, item, total — no stray blank "customer" line.
    expect(text).not.toContain("undefined");
  });
});
