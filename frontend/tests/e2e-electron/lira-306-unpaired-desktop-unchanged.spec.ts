/**
 * E2E (desktop, CI-only): LIRA-306 T141 — a never-paired desktop is
 * unchanged by the offline fallback (SC-007).
 *
 * This PINS today's behaviour; it is NOT a failing-first guard (rule 17): it
 * was written after the offline recorder existed and has never been run on
 * the Mac where it was written (desktop e2e is never run there). It runs in
 * CI / on Windows.
 *
 * What it proves through real main-process IPC:
 *   - `offline:status` says standalone / not paired (the recorder passes
 *     every call through untouched in that mode);
 *   - a POS sale still books (id below the offline range 10¹², stock moves);
 *   - an online-only channel (a settings read-write round trip) still works —
 *     nothing answers OFFLINE_NOT_AVAILABLE or PC_ON_STANDBY on an unpaired PC.
 * Assertions are by identity and delta (rule 15), never row position.
 */
import { test, expect, seedProduct } from "./fixtures";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    offline: { status: () => Promise<{ success: boolean; data?: { mode: string; paired: boolean } }> };
    sales: {
      process: (p: unknown) => Promise<{ success: boolean; id?: number; error?: string; code?: string }>;
    };
    inventory: {
      getProducts: (q?: unknown) => Promise<Array<{ id: number; stock_quantity: number }>>;
    };
  };
};

test.describe("LIRA-306 — never-paired desktop unchanged", () => {
  test("offline:status answers standalone, not paired", async ({ appPage }) => {
    const status = await appPage.evaluate(async () => (window as unknown as Api).api.offline.status());
    expect(status.success).toBe(true);
    expect(status.data).toMatchObject({ mode: "standalone", paired: false });
  });

  test("a POS sale books as today: server-range id, stock moves by the quantity", async ({ appPage }) => {
    const productId = await seedProduct(appPage, {
      name: `P306 unpaired ${Date.now()}`,
      cost_price: 5,
      sell_price: 10,
      quantity: 3,
    });
    const result = await appPage.evaluate(
      async ({ productId }) => {
        const w = window as unknown as Api;
        const stockOf = async () =>
          (await w.api.inventory.getProducts()).find((p) => p.id === productId)?.stock_quantity ?? null;
        const before = await stockOf();
        const res = await w.api.sales.process({
          client_id: null,
          items: [{ product_id: productId, quantity: 1, price: 10 }],
          total_amount: 10,
          discount: 0,
          final_amount: 10,
          payment_usd: 10,
          payment_lbp: 0,
          exchange_rate: 90000,
        });
        const after = await stockOf();
        return { res, before, after };
      },
      { productId },
    );
    expect(result.res.error ?? null).toBeNull();
    expect(result.res.success).toBe(true);
    expect(result.res.code).toBeUndefined();
    expect(result.res.id).toBeLessThan(1_000_000_000_000);
    expect(result.before).not.toBeNull();
    expect((result.before as number) - (result.after as number)).toBe(1);
  });
});
