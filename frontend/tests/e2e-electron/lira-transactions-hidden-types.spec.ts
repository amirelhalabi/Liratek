/**
 * E2E: Hidden transaction types + System Transactions button (Issue 4, D2)
 *
 * D2 (CQ-8, decided 2026-07-18): a MANUAL supplier payment is a first-class
 * visible row on the transactions table by default; only auto-generated
 * ledger siblings (metadata.is_auto === true — e.g. a BILL commission's
 * journal row) stay hidden, alongside CLIENT_CREATED and the ⚙ "System
 * Transactions" fold button which never renders. The is_credit auto variant
 * (rendered "Supplier Credit") only reappears when the operator explicitly
 * selects the "Supplier Credit" type filter.
 *
 * Non-credit SUPPLIER_PAYMENT renders as "SUPPLIER PAYMENT" and CLIENT_CREATED
 * as "CLIENT CREATED" (label fallback) — so their absence/presence in the table
 * is asserted by those exact labels. Data is generated fresh so it sits in the
 * most-recent window. Shared Electron instance / accumulating DB.
 */

import { test, expect, navigateTo, seedClient } from "./fixtures";

test.describe.configure({ retries: 0 });

test.describe("Transactions table — hidden types", () => {
  test("supplier-payment, client-created & supplier-credit hidden by default; supplier-credit filter reveals it; no ⚙ button", async ({
    appPage,
  }) => {
    const ts = Date.now();

    // 1. CLIENT_CREATED — creating a client logs one.
    await seedClient(appPage, {
      name: `HIDDEN CLIENT ${ts}`,
      phone: `03${String(ts).slice(-7)}`,
    });

    // 2. A non-credit SUPPLIER_PAYMENT (a supplier PAYMENT) and
    // 3. A credit SUPPLIER_PAYMENT (a Katsh BILL commission, is_credit=true).
    const gen = await appPage.evaluate(async () => {
      const katsh = (
        (await (window as any).api.suppliers.list("", true)) as Array<{
          id: number;
          provider: string | null;
        }>
      ).find((s) => s.provider === "Katsh");

      const payment = katsh
        ? await (window as any).api.suppliers.addLedgerEntry({
            supplier_id: katsh.id,
            entry_type: "PAYMENT",
            amount_usd: 7,
            amount_lbp: 0,
            drawer_name: "General",
            note: "E2E hide-test supplier payment",
          })
        : { success: false };

      const bill = await (window as any).api.omt.addTransaction({
        provider: "Katsh",
        serviceType: "BILL",
        amount: 50000,
        cost: 50000,
        price: 50000,
        currency: "LBP",
        commission: 0,
        paidByMethod: "CASH",
      });

      return {
        paymentOk: payment.success === true,
        billOk: bill.success === true,
      };
    });
    expect(gen.billOk).toBe(true);

    // Preconditions: all three exist in the data so the hide/keep assertions
    // below are meaningful (not vacuous).
    const present = await appPage.evaluate(() => {
      const isCredit = (r: { metadata_json: string | null }) => {
        try {
          return JSON.parse(r.metadata_json ?? "{}").is_credit === true;
        } catch {
          return false;
        }
      };
      return (
        (window as any).api.transactions.getRecent(200) as Promise<
          Array<{ type: string; metadata_json: string | null }>
        >
      ).then((recent) => ({
        clientCreated: recent.some((r) => r.type === "CLIENT_CREATED"),
        supplierPaymentNonCredit: recent.some(
          (r) => r.type === "SUPPLIER_PAYMENT" && !isCredit(r),
        ),
        supplierCredit: recent.some(
          (r) => r.type === "SUPPLIER_PAYMENT" && isCredit(r),
        ),
      }));
    });
    expect(present.clientCreated).toBe(true);
    expect(present.supplierPaymentNonCredit).toBe(true);
    expect(present.supplierCredit).toBe(true);

    await navigateTo(appPage, "/audit");
    await expect(appPage.locator("tbody tr").first()).toBeVisible({
      timeout: 8_000,
    });

    // Hidden types are absent from the table…
    await expect(
      appPage.getByText("CLIENT CREATED", { exact: true }),
    ).toHaveCount(0);
    // …but a MANUAL supplier payment is visible by default (D2) — only the
    // auto-generated ledger siblings (metadata.is_auto) stay hidden.
    await expect(
      appPage.getByText("SUPPLIER PAYMENT", { exact: true }).first(),
    ).toBeVisible({ timeout: 8_000 });

    // …and so is the commission-revenue "Supplier Credit" row, by default…
    await expect(
      appPage.getByText("Supplier Credit", { exact: true }),
    ).toHaveCount(0);

    // …and the ⚙ System Transactions fold button never renders.
    await expect(appPage.getByText("⚙")).toHaveCount(0);

    // Selecting the "Supplier Credit" filter reveals just that row.
    await appPage
      .locator("button")
      .filter({ hasText: /^All types$/ })
      .first()
      .click();
    await appPage.getByText("Supplier Credit", { exact: true }).click();
    await expect(
      appPage.getByText("Supplier Credit", { exact: true }).first(),
    ).toBeVisible({ timeout: 8_000 });
  });

  test("B6: 'Cash only (till)' filter keeps cash rows and drops wallet-only rows", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const cashName = `B6 CASH ${ts}`;
    const walletName = `B6 WALLET ${ts}`;

    // 1. A cash transaction (CASH leg → General) and a wallet-only transaction
    //    (OMT_APP transfer paid from the OMT wallet — no CASH leg).
    const created = await appPage.evaluate(
      async ({ cashName, walletName }) => {
        const w = window as unknown as {
          api: {
            omt: {
              addTransaction: (d: Record<string, unknown>) => Promise<{
                success?: boolean;
                error?: string;
              }>;
            };
          };
        };
        const cash = await w.api.omt.addTransaction({
          provider: "OMT",
          serviceType: "SEND",
          amount: 21,
          currency: "USD",
          commission: 0,
          omtServiceType: "INTRA",
          clientName: cashName,
          paidByMethod: "CASH",
        });
        const wallet = await w.api.omt.addTransaction({
          provider: "OMT_APP",
          serviceType: "SEND",
          amount: 13,
          currency: "USD",
          commission: 0,
          clientName: walletName,
          paidByMethod: "OMT",
        });
        return {
          cashOk: cash.success === true,
          cashError: cash.error ?? null,
          walletOk: wallet.success === true,
          walletError: wallet.error ?? null,
        };
      },
      { cashName, walletName },
    );
    expect(created.cashError).toBeNull();
    expect(created.cashOk).toBe(true);
    expect(created.walletError).toBeNull();
    expect(created.walletOk).toBe(true);

    // 2. Fresh mount of /audit, then pick the cash filter.
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/audit");
    await expect(appPage.locator("tbody tr").first()).toBeVisible({
      timeout: 8_000,
    });
    await appPage
      .locator("button")
      .filter({ hasText: /^All types$/ })
      .first()
      .click();
    await appPage.getByText("Cash only (till)", { exact: true }).click();

    // Cash row visible; the wallet-only transfer is filtered out.
    await expect(
      appPage.locator("tr", { hasText: cashName }).first(),
    ).toBeVisible({ timeout: 8_000 });
    await expect(appPage.locator("tr", { hasText: walletName })).toHaveCount(0);
  });
});
