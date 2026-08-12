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
 * ⚠ UPDATED FOR LIRA-137 (BILL_COMMISSION_SETTLEMENT_PLAN.md, 2026-08-11).
 * This spec used to generate its is_credit fixture by settling a Katsh BILL
 * with a nonzero commission — `SupplierRepository._bookCommissionAtSettlement`
 * used to book a cashless `SUPPLIER_PAYS_US` `supplier_ledger` credit
 * (`is_credit: true`) for exactly that shape. LIRA-137 replaced that credit,
 * for a BILLS-ONLY batch, with a REAL top-up into the Katsh/iPick provider
 * DRAWER, posted as a `payments` leg on the SUPPLIER_SETTLEMENT transaction
 * itself — `_bookBillsCommissionDrawerTopUp` deliberately never calls
 * `addLedgerEntry`/writes `supplier_ledger` for this money at all (rule 20:
 * there is no debt for it to net against). Concretely, `commission_model = 1`
 * is stamped EXCLUSIVELY on BILL rows at creation (no other service_type ever
 * reaches this settlement branch), so a bills-only batch is the ONLY shape
 * that has ever fed this settlement-side ledger-credit mechanism in
 * production — meaning post-LIRA-137 there is genuinely NO REACHABLE way
 * (real UI, raw IPC, or otherwise) left to generate a fresh is_credit
 * SUPPLIER_PAYMENT row any more: the manual `addLedgerEntry` IPC/REST
 * endpoint's Zod schema restricts `entry_type` to `["TOP_UP", "PAYMENT",
 * "ADJUSTMENT"]` (`packages/core/src/validators/supplier.ts`) — never
 * `SUPPLIER_PAYS_US` — and `recordSupplierCashflow`'s RECEIVE direction also
 * books `entry_type: "SUPPLIER_PAYS_US"` but does NOT set `is_credit` on its
 * transaction (real cash, not a paper receivable — see
 * `TransactionsViewer.tsx`'s own comment on the distinction). This is not a
 * bug: bills commission is no longer a receivable waiting to be collected
 * (the OLD "paper credit" semantic `is_credit` exists to flag) — it is real
 * cash landing in the drawer the instant Confirm is pressed (owner, 2026-08-11:
 * "it is profit, entirely").
 *
 * The is_credit/"Supplier Credit"-filter MECHANISM itself is untouched and
 * still unit-tested in isolation against a synthetic fixture
 * (`frontend/src/features/audit/__tests__/supplierPaymentVisibility.test.ts`)
 * — it simply has no live producer for BILLS any more. So this spec's first
 * test below no longer tries to manufacture that dead combination; instead
 * it proves the row that NOW carries the audit evidence for a bills
 * commission settlement — the SUPPLIER_SETTLEMENT transaction itself — is
 * VISIBLE BY DEFAULT (SUPPLIER_SETTLEMENT was never in scope of the
 * is_auto/is_credit hide rule to begin with, CQ-8) with its cash-flow badge
 * reading IN (money arrived, per cashFlow.ts's new SUPPLIER_SETTLEMENT case).
 * This is a stronger, more direct proof of the thing D2/CQ-8 actually cares
 * about here ("can the operator see this money moved by default") than the
 * old is_credit/filter-reveal path was for this exact scenario.
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
  test("supplier-payment & client-created hidden by default; bills-only commission settlement stays visible with IN flow (LIRA-137); no ⚙ button", async ({
    appPage,
  }) => {
    const ts = Date.now();
    // Rule-15 identity anchors: unique amounts make THIS run's own payment
    // and settlement rows matchable in the shared, accumulating e2e DB — a
    // stale $7 payment or a stale 20,000 LBP settlement left by an earlier
    // spec must never be able to satisfy a precondition or a table assertion
    // in place of the row this run actually created.
    const paymentAmount = 7 + ((ts % 88) + 1) / 100; // $7.01–$7.88, never a bare $7
    const commissionLbp = 20000 + (ts % 5000); // 20,000–24,999 LBP

    // 1. CLIENT_CREATED — creating a client logs one.
    await seedClient(appPage, {
      name: `HIDDEN CLIENT ${ts}`,
      phone: `03${String(ts).slice(-7)}`,
    });

    // 2. A non-credit SUPPLIER_PAYMENT (a supplier PAYMENT) and
    // 3. A Katsh BILL settled with a nonzero commission — post-LIRA-137 this
    //    is a REAL Katsh-drawer top-up plus a visible SUPPLIER_SETTLEMENT
    //    transaction (flow="IN"), never a hidden is_credit ledger row (see
    //    file header comment for why that mechanism has no live producer
    //    left for bills at all).
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

        // The bill itself books nothing now (born commission_model=1) —
        // settle it with a nonzero LUMP commission. LIRA-137:
        // `_bookCommissionAtSettlement` books a REAL Katsh-drawer top-up
        // (`_bookBillsCommissionDrawerTopUp`) for a bills-only batch, never
        // a supplier_ledger credit — see file header comment. amount_usd/
        // amount_lbp stay 0: the bill's own principal already reached the
        // supplier via the provider drawer's cost leg, so there is no net
        // cash owed here — only the commission moves (same shape lira-089
        // proves).
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
                note: "E2E hide-test commission-at-settlement",
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

    // Preconditions: both rows exist in the data so the hide/keep assertions
    // below are meaningful (not vacuous) — matched by THIS run's own unique
    // amount (rule 15), never an earlier spec's stale row of the same type.
    // `paymentSummary`/`settlementSummary` capture the exact rendered
    // summary text of our own two rows, reused below to scope the /audit DOM
    // assertions to that same identity instead of a generic label match any
    // stale row could satisfy.
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
          const settlementRow = recent.find((r) => {
            if (r.type !== "SUPPLIER_SETTLEMENT") return false;
            try {
              const m = JSON.parse(r.metadata_json ?? "{}") as {
                commission_lbp?: number;
                counterparty?: { flow?: string };
              };
              return (
                m.commission_lbp === commissionLbp &&
                m.counterparty?.flow === "IN"
              );
            } catch {
              return false;
            }
          });
          return {
            clientCreated: recent.some((r) => r.type === "CLIENT_CREATED"),
            supplierPaymentNonCredit: paymentRow !== undefined,
            supplierSettlementInFlow: settlementRow !== undefined,
            paymentSummary: paymentRow?.summary ?? null,
            settlementSummary: settlementRow?.summary ?? null,
          };
        });
      },
      { paymentAmount, commissionLbp },
    );
    expect(present.clientCreated).toBe(true);
    expect(present.supplierPaymentNonCredit).toBe(true);
    // LIRA-137: the commission arrived as a real drawer top-up stamped on
    // the SUPPLIER_SETTLEMENT transaction (flow="IN") — NOT a hidden
    // is_credit SUPPLIER_PAYMENT row (the mechanism this assertion used to
    // check is unreachable for bills post-LIRA-137 — see file header
    // comment).
    expect(present.supplierSettlementInFlow).toBe(true);
    expect(present.paymentSummary).not.toBeNull();
    expect(present.settlementSummary).not.toBeNull();
    const paymentSummary = present.paymentSummary as string;
    const settlementSummary = present.settlementSummary as string;

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

    // …and so is the bills-commission SUPPLIER_SETTLEMENT row, by default —
    // LIRA-137: SUPPLIER_SETTLEMENT was never in scope of the is_auto/
    // is_credit hide rule to begin with (CQ-8, "Suppliers are first-class
    // citizens of the Transactions page") — it is a real, always-visible
    // row. Scoped to THIS run's own settlement row, not any stale one.
    const ourSettlementRow = appPage.locator("tr", {
      hasText: settlementSummary,
    });
    await expect(ourSettlementRow).toBeVisible({ timeout: 8_000 });
    await expect(
      ourSettlementRow.getByText("Supplier Settlement", { exact: true }),
    ).toBeVisible();
    // The cash-flow badge reads IN (money arrived, funded by Katsh) — the
    // opposite of a real net-payment settlement's "OUT" stamp, and — along
    // with the summary text below — the only visible signal that money moved
    // here at all, since amount_usd/amount_lbp are contractually 0/0 for
    // this batch shape (no bill principal is owed for a bill).
    await expect(
      ourSettlementRow.locator('[data-testid="cash-flow-badge"]'),
    ).toHaveAttribute("data-direction", "in");
    // The commission amount itself is visible in the row's own summary text
    // by default (SupplierRepository.ts's `settlementSummary` — the fix for
    // the audit-visibility gap this spec caught while investigating LIRA-137:
    // the drawer leg is filtered from the customer-facing legs subtext by
    // the SAME PROVIDER_STOCK_DRAWERS rule that hides a bill's own
    // creation-time cost leg, and amount_usd/amount_lbp stay 0/0, so without
    // this fix the row would show IN but never HOW MUCH).
    expect(settlementSummary).toContain(
      `${commissionLbp.toLocaleString()} LBP`,
    );

    // …and the ⚙ System Transactions fold button never renders.
    await expect(appPage.getByText("⚙")).toHaveCount(0);

    // The "Supplier Credit" filter mechanism itself is untouched by
    // LIRA-137 and stays covered at the unit level against a synthetic
    // fixture (frontend/src/features/audit/__tests__/
    // supplierPaymentVisibility.test.ts) — it simply has no live producer
    // for bills any more (see file header comment), so this spec no longer
    // exercises it via a real settlement flow here.
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
