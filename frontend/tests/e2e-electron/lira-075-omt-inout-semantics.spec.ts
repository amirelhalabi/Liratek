/**
 * E2E: LIRA-075 (C2) — OMT/WHISH in/out semantics in the transactions table
 *
 * A system SEND takes the customer's cash → its row must read as cash IN
 * (green ↓ badge, "in:" payment legs, no "out:"). A system RECEIVE pays the
 * customer out of the drawers → its row must read as cash OUT (red ↑ badge,
 * "out:" legs for BOTH payout currencies, no "in:"). Pre-C2 every
 * FINANCIAL_SERVICE row rendered the green cash-in badge, including RECEIVE.
 *
 * Rows are created via IPC and located in /audit by IDENTITY (a unique client
 * name in the row summary) — never by row position (shared accumulating DB).
 */

import { test, expect, navigateTo } from "./fixtures";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    omt: {
      addTransaction: (data: {
        provider: string;
        serviceType: "SEND" | "RECEIVE" | "BILL";
        amount: number;
        currency?: string;
        commission?: number;
        omtServiceType?: string;
        cashoutMethod?: string;
        clientName?: string;
        paidByMethod?: string;
        payments?: Array<{
          method: string;
          currencyCode: string;
          amount: number;
          direction?: "IN" | "OUT";
        }>;
      }) => Promise<{ success?: boolean; id?: number; error?: string }>;
    };
  };
};

test.describe("LIRA-075 (C2) — OMT in/out semantics", () => {
  test("SEND row shows cash IN only; RECEIVE row shows cash OUT only with both currency legs", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const sendName = `INOUT SEND ${ts}`;
    const recvName = `INOUT RECV ${ts}`;

    // Create one SEND and one split-payout RECEIVE via IPC.
    const created = await appPage.evaluate(
      async ({ sendName, recvName }) => {
        const w = window as unknown as Api;

        const send = await w.api.omt.addTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: 37,
          currency: "USD",
          commission: 0,
          omtServiceType: "INTRA",
          clientName: sendName,
          paidByMethod: "CASH",
        });

        const recv = await w.api.omt.addTransaction({
          provider: "OMT",
          serviceType: "RECEIVE",
          amount: 63,
          currency: "USD",
          commission: 0,
          omtServiceType: "INTRA",
          clientName: recvName,
          cashoutMethod: "CASH",
          payments: [
            { method: "CASH", currencyCode: "USD", amount: 60 },
            { method: "CASH", currencyCode: "LBP", amount: 267000 },
          ],
        });

        return {
          sendOk: send?.success === true,
          sendError: send?.error ?? null,
          recvOk: recv?.success === true,
          recvError: recv?.error ?? null,
        };
      },
      { sendName, recvName },
    );

    expect(created.sendError).toBeNull();
    expect(created.sendOk).toBe(true);
    expect(created.recvError).toBeNull();
    expect(created.recvOk).toBe(true);

    // Open the transactions table and locate each row by identity.
    // Bounce through another route first: if a previous spec in this worker's
    // shared Electron instance ended parked on /audit, navigateTo("/audit")
    // would be a no-op — the mounted table would still show the list fetched
    // BEFORE our rows existed. Remounting forces a fresh fetch.
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/audit");

    const sendRow = appPage.locator("tr", { hasText: sendName }).first();
    const recvRow = appPage.locator("tr", { hasText: recvName }).first();
    await expect(sendRow).toBeVisible();
    await expect(recvRow).toBeVisible();

    // ── SEND: cash IN only ──────────────────────────────────────────────────
    await expect(sendRow.getByTestId("cash-flow-badge")).toHaveAttribute(
      "data-direction",
      "in",
    );
    const sendLegs = sendRow.getByTestId("payment-legs");
    await expect(sendLegs).toContainText("in:");
    await expect(sendLegs).not.toContainText("out:");

    // ── RECEIVE: cash OUT only, BOTH payout currency legs ───────────────────
    await expect(recvRow.getByTestId("cash-flow-badge")).toHaveAttribute(
      "data-direction",
      "out",
    );
    const recvLegs = recvRow.getByTestId("payment-legs");
    await expect(recvLegs).toContainText("out:");
    await expect(recvLegs).not.toContainText("in:");
    // Both currencies of the split payout are visible on the row.
    await expect(recvLegs).toContainText("$60");
    await expect(recvLegs).toContainText("267,000 LBP");
  });
});
