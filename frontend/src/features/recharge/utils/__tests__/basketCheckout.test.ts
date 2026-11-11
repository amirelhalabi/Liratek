/**
 * basketCheckout — 3 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 3).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import {
  createFinancialServiceSchema,
  rechargeBasketCheckoutSchema,
  rechargePartnerOrderSchema,
  sessionCheckoutPaymentSchema,
  RECHARGE_BASKET_MODULES,
  RECHARGE_BASKET_MODULE_PROVIDER,
  type RechargeBasketModule,
} from "@liratek/core";
import {
  withClient,
  basketItemCount,
  basketSheetSummary,
  billPricedLine,
  buildBasketCheckoutPayload,
  buildPartnerOrderPayload,
  spreadDiscount,
} from "../basketCheckout";
import {
  type BasketSubItem,
  type BasketProvider,
  type PricedLine,
} from "../../types/basket";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("basketCheckout.itemTime", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Bug #4 (TRANSACTION_DETAIL_AUDIT §3) — iPick / Katsh / Whish App units
   * added to a customer session's basket keep the "Set custom time" picked on
   * the form, like the same units sold on their own. The session checkout
   * replays each unit through the financial-service schema, so the key is
   * checked against that schema (rule 24).
   */

  const PICKED = "2026-10-14T09:30:00.000Z";

  const unit: BasketSubItem = {
    provider: "iPick",
    serviceType: "SEND",
    amount: 10,
    cost: 8,
    currency: "USD",
    commission: 2,
  };

  describe("withClient — session sub-items carry the picked time", () => {
    it("every unit carries the time, under the key the schema keeps", () => {
      const [a, b] = withClient([unit, { ...unit, amount: 5 }], {
        clientId: 3,
        transactionTime: PICKED,
      });
      expect(a.transaction_time).toBe(PICKED);
      expect(b.transaction_time).toBe(PICKED);
      const parsed = createFinancialServiceSchema.parse({
        ...a,
        payments: [],
      }) as { transaction_time?: string };
      expect(parsed.transaction_time).toBe(PICKED);
    });

    it("no time picked: no key (the checkout's time, or now, applies)", () => {
      const [a] = withClient([unit], { clientId: 3 });
      expect("transaction_time" in a).toBe(false);
      expect(a.clientId).toBe(3);
    });
  });
});

describe("basketCheckout (LIRA-326)", () => {
  beforeAll(resetBetweenFiles);

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
        expect(e.amount).toBe(
          e.formData.items.reduce((s, x) => s + x.amount, 0),
        );
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
        expect(e.amount).toBe(
          e.formData.items.reduce((s, x) => s + x.amount, 0),
        );
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
          {
            method: "WHISH",
            currencyCode: "USD",
            amount: 50,
            direction: "OUT",
          },
        ],
      });
    });
  });
});

describe("basketCheckout.transactionDetails (LIRA-329)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-329 T019 / T022 — a Mobile Recharge basket discount is kept on each
   * unit's transaction: the share of the typed discount that unit was charged
   * less, in the basket's currency (`typedDiscount`). Each sub-item is a
   * financial-service payload, so the field must survive the shared
   * `createFinancialServiceSchema` (rule 23) — asserted by parsing through it
   * (rule 24).
   *
   * Rule 17: run against the unchanged spread first and seen failing (no
   * `typedDiscount` on any unit).
   */

  function sub(
    provider: BasketProvider,
    amount: number,
    cost: number,
  ): BasketSubItem {
    return {
      provider,
      serviceType: "SEND",
      amount,
      cost,
      currency: "LBP",
      commission: Math.max(0, amount - cost),
      itemKey: `${provider}/item/${amount}`,
      itemCategory: "Gaming",
      note: `${provider} item`,
    };
  }

  function line(provider: BasketProvider, subs: BasketSubItem[]): PricedLine {
    return {
      key: `${provider}-line`,
      provider,
      label: `${provider} x${subs.length}`,
      currency: "LBP",
      amount: subs.reduce((s, x) => s + x.amount, 0),
      cost: subs.reduce((s, x) => s + x.cost, 0),
      commission: subs.reduce((s, x) => s + x.commission, 0),
      subItems: subs,
      sheetItem: {
        key: `${provider}-line`,
        name: provider,
        quantity: subs.length,
        unitPrice: subs[0]!.amount,
        currency: "LBP",
      },
    };
  }

  describe("basket discount kept per unit (LIRA-329)", () => {
    it("each unit carries its own share; a unit with no share carries none", () => {
      const out = spreadDiscount(
        [
          sub("Katsh", 130_000, 100_000),
          sub("iPick", 110_000, 100_000),
          sub("Katsh", 50_000, 50_000),
        ],
        20_000,
      );
      const shares = [130_000, 110_000, 50_000].map(
        (a, i) => a - out[i]!.amount,
      );
      out.forEach((unit, i) => {
        const parsed = createFinancialServiceSchema.parse(unit);
        if (shares[i]! > 0) {
          expect(parsed.typedDiscount).toEqual({
            amount: shares[i],
            currency: "LBP",
          });
        } else {
          expect(parsed.typedDiscount).toBeUndefined();
        }
      });
    });

    it("the checkout payload's sub-items keep their share", () => {
      const payload = buildBasketCheckoutPayload({
        lines: [
          line("Katsh", [sub("Katsh", 500_000, 450_000)]),
          line("iPick", [sub("iPick", 900_000, 850_000)]),
        ],
        discount: 40_000,
        payments: [],
        returnLegs: [],
        paidByMethod: "CASH",
        client: {},
        userId: 1,
        newId: () => "id",
      });
      const subs = (
        payload.cartItems as Array<{ formData: { items: unknown[] } }>
      ).flatMap((e) => e.formData.items);
      const kept = subs.map(
        (s) => createFinancialServiceSchema.parse(s).typedDiscount?.amount ?? 0,
      );
      expect(kept.reduce((a, b) => a + b, 0)).toBe(40_000);
    });
  });
});
