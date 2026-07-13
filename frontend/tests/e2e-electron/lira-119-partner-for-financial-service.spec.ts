/**
 * E2E: LIRA-119 (PFT-3b) — financial services "for partner": every
 * provider × direction books the partner ledger + drawers per the
 * owner-validated catalog, and void nets everything to 0.
 *
 * Model (docs/plans/PARTNER_FOR_TRANSACTIONS_PLAN.md, "⭐ VALIDATED FLOW
 * CATALOG"): a FOR-partner financial service has NO walk-in customer — no
 * counter cash-in, no payout, no client debt, no supplier auto-record.
 *   SEND  → partner OWES the shop (partner_ledger DEBIT):
 *     - OMT/WHISH/OMT_APP/WHISH_APP: the shop fronts the transfer via OUT
 *       payment legs (drawer follows the method, fee already inside the
 *       disbursement); partner owes EXACTLY what the shop paid, per currency.
 *     - BINANCE: Binance drawer −USDT; partner owes the USD sell price
 *       (amount + fee) — partner debt is USD, never USDT.
 *     - iPick/Katsh (cost/price): provider drawer −cost; partner owes the
 *       SELLING price (margin immediate).
 *   RECEIVE → shop OWES the partner (partner_ledger CREDIT):
 *     - the service's own drawer INCREASES by the received amount;
 *     - OMT/WHISH: credit = full amount (no fee);
 *     - OMT_APP/WHISH_APP: credit = amount − fee (fee optional);
 *     - BINANCE: drawer +USDT, credit = (amount − fee) in USD.
 *
 * Rule 15: every case uses its OWN fresh partner (identity by returned id)
 * and asserts DELTAS on getBalance + named drawers, never row position.
 *
 * Rule 17 (failing-first) — each case carries a discriminator that FAILS on
 * the pre-PFT-3b code (which ran the legacy walk-in dispatch + a collapsed
 * OMT/WHISH auto-record for FOR rows):
 *   - OMT/WHISH SEND: the system drawer delta (old code credited
 *     OMT_System/Whish_System +amount+fee; new leaves it untouched).
 *   - OMT_APP/WHISH_APP SEND: transaction_type (old: FOR_OMT_SEND /
 *     FOR_WHISH_SEND) + the app drawer delta (old wallet block debited it).
 *   - BINANCE: the partner USD balance (old booked USDT → usd delta 0) +
 *     transaction_type (old: FOR_WHISH_SEND).
 *   - RECEIVE (all): drawer sign (old DECREASED the system drawer to pay a
 *     customer out) + transaction_type.
 *   - iPick/Katsh: transaction_type (old: FOR_WHISH_SEND) + General delta
 *     (old credited the customer "price inflow" to General).
 *   - reject: old code ACCEPTED customer IN legs in FOR mode.
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

type LedgerEntry = {
  transaction_type: string | null;
  amount: number;
  currency: string;
  direction: "DEBIT" | "CREDIT";
};

type Api = {
  api: {
    partners: {
      create: (d: {
        name: string;
        phone?: string;
      }) => Promise<{ success: boolean; data?: { id: number }; error?: string }>;
      getBalance: (id: number) => Promise<{ usd: number; lbp: number }>;
      getLedger: (id: number) => Promise<{ entries: LedgerEntry[] }>;
    };
    omt: {
      addTransaction: (
        d: unknown,
      ) => Promise<{ success: boolean; id?: number; error?: string }>;
    };
    recharge: {
      getDrawerBalances: () => Promise<
        Array<{
          name: string;
          usdBalance: number;
          lbpBalance: number;
          usdtBalance: number;
        }>
      >;
    };
    transactions: {
      getRecent: (
        n: number,
      ) => Promise<Array<{ id: number; type: string; summary: string | null }>>;
      void: (id: number) => Promise<{ success: boolean; error?: string }>;
    };
  };
};

type Snapshot = {
  bal: { usd: number; lbp: number };
  drawers: Record<string, { usd: number; lbp: number; usdt: number }>;
};

async function snapshot(page: Page, partnerId: number): Promise<Snapshot> {
  return page.evaluate(async (id) => {
    const w = window as unknown as Api;
    const bal = await w.api.partners.getBalance(id);
    const rows = await w.api.recharge.getDrawerBalances();
    const drawers: Snapshot["drawers"] = {};
    for (const r of rows) {
      drawers[r.name] = {
        usd: r.usdBalance ?? 0,
        lbp: r.lbpBalance ?? 0,
        usdt: r.usdtBalance ?? 0,
      };
    }
    return { bal: { usd: bal.usd, lbp: bal.lbp }, drawers };
  }, partnerId);
}

function drawerVal(
  s: Snapshot,
  name: string,
  field: "usd" | "lbp" | "usdt",
): number {
  return s.drawers[name]?.[field] ?? 0;
}

async function createPartner(page: Page, label: string): Promise<number> {
  return page.evaluate(async (l) => {
    const w = window as unknown as Api;
    const c = await w.api.partners.create({
      name: `${l} ${Date.now()}`,
      phone: `${Date.now()}`.slice(-8),
    });
    if (!c.success || !c.data) throw new Error(c.error ?? "create failed");
    return c.data.id;
  }, label);
}

type Case = {
  label: string;
  payload: Record<string, unknown>;
  match: string; // unique summary substring for identity matching
  type: string; // expected partner_ledger transaction_type
  direction: "DEBIT" | "CREDIT";
  balDelta: { usd: number; lbp: number };
  // named drawer deltas to assert (0-deltas are the failing-first
  // discriminators against the legacy dispatch)
  drawerChecks: Array<{
    name: string;
    field: "usd" | "lbp" | "usdt";
    delta: number;
  }>;
};

const CASES: Case[] = [
  {
    label: "OMT SEND: disbursed 103.11 via CASH OUT → partner owes 103.11",
    payload: {
      provider: "OMT",
      serviceType: "SEND",
      amount: 100.11,
      currency: "USD",
      omtServiceType: "INTRA",
      omtFee: 3,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 103.11, direction: "OUT" },
      ],
    },
    match: "100.11",
    type: "FOR_OMT_SEND",
    direction: "DEBIT",
    balDelta: { usd: 103.11, lbp: 0 },
    drawerChecks: [
      { name: "General", field: "usd", delta: -103.11 },
      // Failing-first: legacy code credited OMT_System +(amount+fee).
      { name: "OMT_System", field: "usd", delta: 0 },
    ],
  },
  {
    label: "OMT RECEIVE 80.12 → OMT_System +80.12, shop owes full (no fee)",
    payload: {
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 80.12,
      currency: "USD",
    },
    match: "80.12",
    type: "FOR_OMT_RECEIVE",
    direction: "CREDIT",
    balDelta: { usd: -80.12, lbp: 0 },
    drawerChecks: [
      // Failing-first: legacy RECEIVE DEBITED the system drawer (payout flow).
      { name: "OMT_System", field: "usd", delta: 80.12 },
      { name: "General", field: "usd", delta: 0 },
    ],
  },
  {
    label: "WHISH SEND: disbursed 51.22 via CASH OUT → partner owes 51.22",
    payload: {
      provider: "WHISH",
      serviceType: "SEND",
      amount: 50.22,
      currency: "USD",
      whishFee: 1,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 51.22, direction: "OUT" },
      ],
    },
    match: "50.22",
    type: "FOR_WHISH_SEND",
    direction: "DEBIT",
    balDelta: { usd: 51.22, lbp: 0 },
    drawerChecks: [
      { name: "General", field: "usd", delta: -51.22 },
      { name: "Whish_System", field: "usd", delta: 0 },
    ],
  },
  {
    label: "WHISH RECEIVE 40.23 → Whish_System +40.23, shop owes full",
    payload: {
      provider: "WHISH",
      serviceType: "RECEIVE",
      amount: 40.23,
      currency: "USD",
    },
    match: "40.23",
    type: "FOR_WHISH_RECEIVE",
    direction: "CREDIT",
    balDelta: { usd: -40.23, lbp: 0 },
    drawerChecks: [
      { name: "Whish_System", field: "usd", delta: 40.23 },
      { name: "General", field: "usd", delta: 0 },
    ],
  },
  {
    label: "OMT App SEND: disbursed 22.33 CASH OUT → FOR_OMT_APP_SEND 22.33",
    payload: {
      provider: "OMT_APP",
      serviceType: "SEND",
      amount: 20.33,
      currency: "USD",
      commission: 2,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 22.33, direction: "OUT" },
      ],
    },
    match: "20.33",
    // Failing-first: legacy auto-record typed this FOR_OMT_SEND.
    type: "FOR_OMT_APP_SEND",
    direction: "DEBIT",
    balDelta: { usd: 22.33, lbp: 0 },
    drawerChecks: [
      { name: "General", field: "usd", delta: -22.33 },
      // Failing-first: legacy wallet block debited OMT_App −amount.
      { name: "OMT_App", field: "usd", delta: 0 },
    ],
  },
  {
    label: "OMT App RECEIVE 30.34 (fee 2) → OMT_App +30.34, owes 28.34",
    payload: {
      provider: "OMT_APP",
      serviceType: "RECEIVE",
      amount: 30.34,
      currency: "USD",
      commission: 2,
    },
    match: "30.34",
    type: "FOR_OMT_APP_RECEIVE",
    direction: "CREDIT",
    balDelta: { usd: -28.34, lbp: 0 },
    drawerChecks: [
      { name: "OMT_App", field: "usd", delta: 30.34 },
      { name: "General", field: "usd", delta: 0 },
    ],
  },
  {
    label: "Whish App SEND: disbursed 26.44 CASH OUT → FOR_WHISH_APP_SEND",
    payload: {
      provider: "WHISH_APP",
      serviceType: "SEND",
      amount: 25.44,
      currency: "USD",
      commission: 1,
      payments: [
        { method: "CASH", currencyCode: "USD", amount: 26.44, direction: "OUT" },
      ],
    },
    match: "25.44",
    type: "FOR_WHISH_APP_SEND",
    direction: "DEBIT",
    balDelta: { usd: 26.44, lbp: 0 },
    drawerChecks: [
      { name: "General", field: "usd", delta: -26.44 },
      { name: "Whish_App", field: "usd", delta: 0 },
    ],
  },
  {
    label: "Whish App RECEIVE 35.45 (fee 1.5) → Whish_App +35.45, owes 33.95",
    payload: {
      provider: "WHISH_APP",
      serviceType: "RECEIVE",
      amount: 35.45,
      currency: "USD",
      commission: 1.5,
    },
    match: "35.45",
    type: "FOR_WHISH_APP_RECEIVE",
    direction: "CREDIT",
    balDelta: { usd: -33.95, lbp: 0 },
    drawerChecks: [
      { name: "Whish_App", field: "usd", delta: 35.45 },
      { name: "General", field: "usd", delta: 0 },
    ],
  },
  {
    label: "Binance SEND 60.55 USDT (fee 2) → drawer −60.55 USDT, owes 62.55 USD",
    payload: {
      provider: "BINANCE",
      serviceType: "SEND",
      amount: 60.55,
      currency: "USDT",
      commission: 2,
    },
    match: "60.55",
    // Failing-first: legacy typed this FOR_WHISH_SEND in USDT → usd delta 0.
    type: "FOR_BINANCE_SEND",
    direction: "DEBIT",
    balDelta: { usd: 62.55, lbp: 0 },
    drawerChecks: [
      { name: "Binance", field: "usdt", delta: -60.55 },
      { name: "General", field: "usd", delta: 0 },
    ],
  },
  {
    label: "Binance RECEIVE 45.56 USDT (fee 1.5) → drawer +45.56, owes 44.06 USD",
    payload: {
      provider: "BINANCE",
      serviceType: "RECEIVE",
      amount: 45.56,
      currency: "USDT",
      commission: 1.5,
    },
    match: "45.56",
    type: "FOR_BINANCE_RECEIVE",
    direction: "CREDIT",
    balDelta: { usd: -44.06, lbp: 0 },
    drawerChecks: [
      { name: "Binance", field: "usdt", delta: 45.56 },
      { name: "General", field: "usd", delta: 0 },
    ],
  },
  {
    label: "iPick catalog SEND cost 90 / price 100.66 → partner owes price",
    payload: {
      provider: "iPick",
      serviceType: "SEND",
      amount: 100.66,
      currency: "USD",
      cost: 90,
      price: 100.66,
    },
    match: "100.66",
    type: "FOR_IPICK",
    direction: "DEBIT",
    balDelta: { usd: 100.66, lbp: 0 },
    drawerChecks: [
      { name: "iPick", field: "usd", delta: -90 },
      // Failing-first: legacy price-inflow credited General +price.
      { name: "General", field: "usd", delta: 0 },
    ],
  },
  {
    label: "Katsh catalog SEND cost 45 / price 50.77 → partner owes price",
    payload: {
      provider: "Katsh",
      serviceType: "SEND",
      amount: 50.77,
      currency: "USD",
      cost: 45,
      price: 50.77,
    },
    match: "50.77",
    type: "FOR_KATSH",
    direction: "DEBIT",
    balDelta: { usd: 50.77, lbp: 0 },
    drawerChecks: [
      { name: "Katsh", field: "usd", delta: -45 },
      { name: "General", field: "usd", delta: 0 },
    ],
  },
];

test.describe("LIRA-119 — financial services for a partner (every provider × direction)", () => {
  for (const c of CASES) {
    test(c.label, async ({ appPage }) => {
      const partnerId = await createPartner(appPage, "L119");
      const before = await snapshot(appPage, partnerId);

      const res = await appPage.evaluate(
        async ({ payload, partnerId }) => {
          const w = window as unknown as Api;
          const r = await w.api.omt.addTransaction({
            ...payload,
            partnerId,
            partnerMode: "FOR",
          });
          const ledger = await w.api.partners.getLedger(partnerId);
          return {
            ok: r.success,
            error: r.error ?? null,
            entries: ledger.entries,
          };
        },
        { payload: c.payload, partnerId },
      );

      expect(res.error).toBeNull();
      expect(res.ok).toBe(true);

      // Identity: the fresh partner has EXACTLY one ledger row — ours.
      expect(res.entries).toHaveLength(1);
      expect(res.entries[0].transaction_type).toBe(c.type);
      expect(res.entries[0].direction).toBe(c.direction);

      const afterCreate = await snapshot(appPage, partnerId);
      expect(afterCreate.bal.usd - before.bal.usd).toBeCloseTo(
        c.balDelta.usd,
        2,
      );
      expect(afterCreate.bal.lbp - before.bal.lbp).toBeCloseTo(
        c.balDelta.lbp,
        0,
      );
      for (const d of c.drawerChecks) {
        expect(
          drawerVal(afterCreate, d.name, d.field) -
            drawerVal(before, d.name, d.field),
          `${d.name}.${d.field} delta after create`,
        ).toBeCloseTo(d.delta, 2);
      }

      // Void (rule 20): partner ledger AND every touched drawer net to 0.
      const voided = await appPage.evaluate(async (match) => {
        const w = window as unknown as Api;
        const row = (await w.api.transactions.getRecent(100)).find(
          (t) =>
            t.type === "FINANCIAL_SERVICE" &&
            (t.summary ?? "").includes(match),
        );
        const r = row
          ? await w.api.transactions.void(row.id)
          : { success: false, error: "txn not found" };
        return { ok: r.success, error: r.error ?? null };
      }, c.match);
      expect(voided.error).toBeNull();
      expect(voided.ok).toBe(true);

      const afterVoid = await snapshot(appPage, partnerId);
      expect(afterVoid.bal.usd - before.bal.usd).toBeCloseTo(0, 2);
      expect(afterVoid.bal.lbp - before.bal.lbp).toBeCloseTo(0, 0);
      for (const d of c.drawerChecks) {
        expect(
          drawerVal(afterVoid, d.name, d.field) -
            drawerVal(before, d.name, d.field),
          `${d.name}.${d.field} delta after void`,
        ).toBeCloseTo(0, 2);
      }
    });
  }

  test("a counter payment (IN leg) on a for-partner financial service is rejected", async ({
    appPage,
  }) => {
    const partnerId = await createPartner(appPage, "L119R");
    const before = await snapshot(appPage, partnerId);

    const res = await appPage.evaluate(async (partnerId) => {
      const w = window as unknown as Api;
      const r = await w.api.omt.addTransaction({
        provider: "OMT_APP",
        serviceType: "SEND",
        amount: 21.99,
        currency: "USD",
        commission: 2,
        partnerId,
        partnerMode: "FOR",
        payments: [
          { method: "CASH", currencyCode: "USD", amount: 23.99, direction: "IN" },
        ],
      });
      return { ok: r.success, error: r.error ?? null };
    }, partnerId);

    // Failing-first: the legacy dispatch ACCEPTED customer IN legs in FOR mode.
    expect(res.ok).toBe(false);
    expect(res.error ?? "").toContain("no counter payment");

    const after = await snapshot(appPage, partnerId);
    expect(after.bal.usd - before.bal.usd).toBeCloseTo(0, 2);
    expect(
      drawerVal(after, "General", "usd") - drawerVal(before, "General", "usd"),
    ).toBeCloseTo(0, 2);
  });
});
