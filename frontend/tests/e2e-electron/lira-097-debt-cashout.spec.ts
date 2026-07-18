/**
 * LIRA-097 — Debts: Cash Out for a creditor (negative balance).
 *
 * Owner-reported (2026-07-05), validated by this spec BEFORE the fix:
 *  1. "Settling" a negative balance doubled the credit: the Cash Out button
 *     opened the SAME repayment modal, which booked a Repayment (NEGATIVE
 *     ledger row, drawer CREDIT). Paying a $20 credit out took the balance
 *     from −20 to −40 ("payment added twice") and moved the till the wrong
 *     way (+20 instead of −20).
 *  2. The Cash Out modal did not autocomplete the payout amount: the modal
 *     received the raw negative total, which the amount auto-sync could not
 *     represent.
 *
 * Correct semantics guarded here (balance = SUM(debt_ledger); negative =
 * shop owes client):
 *  - Cash Out books ONE positive ledger entry (balance → 0) and DEBITS the
 *    drawer by the payout, exactly once.
 *  - The modal prefills the payout with the client's credit (absolute value).
 *
 * Rule 15: delta/identity assertions. Rule 17: this spec was run against the
 * pre-fix code and failed on every core assertion (balance −40, drawer +20,
 * empty amount field).
 *
 * MIXED-POSITION UPDATE (2026-07-05, second pass): the action button used to
 * be picked by the USD sign alone (`isCredit = netUsd < 0`), so a mixed
 * client (USD credit + LBP debt) got ONLY "Cash Out" — the LBP debt was
 * unsettleable until the USD credit was cashed out first (the sequential
 * flow the third test pins). The page now renders BOTH buttons, each gated
 * on its own side, tables get combined "Purchases & Charges" /
 * "Payments & Deposits" headers, and settling one side keeps the client
 * selected (the old post-repayment check compared the USD-CONVERTED net to
 * 0.01 and deselected mixed clients). The fourth test guards this and was
 * proven to FAIL pre-fix (no Settle Debt button in the DOM in mixed state).
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

type Api = {
  api: {
    clients: {
      create: (d: {
        full_name: string;
        phone_number: string;
        whatsapp_opt_in: number;
      }) => Promise<{ success?: boolean; id?: number; error?: string }>;
    };
    maintenance: {
      save: (d: Record<string, unknown>) => Promise<{
        success?: boolean;
        error?: string;
      }>;
    };
    debt: {
      addCredit: (d: {
        clientId: number;
        amountUsd: number;
        amountLbp: number;
        note?: string;
      }) => Promise<{ success?: boolean; error?: string }>;
      getClientTotal: (clientId: number) => Promise<number>;
      getClientBalance: (clientId: number) => Promise<{
        success?: boolean;
        data?: { balance_usd: number; balance_lbp: number };
      }>;
      getDebtors: () => Promise<
        Array<{
          client_id?: number;
          id?: number;
          full_name?: string;
          client_name?: string;
          total_debt_usd: number;
          total_debt_lbp: number;
        }>
      >;
    };
    dashboard: {
      getDrawerBalances: () => Promise<{
        generalDrawer: { usd: number; lbp: number };
      }>;
    };
  };
};

let dialogs: string[] = [];

async function seedCreditor(page: Page, name: string, creditUsd: number) {
  return page.evaluate(
    async ({ n, credit }) => {
      const w = window as unknown as Api;
      const created = await w.api.clients.create({
        full_name: n,
        phone_number: `71${String(Date.now()).slice(-6)}`,
        whatsapp_opt_in: 0,
      });
      if (!created.success || !created.id) {
        return { id: 0, balance: NaN, error: created.error ?? "create failed" };
      }
      const credited = await w.api.debt.addCredit({
        clientId: created.id,
        amountUsd: credit,
        amountLbp: 0,
        note: "L097 credit seed",
      });
      if (!credited.success) {
        return {
          id: 0,
          balance: NaN,
          error: credited.error ?? "credit failed",
        };
      }
      return {
        id: created.id,
        balance: await w.api.debt.getClientTotal(created.id),
        error: null as string | null,
      };
    },
    { n: name, credit: creditUsd },
  );
}

async function openCashOutModal(page: Page, clientName: string) {
  await navigateTo(page, "/");
  await navigateTo(page, "/debts");
  await page.getByPlaceholder(/Search client/i).fill(clientName);
  await page.locator("button").filter({ hasText: clientName }).first().click();
  await page
    .locator("button")
    .filter({ hasText: /Cash Out/i })
    .first()
    .click();
  await expect(page.getByText("Process Repayment")).toBeVisible();
}

test.describe("LIRA-097 — creditor cash out", () => {
  test.beforeEach(({ appPage }) => {
    dialogs = [];
    appPage.on("dialog", (d) => dialogs.push(d.message()));
  });

  test("cash out settles the credit to zero and pays out of the drawer once", async ({
    appPage,
  }) => {
    const CLIENT = `L097 CashOut ${Date.now()}`;
    const CREDIT = 20;

    const seeded = await seedCreditor(appPage, CLIENT, CREDIT);
    expect(seeded.error).toBeNull();
    expect(seeded.balance).toBeCloseTo(-CREDIT, 2);

    const before = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      return (await w.api.dashboard.getDrawerBalances()).generalDrawer.usd;
    });

    await openCashOutModal(appPage, CLIENT);
    // Pay the client their $20 (single CASH USD line).
    await appPage
      .locator('[data-testid^="payment-amount-"]')
      .first()
      .fill(String(CREDIT));
    await appPage.getByRole("button", { name: /^Confirm Payment$/ }).click();

    await expect(
      appPage
        .locator('[role="alert"]', { hasText: /Cash out processed/i })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    expect(
      dialogs.filter((d) => /error|validation|nan/i.test(d)),
      "cash out raised an error dialog",
    ).toEqual([]);

    // The credit is SETTLED, not doubled (pre-fix: −40).
    const balanceAfter = await appPage.evaluate(
      async (id) => (window as unknown as Api).api.debt.getClientTotal(id),
      seeded.id,
    );
    expect(Math.abs(balanceAfter)).toBeLessThan(0.01);

    // The till PAID OUT the credit, exactly once (pre-fix: +20 — money in).
    const after = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      return (await w.api.dashboard.getDrawerBalances()).generalDrawer.usd;
    });
    expect(after - before).toBeCloseTo(-CREDIT, 2);
  });

  test("cash out modal prefills the payout with the credit amount", async ({
    appPage,
  }) => {
    const CLIENT = `L097 Prefill ${Date.now()}`;
    const CREDIT = 15;

    const seeded = await seedCreditor(appPage, CLIENT, CREDIT);
    expect(seeded.error).toBeNull();
    expect(seeded.balance).toBeCloseTo(-CREDIT, 2);

    await openCashOutModal(appPage, CLIENT);
    // The payout amount auto-completes with the client's credit (abs value) —
    // pre-fix the field stayed empty (the negative total couldn't sync).
    await expect(
      appPage.locator('[data-testid^="payment-amount-"]').first(),
    ).toHaveValue(String(CREDIT), { timeout: 5_000 });

    await appPage.getByRole("button", { name: /^Cancel$/ }).click();
  });

  test("mixed position (USD credit + LBP debt): per-currency display, cash out USD, then settle LBP", async ({
    appPage,
  }) => {
    // Owner scenario (2026-07-05), exact amounts: "$35.06 credit |
    // 3,155,000 LBP debt" — a mixed position that NETS to ~0 at the seeded
    // 90,000 sell rate (3,155,000 / 90,000 = 35.06). The panel forced one
    // sign on both currencies (double credit on screen), the modal read the
    // converted net (~$0.00) and treated the client as a debtor, and the
    // panel's type/sign-filtered sums could diverge from the raw ledger the
    // cash-out guard enforces ("Client has no credit to cash out" while the
    // panel showed +$35.06) — the panel now reads debt:client-balance.
    const ts = Date.now();
    const CLIENT = `L097 Mixed ${ts}`;
    const PHONE = `71${String(ts + 9).slice(-6)}`;
    const USD_CREDIT = 35.06;
    const LBP_DEBT = 3_155_000; // = $35.06 at the seeded 90,000 rate → net ≈ 0

    // Seed the LBP debt (maintenance on CUSTOMER_ACCOUNT, LBP job) and then
    // the USD credit — a genuinely mixed per-currency position.
    const seeded = await appPage.evaluate(
      async ({ name, phone, lbpDebt, usdCredit }) => {
        const w = window as unknown as Api;
        const job = await w.api.maintenance.save({
          device_name: "L097 mixed phone",
          issue_description: "mixed position seed",
          client_name: name,
          client_phone: phone,
          cost_usd: 0,
          price_usd: 0,
          cost_lbp: 0,
          final_amount_lbp: lbpDebt,
          currency: "LBP",
          exchange_rate: 90000,
          status: "Delivered_Paid",
          paid_usd: 0,
          paid_lbp: 0,
          payments: [
            {
              method: "CUSTOMER_ACCOUNT",
              currency_code: "LBP",
              amount: lbpDebt,
            },
          ],
        });
        if (!job.success) {
          return {
            id: 0,
            usd: NaN,
            lbp: NaN,
            error: job.error ?? "job failed",
          };
        }
        const debtors = await w.api.debt.getDebtors();
        const row = debtors.find(
          (r) => (r.full_name ?? r.client_name) === name,
        );
        const clientId = row?.client_id ?? row?.id ?? 0;
        if (!clientId) return { id: 0, usd: NaN, lbp: NaN, error: "no debtor" };
        const credited = await w.api.debt.addCredit({
          clientId,
          amountUsd: usdCredit,
          amountLbp: 0,
          note: "L097 mixed credit seed",
        });
        if (!credited.success) {
          return {
            id: 0,
            usd: NaN,
            lbp: NaN,
            error: credited.error ?? "credit",
          };
        }
        const after = (await w.api.debt.getDebtors()).find(
          (r) => (r.full_name ?? r.client_name) === name,
        );
        return {
          id: clientId,
          usd: after?.total_debt_usd ?? NaN,
          lbp: after?.total_debt_lbp ?? NaN,
          error: null as string | null,
        };
      },
      { name: CLIENT, phone: PHONE, lbpDebt: LBP_DEBT, usdCredit: USD_CREDIT },
    );
    expect(seeded.error).toBeNull();
    expect(seeded.usd).toBeCloseTo(-USD_CREDIT, 2); // USD credit
    expect(seeded.lbp).toBeCloseTo(LBP_DEBT, 0); // LBP debt

    // The panel's balance must equal the raw ledger balance the backend
    // guard enforces — one source of truth, per currency.
    const ledger = await appPage.evaluate(async (id) => {
      const w = window as unknown as Api;
      return (await w.api.debt.getClientBalance(id)).data ?? null;
    }, seeded.id);
    expect(ledger?.balance_usd).toBeCloseTo(-USD_CREDIT, 2);
    expect(ledger?.balance_lbp).toBeCloseTo(LBP_DEBT, 0);

    // Panel: each currency carries its OWN sign — pre-fix both showed "+".
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/debts");
    await appPage.getByPlaceholder(/Search client/i).fill(CLIENT);
    await appPage.locator("button").filter({ hasText: CLIENT }).first().click();
    await expect(appPage.getByText(`+$${USD_CREDIT.toFixed(2)}`)).toBeVisible();
    await expect(
      appPage.getByText(`-${LBP_DEBT.toLocaleString()} LBP`),
    ).toBeVisible();

    const generalBefore = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const b = await w.api.dashboard.getDrawerBalances();
      return { usd: b.generalDrawer.usd, lbp: b.generalDrawer.lbp };
    });

    // Step 1 — Cash Out pays the USD credit only (pre-fix: modal said
    // "Full debt — $0.00" and treated the client as a debtor). The payment
    // form opens pre-seeded with the per-currency credit.
    await appPage
      .locator("button")
      .filter({ hasText: /Cash Out/i })
      .first()
      .click();
    await expect(appPage.getByText("Process Repayment")).toBeVisible();
    await expect(
      appPage.locator('[data-testid^="payment-amount-"]').first(),
    ).toHaveValue(String(USD_CREDIT));
    await appPage.getByRole("button", { name: /^Confirm Payment$/ }).click();
    await expect(
      appPage
        .locator('[role="alert"]', { hasText: /Cash out processed/i })
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    // Step 2 — the position is now a pure LBP debt: the form opens pre-seeded
    // with the NATIVE-currency line (3,155,000 LBP, not a converted $35.06).
    await appPage
      .locator("button")
      .filter({ hasText: /Settle Debt/i })
      .first()
      .click();
    await expect(appPage.getByText("Process Repayment")).toBeVisible();
    await expect(
      appPage.locator('[data-testid^="payment-amount-"]').first(),
    ).toHaveValue(LBP_DEBT.toLocaleString());
    await appPage.getByRole("button", { name: /^Confirm Payment$/ }).click();
    await expect(
      appPage
        .locator('[role="alert"]', { hasText: /Repayment processed/i })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    expect(
      dialogs.filter((d) => /error|validation|nan/i.test(d)),
      "mixed settle raised an error dialog",
    ).toEqual([]);

    // Books: both currencies settled to zero PER CURRENCY (no converted
    // residue), $35.06 paid out of the till, 3,155,000 LBP collected into it.
    const finalRow = await appPage.evaluate(
      async ({ name }) => {
        const w = window as unknown as Api;
        return (
          (await w.api.debt.getDebtors()).find(
            (r) => (r.full_name ?? r.client_name) === name,
          ) ?? null
        );
      },
      { name: CLIENT },
    );
    expect(Math.abs(finalRow?.total_debt_usd ?? 0)).toBeLessThan(0.01);
    expect(Math.abs(finalRow?.total_debt_lbp ?? 0)).toBeLessThan(1000);

    const generalAfter = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const b = await w.api.dashboard.getDrawerBalances();
      return { usd: b.generalDrawer.usd, lbp: b.generalDrawer.lbp };
    });
    expect(generalAfter.usd - generalBefore.usd).toBeCloseTo(-USD_CREDIT, 2);
    expect(generalAfter.lbp - generalBefore.lbp).toBeCloseTo(LBP_DEBT, 0);
  });

  test("mixed position offers BOTH actions: LBP settles FIRST, client stays selected, USD credit intact", async ({
    appPage,
  }) => {
    // Non-netting mixed position: $25 USD credit + 1,000,000 LBP debt. The
    // pre-fix page picked ONE button from the USD sign (Cash Out only here),
    // making the LBP debt unreachable until the credit was cashed out.
    const ts = Date.now();
    const CLIENT = `L097 Both ${ts}`;
    const PHONE = `71${String(ts + 17).slice(-6)}`;
    const USD_CREDIT = 25;
    const LBP_DEBT = 1_000_000;

    const seeded = await appPage.evaluate(
      async ({ name, phone, lbpDebt, usdCredit }) => {
        const w = window as unknown as Api;
        const job = await w.api.maintenance.save({
          device_name: "L097 both phone",
          issue_description: "both-buttons seed",
          client_name: name,
          client_phone: phone,
          cost_usd: 0,
          price_usd: 0,
          cost_lbp: 0,
          final_amount_lbp: lbpDebt,
          currency: "LBP",
          exchange_rate: 90000,
          status: "Delivered_Paid",
          paid_usd: 0,
          paid_lbp: 0,
          payments: [
            {
              method: "CUSTOMER_ACCOUNT",
              currency_code: "LBP",
              amount: lbpDebt,
            },
          ],
        });
        if (!job.success) {
          return { id: 0, error: job.error ?? "job failed" };
        }
        const debtors = await w.api.debt.getDebtors();
        const row = debtors.find(
          (r) => (r.full_name ?? r.client_name) === name,
        );
        const clientId = row?.client_id ?? row?.id ?? 0;
        if (!clientId) return { id: 0, error: "no debtor" };
        const credited = await w.api.debt.addCredit({
          clientId,
          amountUsd: usdCredit,
          amountLbp: 0,
          note: "L097 both credit seed",
        });
        if (!credited.success) {
          return { id: 0, error: credited.error ?? "credit" };
        }
        return { id: clientId, error: null as string | null };
      },
      { name: CLIENT, phone: PHONE, lbpDebt: LBP_DEBT, usdCredit: USD_CREDIT },
    );
    expect(seeded.error).toBeNull();

    // Confirm the seeded position is genuinely mixed per currency before the
    // UI assertions rest on it.
    const seededLedger = await appPage.evaluate(async (id) => {
      const w = window as unknown as Api;
      return (await w.api.debt.getClientBalance(id)).data ?? null;
    }, seeded.id);
    expect(seededLedger?.balance_usd).toBeCloseTo(-USD_CREDIT, 2);
    expect(seededLedger?.balance_lbp).toBeCloseTo(LBP_DEBT, 0);

    // Seed a DECOY high-debt client so the deselect regression is observable
    // even when this spec runs in isolation (a lone debtor would be
    // auto-re-selected after a deselect, masking it). The decoy's large
    // positive USD debt sorts it to the TOP of the debtors list (ORDER BY
    // converted net DESC), so a wrongful deselect auto-selects the DECOY, not
    // CLIENT. A CUSTOMER_ACCOUNT leg books debt without moving any drawer, so
    // the decoy does not disturb this test's General deltas.
    const DECOY = `L097 Decoy ${ts}`;
    const decoyErr = await appPage.evaluate(
      async ({ name, phone }) => {
        const w = window as unknown as Api;
        const job = await w.api.maintenance.save({
          device_name: "L097 decoy phone",
          issue_description: "decoy high debt",
          client_name: name,
          client_phone: phone,
          cost_usd: 0,
          price_usd: 500,
          cost_lbp: 0,
          final_amount_usd: 500,
          currency: "USD",
          exchange_rate: 90000,
          status: "Delivered_Paid",
          paid_usd: 0,
          paid_lbp: 0,
          payments: [
            { method: "CUSTOMER_ACCOUNT", currency_code: "USD", amount: 500 },
          ],
        });
        return job.success ? null : (job.error ?? "decoy failed");
      },
      { name: DECOY, phone: `71${String(ts + 33).slice(-6)}` },
    );
    expect(decoyErr).toBeNull();

    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/debts");
    await appPage.getByPlaceholder(/Search client/i).fill(CLIENT);
    await appPage.locator("button").filter({ hasText: CLIENT }).first().click();

    // BOTH actions are offered simultaneously — pre-fix only Cash Out
    // rendered (netUsd < 0 picked the single button).
    const settleBtn = appPage
      .locator("button")
      .filter({ hasText: /Settle Debt/i })
      .first();
    const cashOutBtn = appPage
      .locator("button")
      .filter({ hasText: /Cash Out/i })
      .first();
    await expect(settleBtn).toBeVisible();
    await expect(cashOutBtn).toBeVisible();

    // Mixed table framing — pre-fix the USD sign forced pure-creditor
    // labels ("Charges" / "Deposits") onto an account that also owes LBP.
    await expect(appPage.getByText("Purchases & Charges")).toBeVisible();
    await expect(appPage.getByText("Payments & Deposits")).toBeVisible();

    // Clear the search so the debtor list is UNFILTERED before the settle.
    // This is what makes the deselect regression observable: the client stays
    // selected, but if the old converted-net deselect fires after the LBP
    // settle (leaving a $25 credit → net ≈ −$14 converted → "closed"),
    // auto-select jumps to the highest-debt client in the shared DB — a
    // DIFFERENT name. With the search still narrowed to CLIENT, a deselect is
    // masked by auto-reselecting the sole match, so the guard would be a
    // no-op. selectedClient survives a search change (only a filter change
    // clears it).
    await appPage.getByPlaceholder(/Search client/i).fill("");
    await expect(appPage.getByRole("heading", { name: CLIENT })).toBeVisible();

    const generalBefore = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const b = await w.api.dashboard.getDrawerBalances();
      return { usd: b.generalDrawer.usd, lbp: b.generalDrawer.lbp };
    });

    // Settle the LBP debt FIRST — without cashing out the USD credit.
    await settleBtn.click();
    await expect(appPage.getByText("Process Repayment")).toBeVisible();
    await expect(
      appPage.locator('[data-testid^="payment-amount-"]').first(),
    ).toHaveValue(LBP_DEBT.toLocaleString());
    await appPage.getByRole("button", { name: /^Confirm Payment$/ }).click();
    await expect(
      appPage
        .locator('[role="alert"]', { hasText: /Repayment processed/i })
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    // The client STAYS selected with the USD credit intact — the old
    // converted-net check saw net ≈ −$14 (< 0.01), deselected them, and (with
    // the search cleared above) auto-select jumped to a different, higher-debt
    // client, so this heading assertion fails on the pre-fix code.
    await expect(appPage.getByRole("heading", { name: CLIENT })).toBeVisible();
    await expect(appPage.getByText(`+$${USD_CREDIT.toFixed(2)}`)).toBeVisible();

    // Only the LBP side moved: till collected the debt, USD untouched.
    const afterSettle = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const b = await w.api.dashboard.getDrawerBalances();
      return { usd: b.generalDrawer.usd, lbp: b.generalDrawer.lbp };
    });
    expect(afterSettle.lbp - generalBefore.lbp).toBeCloseTo(LBP_DEBT, 0);
    expect(afterSettle.usd - generalBefore.usd).toBeCloseTo(0, 2);

    // The debt side is gone, so only Cash Out remains; pay out the credit.
    await expect(
      appPage.locator("button").filter({ hasText: /Settle Debt/i }),
    ).toHaveCount(0);
    await cashOutBtn.click();
    await expect(appPage.getByText("Process Repayment")).toBeVisible();
    await expect(
      appPage.locator('[data-testid^="payment-amount-"]').first(),
    ).toHaveValue(String(USD_CREDIT));
    await appPage.getByRole("button", { name: /^Confirm Payment$/ }).click();
    await expect(
      appPage
        .locator('[role="alert"]', { hasText: /Cash out processed/i })
        .first(),
    ).toBeVisible({ timeout: 15_000 });
    expect(
      dialogs.filter((d) => /error|validation|nan/i.test(d)),
      "mixed both-buttons flow raised an error dialog",
    ).toEqual([]);

    // Fully closed: no action button remains, both ledger sides at zero,
    // and the till paid out exactly the USD credit.
    await expect(
      appPage.locator("button").filter({ hasText: /Cash Out/i }),
    ).toHaveCount(0);
    await expect(
      appPage.locator("button").filter({ hasText: /Settle Debt/i }),
    ).toHaveCount(0);

    const ledger = await appPage.evaluate(async (id) => {
      const w = window as unknown as Api;
      return (await w.api.debt.getClientBalance(id)).data ?? null;
    }, seeded.id);
    expect(Math.abs(ledger?.balance_usd ?? NaN)).toBeLessThan(0.01);
    expect(Math.abs(ledger?.balance_lbp ?? NaN)).toBeLessThan(1000);

    const generalAfter = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const b = await w.api.dashboard.getDrawerBalances();
      return { usd: b.generalDrawer.usd, lbp: b.generalDrawer.lbp };
    });
    expect(generalAfter.usd - generalBefore.usd).toBeCloseTo(-USD_CREDIT, 2);
    expect(generalAfter.lbp - generalBefore.lbp).toBeCloseTo(LBP_DEBT, 0);
  });
});
