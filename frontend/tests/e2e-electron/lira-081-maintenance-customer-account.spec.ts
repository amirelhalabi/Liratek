/**
 * E2E: LIRA-081 (B3) — maintenance paid via CUSTOMER_ACCOUNT books the debt
 *
 * A maintenance job checked out on the customer's account must increase what
 * the client owes: a debt_ledger row for the account-charged amount. B3
 * reported the customer-account leg silently dropping.
 *
 * IPC-driven; shared accumulating DB → delta assertions on the client's
 * debt balance around the action.
 */

import { test, expect, navigateTo } from "./fixtures";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    maintenance: {
      save: (data: Record<string, unknown>) => Promise<{
        success: boolean;
        id?: number;
        error?: string;
      }>;
      delete: (id: number) => Promise<{ success: boolean; error?: string }>;
      getJobs: (filter?: string) => Promise<Array<{ id: number; status: string }>>;
    };
    debt: {
      getDebtors: () => Promise<
        Array<{
          id: number;
          full_name: string;
          total_debt_usd: number;
          total_debt_lbp: number;
        }>
      >;
    };
  };
};

test.describe("LIRA-081 (B3) — maintenance on customer account", () => {
  test("CUSTOMER_ACCOUNT checkout increases the client's debt by the job amount", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const clientName = `B3 MAINT ${ts}`;
    const phone = `78${String(ts).slice(-6)}`;

    const result = await appPage.evaluate(
      async ({ clientName, phone }) => {
        const w = window as unknown as Api;

        const balanceOf = async (name: string) =>
          (await w.api.debt.getDebtors()).find((d) => d.full_name === name) ??
          null;

        const before = await balanceOf(clientName); // expected: null (new client)

        const res = await w.api.maintenance.save({
          device_name: "B3 e2e phone",
          issue_description: "screen",
          client_name: clientName,
          client_phone: phone,
          cost_usd: 10,
          price_usd: 45,
          final_amount_usd: 45,
          currency: "USD",
          exchange_rate: 90000,
          status: "Delivered_Paid",
          paid_usd: 0,
          paid_lbp: 0,
          payments: [
            { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 45 },
          ],
        });

        const after = await balanceOf(clientName);

        return {
          ok: res.success === true,
          error: res.error ?? null,
          beforeUsd: before?.total_debt_usd ?? 0,
          afterUsd: after?.total_debt_usd ?? 0,
          afterLbp: after?.total_debt_lbp ?? 0,
          clientFound: after !== null,
        };
      },
      { clientName, phone },
    );

    expect(result.error).toBeNull();
    expect(result.ok).toBe(true);

    // The client now owes exactly the job amount (delta from 0 for a fresh
    // unique client) — pre-B3 the account leg vanished and the client owed 0.
    expect(result.clientFound).toBe(true);
    expect(result.afterUsd - result.beforeUsd).toBeCloseTo(45, 2);
    expect(result.afterLbp).toBeCloseTo(0, 2);
  });

  test("deleting an unpaid draft is a pure status change; deleting a PAID job is blocked", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async () => {
      const w = window as unknown as Api;

      // Unpaid draft → deletes cleanly, disappears from the list.
      const draft = await w.api.maintenance.save({
        device_name: "DEL draft phone",
        issue_description: "unsaved work",
        client_name: "Del Draft E2E",
        cost_usd: 0,
        price_usd: 20,
        final_amount_usd: 20,
        currency: "USD",
        status: "Received",
      });
      const draftDelete = await w.api.maintenance.delete(draft.id!);
      const listed = await w.api.maintenance.getJobs();
      const draftStillListed = listed.some((j) => j.id === draft.id);

      // Paid job → delete is blocked; its transaction must stay ACTIVE.
      const paid = await w.api.maintenance.save({
        device_name: "DEL paid phone",
        issue_description: "battery",
        client_name: "Del Paid E2E",
        client_phone: "70456456",
        cost_usd: 4,
        price_usd: 12,
        final_amount_usd: 12,
        currency: "USD",
        exchange_rate: 90000,
        status: "Delivered_Paid",
        payments: [{ method: "CASH", currency_code: "USD", amount: 12 }],
      });
      const paidDelete = await w.api.maintenance.delete(paid.id!);

      return {
        draftOk: draft.success === true,
        draftError: draft.error ?? null,
        paidError: paid.error ?? null,
        draftDeleteOk: draftDelete.success === true,
        draftStillListed,
        paidOk: paid.success === true,
        paidDeleteBlocked: paidDelete.success === false,
        paidDeleteError: paidDelete.error ?? null,
      };
    });

    expect(result.draftError).toBeNull();
    expect(result.draftOk).toBe(true);
    // Draft: clean delete, gone from the list — and (pre-fix) no −amount
    // reversal transaction is emitted (asserted by unit tests; the visible
    // symptom here is simply a clean removal).
    expect(result.draftDeleteOk).toBe(true);
    expect(result.draftStillListed).toBe(false);

    // Paid: blocked with a clear message; money history untouched.
    expect(result.paidError).toBeNull();
    expect(result.paidOk).toBe(true);
    expect(result.paidDeleteBlocked).toBe(true);
    expect(result.paidDeleteError).toMatch(/refund or void/i);
  });

  // B3 owner follow-up (2026-07-04): the original symptom was the debt not
  // APPEARING IN THE DEBTS PAGE. The IPC test above proves the backend books
  // it; this proves the full path — the debtor renders in the Debts page UI.
  test("the maintenance debt APPEARS in the Debts page UI (debtor row with the amount)", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const clientName = `B3 UI DEBTOR ${ts}`;
    const phone = `79${String(ts).slice(-6)}`;

    const created = await appPage.evaluate(
      async ({ clientName, phone }) => {
        const w = window as unknown as Api;
        const res = await w.api.maintenance.save({
          device_name: "B3 UI e2e phone",
          issue_description: "battery",
          client_name: clientName,
          client_phone: phone,
          cost_usd: 5,
          price_usd: 33,
          final_amount_usd: 33,
          currency: "USD",
          exchange_rate: 90000,
          status: "Delivered_Paid",
          paid_usd: 0,
          paid_lbp: 0,
          payments: [
            { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 33 },
          ],
        });
        return { ok: res.success === true, error: res.error ?? null };
      },
      { clientName, phone },
    );
    expect(created.error).toBeNull();
    expect(created.ok).toBe(true);

    await navigateTo(appPage, "/debts");

    // Debtors render as <button> cards; narrow the (accumulating) list via
    // the search box, then assert the card shows the name + charged amount.
    const search = appPage.getByPlaceholder("Search client...");
    await expect(search).toBeVisible({ timeout: 10_000 });
    await search.fill(clientName);

    const card = appPage
      .locator("button")
      .filter({ hasText: clientName })
      .first();
    await expect(card).toBeVisible({ timeout: 10_000 });
    await expect(card).toContainText("33");
    // The 2026-07 card redesign dropped the "Debtor" text chip — debtor vs
    // creditor is now conveyed by the card color (red = debtor, emerald =
    // creditor, slate = mixed). Assert the red debtor styling instead.
    await expect(card).toHaveClass(/bg-red-500\//);
  });
});
