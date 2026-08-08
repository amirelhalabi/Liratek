/**
 * E2E: Hidden transaction types + System Transactions button (Issue 4, D2)
 *
 * D2 (CQ-8, decided 2026-07-18): a MANUAL supplier payment is a first-class
 * visible row on the transactions table by default; only auto-generated
 * ledger siblings (metadata.is_auto === true — e.g. a commission credit's
 * journal row) stay hidden, alongside CLIENT_CREATED and the ⚙ "System
 * Transactions" fold button which never renders. The is_credit auto variant
 * (rendered "Supplier Credit") only reappears when the operator explicitly
 * selects the "Supplier Credit" type filter.
 *
 * The is_credit SUPPLIER_PAYMENT fixture used to come from creating a Katsh
 * BILL directly (the old hardcoded −20,000 LBP commission booked AT
 * CREATION). `docs/plans/todo_plans/COMMISSION_AT_SETTLEMENT_PLAN.md` Phase 1
 * removed that: a fresh BILL is now born `commission_model = 1` and books
 * NOTHING until settled (see `lira-089-bill-commission-settlement.spec.ts`).
 * This spec now produces the credit the SAME way the new model actually does
 * — create the bill, then settle it with a nonzero commission
 * (`suppliers.settleTransactions` → `SupplierRepository
 * ._bookCommissionAtSettlement`, which books the exact same is_credit/is_auto
 * SUPPLIER_PAYS_US row the old creation-time path used to). This was chosen
 * over `recordSupplierCashflow`'s RECEIVE direction (which also books a
 * SUPPLIER_PAYS_US row) because settling a bill is the flow this filter was
 * actually written to hide, and it reuses an already-proven IPC path instead
 * of a second, less-travelled one.
 *
 * Non-credit SUPPLIER_PAYMENT renders as "SUPPLIER PAYMENT" and CLIENT_CREATED
 * as "CLIENT CREATED" (label fallback) — so their absence/presence in the table
 * is asserted by those exact labels. Data is generated fresh so it sits in the
 * most-recent window. Shared Electron instance / accumulating DB.
 */

import { test, expect, navigateTo, seedClient } from "./fixtures";

test.describe.configure({ retries: 0 });

// Typed narrowly for the one new IPC call this spec adds (settleTransactions)
// — the rest of the file keeps its pre-existing `(window as any).api...`
// convention to minimize the diff against a passing spec.
type SettleApi = {
  api: {
    suppliers: {
      settleTransactions: (data: Record<string, unknown>) => Promise<{
        success?: boolean;
        id?: number;
        error?: string;
      }>;
    };
  };
};

test.describe("Transactions table — hidden types", () => {
  test("supplier-payment, client-created & supplier-credit hidden by default; supplier-credit filter reveals it; no ⚙ button", async ({
    appPage,
  }) => {
    const ts = Date.now();
    // Rule-15 identity anchors: unique amounts make THIS run's own payment
    // and credit rows matchable in the shared, accumulating e2e DB — a stale
    // $7 payment or a stale 20,000 LBP credit left by an earlier spec must
    // never be able to satisfy a precondition or a table assertion in place
    // of the row this run actually created.
    const paymentAmount = 7 + ((ts % 88) + 1) / 100; // $7.01–$7.88, never a bare $7
    const commissionLbp = 20000 + (ts % 5000); // 20,000–24,999 LBP

    // 1. CLIENT_CREATED — creating a client logs one.
    await seedClient(appPage, {
      name: `HIDDEN CLIENT ${ts}`,
      phone: `03${String(ts).slice(-7)}`,
    });

    // 2. A non-credit SUPPLIER_PAYMENT (a supplier PAYMENT) and
    // 3. A credit SUPPLIER_PAYMENT (a commission credit booked AT
    //    SETTLEMENT, is_credit=true — see file header comment for why a bare
    //    BILL creation no longer produces this row post COMMISSION_AT_
    //    SETTLEMENT_PLAN.md Phase 1).
    const gen = await appPage.evaluate(
      async ({ paymentAmount, commissionLbp }) => {
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
              amount_usd: paymentAmount,
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

        // The bill itself books nothing now (born commission_model=1) — settle
        // it with a nonzero LUMP commission so `_bookCommissionAtSettlement`
        // books the real SUPPLIER_PAYS_US credit (is_credit/is_auto), the
        // fixture this test's "supplierCredit" assertion needs. amount_usd/
        // amount_lbp stay 0: the bill's own principal already reached the
        // supplier via the provider drawer's cost leg, so there is no net cash
        // owed here — only the commission moves (same shape lira-089 proves).
        const settleApi = window as unknown as SettleApi;
        const settlement =
          katsh && bill.success === true && bill.id
            ? await settleApi.api.suppliers.settleTransactions({
                supplier_id: katsh.id,
                financial_service_ids: [bill.id],
                amount_usd: 0,
                amount_lbp: 0,
                commission_usd: 0,
                commission_lbp: commissionLbp,
                entry_mode: "LUMP",
                note: "E2E hide-test commission-at-settlement credit",
              })
            : { success: false, error: "bill or supplier missing" };

        return {
          paymentOk: payment.success === true,
          paymentError: payment.error ?? null,
          billOk: bill.success === true,
          settlementOk: settlement.success === true,
          settlementError: settlement.error ?? null,
        };
      },
      { paymentAmount, commissionLbp },
    );
    expect(gen.paymentError).toBeNull();
    expect(gen.paymentOk).toBe(true);
    expect(gen.billOk).toBe(true);
    expect(gen.settlementError).toBeNull();
    expect(gen.settlementOk).toBe(true);

    // Preconditions: all three exist in the data so the hide/keep assertions
    // below are meaningful (not vacuous) — the supplier rows are matched by
    // THIS run's own unique amount (rule 15), never by an earlier spec's
    // stale row of the same type. `paymentSummary`/`creditSummary` capture
    // the exact rendered summary text of our own two rows, reused below to
    // scope the /audit DOM assertions to that same identity instead of a
    // generic label match that any stale row could satisfy.
    const present = await appPage.evaluate(
      ({ paymentAmount, commissionLbp }) => {
        const isCredit = (r: { metadata_json: string | null }) => {
          try {
            return JSON.parse(r.metadata_json ?? "{}").is_credit === true;
          } catch {
            return false;
          }
        };
        return (
          (window as any).api.transactions.getRecent(200) as Promise<
            Array<{
              type: string;
              metadata_json: string | null;
              amount_usd: number;
              amount_lbp: number;
              summary: string | null;
            }>
          >
        ).then((recent) => {
          const paymentRow = recent.find(
            (r) =>
              r.type === "SUPPLIER_PAYMENT" &&
              !isCredit(r) &&
              Math.abs(r.amount_usd - paymentAmount) < 0.001,
          );
          const creditRow = recent.find(
            (r) =>
              r.type === "SUPPLIER_PAYMENT" &&
              isCredit(r) &&
              r.amount_lbp === commissionLbp,
          );
          return {
            clientCreated: recent.some((r) => r.type === "CLIENT_CREATED"),
            supplierPaymentNonCredit: paymentRow !== undefined,
            supplierCredit: creditRow !== undefined,
            paymentSummary: paymentRow?.summary ?? null,
            creditSummary: creditRow?.summary ?? null,
          };
        });
      },
      { paymentAmount, commissionLbp },
    );
    expect(present.clientCreated).toBe(true);
    expect(present.supplierPaymentNonCredit).toBe(true);
    expect(present.supplierCredit).toBe(true);
    expect(present.paymentSummary).not.toBeNull();
    expect(present.creditSummary).not.toBeNull();
    const paymentSummary = present.paymentSummary as string;
    const creditSummary = present.creditSummary as string;

    // Bounce through "/" first (README "Assertion discipline") — a viewer
    // already parked on /audit from an earlier spec in the shared-instance
    // suite does NOT remount (hash-router no-ops a same-route Link click),
    // so TransactionsViewer's load() never re-fires and the table keeps
    // showing whatever it fetched on its FIRST /audit visit — silently
    // missing the rows this test just created. Confirmed via the actual
    // failing-suite DB: our payment row (id 393 of 396) sat 4th-from-newest,
    // nowhere near being crowded out by volume — the viewer simply never
    // re-fetched. The second test in this file (B6, below) already bounces
    // correctly; this one didn't.
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/audit");
    await expect(appPage.locator("tbody tr").first()).toBeVisible({
      timeout: 8_000,
    });

    // Hidden types are absent from the table…
    await expect(
      appPage.getByText("CLIENT CREATED", { exact: true }),
    ).toHaveCount(0);

    // …but a MANUAL supplier payment is visible by default (D2) — only the
    // auto-generated ledger siblings (metadata.is_auto) stay hidden. Scoped
    // to THIS run's own row via its unique amount — a stale SUPPLIER PAYMENT
    // row from an earlier spec can no longer satisfy this in place of ours.
    const ourPaymentRow = appPage.locator("tr", { hasText: paymentSummary });
    await expect(ourPaymentRow).toBeVisible({ timeout: 8_000 });
    await expect(
      ourPaymentRow.getByText("SUPPLIER PAYMENT", { exact: true }),
    ).toBeVisible();

    // …and so is the commission-revenue "Supplier Credit" row, by default —
    // again scoped to THIS run's own credit row, not any stale one.
    await expect(
      appPage.locator("tr", { hasText: creditSummary }),
    ).toHaveCount(0);

    // …and the ⚙ System Transactions fold button never renders.
    await expect(appPage.getByText("⚙")).toHaveCount(0);

    // Selecting the "Supplier Credit" filter reveals just that row — and
    // specifically proves it reveals THIS run's own row.
    await appPage
      .locator("button")
      .filter({ hasText: /^All types$/ })
      .first()
      .click();
    await appPage.getByText("Supplier Credit", { exact: true }).click();
    const ourCreditRow = appPage.locator("tr", { hasText: creditSummary });
    await expect(ourCreditRow).toBeVisible({ timeout: 8_000 });
    await expect(
      ourCreditRow.getByText("Supplier Credit", { exact: true }),
    ).toBeVisible();
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
