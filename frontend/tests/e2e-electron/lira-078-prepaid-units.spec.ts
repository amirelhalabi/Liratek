/**
 * E2E: LIRA-078 (C5) — prepaid-units supplier debt model
 *
 * Supplier debt is booked ONCE at top-up time; sales only draw down the
 * provider drawer (no per-sale SALE_COST). Loto stays the exception (its
 * sale DOES increase what the shop owes LOTO). Katsh bills: cash bill
 * increases General, and the row shows no misleading system "out".
 *
 * IPC-driven; shared accumulating DB → all assertions are DELTAS.
 */

import { test, expect } from "./fixtures";

test.describe.configure({ retries: 0 });

type SupplierBalance = {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
};

type Api = {
  api: {
    suppliers: {
      list: (
        search: string,
        includeInactive: boolean,
      ) => Promise<Array<{ id: number; provider: string | null }>>;
      getBalances: (includeInactive?: boolean) => Promise<SupplierBalance[]>;
    };
    recharge: {
      getDrawerBalances: () => Promise<
        Array<{ name: string; usdBalance: number; lbpBalance: number }>
      >;
      topUpFromSupplier: (data: {
        provider: string;
        amount: number;
        currency: string;
      }) => Promise<{ success: boolean; error?: string }>;
    };
    omt: {
      addTransaction: (data: {
        provider: string;
        serviceType: "SEND" | "BILL";
        amount: number;
        cost?: number;
        price?: number;
        currency?: string;
        commission?: number;
        paidByMethod?: string;
      }) => Promise<{ success?: boolean; id?: number; error?: string }>;
    };
    loto: {
      sell: (data: {
        sale_amount: number;
        payment_method?: string;
      }) => Promise<{ success: boolean; error?: string }>;
    };
    transactions: {
      getRecent: (
        limit: number,
      ) => Promise<
        Array<{
          id: number;
          type: string;
          source_table: string;
          source_id: number;
          summary: string | null;
          payments: Array<{ direction: "in" | "out"; amount: number }>;
        }>
      >;
    };
  };
};

/** Snapshot a supplier's balance (by provider) + a drawer's balance. */
async function snapshot(
  appPage: import("@playwright/test").Page,
  provider: string,
  drawerName: string,
) {
  return appPage.evaluate(
    async ({ provider, drawerName }) => {
      const w = window as unknown as Api;
      const supplier = (await w.api.suppliers.list("", true)).find(
        (s) => s.provider === provider,
      );
      const bal = supplier
        ? (await w.api.suppliers.getBalances(true)).find(
            (b) => b.supplier_id === supplier.id,
          )
        : undefined;
      const drawer = (await w.api.recharge.getDrawerBalances()).find(
        (d) => d.name === drawerName,
      );
      return {
        supplierUsd: bal?.total_usd ?? 0,
        supplierLbp: bal?.total_lbp ?? 0,
        drawerUsd: drawer?.usdBalance ?? 0,
        drawerLbp: drawer?.lbpBalance ?? 0,
      };
    },
    { provider, drawerName },
  );
}

test.describe("LIRA-078 (C5) — prepaid-units model", () => {
  test("supplier top-up books the drawer AND the debt (Katsh +40/+40)", async ({
    appPage,
  }) => {
    const before = await snapshot(appPage, "Katsh", "Katsh");

    const res = await appPage.evaluate(() =>
      (window as unknown as Api).api.recharge.topUpFromSupplier({
        provider: "Katsh",
        amount: 40,
        currency: "USD",
      }),
    );
    expect(res.error ?? null).toBeNull();
    expect(res.success).toBe(true);

    const after = await snapshot(appPage, "Katsh", "Katsh");
    expect(after.drawerUsd - before.drawerUsd).toBeCloseTo(40, 2);
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(40, 2);
  });

  test("a cost/price sale draws down the drawer with NO supplier ledger change", async ({
    appPage,
  }) => {
    const before = await snapshot(appPage, "Katsh", "Katsh");

    // Katsh card sale: cost $9 from the Katsh drawer, customer pays $10.
    const res = await appPage.evaluate(() =>
      (window as unknown as Api).api.omt.addTransaction({
        provider: "Katsh",
        serviceType: "SEND",
        amount: 10,
        cost: 9,
        price: 10,
        currency: "USD",
        commission: 0,
        paidByMethod: "CASH",
      }),
    );
    expect(res.error ?? null).toBeNull();
    expect(res.success).toBe(true);

    const after = await snapshot(appPage, "Katsh", "Katsh");
    // Drawer draw-down by cost…
    expect(after.drawerUsd - before.drawerUsd).toBeCloseTo(-9, 2);
    // …and the supplier balance is UNTOUCHED (pre-C5: +9 SALE_COST per sale).
    expect(after.supplierUsd - before.supplierUsd).toBeCloseTo(0, 2);
    expect(after.supplierLbp - before.supplierLbp).toBeCloseTo(0, 2);
  });

  test("loto sale is the exception: supplier owed DOES increase", async ({
    appPage,
  }) => {
    const before = await snapshot(appPage, "LOTO", "General");

    const res = await appPage.evaluate(() =>
      (window as unknown as Api).api.loto.sell({
        sale_amount: 100_000,
        payment_method: "CASH",
      }),
    );
    expect(res.error ?? null).toBeNull();
    expect(res.success).toBe(true);

    const after = await snapshot(appPage, "LOTO", "General");
    // The shop owes LOTO more after the sale. NOTE: loto books its liability
    // with the INVERSE sign convention — a negative PAYMENT entry of
    // −(sale_amount − commission) — so "owed increases" means the balance
    // moves DOWN by that amount (LotoTicketRepository.createTicket).
    const delta = after.supplierLbp - before.supplierLbp;
    expect(delta).toBeLessThan(0);
    // Magnitude = sale − commission: more than 0, at most the sale amount.
    expect(Math.abs(delta)).toBeGreaterThan(0);
    expect(Math.abs(delta)).toBeLessThanOrEqual(100_000);
  });

  test("katsh bill via cash: General INCREASES by the bill amount; row shows no misleading out", async ({
    appPage,
  }) => {
    const before = await snapshot(appPage, "Katsh", "General");

    const res = await appPage.evaluate(() =>
      (window as unknown as Api).api.omt.addTransaction({
        provider: "Katsh",
        serviceType: "BILL",
        amount: 150_000,
        cost: 150_000,
        price: 150_000,
        currency: "LBP",
        commission: 0,
        paidByMethod: "CASH",
      }),
    );
    expect(res.error ?? null).toBeNull();
    expect(res.success).toBe(true);
    const billId = res.id ?? null;
    expect(billId).not.toBeNull();

    const after = await snapshot(appPage, "Katsh", "General");
    // Customer's cash arrives in General.
    expect(after.drawerLbp - before.drawerLbp).toBeCloseTo(150_000, 2);

    // The bill row's payment legs: customer cash IN only — the Katsh system
    // cost leg must not leak into the summary as a misleading "out".
    // Identity match by source_table + source_id (rule 15), never row position.
    const row = await appPage.evaluate(async (id) => {
      const w = window as unknown as Api;
      const recent = await w.api.transactions.getRecent(100);
      return (
        recent.find(
          (t) =>
            t.type === "FINANCIAL_SERVICE" &&
            t.source_table === "financial_services" &&
            t.source_id === id,
        ) ?? null
      );
    }, billId);

    expect(row).not.toBeNull();
    const inLegs = row!.payments.filter((p) => p.direction === "in");
    const outLegs = row!.payments.filter((p) => p.direction === "out");
    expect(inLegs.length).toBeGreaterThan(0);
    expect(outLegs).toHaveLength(0);
  });
});
