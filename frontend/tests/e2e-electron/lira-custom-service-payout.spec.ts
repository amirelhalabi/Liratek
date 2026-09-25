/**
 * NOT RUN — the owner runs the e2e suite later (fix-round I4).
 *
 * E2E (desktop/IPC): OWNER_NOTES_REMAINING_BUILD.md #16 — Custom Services
 * "Pay out" (Route A, the Syria transfer OUT, migration v185, fix-round I4).
 *
 * "Pay out" is NOT a third partner mode — it is `partner_mode: 'VIA'` with
 * `direction: 'OUT'` instead of the default 'IN'. Owner's own worked
 * example: $100 arrives via the partner, the recipient gets $97 cash, $3 is
 * profit (commission), booked the same day.
 *   - price_usd = what the PARTNER now owes the shop (THROUGH_CUSTOM_SERVICE
 *     partner_ledger DEBIT — "partner owes us").
 *   - cost_usd  = what physically leaves the General drawer to the
 *     recipient, CASH only — the owner was explicit that Syria never
 *     touches the Whish system drawer (rule 16: an OUT leg through the
 *     shared end-of-transaction loop, never a second posting site).
 *   - profit_usd stays price − cost (the commission), realized same day.
 *
 * Drives the same IPC surface the frontend calls (`window.api.customServices.*`)
 * rather than the page DOM — same pattern as lira-119-partner-for-financial-
 * service.spec.ts. Rule 15: a fresh partner per run, matched by returned id,
 * deltas only, never absolute totals or row position.
 */

import { test, expect } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

type LedgerEntry = {
  transaction_type: string | null;
  amount: number;
  currency: string;
  direction: "DEBIT" | "CREDIT";
  reference_table: string | null;
  reference_id: number | null;
};

type RecentTxn = {
  id: number;
  type: string;
  source_table: string;
  source_id: number;
  amount_usd: number;
  profit_usd: number;
  metadata_json: string | null;
};

type Api = {
  api: {
    partners: {
      create: (d: { name: string; phone?: string }) => Promise<{
        success: boolean;
        data?: { id: number };
        error?: string;
      }>;
      getBalance: (id: number) => Promise<{ usd: number; lbp: number }>;
      getLedger: (id: number) => Promise<{ entries: LedgerEntry[] }>;
    };
    customServices: {
      add: (data: Record<string, unknown>) => Promise<{
        success: boolean;
        id?: number;
        error?: string;
      }>;
      delete: (id: number) => Promise<{ success: boolean; error?: string }>;
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
        limit?: number,
        filters?: Record<string, unknown>,
      ) => Promise<RecentTxn[]>;
    };
  };
};

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

async function drawerUsd(page: Page, name: string): Promise<number> {
  return page.evaluate(async (n) => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    return rows.find((r) => r.name === n)?.usdBalance ?? 0;
  }, name);
}

async function partnerBalanceUsd(page: Page, partnerId: number): Promise<number> {
  return page.evaluate(async (id) => {
    const w = window as unknown as Api;
    const bal = await w.api.partners.getBalance(id);
    return bal.usd;
  }, partnerId);
}

async function partnerLedger(
  page: Page,
  partnerId: number,
): Promise<LedgerEntry[]> {
  return page.evaluate(async (id) => {
    const w = window as unknown as Api;
    const r = await w.api.partners.getLedger(id);
    return r.entries;
  }, partnerId);
}

test("Pay out: $100 arrives, $97 leaves General, $3 profit — badge OUT, void nets to 0", async ({
  appPage,
}) => {
  const partnerId = await createPartner(appPage, "L-e2e Syria Corridor");

  const generalBefore = await drawerUsd(appPage, "General");
  const whishBefore = await drawerUsd(appPage, "Whish_System");

  const add = await appPage.evaluate(async (pid) => {
    const w = window as unknown as Api;
    return w.api.customServices.add({
      description: "L-e2e Syria transfer payout",
      price_usd: 100,
      cost_usd: 97,
      partnerId: pid,
      partnerMode: "VIA",
      direction: "OUT",
    });
  }, partnerId);
  expect(add.success, JSON.stringify(add)).toBeTruthy();
  const serviceId = add.id as number;
  expect(serviceId).toBeTruthy();

  // Drawer: exactly the $97 payout left General; Whish_System is untouched
  // (owner: "Syria never touches the Whish system drawer").
  expect(await drawerUsd(appPage, "General")).toBeCloseTo(
    generalBefore - 97,
    2,
  );
  expect(await drawerUsd(appPage, "Whish_System")).toBeCloseTo(
    whishBefore,
    2,
  );

  // Partner ledger: ONE THROUGH_CUSTOM_SERVICE DEBIT for the full $100 that
  // "arrived" via the partner — never the $97 payout figure.
  const ledgerAfterCreate = await partnerLedger(appPage, partnerId);
  const debitRow = ledgerAfterCreate.find(
    (e) =>
      e.transaction_type === "THROUGH_CUSTOM_SERVICE" &&
      e.reference_table === "custom_services" &&
      e.reference_id === serviceId,
  );
  expect(debitRow, JSON.stringify(ledgerAfterCreate)).toBeTruthy();
  expect(debitRow!.direction).toBe("DEBIT");
  expect(debitRow!.amount).toBeCloseTo(100, 2);
  expect(await partnerBalanceUsd(appPage, partnerId)).toBeCloseTo(100, 2);

  // The unified transaction row: identity-matched by source_table +
  // source_id (rule 15 — never "the newest row"). Face amount is the
  // payout (cost), profit is the commission, badge (metadata_json.direction)
  // is OUT.
  const recent = await appPage.evaluate(async () => {
    const w = window as unknown as Api;
    return w.api.transactions.getRecent(50, { source_table: "custom_services" });
  });
  const row = recent.find((r) => r.source_id === serviceId);
  expect(row, JSON.stringify(recent.slice(0, 5))).toBeTruthy();
  expect(row!.amount_usd).toBeCloseTo(97, 2);
  expect(row!.profit_usd).toBeCloseTo(3, 2);
  const meta = row!.metadata_json ? JSON.parse(row!.metadata_json) : {};
  expect(meta.direction).toBe("OUT");

  // Void: create + void nets every ledger touched to 0 (rule 20).
  const voidResult = await appPage.evaluate(async (id) => {
    const w = window as unknown as Api;
    return w.api.customServices.delete(id);
  }, serviceId);
  expect(voidResult.success, JSON.stringify(voidResult)).toBeTruthy();

  expect(await drawerUsd(appPage, "General")).toBeCloseTo(generalBefore, 2);
  expect(await drawerUsd(appPage, "Whish_System")).toBeCloseTo(
    whishBefore,
    2,
  );
  expect(await partnerBalanceUsd(appPage, partnerId)).toBeCloseTo(0, 2);

  const ledgerAfterVoid = await partnerLedger(appPage, partnerId);
  const reversalRow = ledgerAfterVoid.find(
    (e) =>
      e.transaction_type === "THROUGH_CUSTOM_SERVICE" &&
      e.reference_table === "custom_services" &&
      e.reference_id === serviceId &&
      e.direction === "CREDIT",
  );
  expect(reversalRow, JSON.stringify(ledgerAfterVoid)).toBeTruthy();
});

test("Pay out is rejected without a Via-Partner mode (edge, not just the UI guard)", async ({
  appPage,
}) => {
  const generalBefore = await drawerUsd(appPage, "General");

  const result = await appPage.evaluate(async () => {
    const w = window as unknown as Api;
    return w.api.customServices.add({
      description: "L-e2e bare payout, no partner mode",
      price_usd: 50,
      cost_usd: 48,
      direction: "OUT",
    });
  });

  expect(result.success).toBe(false);
  expect(result.error ?? "").toMatch(/via-partner/i);
  // Nothing was posted.
  expect(await drawerUsd(appPage, "General")).toBeCloseTo(generalBefore, 2);
});
