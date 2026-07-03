/**
 * E2E: LIRA-087 (D1) — Cash Report: currency in/out by business date
 *
 * Creates KNOWN transactions backdated (transaction_time) to a date only this
 * spec uses, then asserts the by-date/by-currency aggregation equals exactly
 * the created amounts — via IPC, and rendered in the Cash Report modal on the
 * Transactions page (opened through the real toolbar button).
 *
 * Identity = the unique business date (fresh per-run DB → nothing else lands
 * on it), so absolute per-date assertions are safe.
 */

import { test, expect, navigateTo } from "./fixtures";

test.describe.configure({ retries: 0 });

const DATE = "2021-07-15";

type Api = {
  api: {
    omt: {
      addTransaction: (d: Record<string, unknown>) => Promise<{
        success?: boolean;
        error?: string;
      }>;
    };
    transactions: {
      getCashFlowByDate: (
        from: string,
        to: string,
      ) => Promise<
        Array<{
          date: string;
          currency_code: string;
          total_in: number;
          total_out: number;
        }>
      >;
    };
  };
};

test.describe("LIRA-087 (D1) — cash report by date", () => {
  test("aggregation equals the created amounts, via IPC and in the modal", async ({
    appPage,
  }) => {
    const result = await appPage.evaluate(async (DATE) => {
      const w = window as unknown as Api;
      const time = `${DATE} 12:00:00`;

      // USD in: customer pays $25 cash for a SEND.
      const send = await w.api.omt.addTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 25,
        currency: "USD",
        commission: 0,
        omtServiceType: "INTRA",
        paidByMethod: "CASH",
        transaction_time: time,
      });
      // USD out: shop pays a $10 RECEIVE cashout.
      const recv = await w.api.omt.addTransaction({
        provider: "OMT",
        serviceType: "RECEIVE",
        amount: 10,
        currency: "USD",
        commission: 0,
        omtServiceType: "INTRA",
        cashoutMethod: "CASH",
        transaction_time: time,
      });
      // LBP in: a 900,000 LBP SEND paid cash.
      const lbpSend = await w.api.omt.addTransaction({
        provider: "OMT",
        serviceType: "SEND",
        amount: 900_000,
        currency: "LBP",
        commission: 0,
        omtServiceType: "INTRA",
        paidByMethod: "CASH",
        transaction_time: time,
      });

      const rows = await w.api.transactions.getCashFlowByDate(DATE, DATE);
      return {
        errors: [send.error, recv.error, lbpSend.error].filter(Boolean),
        usd: rows.find((r) => r.currency_code === "USD") ?? null,
        lbp: rows.find((r) => r.currency_code === "LBP") ?? null,
      };
    }, DATE);

    expect(result.errors).toEqual([]);

    // ── IPC: the aggregation is exactly the created amounts ─────────────────
    expect(result.usd).toMatchObject({ date: DATE });
    expect(result.usd!.total_in).toBeCloseTo(25, 2);
    expect(result.usd!.total_out).toBeCloseTo(10, 2);
    expect(result.lbp!.total_in).toBeCloseTo(900_000, 2);
    expect(result.lbp!.total_out).toBeCloseTo(0, 2);

    // ── UI: open the Cash Report from the Transactions page ─────────────────
    await navigateTo(appPage, "/audit");
    await appPage.getByTestId("open-cash-report").click();
    const modal = appPage.getByTestId("cash-report-modal");
    await expect(modal).toBeVisible();

    // Point the range at the fixed business date.
    const dateInputs = modal.locator('input[type="date"]');
    await dateInputs.nth(0).fill(DATE);
    await dateInputs.nth(1).fill(DATE);

    const row = appPage.getByTestId(`cash-report-row-${DATE}`);
    await expect(row).toBeVisible();
    await expect(row).toContainText("$25.00"); // USD in
    await expect(row).toContainText("$10.00"); // USD out
    await expect(row).toContainText("900,000 LBP"); // LBP in
  });
});
