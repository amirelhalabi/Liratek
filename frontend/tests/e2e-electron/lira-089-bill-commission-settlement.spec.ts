/**
 * E2E: LIRA-089 — commission-at-settlement for iPick/Katsh BILLs
 * (docs/plans/todo_plans/COMMISSION_AT_SETTLEMENT_PLAN.md, Phase 0+1)
 *
 * Pre-plan behaviour (still guarded by lira-062): every BILL hardcoded a
 * −20,000 LBP `SUPPLIER_PAYS_US` credit AT CREATION. Post-plan, a fresh
 * iPick/Katsh BILL row is born `commission_model = 1` (AT_SETTLEMENT) —
 * `FinancialServiceRepository.createTransaction` explicitly stamps this for
 * `service_type === "BILL"` rows specifically (OMT/WHISH SEND/RECEIVE stay
 * `commission_model = 0` until Phase 2 ships — see
 * `FinancialServiceRepository.omtCommissionModelGate.test.ts`) — so a NEW
 * bill books NOTHING at creation; it joins the unsettled queue instead
 * (`isPendingSupplierSettlement` / `PENDING_SETTLEMENT_SQL`,
 * FinancialServiceRepository.ts) and the real commission is entered AT
 * settlement, in one of two modes (D8): LUMP for the whole batch, or
 * RATE × unit count. This spec proves the whole lifecycle for ONE bill:
 *
 *   1. Create a Katsh BILL via the REAL KatchForm UI (not raw IPC) — the
 *      layer-seam lesson (memory: 42/84 specs hand-build IPC payloads and
 *      never touch the UI) — and confirm NO commission credit posts.
 *   2. The bill appears in the unsettled queue with a bill_count of +1
 *      (`suppliers:unsettled-summary`, the Settle-tab-feeding projection).
 *   3. Settle it via `suppliers:settle-transactions` in RATE mode
 *      (rate × unit_count) — the batch's ONLY member is this bill, so the
 *      largest-remainder proportional allocation (D6) degenerates to "100%
 *      of the entered commission to this one row," letting the ledger credit
 *      alone prove the money math exactly. (The Suppliers page's own
 *      Settle-tab UI has NOT been extended with LUMP/RATE controls yet — see
 *      the transport report's "Settlement-UI change... out of this task's
 *      scope" — and its batch-select list is USD-only
 *      (`selectableUnsettled` filters `currency !== "LBP"`), so an LBP bill
 *      is not even selectable there today. The settle CALL itself is
 *      real-IPC-driven here, same convention as lira-056/lira-059's settle
 *      coverage.)
 *   4. Void the settlement and prove the WHOLE cycle nets to 0: the
 *      commission credit and the SETTLEMENT ledger row both soft-void, the
 *      supplier's LBP balance returns to its pre-bill baseline, and the bill
 *      re-joins the unsettled queue (rule 20 — reversal symmetry).
 *
 * `settlement_commission_allocations`/`supplier_settlements` have NO IPC
 * projection at all (verified: no `electron-app/handlers/supplierHandlers.ts`
 * channel reads either table) — the closest available proof that the
 * allocation record was written is the SUPPLIER_SETTLEMENT transaction's own
 * `metadata_json` (`commission_model`/`entry_mode`/`commission_lbp`, stamped
 * from the SAME data `_bookCommissionAtSettlement` persists into
 * `supplier_settlements`), asserted below alongside the ledger credit.
 *
 * Rule 15: shared accumulating DB, ordered before lira-095 alphabetically —
 * lira-062/lira-078 already left their own pending (never-settled) Katsh/
 * iPick BILL rows in the unsettled queue by the time this file runs, so
 * every assertion here is a DELTA around this run's own action, and every
 * row is matched by IDENTITY (unique bill amount, this settlement's own
 * ledger-entry id embedded in the credit's note) — never absolute totals or
 * `[0]`.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";
import { closeAllActiveSessions } from "./helpers/nav";

test.describe.configure({ retries: 0 });

// Unique to this spec file — not reused by any other Katsh-bill spec
// (lira-062: 50,000; lira-095: 130k/220k/140k/160k/111k/222k/250k/120k/180k).
const BILL_AMOUNT_LBP = 486_000;
const RATE_LBP = 7_000;
const UNIT_COUNT = 1;
const COMMISSION_LBP = RATE_LBP * UNIT_COUNT;

type SupplierRow = { id: number; provider: string | null };
type SupplierBalanceRow = {
  supplier_id: number;
  total_usd: number;
  total_lbp: number;
};
type LedgerRow = {
  id: number;
  entry_type: string;
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
  is_refunded?: number;
};
type UnsettledSummaryRow = {
  provider: string;
  count: number;
  bill_count: number;
};
type SupplierTxnRow = {
  id: number;
  provider: string;
  service_type: string;
  amount: number;
  currency: string;
  commission: number;
  settlement_id: number | null;
  is_settled: number;
};
type RecentTxnRow = {
  id: number;
  type: string;
  source_table: string;
  source_id: number | null;
  amount_usd: number;
  amount_lbp: number;
  metadata_json: string | null;
};

type Api = {
  api: {
    suppliers: {
      list: (
        search?: string,
        includeInactive?: boolean,
      ) => Promise<SupplierRow[]>;
      getBalances: (includeInactive?: boolean) => Promise<SupplierBalanceRow[]>;
      getLedger: (supplierId: number, limit?: number) => Promise<LedgerRow[]>;
      getUnsettledTransactions: (provider: string) => Promise<SupplierTxnRow[]>;
      getUnsettledSummary: () => Promise<UnsettledSummaryRow[]>;
      settleTransactions: (data: {
        supplier_id: number;
        financial_service_ids: number[];
        amount_usd: number;
        amount_lbp: number;
        commission_usd: number;
        commission_lbp: number;
        entry_mode?: "LUMP" | "RATE";
        commission_rate?: number;
        commission_unit_count?: number;
        note?: string;
      }) => Promise<{ success?: boolean; id?: number; error?: string }>;
    };
    transactions: {
      getRecent: (
        limit?: number,
        filters?: Record<string, unknown>,
      ) => Promise<RecentTxnRow[] | { transactions?: RecentTxnRow[] }>;
      void: (
        id: number,
      ) => Promise<{ success?: boolean; reversalId?: number; error?: string }>;
    };
  };
};

// ── KatchForm UI helpers (mirrors lira-095's real-form conventions) ────────

const PROVIDER_MARKER = "Search Katsh items";

async function providerTabKatsh(page: Page) {
  for (let attempt = 0; attempt < 4; attempt++) {
    await page
      .locator('[role="alert"]')
      .first()
      .waitFor({ state: "hidden", timeout: 6_000 })
      .catch(() => {});
    const tab = page
      .locator("button")
      .filter({ hasText: /^Katsh$/ })
      .first();
    if (attempt === 0) {
      await tab.click({ force: true });
    } else {
      await page.mouse.move(5, 400);
      await tab.evaluate((el) => (el as HTMLButtonElement).click());
    }
    const marker = page.getByPlaceholder(new RegExp(PROVIDER_MARKER, "i"));
    const waitMs = [2_500, 5_000, 10_000, 10_000][attempt] ?? 10_000;
    const ok = await marker
      .first()
      .waitFor({ state: "visible", timeout: waitMs })
      .then(() => true)
      .catch(() => false);
    if (ok) return;
  }
  throw new Error("Katsh provider tab did not activate");
}

/** The inline BILL card (renders only while the search box is empty). */
function billCard(page: Page) {
  return page
    .locator("div.bg-slate-800")
    .filter({ has: page.getByText("BILL", { exact: true }) })
    .last();
}

async function addBill(page: Page, amount: number) {
  await page.getByPlaceholder(new RegExp(PROVIDER_MARKER, "i")).fill("");
  const card = billCard(page);
  // Card defaults to LBP already; explicit click keeps the intent visible.
  await card.getByRole("button", { name: /^LBP$/ }).click();
  await card.locator("input").last().fill(String(amount));
  await card.getByRole("button", { name: /^Add Bill$/ }).click();
  await expect(
    page.getByText(`Pending: ${amount.toLocaleString()} LBP`),
  ).toBeVisible();
}

async function payCashWithClient(page: Page, name: string, phone: string) {
  await page.getByRole("button", { name: /Proceed to Pay/i }).click();
  await page.getByPlaceholder(/Client name \(optional\)/i).fill(name);
  await page.keyboard.press("Escape"); // dismiss autocomplete dropdown if any
  await page.getByPlaceholder(/Phone number/i).fill(phone);
  // New-client info auto-promotes the payment method to CUSTOMER_ACCOUNT and
  // remounts MultiPaymentInput — wait for it, then switch back to CASH.
  const methodSelect = page.locator('[data-testid^="payment-method-"]').first();
  await expect(methodSelect).toBeVisible();
  await methodSelect.selectOption("CASH");
  await page.getByRole("button", { name: /^Pay / }).click();
}

test.describe("LIRA-089 — bill commission-at-settlement", () => {
  test.afterEach(async ({ appPage }) => {
    await closeAllActiveSessions(appPage).catch(() => {});
  });

  test("new-model Katsh bill books no commission at creation, settles in RATE mode, voids net-to-0", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const CLIENT = `L089 Commission ${ts}`;
    const PHONE = `76${String(ts).slice(-6)}`;

    await closeAllActiveSessions(appPage);
    await navigateTo(appPage, "/recharge");
    await providerTabKatsh(appPage);
    await expect(
      billCard(appPage).getByRole("button", { name: /^Add Bill$/ }),
    ).toBeVisible({ timeout: 20_000 });

    // ── Baselines, immediately before the action (rule 15) ────────────────
    const katsh = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      return (await w.api.suppliers.list("", true)).find(
        (s) => s.provider === "Katsh",
      );
    });
    expect(katsh, "Katsh supplier not found").toBeTruthy();
    const katshId = katsh!.id;

    const balBefore = await appPage.evaluate(async (id) => {
      const w = window as unknown as Api;
      return (
        (await w.api.suppliers.getBalances(true)).find(
          (b) => b.supplier_id === id,
        )?.total_lbp ?? 0
      );
    }, katshId);

    const legacyCreditsBefore = await appPage.evaluate(async (id) => {
      const w = window as unknown as Api;
      return (await w.api.suppliers.getLedger(id, 500)).filter(
        (l) =>
          l.entry_type === "SUPPLIER_PAYS_US" &&
          (l.note ?? "").includes("BILL commission from Katsh"),
      ).length;
    }, katshId);

    const billCountBefore = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      return (
        (await w.api.suppliers.getUnsettledSummary()).find(
          (s) => s.provider === "Katsh",
        )?.bill_count ?? 0
      );
    });

    // ── 1. Create the bill through the REAL KatchForm UI ───────────────────
    await addBill(appPage, BILL_AMOUNT_LBP);
    await payCashWithClient(appPage, CLIENT, PHONE);
    await expect(appPage.getByText(/^Pending: /)).toHaveCount(0, {
      timeout: 15_000,
    });

    // ── 2. NO 20,000 (or any) commission credit posted at creation ─────────
    const balAfterCreate = await appPage.evaluate(async (id) => {
      const w = window as unknown as Api;
      return (
        (await w.api.suppliers.getBalances(true)).find(
          (b) => b.supplier_id === id,
        )?.total_lbp ?? 0
      );
    }, katshId);
    expect(balAfterCreate - balBefore).toBe(0);

    const legacyCreditsAfterCreate = await appPage.evaluate(async (id) => {
      const w = window as unknown as Api;
      return (await w.api.suppliers.getLedger(id, 500)).filter(
        (l) =>
          l.entry_type === "SUPPLIER_PAYS_US" &&
          (l.note ?? "").includes("BILL commission from Katsh"),
      ).length;
    }, katshId);
    expect(legacyCreditsAfterCreate - legacyCreditsBefore).toBe(0);

    // ── 3. The bill joined the unsettled queue (Settle-tab projection) ─────
    const billCountAfterCreate = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      return (
        (await w.api.suppliers.getUnsettledSummary()).find(
          (s) => s.provider === "Katsh",
        )?.bill_count ?? 0
      );
    });
    expect(billCountAfterCreate - billCountBefore).toBe(1);

    // Locate the bill's own financial_services row by IDENTITY (unique
    // amount + service_type), never by list position.
    const bill = await appPage.evaluate(async (amount: number) => {
      const w = window as unknown as Api;
      const rows = await w.api.suppliers.getUnsettledTransactions("Katsh");
      return (
        rows.find((r) => r.service_type === "BILL" && r.amount === amount) ??
        null
      );
    }, BILL_AMOUNT_LBP);
    expect(bill, "unsettled BILL row not found").toBeTruthy();
    expect(bill!.settlement_id).toBeNull();
    const billId = bill!.id;

    // ── 4. Settle in RATE mode (rate × unit_count) — $0/0 LBP net (the
    // bill's principal already reached the supplier via the provider
    // drawer's cost leg; only the commission moves here). ───────────────────
    const settleRes = await appPage.evaluate(
      async (args: {
        supplierId: number;
        fsId: number;
        rate: number;
        count: number;
        commissionLbp: number;
      }) => {
        const w = window as unknown as Api;
        return w.api.suppliers.settleTransactions({
          supplier_id: args.supplierId,
          financial_service_ids: [args.fsId],
          amount_usd: 0,
          amount_lbp: 0,
          commission_usd: 0,
          commission_lbp: args.commissionLbp,
          entry_mode: "RATE",
          commission_rate: args.rate,
          commission_unit_count: args.count,
          note: "L089 e2e RATE settlement",
        });
      },
      {
        supplierId: katshId,
        fsId: billId,
        rate: RATE_LBP,
        count: UNIT_COUNT,
        commissionLbp: COMMISSION_LBP,
      },
    );
    expect(settleRes.error ?? null).toBeNull();
    expect(settleRes.success).toBe(true);
    const settlementLedgerId = settleRes.id!;
    expect(settlementLedgerId).toBeTruthy();

    // ── Assert: SUPPLIER_PAYS_US credit of exactly rate × count, linked to
    // THIS settlement via its note (never by time proximity — LIRA-085). ────
    const creditRow = await appPage.evaluate(
      async (args: { id: number; settlementLedgerId: number }) => {
        const w = window as unknown as Api;
        return (
          (await w.api.suppliers.getLedger(args.id, 500)).find(
            (l) =>
              l.entry_type === "SUPPLIER_PAYS_US" &&
              (l.note ?? "").includes(
                `commission credit from settlement #${args.settlementLedgerId}`,
              ),
          ) ?? null
        );
      },
      { id: katshId, settlementLedgerId },
    );
    expect(creditRow, "commission credit ledger row not found").toBeTruthy();
    expect(creditRow!.amount_lbp).toBe(-COMMISSION_LBP);
    expect(creditRow!.amount_usd).toBe(0);
    expect(creditRow!.is_refunded ?? 0).toBe(0);

    // ── Allocation proof (no IPC projects supplier_settlements/
    // settlement_commission_allocations directly — see file doc comment):
    // the SUPPLIER_SETTLEMENT transaction's metadata mirrors the SAME data
    // _bookCommissionAtSettlement persisted onto supplier_settlements. ──────
    const settlementTxn = await appPage.evaluate(
      async (settlementLedgerId: number) => {
        const w = window as unknown as Api;
        const recent = await w.api.transactions.getRecent(50, {
          source_table: "supplier_ledger",
        });
        const list = Array.isArray(recent)
          ? recent
          : (recent.transactions ?? []);
        return (
          list.find(
            (t) =>
              t.type === "SUPPLIER_SETTLEMENT" &&
              t.source_id === settlementLedgerId,
          ) ?? null
        );
      },
      settlementLedgerId,
    );
    expect(
      settlementTxn,
      "SUPPLIER_SETTLEMENT transaction not found",
    ).toBeTruthy();
    const meta = JSON.parse(settlementTxn!.metadata_json ?? "{}") as {
      commission_model?: number;
      entry_mode?: string;
      commission_lbp?: number;
    };
    expect(meta.commission_model).toBe(1);
    expect(meta.entry_mode).toBe("RATE");
    expect(meta.commission_lbp).toBe(COMMISSION_LBP);

    // The bill itself is now settled, linked to THIS settlement.
    const billAfterSettle = await appPage.evaluate(async (amount: number) => {
      const w = window as unknown as Api;
      const rows = await w.api.suppliers.getUnsettledTransactions("Katsh");
      return rows.find((r) => r.service_type === "BILL" && r.amount === amount);
    }, BILL_AMOUNT_LBP);
    // No longer pending — settleTransactions moved it out of the queue.
    expect(billAfterSettle).toBeUndefined();

    // ── 5. Void the settlement — everything must net to 0 (rule 20) ────────
    const voidRes = await appPage.evaluate(async (txnId: number) => {
      const w = window as unknown as Api;
      return w.api.transactions.void(txnId);
    }, settlementTxn!.id);
    expect(voidRes.error ?? null).toBeNull();
    expect(voidRes.success).toBe(true);

    // Both ledger rows this settlement wrote are soft-voided.
    const creditRowAfterVoid = await appPage.evaluate(
      async (args: { id: number; creditId: number }) => {
        const w = window as unknown as Api;
        return (await w.api.suppliers.getLedger(args.id, 500)).find(
          (l) => l.id === args.creditId,
        );
      },
      { id: katshId, creditId: creditRow!.id },
    );
    expect(creditRowAfterVoid?.is_refunded).toBe(1);

    const settlementRowAfterVoid = await appPage.evaluate(
      async (args: { id: number; settlementLedgerId: number }) => {
        const w = window as unknown as Api;
        return (await w.api.suppliers.getLedger(args.id, 500)).find(
          (l) => l.id === args.settlementLedgerId,
        );
      },
      { id: katshId, settlementLedgerId },
    );
    expect(settlementRowAfterVoid?.is_refunded).toBe(1);

    // Supplier LBP balance is back to the pre-bill baseline — the whole
    // create → settle → void cycle nets to exactly 0.
    const balAfterVoid = await appPage.evaluate(async (id) => {
      const w = window as unknown as Api;
      return (
        (await w.api.suppliers.getBalances(true)).find(
          (b) => b.supplier_id === id,
        )?.total_lbp ?? 0
      );
    }, katshId);
    expect(balAfterVoid - balBefore).toBe(0);

    // The bill re-joins the unsettled queue (settlement_id cleared,
    // is_settled reset — isPendingSupplierSettlement is true for it).
    const billAfterVoid = await appPage.evaluate(async (amount: number) => {
      const w = window as unknown as Api;
      const rows = await w.api.suppliers.getUnsettledTransactions("Katsh");
      return rows.find((r) => r.service_type === "BILL" && r.amount === amount);
    }, BILL_AMOUNT_LBP);
    expect(billAfterVoid).toBeTruthy();
    expect(billAfterVoid!.settlement_id).toBeNull();

    const billCountAfterVoid = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      return (
        (await w.api.suppliers.getUnsettledSummary()).find(
          (s) => s.provider === "Katsh",
        )?.bill_count ?? 0
      );
    });
    expect(billCountAfterVoid - billCountBefore).toBe(1);
  });
});

// Keep a typed reference to Page so the import is always used.
export type _BillCommissionSettlementSpecPage = Page;
