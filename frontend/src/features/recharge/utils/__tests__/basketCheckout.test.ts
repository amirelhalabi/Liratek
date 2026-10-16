/**
 * LIRA-326 T007 — the Mobile Recharge basket checkout payload and the
 * discount spread.
 *
 * Rule 24: field names are never hand-typed into assertions. The payload is
 * parsed through `rechargeBasketCheckoutSchema` made STRICT (the schema itself
 * passes unknown keys through, so a misspelled key would otherwise parse), each
 * leg through `sessionCheckoutPaymentSchema.strict()`, and every entry's
 * module ↔ sub-item provider pair is checked against core's own
 * `RECHARGE_BASKET_MODULE_PROVIDER`.
 */
import {
  rechargeBasketCheckoutSchema,
  rechargePartnerOrderSchema,
  sessionCheckoutPaymentSchema,
  RECHARGE_BASKET_MODULES,
  RECHARGE_BASKET_MODULE_PROVIDER,
  type RechargeBasketModule,
} from "@liratek/core";
import {
  basketItemCount,
  basketSheetSummary,
  billPricedLine,
  buildBasketCheckoutPayload,
  buildPartnerOrderPayload,
  spreadDiscount,
} from "../basketCheckout";
import type {
  BasketProvider,
  BasketSubItem,
  PricedLine,
} from "../../types/basket";

function sub(
  provider: BasketProvider,
  amount: number,
  cost: number,
  currency: "LBP" | "USD" = "LBP",
  itemKey = `${provider}/item/${amount}`,
): BasketSubItem {
  return {
    provider,
    serviceType: "SEND",
    amount,
    cost,
    currency,
    commission: Math.max(0, amount - cost),
    itemKey,
    itemCategory: "Gaming",
    note: itemKey,
  };
}

function line(
  provider: BasketProvider,
  key: string,
  subs: BasketSubItem[],
): PricedLine {
  const currency = subs[0]!.currency;
  return {
    key,
    provider,
    label: `${key} x${subs.length}`,
    currency,
    amount: subs.reduce((s, x) => s + x.amount, 0),
    cost: subs.reduce((s, x) => s + x.cost, 0),
    commission: subs.reduce((s, x) => s + x.commission, 0),
    subItems: subs,
    sheetItem: {
      key,
      name: key,
      quantity: subs.length,
      unitPrice: subs[0]!.amount,
      currency,
    },
  };
}

const strictPayload = rechargeBasketCheckoutSchema.strict();
const strictLeg = sessionCheckoutPaymentSchema.strict();

type Entry = {
  module: RechargeBasketModule;
  amount: number;
  currency: string;
  ipcChannel: string;
  formData: { _batch: boolean; items: BasketSubItem[] };
};

describe("buildBasketCheckoutPayload (LIRA-326)", () => {
  const katsh = line("Katsh", "k1", [
    sub("Katsh", 90_000, 82_340),
    sub("Katsh", 90_000, 82_340),
  ]);
  const ipick = line("iPick", "i1", [sub("iPick", 180_000, 150_000)]);
  const whish = line("WHISH_APP", "w1", [sub("WHISH_APP", 10, 9.5, "USD")]);

  function build(lines: PricedLine[], discount = 0) {
    return buildBasketCheckoutPayload({
      lines,
      discount,
      payments: [
        { id: "L1", method: "CASH", currencyCode: "LBP", amount: 400_000 },
        { id: "L2", method: "CASH", currencyCode: "USD", amount: 10 },
      ],
      returnLegs: [
        {
          id: "R1",
          method: "CASH",
          currencyCode: "LBP",
          amount: 40_000,
          direction: "OUT",
        },
      ],
      paidByMethod: "MULTI",
      exchangeRate: 89_500,
      keptChange: { usd: 0, lbp: 5_000 },
      extra: { usd: 0, lbp: 0 },
      client: { clientId: 12, clientName: "Rami", clientPhone: "03123456" },
      userId: 3,
    });
  }

  it("builds ONE _batch entry per provider, each sub-item under its own provider, parsing STRICTLY through the schema", () => {
    const payload = build([katsh, ipick, whish]);
    const parsed = strictPayload.parse(payload);
    const entries = parsed.cartItems as Entry[];

    expect(entries).toHaveLength(3);
    const modules = entries.map((e) => e.module).sort();
    expect(modules).toEqual([...RECHARGE_BASKET_MODULES].sort());
    for (const e of entries) {
      expect(RECHARGE_BASKET_MODULES).toContain(e.module);
      expect(e.ipcChannel).toBe("financial:create");
      expect(e.formData._batch).toBe(true);
      for (const s of e.formData.items) {
        expect(s.provider).toBe(RECHARGE_BASKET_MODULE_PROVIDER[e.module]);
      }
      // The server charges the customer `entry.amount` (one shared rule with
      // session checkout) — it must equal its own sub-items.
      expect(e.amount).toBe(e.formData.items.reduce((s, x) => s + x.amount, 0));
    }
    const byModule = Object.fromEntries(entries.map((e) => [e.module, e]));
    expect(byModule.katsh!.amount).toBe(180_000);
    expect(byModule.katsh!.currency).toBe("LBP");
    expect(byModule.katsh!.formData.items).toHaveLength(2);
    expect(byModule.ipick!.amount).toBe(180_000);
    expect(byModule.whish_app!.amount).toBe(10);
    expect(byModule.whish_app!.currency).toBe("USD");
  });

  it("sends the legs once for the whole basket: IN tender, OUT change", () => {
    const parsed = strictPayload.parse(build([katsh, whish]));
    const legs = parsed.payments ?? [];
    for (const l of legs) strictLeg.parse(l);
    expect(legs.filter((l) => l.direction === "IN")).toHaveLength(2);
    const out = legs.filter((l) => l.direction === "OUT");
    expect(out).toHaveLength(1);
    expect(out[0]!.kind).toBe("CHANGE");
    expect(out[0]!.currency_code).toBe("LBP");
    expect(parsed.kept_change_lbp).toBe(5_000);
    expect(parsed.exchangeRate).toBe(89_500);
    expect(parsed.clientId).toBe(12);
    expect(parsed.clientName).toBe("Rami");
    expect(parsed.clientPhone).toBe("03123456");
    expect(parsed.userId).toBe(3);
  });

  it("stamps the resolved client on every sub-item", () => {
    const entries = strictPayload.parse(build([katsh, ipick]))
      .cartItems as Entry[];
    for (const e of entries)
      for (const s of e.formData.items) {
        expect(s.clientId).toBe(12);
        expect(s.clientName).toBe("Rami");
      }
  });

  it("applies a discount once across the basket: entry amounts sum to total − discount", () => {
    const payload = build([katsh, ipick], 10_000);
    const entries = strictPayload.parse(payload).cartItems as Entry[];
    const total = entries.reduce((s, e) => s + e.amount, 0);
    expect(total).toBe(360_000 - 10_000);
    // Each entry charges exactly what its own (discounted) sales record —
    // the server does not re-check this.
    for (const e of entries) {
      expect(e.amount).toBe(e.formData.items.reduce((s, x) => s + x.amount, 0));
      for (const s of e.formData.items) expect(s.currency).toBe(e.currency);
    }
    expect(entries.every((e) => e.formData.items.length > 0)).toBe(true);
  });

  it("refuses a provider whose lines mix currencies", () => {
    const bad = line("Katsh", "kx", [
      sub("Katsh", 90_000, 82_340),
      sub("Katsh", 1, 0.5, "USD"),
    ]);
    expect(() => build([bad, ipick])).toThrow();
  });
});

describe("spreadDiscount (LIRA-326)", () => {
  it("lowers amount AND commission in proportion to commission; shares sum exactly to the discount", () => {
    const subs = [
      sub("Katsh", 130_000, 100_000), // commission 30,000
      sub("iPick", 110_000, 100_000), // commission 10,000
      sub("Katsh", 50_000, 50_000), // commission 0
    ];
    const out = spreadDiscount(subs, 20_001);
    const shares = subs.map((s, i) => s.amount - out[i]!.amount);
    expect(shares.reduce((a, b) => a + b, 0)).toBe(20_001);
    subs.forEach((s, i) => {
      expect(s.commission - out[i]!.commission).toBe(shares[i]);
      expect(out[i]!.commission).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(shares[i])).toBe(true); // whole LBP
    });
    // A zero-profit item takes no discount.
    expect(shares[2]).toBe(0);
    // Proportional: 3 : 1.
    expect(shares[0]).toBeGreaterThan(shares[1]!);
  });

  it("never takes a sub-item below 0 commission when the discount equals total commission", () => {
    const subs = [sub("Katsh", 103, 100), sub("Katsh", 101, 100)];
    const out = spreadDiscount(subs, 4);
    expect(out.map((s) => s.commission)).toEqual([0, 0]);
    expect(out.map((s) => s.amount)).toEqual([100, 100]);
  });

  it("works in cents for USD", () => {
    const subs = [
      sub("WHISH_APP", 10.5, 10, "USD"),
      sub("WHISH_APP", 10.25, 10, "USD"),
    ];
    const out = spreadDiscount(subs, 0.5);
    const total = out.reduce((s, x) => s + x.amount, 0);
    expect(Math.round(total * 100)).toBe(Math.round((20.75 - 0.5) * 100));
    for (const s of out) expect(s.commission).toBeGreaterThanOrEqual(0);
  });

  it("refuses a discount larger than the total commission", () => {
    expect(() =>
      spreadDiscount([sub("Katsh", 110_000, 100_000)], 10_001),
    ).toThrow();
  });

  it("returns the items unchanged for no discount", () => {
    const subs = [sub("Katsh", 110_000, 100_000)];
    expect(spreadDiscount(subs, 0)).toEqual(subs);
  });
});

describe("basketSheetSummary (LIRA-326)", () => {
  it("owes each currency separately and offers no discount on a mixed LBP + USD basket", () => {
    const sum = basketSheetSummary([
      line("Katsh", "k1", [sub("Katsh", 90_000, 82_340)]),
      line("WHISH_APP", "w1", [sub("WHISH_APP", 10, 9.5, "USD")]),
    ]);
    expect(sum.totals).toEqual([
      { amount: 90_000, currency: "LBP" },
      { amount: 10, currency: "USD" },
    ]);
    expect(sum.singleCurrency).toBe(false);
    expect(sum.items).toHaveLength(2);
  });

  it("caps the discount at the basket's whole profit on a one-currency basket", () => {
    const sum = basketSheetSummary([
      line("Katsh", "k1", [sub("Katsh", 90_000, 82_340)]),
      line("iPick", "i1", [sub("iPick", 180_000, 150_000)]),
    ]);
    expect(sum.singleCurrency).toBe(true);
    expect(sum.currency).toBe("LBP");
    expect(sum.totalAmount).toBe(270_000);
    expect(sum.maxDiscount).toBe(7_660 + 30_000);
  });
});

// ─── LIRA-327: bills and the basket-wide partner order ──────────────────────
// (written after the code — not proven failing-first; the failing-first
// guards are RechargeBasket.crossProvider.test.tsx and the core tests.)

describe("bills in the basket (LIRA-327)", () => {
  const katshBill = billPricedLine({
    id: "b1",
    provider: "Katsh",
    amount: 500_000,
    currency: "LBP",
  });
  const ipickUsdBill = billPricedLine({
    id: "b2",
    provider: "iPick",
    amount: 20,
    currency: "USD",
  });

  it("a bill is its own non-batch entry under its own provider, the shape a bill paid alone sends", () => {
    const payload = buildBasketCheckoutPayload({
      lines: [
        line("WHISH_APP", "w", [sub("WHISH_APP", 900_000, 897_000)]),
        katshBill,
        ipickUsdBill,
      ],
      payments: [],
      returnLegs: [],
      paidByMethod: "CASH",
      client: {},
      userId: 1,
      newId: () => "id",
    });
    const parsed = strictPayload.parse(payload);
    const entries = parsed.cartItems as Array<{
      module: string;
      amount: number;
      currency: string;
      formData: Record<string, unknown>;
    }>;
    expect(entries.map((e) => [e.module, e.amount, e.currency])).toEqual([
      ["whish_app", 900_000, "LBP"],
      ["katsh", 500_000, "LBP"],
      ["ipick", 20, "USD"],
    ]);
    expect(entries[1]!.formData).toEqual({
      provider: "Katsh",
      serviceType: "BILL",
      amount: 500_000,
      cost: 500_000,
      price: 500_000,
      currency: "LBP",
      commission: 0,
    });
    expect(entries[2]!.formData).toMatchObject({
      provider: "iPick",
      serviceType: "BILL",
      currency: "USD",
    });
  });

  it("the discount is spread over the cards only — a bill keeps its full amount", () => {
    const payload = buildBasketCheckoutPayload({
      lines: [
        line("WHISH_APP", "w", [sub("WHISH_APP", 900_000, 800_000)]),
        katshBill,
      ],
      discount: 50_000,
      payments: [],
      returnLegs: [],
      paidByMethod: "CASH",
      client: {},
      userId: 1,
      newId: () => "id",
    });
    const entries = payload.cartItems as Array<{
      amount: number;
      formData: Record<string, unknown>;
    }>;
    expect(entries[0]!.amount).toBe(850_000);
    expect(entries[1]!.amount).toBe(500_000);
    expect(entries[1]!.formData.amount).toBe(500_000);
  });

  it("the payment window lists a bill under its own provider and counts it", () => {
    const summary = basketSheetSummary([katshBill, ipickUsdBill]);
    expect(summary.items.map((i) => [i.name, i.provider])).toEqual([
      ["Bill", "KATSH"],
      ["Bill", "IPICK"],
    ]);
    expect(summary.totals).toEqual([
      { amount: 500_000, currency: "LBP" },
      { amount: 20, currency: "USD" },
    ]);
    expect(summary.maxDiscount).toBe(0);
    expect(basketItemCount([katshBill, ipickUsdBill])).toBe(2);
  });
});

describe("buildPartnerOrderPayload (LIRA-327)", () => {
  const strictOrder = rechargePartnerOrderSchema.strict();

  it("writes today's per-tab partner sales for every provider: one aggregated SEND per iPick / Katsh, one BILL per bill, one SEND per Whish App unit", () => {
    const katshCards = {
      ...line("Katsh", "k", [
        sub("Katsh", 90_000, 82_340),
        sub("Katsh", 90_000, 82_340),
      ]),
      partnerNote: "Pubg 60 UC x2",
    };
    const ipickCards = {
      ...line("iPick", "i", [sub("iPick", 180_000, 150_000)]),
      partnerNote: "Free Fire 100 Diamonds [Only Days]",
    };
    const whish = line("WHISH_APP", "w", [
      sub("WHISH_APP", 10, 9, "USD", "W/PSN/10"),
      sub("WHISH_APP", 10, 9, "USD", "W/PSN/10"),
    ]);
    const order = strictOrder.parse(
      buildPartnerOrderPayload({
        lines: [
          whish,
          katshCards,
          billPricedLine({
            id: "b",
            provider: "Katsh",
            amount: 500_000,
            currency: "LBP",
          }),
          ipickCards,
        ],
        partnerId: 7,
        userId: 3,
      }),
    );
    expect(order.partnerId).toBe(7);
    expect(order.userId).toBe(3);
    expect(
      order.sales.map((s) => [
        s.provider,
        s.serviceType,
        s.amount,
        s.cost,
        s.currency,
        s.commission,
        s.note,
      ]),
    ).toEqual([
      [
        "iPick",
        "SEND",
        180_000,
        150_000,
        "LBP",
        30_000,
        "Free Fire 100 Diamonds [Only Days]",
      ],
      ["Katsh", "SEND", 180_000, 164_680, "LBP", 15_320, "Pubg 60 UC x2"],
      ["Katsh", "BILL", 500_000, 500_000, "LBP", 0, undefined],
      ["WHISH_APP", "SEND", 10, 9, "USD", 1, "W/PSN/10"],
      ["WHISH_APP", "SEND", 10, 9, "USD", 1, "W/PSN/10"],
    ]);
    expect(order.sales[2]!.price).toBe(500_000);
    expect(order.sales[3]!.itemKey).toBe("W/PSN/10");
    for (const s of order.sales) {
      expect(s.payments).toEqual([]);
      expect(s.partnerId).toBeUndefined();
      expect(s.clientId).toBeUndefined();
    }
  });

  it("a zero-cost Whish App unit pays its OUT leg from the chosen drawer, with no profit", () => {
    const order = buildPartnerOrderPayload({
      lines: [line("WHISH_APP", "w", [sub("WHISH_APP", 50, 0, "USD")])],
      partnerId: 7,
      paidFromMethod: "WHISH",
      transactionTime: "2026-10-16T08:00:00.000Z",
      userId: 3,
    });
    expect(order.transaction_time).toBe("2026-10-16T08:00:00.000Z");
    expect(order.sales[0]).toMatchObject({
      commission: 0,
      payments: [
        { method: "WHISH", currencyCode: "USD", amount: 50, direction: "OUT" },
      ],
    });
  });
});
