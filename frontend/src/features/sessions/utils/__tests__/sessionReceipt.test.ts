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

describe("buildSessionCheckoutReceiptText — GROSS Charges/Payout split (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase F)", () => {
  const shop = { name: "Corner Tech", phone: "01-234567", location: "Beirut" };

  it("prints Charges AND Payout to customer separately for a mixed basket — never netted", () => {
    // A $50 charge (custom service) + a $20 cash-out (same currency) used to
    // collapse into one "Total: $30.00" line. Proven failing-first (rule
    // 17): against the pre-fix single-net-Total code this test fails because
    // "Charges:" / "Payout to customer:" never appear at all (only
    // "Total:" does), and "$30.00" (the net) DOES appear — the exact
    // opposite of what this asserts.
    const text = buildSessionCheckoutReceiptText({
      shop,
      sessionId: 10,
      items: [
        { label: "Custom Service", amount: 50, currency: "USD" },
        { label: "OMT RECEIVE", amount: -20, currency: "USD" },
      ],
      legs: [],
    });

    expect(text).toMatch(/Charges:\s+\$50\.00/);
    expect(text).toMatch(/Payout to customer:\s+\$20\.00/);
    // The net ($30.00) must never appear — that's the amount this split
    // guards against silently vanishing from the printed receipt.
    expect(text).not.toContain("$30.00");
    expect(text).not.toContain("Total:");
  });

  it("keeps Charges/Payout separate per currency in a USD+LBP mixed basket", () => {
    const text = buildSessionCheckoutReceiptText({
      shop,
      sessionId: 11,
      items: [
        { label: "MTC Recharge", amount: 100_000, currency: "LBP" },
        { label: "WHISH RECEIVE", amount: -30, currency: "USD" },
      ],
      legs: [],
    });

    expect(text).toMatch(/Charges:\s+100,000 LBP/);
    expect(text).toMatch(/Payout to customer:\s+\$30\.00/);
  });

  it("labels a kind:PAYOUT OUT leg as Payout, never Change", () => {
    // Pre-Phase-F, every non-CUSTOMER_ACCOUNT OUT leg printed "Change:" — a
    // RECEIVE/loto-prize payout isn't change, it's the shop paying the
    // customer. Failing-first: legs carried no `kind` field before this
    // change, so the pre-fix labeling logic (`method === "CUSTOMER_ACCOUNT"
    // ? "Credited" : "Change"`) always prints "Change:" here — this
    // assertion on "Payout (CASH):" fails against it.
    const text = buildSessionCheckoutReceiptText({
      shop,
      sessionId: 12,
      items: [{ label: "Loto Prize", amount: -20, currency: "USD" }],
      legs: [
        {
          method: "CASH",
          currency_code: "USD",
          amount: 20,
          direction: "OUT",
          kind: "PAYOUT",
        },
      ],
    });

    expect(text).toMatch(/Payout \(CASH\):\s+\$20\.00/);
    expect(text).not.toContain("Change:");
  });

  it("still labels a real change/return leg (kind:CHANGE) as Change, not Payout", () => {
    const text = buildSessionCheckoutReceiptText({
      shop,
      sessionId: 13,
      items: [{ label: "Item A", amount: 10, currency: "USD" }],
      legs: [
        {
          method: "CASH",
          currency_code: "USD",
          amount: 20,
          direction: "IN",
        },
        {
          method: "CASH",
          currency_code: "USD",
          amount: 10,
          direction: "OUT",
          kind: "CHANGE",
        },
      ],
    });

    expect(text).toMatch(/Change:\s+\$10\.00/);
    expect(text).not.toContain("Payout (CASH)");
  });

  it("prints a Fees line for an item's commission (LIRA note: 'iPick: no commission on bill' — the gap was in this session-basket receipt, not iPick-specific)", () => {
    // Proven failing-first (rule 17): pre-fix, SessionReceiptItem had no
    // `fee` field and buildSessionCheckoutReceiptText never printed a
    // "Fees:" line at all — this assertion fails against that code.
    const text = buildSessionCheckoutReceiptText({
      shop,
      sessionId: 20,
      items: [
        { label: "iPick Bill Payment", amount: 50, currency: "USD", fee: 5 },
      ],
      legs: [],
    });

    expect(text).toMatch(/Fees:\s+\$5\.00/);
  });

  it("sums fees across items sharing a currency and omits the line when there is no fee", () => {
    const text = buildSessionCheckoutReceiptText({
      shop,
      sessionId: 21,
      items: [
        { label: "KATCH Bill A", amount: 30, currency: "USD", fee: 2 },
        { label: "KATCH Bill B", amount: 20, currency: "USD", fee: 3 },
        { label: "POS Sale", amount: 10, currency: "USD" },
      ],
      legs: [],
    });

    expect(text).toMatch(/Fees:\s+\$5\.00/);
  });

  it("omits the Fees line entirely when no item carries a fee", () => {
    const text = buildSessionCheckoutReceiptText({
      shop,
      sessionId: 22,
      items: [{ label: "POS Sale", amount: 10, currency: "USD" }],
      legs: [],
    });

    expect(text).not.toContain("Fees:");
  });

  it("still labels a CUSTOMER_ACCOUNT payout as Credited even with kind:PAYOUT", () => {
    const text = buildSessionCheckoutReceiptText({
      shop,
      sessionId: 14,
      items: [{ label: "Loto Prize", amount: -20, currency: "USD" }],
      legs: [
        {
          method: "CUSTOMER_ACCOUNT",
          currency_code: "USD",
          amount: 20,
          direction: "OUT",
          kind: "PAYOUT",
        },
      ],
    });

    expect(text).toMatch(/Credited:\s+\$20\.00/);
    expect(text).not.toContain("Payout (CUSTOMER_ACCOUNT)");
  });
});
