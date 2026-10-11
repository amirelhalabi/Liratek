/**
 * Not proven failing-first; desktop e2e never runs on the owner's Mac — first
 * run is CI (G5).
 *
 * E2E (desktop/IPC): LIRA-305 — Syria remittance corridor netting. The
 * desktop twin of `frontend/tests/e2e-web/lira-web-054-syria-corridor.spec.ts`
 * (proven red → green over REST on 2026-10-11).
 *
 * A SEND (Custom Services → Via Partner) and a RECEIVE (Via Partner + Pay out)
 * through the same partner cancel on the partner's account, so the Pay out's
 * commission counts on Profits (owner decisions Y6/Y14). Voiding either row
 * re-derives it on the next read and puts every balance back (rule 20).
 *
 * Rule 15: a fresh partner per run, the RECEIVE's transaction found by
 * identity (`source_id`), deltas only. Rule 27: the Profits window is wide.
 */

import { test, expect, ensureProfitsUnlocked } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

type RecentTxn = {
  id: number;
  source_table: string;
  source_id: number;
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
        Array<{ name: string; usdBalance: number; lbpBalance: number }>
      >;
    };
    transactions: {
      getRecent: (
        limit?: number,
        filters?: Record<string, unknown>,
      ) => Promise<RecentTxn[]>;
      void: (id: number) => Promise<{ success: boolean; error?: string }>;
    };
    profits: {
      byModule: (
        from: string,
        to: string,
      ) => Promise<Array<{ module: string; profit_usd: number }>>;
    };
  };
};

type Snapshot = { general: number; partner: number; profit: number };

async function snap(page: Page, partnerId: number): Promise<Snapshot> {
  return page.evaluate(async (id) => {
    const w = window as unknown as Api;
    const drawers = await w.api.recharge.getDrawerBalances();
    const bal = await w.api.partners.getBalance(id);
    const rows = await w.api.profits.byModule("2000-01-01", "2100-01-01");
    return {
      general: drawers.find((d) => d.name === "General")?.usdBalance ?? 0,
      partner: bal.usd,
      profit:
        (rows ?? []).find((r) => r.module === "CUSTOM_SERVICE")?.profit_usd ??
        0,
    };
  }, partnerId);
}

test("LIRA-305: Syria corridor — SEND + RECEIVE net out, Pay out commission counts, voids put everything back", async ({
  appPage,
}) => {
  await ensureProfitsUnlocked(appPage);

  const partnerId = await appPage.evaluate(async () => {
    const w = window as unknown as Api;
    const c = await w.api.partners.create({
      name: `L-e2e 7welet souria ${Date.now()}`,
      phone: `${Date.now()}`.slice(-8),
    });
    if (!c.success || !c.data) throw new Error(c.error ?? "create failed");
    return c.data.id;
  });

  const start = await snap(appPage, partnerId);
  expect(start.partner).toBeCloseTo(0, 2);

  // (1) SEND — the customer pays $103 cash; the shop owes the partner $100.
  let before = start;
  const sent = await appPage.evaluate(async (pid) => {
    const w = window as unknown as Api;
    return w.api.customServices.add({
      description: "L-e2e Syria send",
      cost_usd: 100,
      price_usd: 103,
      partnerId: pid,
      partnerMode: "VIA",
      payments: [{ method: "CASH", currency_code: "USD", amount: 103 }],
    });
  }, partnerId);
  expect(sent.success, JSON.stringify(sent)).toBeTruthy();
  const sendId = sent.id as number;
  let now = await snap(appPage, partnerId);
  expect(now.general - before.general).toBeCloseTo(103, 2);
  expect(now.partner - before.partner).toBeCloseTo(-100, 2);
  expect(now.profit - before.profit).toBeCloseTo(3, 2);

  // (2) RECEIVE — Pay out: $100 arrived, the recipient gets $97. The account
  // is now square, so the $3 counts.
  before = now;
  const received = await appPage.evaluate(async (pid) => {
    const w = window as unknown as Api;
    return w.api.customServices.add({
      description: "L-e2e Syria receive",
      price_usd: 100,
      cost_usd: 97,
      partnerId: pid,
      partnerMode: "VIA",
      direction: "OUT",
    });
  }, partnerId);
  expect(received.success, JSON.stringify(received)).toBeTruthy();
  const receiveId = received.id as number;
  now = await snap(appPage, partnerId);
  expect(now.general - before.general).toBeCloseTo(-97, 2);
  expect(now.partner - before.partner).toBeCloseTo(100, 2);
  expect(now.partner).toBeCloseTo(0, 2);
  expect(now.profit - before.profit).toBeCloseTo(3, 2);

  // (3) Void the RECEIVE through the Transactions-page channel, by identity.
  before = now;
  const voided = await appPage.evaluate(async (sid) => {
    const w = window as unknown as Api;
    const recent = await w.api.transactions.getRecent(50, {
      source_table: "custom_services",
    });
    const row = recent.find((r) => r.source_id === sid);
    if (!row) throw new Error(`no transaction for custom_services#${sid}`);
    return w.api.transactions.void(row.id);
  }, receiveId);
  expect(voided.success, JSON.stringify(voided)).toBeTruthy();
  now = await snap(appPage, partnerId);
  expect(now.general - before.general).toBeCloseTo(97, 2);
  expect(now.partner - before.partner).toBeCloseTo(-100, 2);
  expect(now.profit - before.profit).toBeCloseTo(-3, 2);

  // (4) Void the SEND through the Custom Services history channel.
  before = now;
  const deleted = await appPage.evaluate(async (id) => {
    const w = window as unknown as Api;
    return w.api.customServices.delete(id);
  }, sendId);
  expect(deleted.success, JSON.stringify(deleted)).toBeTruthy();
  now = await snap(appPage, partnerId);
  expect(now.general - before.general).toBeCloseTo(-103, 2);
  expect(now.partner - before.partner).toBeCloseTo(100, 2);
  expect(now.profit - before.profit).toBeCloseTo(-3, 2);

  // Create + void nets to 0 on every ledger touched (rule 20).
  expect(now.general).toBeCloseTo(start.general, 2);
  expect(now.partner).toBeCloseTo(start.partner, 2);
  expect(now.profit).toBeCloseTo(start.profit, 2);
});
