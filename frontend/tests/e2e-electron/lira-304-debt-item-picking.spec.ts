/**
 * lira-304 — LIRA-304 over the DESKTOP transport (IPC), mirroring the web
 * twin lira-web-051: a customer basket on Customer Account (OMT send $100 +
 * $1 fee, a $9 custom service), then a $50 cash repayment with the basket's
 * OMT send ticked → the OMT cash drawer (OMT_System) rises by $50 and
 * General does not move. Drawer DELTAS and identity only (rule 15 — the
 * suite shares one accumulating DB).
 *
 * Runs in CI's desktop job only (no Electron on the owner's Mac).
 */
import { test, expect } from "./fixtures";

interface Api {
  api: {
    session: {
      start: (d: Record<string, unknown>) => Promise<{ sessionId?: number }>;
      getActive: () => Promise<{ session?: { id: number } }>;
      checkout: (d: Record<string, unknown>) => Promise<{
        success: boolean;
        error?: string;
      }>;
    };
    debt: {
      getDebtors: () => Promise<Array<{ id: number; full_name: string }>>;
      getOpenItems: (clientId: number) => Promise<
        Array<{ kind: string; id: number; isPrimary: boolean; openUsd: number }>
      >;
      addRepayment: (d: Record<string, unknown>) => Promise<{
        success: boolean;
        error?: string;
      }>;
    };
    dashboard: {
      getDrawerBalances: () => Promise<unknown>;
    };
  };
}

test("basket on account → tick the OMT send → $50 lands in the OMT cash drawer (desktop)", async ({
  appPage,
}) => {
  const result = await appPage.evaluate(async () => {
    const w = window as unknown as Api;
    const name = `E2E 304 Picker ${Date.now()}`;
    const drawers = async () => {
      const raw = (await w.api.dashboard.getDrawerBalances()) as {
        balances?: Record<string, { usd: number }>;
      } & Record<string, { usd: number }>;
      const b = raw.balances ?? raw;
      return { general: b.generalDrawer.usd, pcd: b.omtDrawer.usd };
    };

    const started = await w.api.session.start({
      customer_name: name,
      customer_phone: `0330${Date.now().toString().slice(-6)}`,
      started_by: "admin",
    });
    const sessionId =
      started.sessionId ?? (await w.api.session.getActive()).session?.id;

    const checkout = await w.api.session.checkout({
      sessionId,
      cartItems: [
        {
          id: "e2e-304-omt",
          module: "omt_system",
          label: "E2E 304 OMT SEND",
          amount: 101,
          currency: "USD",
          ipcChannel: "financial:create",
          formData: {
            provider: "OMT",
            serviceType: "SEND",
            amount: 100,
            currency: "USD",
            omtServiceType: "INTRA",
            omtFee: 1,
          },
        },
        {
          id: "e2e-304-cs",
          module: "custom_service",
          label: "E2E 304 Svc",
          amount: 9,
          currency: "USD",
          ipcChannel: "custom-services:add",
          formData: {
            description: "E2E 304 Svc",
            cost_usd: 7,
            cost_lbp: 0,
            price_usd: 9,
            price_lbp: 0,
          },
        },
      ],
      payments: [
        { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 110 },
      ],
      exchangeRate: 89_000,
      userId: 1,
    });

    const client = (await w.api.debt.getDebtors()).find(
      (d) => d.full_name === name,
    );
    const items = client ? await w.api.debt.getOpenItems(client.id) : [];
    const omt = items.find((i) => i.kind === "member" && i.isPrimary);

    const before = await drawers();
    const repaid =
      client && omt
        ? await w.api.debt.addRepayment({
            clientId: client.id,
            amountUSD: 50,
            amountLBP: 0,
            payments: [{ method: "CASH", currencyCode: "USD", amount: 50 }],
            tender_exchange_rate: 89_000,
            targets: [{ kind: "member", id: omt.id }],
          })
        : { success: false, error: "no client/item" };
    const after = await drawers();

    return {
      checkoutOk: checkout.success,
      checkoutError: checkout.error ?? null,
      foundClient: !!client,
      omtOpen: omt?.openUsd ?? null,
      repaidOk: repaid.success,
      repaidError: repaid.error ?? null,
      pcdDelta: after.pcd - before.pcd,
      generalDelta: after.general - before.general,
    };
  });

  expect(result.checkoutOk, String(result.checkoutError)).toBe(true);
  expect(result.foundClient).toBe(true);
  expect(result.omtOpen).toBeCloseTo(101, 2);
  expect(result.repaidOk, String(result.repaidError)).toBe(true);
  expect(result.pcdDelta).toBeCloseTo(50, 2);
  expect(result.generalDelta).toBeCloseTo(0, 2);
});
