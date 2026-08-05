/**
 * E2E: LIRA-130 — maintenance CheckoutModal "Save as Draft" must not check
 * out, and a refunded job's amounts unlock again (owner manual-test reports,
 * 2026-07-28, points 4 and 5 of the 7-point manual test audit).
 *
 * Point 4 regression: `CheckoutModal`'s "Save as Draft" button used to be
 * wired as `onSaveDraft={async (data) => { await handleCheckoutComplete(data);
 * }}` — hardcoding `status: "Delivered_Paid"` and forwarding the modal's
 * payment sheet, so a "draft" landed as a fully paid job with a real unified
 * transaction. The fix routes the modal's onSaveDraft through the page's own
 * `handleSaveDraft`. This spec drives the REAL `CheckoutModal` component
 * through the page (no mock) — the existing jsdom coverage
 * (`Maintenance.checkoutDraftAndAmountLock.test.tsx`) mocks CheckoutModal out
 * entirely, so it proves the page's wiring but never that clicking the real
 * modal's real button produces this outcome end-to-end.
 *
 * Point 5 regression: after refunding a paid job, reopening it kept showing
 * "Paid job — void or refund to change the amount" with the amount fields
 * disabled — wrong, since the job had already been refunded. Fixed by
 * `isAmountLocked = hasMoneyHistory && !isRefundedOrVoided` on the frontend,
 * mirrored by `isJobMoneyLocked` (`!is_refunded && jobHasActiveTransaction`)
 * in `MaintenanceRepository`. This spec proves the full real-money cycle: pay
 * a job → confirm the amount edit is REFUSED → refund it via the real
 * Transactions-table Refund button (`/audit`, same click pattern as
 * lira-104) → confirm the SAME edit now SUCCEEDS — both halves, not just the
 * end state (a test that only checked the unlocked end state could not tell
 * a real fix from a gate that was never enforced in the first place).
 *
 * Rule 15: shared accumulating DB → every job/client is `Date.now()`-unique;
 * rows are found by identity (device name substring), never position.
 */

import { test, expect, navigateTo } from "./fixtures";

test.describe.configure({ retries: 0 });

type MaintenanceRow = {
  id: number;
  client_id?: number | null;
  client_name?: string | null;
  device_name: string;
  issue_description?: string | null;
  status: string;
  currency?: string;
  cost_usd?: number;
  price_usd?: number;
  cost_lbp?: number;
  price_lbp?: number;
  discount_usd?: number;
  final_amount_usd?: number;
  final_amount_lbp?: number;
  paid_usd?: number;
  paid_lbp?: number;
  exchange_rate?: number;
  is_refunded?: number;
};

type Api = {
  api: {
    maintenance: {
      save: (data: Record<string, unknown>) => Promise<{
        success: boolean;
        id?: number;
        error?: string;
      }>;
      getJobs: (filter?: string) => Promise<MaintenanceRow[]>;
    };
    transactions: {
      getBySource: (
        sourceTable: string,
        sourceId: number,
      ) => Promise<{ id: number } | null>;
    };
  };
};

test.describe("LIRA-130 — maintenance CheckoutModal draft + refund unlock", () => {
  test("Save Draft inside the REAL CheckoutModal never checks out the job", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const deviceName = `L130 Draft ${ts}`;

    await navigateTo(appPage, "/maintenance");

    await appPage.fill("#maintenance-device-name", deviceName);
    await appPage.fill("#maintenance-issue", "Cracked screen — draft test");
    await appPage.fill("#maintenance-price", "77");

    await appPage.getByRole("button", { name: /Proceed to Checkout/i }).click();

    const modal = appPage.locator('[data-testid="checkout-modal"]');
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // THE real button, THE real modal — not the mocked stand-in the jsdom
    // test uses.
    await appPage.locator('[data-testid="checkout-save-draft-btn"]').click();
    await expect(modal).toBeHidden({ timeout: 10_000 });

    // Identity check via IPC (rule 15): find the job by its unique device
    // name, never by list position.
    const check = await appPage.evaluate(async (name: string) => {
      const w = window as unknown as Api;
      const jobs = await w.api.maintenance.getJobs();
      const job = jobs.find((j) => j.device_name === name);
      if (!job) return { found: false as const };
      const txn = await w.api.transactions.getBySource("maintenance", job.id);
      return {
        found: true as const,
        status: job.status,
        paidUsd: job.paid_usd ?? 0,
        paidLbp: job.paid_lbp ?? 0,
        hasTransaction: txn != null,
      };
    }, deviceName);

    expect(check.found).toBe(true);
    if (!check.found) return;

    // The regression: this used to come back "Delivered_Paid" with a real
    // transaction (handleCheckoutComplete ran instead of the draft path).
    expect(check.status).toBe("Received");
    expect(check.status).not.toBe("Delivered_Paid");
    expect(check.paidUsd).toBe(0);
    expect(check.paidLbp).toBe(0);
    expect(check.hasTransaction).toBe(false);

    // UI half: reopening the draft on the page itself leaves the amount
    // fields editable — no stale "paid job" lock.
    await appPage
      .locator("button")
      .filter({ hasText: deviceName })
      .first()
      .click();

    await expect(appPage.locator("#maintenance-price")).toBeEnabled();
    await expect(
      appPage.getByText(/Paid job — void or refund/i),
    ).not.toBeVisible();
  });

  test("refunding a paid maintenance job unlocks its amount for editing again", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const deviceName = `L130 Unlock ${ts}`;
    const clientName = `L130 Unlock Client ${ts}`;
    const phone = `77${String(ts).slice(-6)}`;
    // Unique price so the /audit row is identity-matchable (rule 15) and so
    // a stray equal-value resubmit can never accidentally pass the gate.
    const PRICE_USD = 913.17;
    const NEW_PRICE_USD = 918.42;

    // Pay the job fully via CUSTOMER_ACCOUNT. This mirrors exactly what the
    // REAL CheckoutModal sends: `paymentData.payment_usd` is `paidUSD`,
    // which sums every payment line's amount REGARDLESS of method —
    // CUSTOMER_ACCOUNT included (CheckoutModal.tsx paidUSD/tenderUSD split,
    // "settlement completeness counts covered-by-debt as covered") — so the
    // job's own `paid_usd` column, and therefore the frontend's
    // `hasMoneyHistory` lock proxy, is genuinely nonzero for an
    // account-charged job, exactly as it would be after a real checkout.
    // A CUSTOMER_ACCOUNT settlement never writes a `payments` table row (no
    // drawer movement — TransactionRepository.ts), so the unified
    // transaction's `payments[]` stays EMPTY: the /audit Refund button falls
    // into the bare confirm() path (same as lira-104), never the
    // tender-selection RefundMethodModal.
    const seeded = await appPage.evaluate(
      async (args: {
        name: string;
        price: number;
        client: string;
        phone: string;
      }) => {
        const w = window as unknown as Api;
        const res = await w.api.maintenance.save({
          device_name: args.name,
          issue_description: "Battery replacement — unlock test",
          client_name: args.client,
          client_phone: args.phone,
          cost_usd: 30,
          price_usd: args.price,
          final_amount_usd: args.price,
          currency: "USD",
          exchange_rate: 90000,
          status: "Delivered_Paid",
          paid_usd: args.price,
          paid_lbp: 0,
          payments: [
            {
              method: "CUSTOMER_ACCOUNT",
              currency_code: "USD",
              amount: args.price,
            },
          ],
        });
        return {
          ok: res.success === true,
          error: res.error ?? null,
          id: res.id ?? null,
        };
      },
      { name: deviceName, price: PRICE_USD, client: clientName, phone },
    );
    expect(seeded.error).toBeNull();
    expect(seeded.ok).toBe(true);
    const jobId = seeded.id as number;
    expect(jobId).not.toBeNull();

    // Read back the full row so every edit attempt below resubmits every
    // OTHER amount field unchanged — only price_usd/final_amount_usd differ,
    // isolating exactly what the gate is supposed to catch (an equal-value
    // resubmit of the rest must never itself trip the gate).
    const original = await appPage.evaluate(async (id: number) => {
      const w = window as unknown as Api;
      const jobs = await w.api.maintenance.getJobs();
      return jobs.find((j) => j.id === id) ?? null;
    }, jobId);
    expect(original).not.toBeNull();
    if (!original) return;

    const editPayload = (price: number) => ({
      id: jobId,
      client_id: original.client_id ?? undefined,
      client_name: original.client_name ?? undefined,
      device_name: original.device_name,
      issue_description: original.issue_description ?? "",
      cost_usd: original.cost_usd ?? 0,
      price_usd: price,
      cost_lbp: original.cost_lbp ?? 0,
      price_lbp: original.price_lbp ?? 0,
      discount_usd: original.discount_usd ?? 0,
      final_amount_usd: price,
      final_amount_lbp: original.final_amount_lbp ?? 0,
      currency: original.currency ?? "USD",
      paid_usd: original.paid_usd ?? 0,
      paid_lbp: original.paid_lbp ?? 0,
      exchange_rate: original.exchange_rate ?? 0,
      status: original.status,
    });

    // ── HALF 1 — refused while the transaction is still ACTIVE/unreversed ──
    const blockedAttempt = await appPage.evaluate(
      async (payload: Record<string, unknown>) => {
        const w = window as unknown as Api;
        const res = await w.api.maintenance.save(payload);
        return { ok: res.success === true, error: res.error ?? null };
      },
      editPayload(NEW_PRICE_USD),
    );
    expect(blockedAttempt.ok).toBe(false);
    expect(blockedAttempt.error).toMatch(/void or refund it first/i);

    // The refusal must actually leave the stored price untouched (not just
    // return an error while silently writing anyway).
    const priceAfterBlockedAttempt = await appPage.evaluate(
      async (id: number) => {
        const w = window as unknown as Api;
        const jobs = await w.api.maintenance.getJobs();
        return jobs.find((j) => j.id === id)?.price_usd ?? null;
      },
      jobId,
    );
    expect(priceAfterBlockedAttempt).toBeCloseTo(PRICE_USD, 2);

    // UI half of HALF 1: reopening the job on /maintenance shows it locked.
    // The job was created via a direct IPC call above (bypassing the page's
    // own React state), so whatever Maintenance instance is currently
    // mounted has never fetched it — force a fresh mount (README: bounce
    // through "/" so the page's own load-on-mount effect re-fetches).
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/maintenance");
    await appPage
      .locator("button")
      .filter({ hasText: deviceName })
      .first()
      .click();
    const priceField = appPage.locator("#maintenance-price");
    await expect(priceField).toBeDisabled();
    await expect(appPage.getByText(/Paid job — void or refund/i)).toBeVisible();

    // ── Refund the job's transaction from /audit (the real Refund button) ──
    await navigateTo(appPage, "/audit");
    const row = appPage
      .locator("tbody tr")
      .filter({ hasText: deviceName })
      .first();
    await expect(row).toBeVisible({ timeout: 10_000 });
    const refundBtn = row.getByRole("button", { name: /^Refund$/ });
    await expect(refundBtn).toBeVisible();

    // Same pattern as lira-104: answer the confirm explicitly with OK. A
    // CUSTOMER_ACCOUNT-only job has no customer-facing payment legs, so this
    // is the bare confirm() path, not the tender-selection modal.
    const confirmSeen = new Promise<string>((resolve) => {
      appPage.once("dialog", (d) => {
        d.accept().catch(() => {});
        resolve(d.message());
      });
    });
    await refundBtn.click();
    expect(await confirmSeen).toMatch(/Refund this transaction/i);

    // Wait for the refund to land: is_refunded flips on the maintenance row.
    await expect
      .poll(
        async () => {
          const jobs = await appPage.evaluate(async () => {
            const w = window as unknown as Api;
            return w.api.maintenance.getJobs();
          });
          return jobs.find((j) => j.id === jobId)?.is_refunded ?? 0;
        },
        { timeout: 10_000 },
      )
      .toBe(1);

    // ── HALF 2 — the SAME edit now succeeds: refund unlocked the amount ──
    const unlockedAttempt = await appPage.evaluate(
      async (payload: Record<string, unknown>) => {
        const w = window as unknown as Api;
        const res = await w.api.maintenance.save(payload);
        return { ok: res.success === true, error: res.error ?? null };
      },
      editPayload(NEW_PRICE_USD),
    );
    expect(unlockedAttempt.error).toBeNull();
    expect(unlockedAttempt.ok).toBe(true);

    const priceAfterUnlock = await appPage.evaluate(async (id: number) => {
      const w = window as unknown as Api;
      const jobs = await w.api.maintenance.getJobs();
      return jobs.find((j) => j.id === id)?.price_usd ?? null;
    }, jobId);
    expect(priceAfterUnlock).toBeCloseTo(NEW_PRICE_USD, 2);

    // UI half of HALF 2: bounce for a fresh mount (README: a parked viewer
    // shows a stale list), reopen the job, confirm it's now editable with
    // the informational note instead of the stale lock banner.
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/maintenance");
    await appPage
      .locator("button")
      .filter({ hasText: deviceName })
      .first()
      .click();
    await expect(priceField).toBeEnabled();
    await expect(
      appPage.getByText(/Paid job — void or refund/i),
    ).not.toBeVisible();
    await expect(appPage.getByText(/voided or refunded/i)).toBeVisible();
  });
});
