/**
 * E2E: LIRA-108 (T3, KC-3) — keep-change profit stamps across the remaining
 * modules: custom services, maintenance, loto tickets, telecom recharges.
 *
 * Each module's create accepts kept_change_usd/lbp (tender-native, per
 * docs/plans/T3_KEEP_CHANGE_PLAN.md) and adds them to the transaction's
 * per-currency profit stamp, visible as the module's profit delta in
 * profits.summary (rule 15: wide-range delta assertions, IPC-driven).
 *
 * Rule 17 (failing-first): three of the four modules validate against LOCAL
 * electron schema duplicates (recharge, maintenance, custom services — the
 * rule-14 debt documented in electron-app/schemas/index.ts); with the
 * pre-KC-3 electron dist those schemas STRIP the kept fields and this spec's
 * profit deltas come up short (loto re-exports the core schema, so it goes
 * green as soon as core is rebuilt). Proof run recorded in the plan.
 */

import { test, expect, seedProduct as _sp } from "./fixtures";

test.describe.configure({ retries: 0 });

const FROM = "2000-01-01";
const TO = "2099-12-31";

type Summary = {
  custom_services: { profit_usd: number };
  maintenance: { profit_usd: number };
  loto: { profit_lbp: number };
  recharges: { profit_lbp: number };
};

type Api = {
  api: {
    profits: { summary: (f: string, t: string) => Promise<Summary> };
    customServices: {
      add: (d: unknown) => Promise<{ success: boolean; error?: string }>;
    };
    maintenance: {
      save: (d: unknown) => Promise<{ success: boolean; error?: string }>;
    };
    loto: {
      sell: (d: unknown) => Promise<{ success?: boolean; error?: string }>;
    };
    recharge: {
      process: (d: unknown) => Promise<{ success: boolean; error?: string }>;
    };
  };
};

test.describe("LIRA-108 — keep-change across modules", () => {
  test("custom service: kept $5 joins the profit stamp (margin 30 → delta 35)", async ({
    appPage,
  }) => {
    const r = await appPage.evaluate(
      async ({ FROM, TO }) => {
        const w = window as unknown as Api;
        const s = async () =>
          (await w.api.profits.summary(FROM, TO)).custom_services.profit_usd;
        const before = await s();
        const res = await w.api.customServices.add({
          description: `L108 svc ${Date.now()}`,
          cost_usd: 10,
          price_usd: 40,
          paid_by: "CASH",
          payments: [
            { method: "CASH", currency_code: "USD", amount: 45 },
          ],
          kept_change_usd: 5,
          kept_change_lbp: 0,
        });
        return { ok: res.success, error: res.error ?? null, delta: (await s()) - before };
      },
      { FROM, TO },
    );
    expect(r.error).toBeNull();
    expect(r.ok).toBe(true);
    expect(r.delta).toBeCloseTo(35, 2); // 30 margin + 5 kept; pre-fix: 30
  });

  test("maintenance: kept $3 joins the profit stamp (profit 20 → delta 23)", async ({
    appPage,
  }) => {
    const r = await appPage.evaluate(
      async ({ FROM, TO }) => {
        const w = window as unknown as Api;
        const s = async () =>
          (await w.api.profits.summary(FROM, TO)).maintenance.profit_usd;
        const before = await s();
        const res = await w.api.maintenance.save({
          device_name: `L108 phone ${Date.now()}`,
          issue_description: "keep-change e2e",
          cost_usd: 30,
          price_usd: 50,
          final_amount_usd: 50,
          currency: "USD",
          exchange_rate: 90000,
          status: "Delivered_Paid",
          paid_usd: 53,
          paid_lbp: 0,
          payments: [
            { method: "CASH", currency_code: "USD", amount: 53, direction: "IN" },
          ],
          kept_change_usd: 3,
          kept_change_lbp: 0,
        });
        return { ok: res.success, error: res.error ?? null, delta: (await s()) - before };
      },
      { FROM, TO },
    );
    expect(r.error).toBeNull();
    expect(r.ok).toBe(true);
    expect(r.delta).toBeCloseTo(23, 2); // 20 margin + 3 kept; pre-fix: 20
  });

  test("loto ticket: kept 50,000 LBP joins the commission stamp", async ({
    appPage,
  }) => {
    const r = await appPage.evaluate(
      async ({ FROM, TO }) => {
        const w = window as unknown as Api;
        const s = async () =>
          (await w.api.profits.summary(FROM, TO)).loto.profit_lbp;
        const before = await s();
        // 200,000 sale at 5% → 10,000 commission; kept 50,000 → delta 60,000.
        const res = (await w.api.loto.sell({
          sale_amount: 200_000,
          commission_rate: 0.05,
          commission_amount: 10_000,
          payment_method: "CASH",
          currency: "LBP",
          payments: [
            {
              method: "CASH",
              currencyCode: "LBP",
              amount: 250_000,
              direction: "IN",
            },
          ],
          kept_change_usd: 0,
          kept_change_lbp: 50_000,
        })) as { success?: boolean; error?: string };
        return {
          ok: res.success !== false,
          error: res.error ?? null,
          delta: (await s()) - before,
        };
      },
      { FROM, TO },
    );
    expect(r.error).toBeNull();
    expect(r.ok).toBe(true);
    expect(r.delta).toBeCloseTo(60_000, 0); // pre-fix: 10,000
  });

  test("telecom recharge: kept 30,000 LBP joins the commission stamp", async ({
    appPage,
  }) => {
    const r = await appPage.evaluate(
      async ({ FROM, TO }) => {
        const w = window as unknown as Api;
        const s = async () =>
          (await w.api.profits.summary(FROM, TO)).recharges.profit_lbp;
        const before = await s();
        // DAYS recharge (no SMS cost): LBP-priced, commission = price − cost.
        const res = await w.api.recharge.process({
          provider: "MTC",
          type: "DAYS",
          amount: 10,
          cost: 850_000,
          price: 900_000,
          currency: "LBP",
          paid_by_method: "CASH",
          kept_change_usd: 0,
          kept_change_lbp: 30_000,
        });
        return { ok: res.success, error: res.error ?? null, delta: (await s()) - before };
      },
      { FROM, TO },
    );
    expect(r.error).toBeNull();
    expect(r.ok).toBe(true);
    expect(r.delta).toBeCloseTo(80_000, 0); // 50,000 commission + 30,000 kept; pre-fix: 50,000
  });
});
