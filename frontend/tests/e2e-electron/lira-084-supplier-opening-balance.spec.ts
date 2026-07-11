/**
 * E2E: LIRA-084 (B4) — supplier opening balance, both directions
 *
 * A supplier can start with an owed amount in EITHER direction via a signed
 * ADJUSTMENT ledger entry (the Settings → Supplier Ledger manual entry now
 * exposes a direction toggle that signs the amounts):
 *   positive → shop owes the supplier;  negative → supplier owes the shop.
 *
 * IPC-driven; shared accumulating DB → delta assertions on the supplier's
 * balance around each entry.
 */

import { test, expect } from "./fixtures";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    suppliers: {
      list: (
        search: string,
        includeInactive: boolean,
      ) => Promise<Array<{ id: number; provider: string | null }>>;
      getBalances: (
        includeInactive?: boolean,
      ) => Promise<
        Array<{ supplier_id: number; total_usd: number; total_lbp: number }>
      >;
      addLedgerEntry: (data: {
        supplier_id: number;
        entry_type: string;
        amount_usd: number;
        amount_lbp: number;
        note?: string;
      }) => Promise<{ success: boolean; error?: string }>;
    };
  };
};

test.describe("LIRA-084 (B4) — supplier opening balance", () => {
  test("signed ADJUSTMENT moves the balance in both directions", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const omt = (await w.api.suppliers.list("", true)).find(
        (s) => s.provider === "OMT",
      );
      if (!omt) throw new Error("OMT supplier not found");

      const balance = async () => {
        const b = (await w.api.suppliers.getBalances(true)).find(
          (x) => x.supplier_id === omt.id,
        );
        return { usd: b?.total_usd ?? 0, lbp: b?.total_lbp ?? 0 };
      };

      const baseline = await balance();

      // Direction 1: shop owes supplier (+100 USD / +2,000,000 LBP)
      const weOwe = await w.api.suppliers.addLedgerEntry({
        supplier_id: omt.id,
        entry_type: "ADJUSTMENT",
        amount_usd: 100,
        amount_lbp: 2_000_000,
        note: "B4 opening balance — we owe",
      });
      const afterWeOwe = await balance();

      // Direction 2: supplier owes shop (−80 USD)
      const owesUs = await w.api.suppliers.addLedgerEntry({
        supplier_id: omt.id,
        entry_type: "ADJUSTMENT",
        amount_usd: -80,
        amount_lbp: 0,
        note: "B4 opening balance — supplier owes us",
      });
      const afterOwesUs = await balance();

      return {
        weOweOk: weOwe.success === true,
        weOweError: weOwe.error ?? null,
        owesUsOk: owesUs.success === true,
        owesUsError: owesUs.error ?? null,
        d1usd: afterWeOwe.usd - baseline.usd,
        d1lbp: afterWeOwe.lbp - baseline.lbp,
        d2usd: afterOwesUs.usd - afterWeOwe.usd,
        d2lbp: afterOwesUs.lbp - afterWeOwe.lbp,
      };
    });

    expect(result.weOweError).toBeNull();
    expect(result.weOweOk).toBe(true);
    expect(result.owesUsError).toBeNull();
    expect(result.owesUsOk).toBe(true);

    // Shop-owes-supplier: balance up by exactly the signed amounts.
    expect(result.d1usd).toBeCloseTo(100, 2);
    expect(result.d1lbp).toBeCloseTo(2_000_000, 2);
    // Supplier-owes-shop: balance DOWN — the sign passes through.
    expect(result.d2usd).toBeCloseTo(-80, 2);
    expect(result.d2lbp).toBeCloseTo(0, 2);
  });
});
