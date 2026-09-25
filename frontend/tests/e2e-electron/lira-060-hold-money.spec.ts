/**
 * NOT RUN — proven at the end-of-batch gate (owner process rule for this
 * batch). LIRA-060 / LIRA-214 (OWNER_NOTES_REMAINING_BUILD.md #24, migration
 * v183) — Services: Hold Money.
 *
 * Validates the money invariants for holding cash on behalf of a client:
 *   - Holding cash posts its payment legs and creates a HOLD_MONEY
 *     transaction; the hold appears in the active list.
 *   - Collecting (LIRA-214: now a payload, and partial pickup is allowed)
 *     debits the drawer by exactly the portion returned, creates a
 *     HOLD_MONEY_COLLECT transaction, and only removes it from the active
 *     list once nothing remains.
 *   - Voiding a pickup (rule 20) re-credits the drawer and reopens the hold.
 *   - Collecting more than what remains is rejected (no over-collect).
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
  remaining_usd: number;
  remaining_lbp: number;
}

interface PickupRecord {
  id: number;
  hold_money_id: number;
  usd_amount: number;
  lbp_amount: number;
  is_voided: number;
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
        client_id?: number | null;
        usd_amount?: number;
        lbp_amount?: number;
        notes?: string;
        payments?: Array<{
          method: string;
          currency_code: string;
          amount: number;
          direction?: "IN" | "OUT";
        }>;
        exchange_rate?: number;
      }) => Promise<{ success: boolean; id?: number; error?: string }>;
      collect: (data: {
        id: number;
        usd_amount?: number;
        lbp_amount?: number;
        payments?: Array<{
          method: string;
          currency_code: string;
          amount: number;
          direction?: "IN" | "OUT";
        }>;
        exchange_rate?: number;
      }) => Promise<{ success: boolean; id?: number; error?: string }>;
      voidPickup: (
        pickupId: number,
      ) => Promise<{ success: boolean; id?: number; error?: string }>;
      pickups: (
        holdMoneyId: number,
      ) => Promise<{ success: boolean; data?: PickupRecord[] }>;
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

        // ── Collect (return) the cash — LIRA-214: full pickup by omitting
        // usd_amount/lbp_amount ────────────────────────────────────────────
        const collected = await w.api.holdMoney.collect({
          id: created.id as number,
        });
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
        const secondCollect = await w.api.holdMoney.collect({
          id: created.id as number,
        });
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

  test("LIRA-214: partial pickup leaves the hold active with the right remaining balance, over-collect is rejected, and voiding a pickup re-credits the drawer", async ({
    appPage,
  }) => {
    const clientName = `E2E 214 Partial ${Date.now()}`;

    const result = await appPage.evaluate(
      async ({ name }) => {
        const w = window as unknown as Api;
        const general = async () => {
          const all = await w.api.closing.getSystemExpectedBalancesDynamic();
          const g = all["General"] ?? {};
          return { usd: g["USD"] ?? 0, lbp: g["LBP"] ?? 0 };
        };

        const before = await general();
        const created = await w.api.holdMoney.create({
          client_name: name,
          usd_amount: 100,
        });

        // First partial pickup: $60 of the $100 held.
        const firstCollect = await w.api.holdMoney.collect({
          id: created.id as number,
          usd_amount: 60,
        });
        const afterFirst = await general();
        const activeAfterFirst = await w.api.holdMoney.active();
        const rowAfterFirst = (activeAfterFirst.data ?? []).find(
          (h) => h.id === created.id,
        );

        // Over-collecting the remainder must be rejected.
        const overCollect = await w.api.holdMoney.collect({
          id: created.id as number,
          usd_amount: 100, // only $40 remains
        });
        const afterOverAttempt = await general();

        // Second (final) pickup: the remaining $40, by omission.
        const secondCollect = await w.api.holdMoney.collect({
          id: created.id as number,
        });
        const afterSecond = await general();
        const activeAfterSecond = await w.api.holdMoney.active();
        const stillActiveAfterFull = (activeAfterSecond.data ?? []).some(
          (h) => h.id === created.id,
        );

        // Void the FIRST pickup — re-credits its $60 and reopens the hold.
        const pickupsRes = await w.api.holdMoney.pickups(created.id as number);
        const firstPickup = (pickupsRes.data ?? []).find(
          (p) => p.usd_amount === 60 && p.is_voided === 0,
        );
        const voided = firstPickup
          ? await w.api.holdMoney.voidPickup(firstPickup.id)
          : { success: false };
        const afterVoid = await general();
        const activeAfterVoid = await w.api.holdMoney.active();
        const rowAfterVoid = (activeAfterVoid.data ?? []).find(
          (h) => h.id === created.id,
        );

        return {
          createOk: created.success,
          before,
          firstCollectOk: firstCollect.success,
          afterFirst,
          rowAfterFirst: rowAfterFirst
            ? {
                status: rowAfterFirst.status,
                remaining_usd: rowAfterFirst.remaining_usd,
              }
            : null,
          overCollectRejected: !overCollect.success,
          afterOverAttempt,
          secondCollectOk: secondCollect.success,
          afterSecond,
          stillActiveAfterFull,
          voidOk: voided.success,
          afterVoid,
          rowAfterVoid: rowAfterVoid
            ? {
                status: rowAfterVoid.status,
                remaining_usd: rowAfterVoid.remaining_usd,
              }
            : null,
        };
      },
      { name: clientName },
    );

    expect(result.createOk).toBe(true);

    // First partial pickup: drawer nets to +$40 (100 in, 60 out), hold stays
    // active with $40 remaining.
    expect(result.firstCollectOk).toBe(true);
    expect(result.afterFirst.usd - result.before.usd).toBeCloseTo(40, 2);
    expect(result.rowAfterFirst).toEqual({
      status: "held",
      remaining_usd: 40,
    });

    // Over-collecting the $40 remainder as $100 is rejected — no drawer move.
    expect(result.overCollectRejected).toBe(true);
    expect(result.afterOverAttempt.usd - result.afterFirst.usd).toBeCloseTo(
      0,
      2,
    );

    // Final pickup of the remainder: drawer back to baseline, hold inactive.
    expect(result.secondCollectOk).toBe(true);
    expect(result.afterSecond.usd - result.before.usd).toBeCloseTo(0, 2);
    expect(result.stillActiveAfterFull).toBe(false);

    // Voiding the FIRST ($60) pickup re-credits exactly $60 and reopens the
    // hold with $60 remaining (rule 20 — create + one pickup's void nets to
    // that pickup's own amount, not the whole hold).
    expect(result.voidOk).toBe(true);
    expect(result.afterVoid.usd - result.afterSecond.usd).toBeCloseTo(60, 2);
    expect(result.rowAfterVoid).toEqual({
      status: "held",
      remaining_usd: 60,
    });
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

    // ── Collect it from the page — LIRA-214: Collect opens the pickup sheet
    // (payment form), defaulting to the full remaining balance via a single
    // auto-seeded CASH line (MultiPaymentInput's default) → row disappears,
    // drawer returns ──────────────────────────────────────────────────────
    await row.getByRole("button", { name: /Collect/i }).click();

    const sheet = appPage.getByTestId("hold-money-pickup-sheet");
    await expect(sheet).toBeVisible({ timeout: 5_000 });

    const submitBtn = appPage.getByTestId("hold-money-pickup-submit");
    await expect(submitBtn).toBeEnabled({ timeout: 5_000 });
    await submitBtn.click();

    await expect(sheet).toHaveCount(0, { timeout: 8_000 });

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

  test("UI: the pickup-history panel voids a partial pickup and re-credits the drawer", async ({
    appPage,
  }) => {
    // rule 20 — HoldMoneyRepository.voidPickup is the reversal owner for a
    // pickup event, but it must be REACHABLE from the page, not only over
    // IPC (the "partial pickup ... voiding a pickup" test above drives it
    // directly via w.api). This test drives the SAME mechanism through the
    // real History → Void button in HoldMoneySection (rule 15/layer-seam).
    const customer = `E2E 214 UI Void ${Date.now()}`;
    const HELD_USD = 50;
    const PICKUP_USD = 20;

    await navigateTo(appPage, "/custom-services");

    const holdChip = appPage
      .locator("button")
      .filter({ hasText: /^Hold Money$/ })
      .first();
    await expect(holdChip).toBeVisible({ timeout: 8_000 });
    await holdChip.click();
    await expect(appPage.locator("#hold-client")).toBeVisible({
      timeout: 5_000,
    });

    const generalUsd = async () =>
      appPage.evaluate(async () => {
        const w = window as unknown as Api;
        const all = await w.api.closing.getSystemExpectedBalancesDynamic();
        return all["General"]?.["USD"] ?? 0;
      });
    const usdBefore = await generalUsd();

    // ── Hold $50 ─────────────────────────────────────────────────────────
    await appPage.locator("#hold-client").fill(customer);
    await appPage.locator("#hold-client").blur();
    await appPage.locator("#hold-usd").fill(String(HELD_USD));
    const holdBtn = appPage.getByTestId("hold-money-submit");
    await expect(holdBtn).toBeEnabled({ timeout: 5_000 });
    await holdBtn.click();

    await expect
      .poll(async () => (await generalUsd()) - usdBefore, { timeout: 8_000 })
      .toBeCloseTo(HELD_USD, 2);

    const row = appPage
      .locator("div.flex.items-center.justify-between")
      .filter({ hasText: customer });
    await expect(row).toBeVisible({ timeout: 5_000 });

    // ── Partial pickup: $20 of the $50 ──────────────────────────────────
    await row.getByRole("button", { name: /Collect/i }).click();
    const sheet = appPage.getByTestId("hold-money-pickup-sheet");
    await expect(sheet).toBeVisible({ timeout: 5_000 });

    const pickupUsdInput = appPage.getByTestId("hold-pickup-usd");
    await pickupUsdInput.fill(String(PICKUP_USD));

    const pickupSubmit = appPage.getByTestId("hold-money-pickup-submit");
    await expect(pickupSubmit).toBeEnabled({ timeout: 5_000 });
    await pickupSubmit.click();
    await expect(sheet).toHaveCount(0, { timeout: 8_000 });

    // Drawer nets to +$30 (50 in, 20 out); the hold stays in the "Held" list
    // (partial — $30 of $50 remains).
    await expect
      .poll(async () => (await generalUsd()) - usdBefore, { timeout: 8_000 })
      .toBeCloseTo(HELD_USD - PICKUP_USD, 2);
    await expect(row).toBeVisible({ timeout: 5_000 });

    // ── Open the pickup history panel and void the $20 pickup ──────────
    const historyBtn = row.locator('[data-testid^="hold-history-"]');
    await expect(historyBtn).toBeVisible({ timeout: 5_000 });
    await historyBtn.click();

    const historyPanel = appPage.locator(
      '[data-testid^="hold-pickup-history-"]',
    );
    await expect(historyPanel).toBeVisible({ timeout: 5_000 });

    const voidBtn = historyPanel.locator('[data-testid^="hold-void-pickup-"]');
    await expect(voidBtn).toBeVisible({ timeout: 5_000 });
    // fixtures.ts auto-accepts the window.confirm() this button raises.
    await voidBtn.click();

    // Voiding re-credits the $20 payout — drawer goes back to +$50 (its
    // full held amount, delta from baseline) and the void button/row
    // disappears (replaced by a "voided" strike-through label).
    await expect
      .poll(async () => (await generalUsd()) - usdBefore, { timeout: 8_000 })
      .toBeCloseTo(HELD_USD, 2);
    await expect(voidBtn).toHaveCount(0, { timeout: 8_000 });

    const stillHeldFullAmount = await appPage.evaluate(async (name) => {
      const w = window as unknown as Api;
      const res = await w.api.holdMoney.active();
      const h = (res.data ?? []).find((r) => r.client_name === name);
      return h ? { status: h.status, remaining_usd: h.remaining_usd } : null;
    }, customer);
    expect(stillHeldFullAmount).toEqual({
      status: "held",
      remaining_usd: HELD_USD,
    });
  });
});
