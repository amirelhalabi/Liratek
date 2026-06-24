/**
 * E2E: Hidden transaction types + System Transactions button (Issue 4)
 *
 * The transactions table now hides SUPPLIER_PAYMENT and CLIENT_CREATED rows and
 * removes the ⚙ "System Transactions" fold button. The is_credit variant of
 * SUPPLIER_PAYMENT (commission revenue, rendered "Supplier Credit") is real
 * revenue and stays visible (review finding).
 *
 * Non-credit SUPPLIER_PAYMENT renders as "SUPPLIER PAYMENT" and CLIENT_CREATED
 * as "CLIENT CREATED" (label fallback) — so their absence/presence in the table
 * is asserted by those exact labels. Data is generated fresh so it sits in the
 * most-recent window. Shared Electron instance / accumulating DB.
 */

import { test, expect, navigateTo, seedClient } from "./fixtures";

test.describe.configure({ retries: 0 });

test.describe("Transactions table — hidden types", () => {
  test("supplier-payment & client-created hidden; supplier-credit visible; no ⚙ button", async ({
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

      return { paymentOk: payment.success === true, billOk: bill.success === true };
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
    await expect(appPage.getByText("CLIENT CREATED", { exact: true })).toHaveCount(
      0,
    );
    await expect(
      appPage.getByText("SUPPLIER PAYMENT", { exact: true }),
    ).toHaveCount(0);

    // …but commission-revenue "Supplier Credit" rows remain visible…
    await expect(
      appPage.getByText("Supplier Credit", { exact: true }).first(),
    ).toBeVisible({ timeout: 8_000 });

    // …and the ⚙ System Transactions fold button never renders.
    await expect(appPage.getByText("⚙")).toHaveCount(0);
  });
});
