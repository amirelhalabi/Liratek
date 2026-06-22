/**
 * E2E: LIRA-060 — Services: Hold Money
 *
 * Validates the money invariants for holding cash on behalf of a client:
 *   - Holding cash credits the General drawer (USD + LBP) and creates a
 *     HOLD_MONEY transaction; the hold appears in the active list.
 *   - Collecting debits the General drawer back to the pre-hold baseline,
 *     creates a HOLD_MONEY_COLLECT transaction, and removes it from active.
 *   - A second collect on the same hold is rejected (no double drawer hit).
 *
 * IPC-driven over the shared per-worker DB. Per CLAUDE.md rule 15 we match the
 * transaction rows by IDENTITY (source_table + source_id from the create call)
 * and assert DRAWER DELTAS (snapshot before, compare after) — never absolute
 * totals or "newest row".
 */

import { test, expect, navigateTo } from "./fixtures";

test.describe.configure({ retries: 0 });

interface HoldRecord {
  id: number;
  client_name: string;
  phone_number: string | null;
  usd_amount: number;
  lbp_amount: number;
  status: "held" | "collected";
}

interface PaymentLeg {
  direction: "in" | "out";
  currency_code: string;
  amount?: number;
  signed_amount?: number;
}

interface TxnRow {
  id: number;
  type: string;
  source_table: string;
  source_id: number;
  // NOTE: getRecent() does NOT expose profit — profit=0 is covered by the
  // backend unit test (HoldMoneyRepository.test.ts), not asserted here.
  payments: PaymentLeg[];
}

interface Api {
  api: {
    holdMoney: {
      create: (data: {
        client_name: string;
        phone_number?: string;
        usd_amount?: number;
        lbp_amount?: number;
        notes?: string;
      }) => Promise<{ success: boolean; id?: number; error?: string }>;
      collect: (id: number) => Promise<{ success: boolean; error?: string }>;
      active: () => Promise<{ success: boolean; data?: HoldRecord[] }>;
    };
    closing: {
      getSystemExpectedBalancesDynamic: () => Promise<
        Record<string, Record<string, number>>
      >;
    };
    transactions: {
      getRecent: (limit?: number) => Promise<TxnRow[]>;
    };
  };
}

const USD_HELD = 40;
const LBP_HELD = 200_000;

test.describe("LIRA-060 — Hold Money", () => {
  test("hold credits General, collect returns it to baseline, txns recorded", async ({
    appPage,
  }) => {
    const clientName = `E2E 060 Hold ${Date.now()}`;

    const result = await appPage.evaluate(
      async ({ name, usd, lbp }) => {
        const w = window as unknown as Api;

        const general = async () => {
          const all = await w.api.closing.getSystemExpectedBalancesDynamic();
          const g = all["General"] ?? {};
          return { usd: g["USD"] ?? 0, lbp: g["LBP"] ?? 0 };
        };

        // ── Snapshot baseline ────────────────────────────────────────────────
        const before = await general();

        // ── Hold cash ────────────────────────────────────────────────────────
        const created = await w.api.holdMoney.create({
          client_name: name,
          usd_amount: usd,
          lbp_amount: lbp,
        });
        const afterHold = await general();

        const activeAfterHold = await w.api.holdMoney.active();
        const holdRow = (activeAfterHold.data ?? []).find(
          (h) => h.id === created.id,
        );

        const recentAfterHold = await w.api.transactions.getRecent(80);
        const holdTxn = recentAfterHold.find(
          (t) =>
            t.source_table === "hold_money" &&
            t.source_id === created.id &&
            t.type === "HOLD_MONEY",
        );

        // ── Collect (return) the cash ────────────────────────────────────────
        const collected = await w.api.holdMoney.collect(created.id as number);
        const afterCollect = await general();

        const activeAfterCollect = await w.api.holdMoney.active();
        const stillActive = (activeAfterCollect.data ?? []).some(
          (h) => h.id === created.id,
        );

        const recentAfterCollect = await w.api.transactions.getRecent(80);
        const collectTxn = recentAfterCollect.find(
          (t) =>
            t.source_table === "hold_money" &&
            t.source_id === created.id &&
            t.type === "HOLD_MONEY_COLLECT",
        );

        // ── Double-collect must be rejected ──────────────────────────────────
        const secondCollect = await w.api.holdMoney.collect(
          created.id as number,
        );
        const afterSecond = await general();

        const legAmt = (leg?: PaymentLeg) =>
          leg ? (leg.signed_amount ?? leg.amount ?? 0) : null;

        return {
          createOk: created.success,
          holdId: created.id ?? null,
          before,
          afterHold,
          afterCollect,
          afterSecond,
          holdRow: holdRow
            ? {
                usd: holdRow.usd_amount,
                lbp: holdRow.lbp_amount,
                status: holdRow.status,
              }
            : null,
          holdTxn: holdTxn
            ? {
                usdIn: legAmt(
                  holdTxn.payments.find(
                    (p) => p.direction === "in" && p.currency_code === "USD",
                  ),
                ),
                lbpIn: legAmt(
                  holdTxn.payments.find(
                    (p) => p.direction === "in" && p.currency_code === "LBP",
                  ),
                ),
              }
            : null,
          collectOk: collected.success,
          collectTxn: collectTxn
            ? {
                usdOut: legAmt(
                  collectTxn.payments.find(
                    (p) => p.direction === "out" && p.currency_code === "USD",
                  ),
                ),
                lbpOut: legAmt(
                  collectTxn.payments.find(
                    (p) => p.direction === "out" && p.currency_code === "LBP",
                  ),
                ),
              }
            : null,
          stillActive,
          secondCollectRejected: !secondCollect.success,
        };
      },
      { name: clientName, usd: USD_HELD, lbp: LBP_HELD },
    );

    // ── Hold created and surfaced ──────────────────────────────────────────
    expect(result.createOk).toBe(true);
    expect(result.holdId).not.toBeNull();
    expect(result.holdRow).toEqual({
      usd: USD_HELD,
      lbp: LBP_HELD,
      status: "held",
    });

    // ── Drawer credited by exactly the held amounts ────────────────────────
    expect(result.afterHold.usd - result.before.usd).toBeCloseTo(USD_HELD, 2);
    expect(result.afterHold.lbp - result.before.lbp).toBeCloseTo(LBP_HELD, 2);

    // ── Hold transaction: cash-in legs (profit=0 is covered by unit tests;
    //    getRecent does not expose profit) ──────────────────────────────────
    expect(result.holdTxn).not.toBeNull();
    expect(result.holdTxn!.usdIn).toBeCloseTo(USD_HELD, 2);
    expect(result.holdTxn!.lbpIn).toBeCloseTo(LBP_HELD, 2);

    // ── Collect returns the drawer to baseline (net zero) ──────────────────
    expect(result.collectOk).toBe(true);
    expect(result.afterCollect.usd - result.before.usd).toBeCloseTo(0, 2);
    expect(result.afterCollect.lbp - result.before.lbp).toBeCloseTo(0, 2);
    expect(result.stillActive).toBe(false);

    // ── Collect transaction: cash-out legs (negative) ──────────────────────
    expect(result.collectTxn).not.toBeNull();
    expect(result.collectTxn!.usdOut).toBeCloseTo(-USD_HELD, 2);
    expect(result.collectTxn!.lbpOut).toBeCloseTo(-LBP_HELD, 2);

    // ── Double-collect rejected, drawer unchanged after it ─────────────────
    expect(result.secondCollectRejected).toBe(true);
    expect(result.afterSecond.usd - result.afterCollect.usd).toBeCloseTo(0, 2);
    expect(result.afterSecond.lbp - result.afterCollect.lbp).toBeCloseTo(0, 2);
  });

  test("UI: Hold Money category swaps the form, holds + collects through the page", async ({
    appPage,
  }) => {
    const customer = `E2E 060 UI ${Date.now()}`;
    const UI_USD = 30;

    await navigateTo(appPage, "/custom-services");

    // The standard service form is shown first — its cost field is present.
    await expect(appPage.locator("#svc-cost")).toBeVisible({ timeout: 10_000 });

    // ── Select the "Hold Money" category chip (first match = the chip) ───────
    const holdChip = appPage
      .locator("button")
      .filter({ hasText: /^Hold Money$/ })
      .first();
    await expect(holdChip).toBeVisible({ timeout: 8_000 });
    await holdChip.click();

    // Form swapped: Hold Money fields appear; cost/price + presets are gone.
    await expect(appPage.locator("#hold-client")).toBeVisible({
      timeout: 5_000,
    });
    await expect(appPage.locator("#hold-usd")).toBeVisible();
    await expect(appPage.locator("#svc-cost")).toHaveCount(0);

    // ── Snapshot the General USD drawer before holding ──────────────────────
    const generalUsd = async () =>
      appPage.evaluate(async () => {
        const w = window as unknown as Api;
        const all = await w.api.closing.getSystemExpectedBalancesDynamic();
        return all["General"]?.["USD"] ?? 0;
      });
    const usdBefore = await generalUsd();

    // ── Fill the form and hold ──────────────────────────────────────────────
    await appPage.locator("#hold-client").fill(customer);
    // Blur (not a global Escape) to close the client-autocomplete dropdown.
    await appPage.locator("#hold-client").blur();
    await appPage.locator("#hold-phone").fill("03 060 060");
    await appPage.locator("#hold-usd").fill(String(UI_USD));

    const holdBtn = appPage.getByTestId("hold-money-submit");
    await expect(holdBtn).toBeEnabled({ timeout: 5_000 });
    await holdBtn.click();

    // ── Confirm the create actually fired (IPC), independent of DOM timing ──
    await expect
      .poll(
        () =>
          appPage.evaluate(async (name) => {
            const w = window as unknown as Api;
            const res = await w.api.holdMoney.active();
            return (res.data ?? []).some((h) => h.client_name === name);
          }, customer),
        { timeout: 8_000 },
      )
      .toBe(true);

    // It renders in the Active Holds list (scoped to the hold row, not the form).
    const row = appPage
      .locator("div.flex.items-center.justify-between")
      .filter({ hasText: customer });
    await expect(row).toBeVisible({ timeout: 5_000 });

    // Drawer credited by the held USD (delta, not absolute).
    await expect
      .poll(async () => (await generalUsd()) - usdBefore, { timeout: 8_000 })
      .toBeCloseTo(UI_USD, 2);

    // ── Collect it from the page → row disappears, drawer returns ───────────
    await row.getByRole("button", { name: /Collect/i }).click();

    await expect
      .poll(async () => (await generalUsd()) - usdBefore, { timeout: 8_000 })
      .toBeCloseTo(0, 2);

    const stillActive = await appPage.evaluate(async (name) => {
      const w = window as unknown as Api;
      const res = await w.api.holdMoney.active();
      return (res.data ?? []).some((h) => h.client_name === name);
    }, customer);
    expect(stillActive).toBe(false);
  });
});
