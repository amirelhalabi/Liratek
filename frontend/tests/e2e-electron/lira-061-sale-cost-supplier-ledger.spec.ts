/**
 * E2E: LIRA-061 → C5 — cost/price SEND under the prepaid-units model
 *
 * HISTORY: LIRA-061 originally made every cost/price sale book a settleable
 * SALE_COST supplier-ledger entry. The C5 prepaid-units redesign supersedes
 * that: supplier debt is booked ONCE at top-up time (TOP_UP via
 * recharge.topUpFromSupplier), and a sale only draws down the provider drawer.
 * Booking a per-sale SALE_COST double-counted the debt the top-up had already
 * created. Legacy pre-C5 rows (supplier_debt_booked=1) remain settleable —
 * covered by unit tests (FinancialServiceRepository.saleCost.test.ts).
 *
 * This spec asserts the C5 contract end-to-end for each cost/price provider:
 *   - SEND moves the drawers (provider −cost, General +price)
 *   - SEND adds NO supplier-ledger row and leaves the supplier balance frozen
 *   - SEND does NOT appear in the Settle tab's unsettled list
 *   - top-up debt is still paid down via suppliers.recordCashflow PAY
 *
 * Shared accumulating DB → all assertions are deltas around each action.
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

type LedgerRow = {
  id: number;
  entry_type: string;
  amount_usd: number;
  amount_lbp: number;
};

type SupplierBalanceRow = {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
};

type ProviderDrawerRow = {
  name: string;
  usdBalance: number;
  lbpBalance: number;
};

type SuccessEnvelope = { success?: boolean; id?: number; error?: string };

type SupplierApi = {
  api: {
    omt: {
      addTransaction: (data: Record<string, unknown>) => Promise<unknown>;
    };
    recharge: {
      getDrawerBalances: () => Promise<ProviderDrawerRow[]>;
      topUpFromSupplier: (data: {
        provider: string;
        amount: number;
        currency: string;
      }) => Promise<{ success: boolean; error?: string }>;
    };
    suppliers: {
      list: (
        search?: string,
        includeInactive?: boolean,
      ) => Promise<Array<{ id: number; provider: string | null }>>;
      getLedger: (supplierId: number, limit?: number) => Promise<LedgerRow[]>;
      getBalances: (includeInactive?: boolean) => Promise<SupplierBalanceRow[]>;
      getUnsettledTransactions: (
        provider: string,
      ) => Promise<Array<{ id: number }>>;
      recordCashflow: (data: {
        supplier_id: number;
        direction: "PAY" | "RECEIVE";
        payments: Array<{
          method: string;
          currency_code: string;
          amount: number;
        }>;
        note?: string;
      }) => Promise<SuccessEnvelope>;
    };
  };
};

/**
 * Run a cost/price SEND for `provider` and capture deltas on: the provider's
 * ledger row count, supplier balance, unsettled list size, provider drawer,
 * and General drawer.
 */
async function sendAndCapture(
  appPage: Page,
  provider: string,
  drawerName: string,
  cost: number,
  price: number,
) {
  return appPage.evaluate(
    async ({ provider, drawerName, cost, price }) => {
      const w = window as unknown as SupplierApi;

      const supplier = (await w.api.suppliers.list("", true)).find(
        (s) => s.provider === provider,
      );
      if (!supplier) throw new Error(`${provider} supplier not found`);

      const balOf = async () =>
        (await w.api.suppliers.getBalances(true)).find(
          (b) => b.supplier_id === supplier.id,
        )?.total_usd ?? 0;
      const drawerOf = async (name: string) =>
        (await w.api.recharge.getDrawerBalances()).find((d) => d.name === name)
          ?.usdBalance ?? 0;

      const ledgerBefore = (await w.api.suppliers.getLedger(supplier.id, 500))
        .length;
      const balanceBefore = await balOf();
      const unsettledBefore = (
        await w.api.suppliers.getUnsettledTransactions(provider)
      ).length;
      const providerBefore = await drawerOf(drawerName);
      const generalBefore = await drawerOf("General");

      const res = (await w.api.omt.addTransaction({
        provider,
        serviceType: "SEND",
        amount: price,
        cost,
        price,
        currency: "USD",
        commission: 0,
        paidByMethod: "CASH",
      })) as SuccessEnvelope;

      return {
        ok: res?.success === true,
        error: res?.error ?? null,
        ledgerDelta:
          (await w.api.suppliers.getLedger(supplier.id, 500)).length -
          ledgerBefore,
        balanceDelta: (await balOf()) - balanceBefore,
        unsettledDelta:
          (await w.api.suppliers.getUnsettledTransactions(provider)).length -
          unsettledBefore,
        providerDrawerDelta: (await drawerOf(drawerName)) - providerBefore,
        generalDrawerDelta: (await drawerOf("General")) - generalBefore,
      };
    },
    { provider, drawerName, cost, price },
  );
}

test.describe("C5 — cost/price SEND: drawer draw-down only, no per-sale supplier debt", () => {
  for (const [provider, drawerName] of [
    ["Katsh", "Katsh"],
    ["iPick", "iPick"],
    ["WHISH_APP", "Whish_App"],
  ] as const) {
    test(`${provider} SEND: ${drawerName} −90, General +100, NO ledger row, not settleable`, async ({
      appPage,
    }) => {
      const r = await sendAndCapture(appPage, provider, drawerName, 90, 100);

      expect(r.error).toBeNull();
      expect(r.ok).toBe(true);

      // Drawers move…
      expect(r.providerDrawerDelta).toBeCloseTo(-90, 2);
      expect(r.generalDrawerDelta).toBeCloseTo(100, 2);

      // …the supplier ledger does NOT (pre-C5: +1 SALE_COST row, balance +90).
      expect(r.ledgerDelta).toBe(0);
      expect(r.balanceDelta).toBeCloseTo(0, 2);
      // And the sale is not individually settleable (no SALE_COST to net).
      expect(r.unsettledDelta).toBe(0);
    });
  }

  test("top-up debt is paid down via recordCashflow PAY (prepaid reconciliation)", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as SupplierApi;

      const supplier = (await w.api.suppliers.list("", true)).find(
        (s) => s.provider === "iPick",
      );
      if (!supplier) throw new Error("iPick supplier not found");
      const balOf = async () =>
        (await w.api.suppliers.getBalances(true)).find(
          (b) => b.supplier_id === supplier.id,
        )?.total_usd ?? 0;

      const baseline = await balOf();

      // Top-up: the supplier extends $50 of credit → debt booked ONCE.
      const topUp = await w.api.recharge.topUpFromSupplier({
        provider: "iPick",
        amount: 50,
        currency: "USD",
      });

      const afterTopUp = await balOf();

      // A sale in between must not move the supplier balance.
      await w.api.omt.addTransaction({
        provider: "iPick",
        serviceType: "SEND",
        amount: 40,
        cost: 30,
        price: 40,
        currency: "USD",
        commission: 0,
        paidByMethod: "CASH",
      });
      const afterSale = await balOf();

      // Pay the supplier back.
      const pay = await w.api.suppliers.recordCashflow({
        supplier_id: supplier.id,
        direction: "PAY",
        payments: [{ method: "CASH", currency_code: "USD", amount: 50 }],
        note: "C5 pay-down",
      });
      const afterPay = await balOf();

      return {
        topUpOk: topUp.success === true,
        topUpError: topUp.error ?? null,
        payOk: pay.success === true,
        payError: pay.error ?? null,
        topUpDelta: afterTopUp - baseline,
        saleDelta: afterSale - afterTopUp,
        payDelta: afterPay - afterSale,
        netDelta: afterPay - baseline,
      };
    });

    expect(result.topUpError).toBeNull();
    expect(result.topUpOk).toBe(true);
    expect(result.payError).toBeNull();
    expect(result.payOk).toBe(true);

    // Top-up +50 → sale ±0 → PAY −50 → net zero.
    expect(result.topUpDelta).toBeCloseTo(50, 2);
    expect(result.saleDelta).toBeCloseTo(0, 2);
    expect(result.payDelta).toBeCloseTo(-50, 2);
    expect(result.netDelta).toBeCloseTo(0, 4);
  });
});
