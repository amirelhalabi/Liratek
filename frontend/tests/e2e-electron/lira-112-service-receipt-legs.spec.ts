/**
 * E2E: LIRA-112 (T8/RCP-3) — transactions.getCustomerLegs returns the
 * customer-facing payment legs a service receipt prints, reusing the ONE
 * lira-064 internal-leg filter (rule 14).
 *
 * A financial-service SEND writes internal legs too (provider cost / system
 * reserve / crypto). The receipt must show only the customer's cash leg — so
 * getCustomerLegs must return the customer CASH IN leg and NONE of the
 * internal ones. This is the server-side piece the print helper depends on;
 * the print output itself can't be asserted headless.
 */

import { test, expect } from "./fixtures";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    omt: {
      addTransaction: (
        d: unknown,
      ) => Promise<{ success: boolean; id?: number; error?: string }>;
    };
    transactions: {
      getRecent: (
        n: number,
      ) => Promise<Array<{ id: number; type: string; summary: string | null }>>;
      getCustomerLegs: (id: number) => Promise<
        Array<{
          method: string;
          currency_code: string;
          amount: number;
          direction: "IN" | "OUT";
        }>
      >;
    };
  };
};

test.describe("LIRA-112 — service receipt customer legs", () => {
  test("getCustomerLegs returns the customer cash leg and excludes internal legs", async ({
    appPage,
  }) => {
    const r = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      // OMT App SEND $137.77 (distinctive), paid $139.77 CASH (amount + $2 fee).
      const res = await w.api.omt.addTransaction({
        provider: "OMT_APP",
        serviceType: "SEND",
        amount: 137.77,
        currency: "USD",
        commission: 2,
        paidByMethod: "CASH",
        payments: [
          {
            method: "CASH",
            currencyCode: "USD",
            amount: 139.77,
            direction: "IN",
          },
        ],
        note: `L112 ${Date.now()}`,
      });
      if (!res.success)
        return { ok: false, error: res.error ?? "failed", legs: [] };
      const row = (await w.api.transactions.getRecent(50)).find(
        (t) =>
          t.type === "FINANCIAL_SERVICE" &&
          (t.summary ?? "").includes("137.77"),
      );
      if (!row) return { ok: false, error: "txn not found", legs: [] };
      const legs = await w.api.transactions.getCustomerLegs(row.id);
      return { ok: true, error: null as string | null, legs };
    });

    expect(r.error).toBeNull();
    expect(r.ok).toBe(true);
    // Exactly the customer CASH IN leg — no internal cost/reserve/crypto legs.
    const cashIn = r.legs.filter(
      (l) => l.method === "CASH" && l.direction === "IN",
    );
    expect(cashIn).toHaveLength(1);
    expect(cashIn[0].currency_code).toBe("USD");
    expect(cashIn[0].amount).toBeCloseTo(139.77, 2);
    // No USDT/crypto or system-reserve legs leak through.
    expect(r.legs.every((l) => l.currency_code !== "USDT")).toBe(true);
  });
});
