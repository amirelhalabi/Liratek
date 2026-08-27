/**
 * E2E: LIRA-145 — consuming a shop carrier line's credits is booked as a
 * `Line_Usage` expense against the CARRIER's own credit drawer.
 *
 * The shop's MTC/Alfa SIMs hold prepaid credits it already paid for. Spending
 * them (a staff call, an SMS blast, a test top-up) is a real cost, but it
 * moves NO cash today — the supplier debt was booked back when the credits
 * were topped up (prepaid-units model, C5 / lira-078). So the flow books:
 *
 *   expenses row  →  unified EXPENSE transaction  →  ONE payment leg on the
 *   carrier's credit drawer (`MTC` / `Alfa`, USD, −delta)  →  a
 *   `carrier_line_movements` row carrying that transaction's id.
 *
 * That last linkage is the whole reversal story (rule 20): the movement's
 * `transaction_id` is the ONLY thing that makes
 * `TransactionRepository._reverseCarrierLineMovements` fire, so the generic
 * Void from the Transactions table restores the line's credits, the carrier
 * drawer, and the active-expense total in one go. Test (b) proves that round
 * trip nets to zero across all three.
 *
 * WHY THIS SPEC EXISTS AT THE UI LAYER (the seam nothing else covers):
 * the operator types a NEW BALANCE, not an amount — the panel derives the
 * delta and sends `newCredits`. A repository unit test can only ever be
 * handed the already-derived number, so the derivation, the preview, the
 * client-side "balance went UP" guard, and the fact that the whole thing
 * reaches the drawer through the REAL panel are only provable here.
 * `packages/core/src/repositories/__tests__/CarrierLineRepository.recordUsage.test.ts`
 * owns the server-side rules (17 cases); this file owns the seam.
 *
 * ── Assertion discipline (CLAUDE.md rule 15) ─────────────────────────────
 *  - Every line is SELF-PROVISIONED (`carrierLines.create` with a run-unique
 *    phone). Never "the existing MTC line" — lira-125/132/133 all leave their
 *    own behind, and the setup wizard seeds none.
 *  - Every money assertion is a DELTA snapshotted immediately before the
 *    action: line credits, the active-MTC credits SUM, the MTC drawer's USD
 *    balance, General USD/LBP, `profits.summary().expenses`, and the supplier
 *    balance pool. Never an absolute total.
 *  - The transaction is matched by IDENTITY — the run-unique phone number
 *    inside its `summary` (`Expense: Line_Usage - Line usage: MTC <phone> …`)
 *    plus `source_table = "expenses"` — never `getRecent()[0]` or
 *    `tbody tr.first()`.
 *
 * ── The invariant, in DELTA form (deliberate) ────────────────────────────
 * §0.1 states `drawer_balances["MTC"].USD == getCarrierCreditsSum("mtc")`.
 * That ABSOLUTE equality cannot be asserted on this shared accumulating DB:
 * `carrierLines.create` never syncs the provider drawer (documented in
 * CarrierLinesPanel.tsx and in lira-133's `seedPrimaryMtcLine`, which is why
 * that spec must seed credits: 0), so every earlier spec's seeded line has
 * already widened a line-sum-vs-drawer gap that is not this feature's to
 * close. What IS this feature's job — and what is asserted here — is that the
 * flow moves BOTH sides by the same number:
 *   Δ drawer["MTC"].USD  ==  Δ getCarrierCreditsSum("mtc")  ==  −creditsUsed
 * i.e. it cannot make an existing gap bigger or smaller, in either direction.
 *
 * ── Rule 17 (NOT RUN by this workstream) ─────────────────────────────────
 * Written, `--list`-verified and typechecked, but NOT executed: the owner runs
 * the e2e cycle (`yarn dev` → stop → `node scripts/run-e2e.mjs electron`).
 * Failing-first recipes for the verifier, each isolating ONE assertion:
 *  1. Drop `transactionId: txn.id` from the `applyMovement` call in
 *     `CarrierLineRepository.recordUsage` (pass `null`). Test (a) still
 *     passes; test (b)'s post-void `creditsRestored` assertion fails — the
 *     unlinked movement is invisible to `_reverseCarrierLineMovements`.
 *  2. Remove `AND ${notRefunded("expenses")}` from
 *     `ProfitRepository.getExpenseTotals`. Test (b)'s
 *     `expenseTotalsRestored` assertion fails — the voided expense keeps
 *     counting against profit while its value has already been given back.
 *  3. Replace the `drawer_override` branch's `postOutflow(...)` target with
 *     the default `paymentMethodToDrawerName(paidBy)` mapping (i.e. delete
 *     the override early-return in `ExpenseRepository.createExpense`). Test
 *     (a)'s "General USD unchanged" AND "no customer-cash leg" assertions
 *     both fail — the cost lands on the cash drawer.
 *  4. In the panel's usage dialog, drop the `newCredits >= credits` guard on
 *     the submit button. Test (c)'s `toBeDisabled()` fails.
 * Restore after each.
 *
 * ── UI contract this spec pins (for whoever builds/edits the panel) ──────
 * data-testids, all from the LIRA-145 contract:
 *   carrier-line-usage-open-<id>    one per line row, unique
 *   carrier-line-usage-new-balance  the NEW balance input (driven here)
 *   carrier-line-usage-used         the "amount used" input (presence only —
 *                                   the mirroring direction is deliberately
 *                                   NOT asserted; see `recordUsageViaDialog`)
 *   carrier-line-usage-note         free-text note, lands in the description
 *   carrier-line-usage-preview      the derived amount about to be booked
 *   carrier-line-usage-submit       MUST be `disabled` while the typed
 *                                   balance is not strictly below the line's
 *                                   current credits (test (c))
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

// Wide enough that no local-vs-UTC bucketing can push today's expense row out
// of range (same constants lira-090/108 use for profits.summary).
const FROM = "2000-01-01";
const TO = "2099-12-31";

/** `expenses.category` / `paid_by_method` / `carrier_line_movements.reason`
 *  written by `CarrierLineRepository.recordUsage`. Kept as literals HERE (a
 *  test may not import from `@liratek/core` — the renderer bundle is the only
 *  thing this page can reach) precisely so a rename of the core constant is
 *  caught by this spec rather than silently followed. */
const LINE_USAGE_CATEGORY = "Line_Usage";

type CarrierLineRow = {
  id: number;
  carrier: "alfa" | "mtc";
  phone_number: string;
  label: string | null;
  credits: number;
  is_active: number;
};

type DrawerRow = {
  name: string;
  usdBalance: number;
  lbpBalance: number;
};

type RecentTxn = {
  id: number;
  type: string;
  status: string;
  source_table: string | null;
  source_id: number | null;
  amount_usd: number;
  amount_lbp: number;
  client_name: string | null;
  summary: string | null;
  reverses_id: number | null;
  payments: Array<{
    direction: "in" | "out";
    amount: number;
    currency_code: string;
    method: string;
  }>;
};

type TxnDetail = {
  id: number;
  type: string;
  status: string;
  source_table: string | null;
  source_id: number | null;
  amount_usd: number;
  amount_lbp: number;
  profit_usd: number;
  profit_lbp: number;
  client_id: number | null;
  client_name: string | null;
  metadata_json: string | null;
} | null;

type Api = {
  api: {
    carrierLines: {
      create: (data: {
        carrier: "alfa" | "mtc";
        phone_number: string;
        label?: string | null;
        credits?: number;
        validity_expires_at?: string | null;
      }) => Promise<{
        success: boolean;
        data?: { id: number };
        error?: string;
      }>;
      getAllAdmin: () => Promise<{
        success: boolean;
        data?: CarrierLineRow[];
        error?: string;
      }>;
      recordUsage: (data: {
        carrierLineId: number;
        newCredits: number;
        expectedCurrentCredits?: number;
        note?: string;
      }) => Promise<{
        success: boolean;
        data?: {
          expenseId: number;
          transactionId: number;
          creditsUsed: number;
          newCredits: number;
        };
        error?: string;
      }>;
    };
    recharge: { getDrawerBalances: () => Promise<DrawerRow[]> };
    profits: {
      summary: (
        from: string,
        to: string,
      ) => Promise<{
        expenses: { total_usd: number; total_lbp: number; count: number };
      }>;
    };
    suppliers: {
      getBalances: (
        includeInactive?: boolean,
      ) => Promise<Array<{ total_usd?: number; total_lbp?: number }>>;
    };
    transactions: {
      getRecent: (
        limit?: number,
        filters?: Record<string, unknown>,
      ) => Promise<RecentTxn[]>;
      getById: (id: number) => Promise<TxnDetail>;
    };
  };
};

// ---------------------------------------------------------------------------
// Snapshot — every number this feature is allowed (or forbidden) to move
// ---------------------------------------------------------------------------

type MoneySnapshot = {
  /** The seeded line's own credits. */
  lineCredits: number;
  /** Σ credits over ALL active mtc lines — the §0.1 sum's own definition. */
  mtcCreditsSum: number;
  /** drawer_balances["MTC"].USD — the other half of the §0.1 invariant. */
  mtcDrawerUsd: number;
  /** Must NEVER move: consuming owned credits is not a cash event. */
  generalUsd: number;
  generalLbp: number;
  /** The active-expense bucket the profit page actually reads. */
  expenseTotalUsd: number;
  expenseTotalLbp: number;
  expenseCount: number;
  /** Δ owed to any counterparty must be 0 (prepaid-units model). */
  supplierPoolUsd: number;
  supplierPoolLbp: number;
};

async function snapshot(page: Page, lineId: number): Promise<MoneySnapshot> {
  return page.evaluate(
    async ({ id, from, to }) => {
      const w = window as unknown as Api;

      const linesRes = await w.api.carrierLines.getAllAdmin();
      const lines = linesRes.success ? (linesRes.data ?? []) : [];
      const lineCredits = lines.find((l) => l.id === id)?.credits ?? 0;
      const mtcCreditsSum = lines
        .filter((l) => l.carrier === "mtc" && l.is_active === 1)
        .reduce((sum, l) => sum + l.credits, 0);

      const drawerRows = await w.api.recharge.getDrawerBalances();
      const pick = (name: string, cur: "usd" | "lbp") => {
        const row = drawerRows.find((d) => d.name === name);
        return cur === "usd" ? (row?.usdBalance ?? 0) : (row?.lbpBalance ?? 0);
      };

      const summary = await w.api.profits.summary(from, to);

      const balances = await w.api.suppliers.getBalances(true);
      const supplierPoolUsd = balances.reduce(
        (sum, b) => sum + (b.total_usd ?? 0),
        0,
      );
      const supplierPoolLbp = balances.reduce(
        (sum, b) => sum + (b.total_lbp ?? 0),
        0,
      );

      return {
        lineCredits,
        mtcCreditsSum,
        mtcDrawerUsd: pick("MTC", "usd"),
        generalUsd: pick("General", "usd"),
        generalLbp: pick("General", "lbp"),
        expenseTotalUsd: summary.expenses.total_usd,
        expenseTotalLbp: summary.expenses.total_lbp,
        expenseCount: summary.expenses.count,
        supplierPoolUsd,
        supplierPoolLbp,
      };
    },
    { id: lineId, from: FROM, to: TO },
  );
}

// ---------------------------------------------------------------------------
// Self-provisioning
// ---------------------------------------------------------------------------

/**
 * A fresh, ACTIVE MTC line with a run-unique phone number and a non-zero
 * credit balance.
 *
 * Deliberately does NOT call `setPrimary`: this flow has nothing to do with
 * the primary line (only Only-Days returns and self-charges do), and stealing
 * the primary flag would silently change the starting state for anything that
 * runs after this file.
 *
 * Seeding credits > 0 here is safe (unlike lira-133, where it was not): that
 * spec's buy-back RECONCILES the drawer to the line sum, so a pre-existing
 * gap got swept into its observed delta. `recordUsage` posts an explicit
 * `−delta` leg instead, so the drawer delta is exactly the amount consumed
 * regardless of what gap the seed opened.
 */
async function seedMtcLine(
  page: Page,
  phone: string,
  label: string,
  credits: number,
): Promise<number> {
  const created = await page.evaluate(
    async ({ p, l, c }) =>
      (window as unknown as Api).api.carrierLines.create({
        carrier: "mtc",
        phone_number: p,
        label: l,
        credits: c,
      }),
    { p: phone, l: label, c: credits },
  );
  if (!created.success || !created.data) {
    throw new Error(`Failed to create carrier line: ${created.error}`);
  }
  return created.data.id;
}

// ---------------------------------------------------------------------------
// Driving the REAL panel
// ---------------------------------------------------------------------------

/**
 * Force a fresh mount of Recharge → TelecomForm → CarrierLinesPanel so the
 * panel's `load()` runs AFTER the line exists (it is a one-shot effect, not a
 * live subscription — re-visiting an already-mounted page serves the stale
 * pre-seed list; the same trap lira-133 documents).
 */
async function openMtcPanel(page: Page, lineId: number): Promise<void> {
  await navigateTo(page, "/");
  await navigateTo(page, "/recharge");

  // MTC is the first PROVIDER_CONFIGS entry, so a fresh mount lands on it —
  // clicking is belt-and-braces against a future default change, and a
  // click on the already-active tab is a no-op.
  const mtcTab = page.locator("button").filter({ hasText: /^MTC$/ }).first();
  if (await mtcTab.isVisible({ timeout: 8_000 }).catch(() => false)) {
    await mtcTab.click({ force: true }).catch(() => {});
  }

  await expect(page.getByTestId(`carrier-line-${lineId}`)).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * The panel renders one "Record usage" trigger per line, testid
 * `carrier-line-usage-open-<id>` — unique per row, so no row-scoping needed.
 */
async function clickUsageOpen(page: Page, lineId: number): Promise<void> {
  await page.getByTestId(`carrier-line-usage-open-${lineId}`).click();
  // The form is open once its NEW-balance field is on screen.
  await expect(page.getByTestId("carrier-line-usage-new-balance")).toBeVisible({
    timeout: 10_000,
  });
}

/**
 * Fill the dialog and submit. Drives `carrier-line-usage-new-balance` — the
 * contract's primary input ("User enters the line's NEW credit balance") —
 * and asserts the DERIVED figure through `carrier-line-usage-preview`, which
 * must reflect the amount about to be booked whichever input drove it.
 *
 * `carrier-line-usage-used` is asserted PRESENT but its value is not: the
 * contract does not say whether the two inputs mirror each other live or are
 * two independent entry modes, and a spec written before the panel exists
 * must not invent that detail. If the panel does mirror them, tighten this to
 * a value assertion.
 */
async function recordUsageViaDialog(
  page: Page,
  lineId: number,
  newBalance: number,
  usedPattern: RegExp,
  note: string,
): Promise<void> {
  await clickUsageOpen(page, lineId);

  await expect(page.getByTestId("carrier-line-usage-used")).toBeVisible();

  await page
    .getByTestId("carrier-line-usage-new-balance")
    .fill(String(newBalance));
  await page.getByTestId("carrier-line-usage-note").fill(note);

  // The derived amount the operator is about to commit to.
  await expect(page.getByTestId("carrier-line-usage-preview")).toContainText(
    usedPattern,
    { timeout: 5_000 },
  );

  const submit = page.getByTestId("carrier-line-usage-submit");
  await expect(submit).toBeEnabled();
  await submit.click();
}

/** The EXPENSE transaction for this run, matched by the run-unique phone
 *  number inside its summary (+ source_table) — never by row position. */
async function findUsageTxn(
  page: Page,
  phone: string,
): Promise<RecentTxn | null> {
  return page.evaluate(async (p) => {
    const w = window as unknown as Api;
    const rows = await w.api.transactions.getRecent(200, {
      type: "EXPENSE",
      search: p,
    });
    return (
      rows.find(
        (t) => t.source_table === "expenses" && t.reverses_id == null,
      ) ?? null
    );
  }, phone);
}

// ===========================================================================

test.describe("LIRA-145 — carrier-line credit usage books a Line_Usage expense", () => {
  test("(a) recording usage from the Recharge panel debits the CARRIER drawer and the line by the same amount, books one EXPENSE, and moves no cash", async ({
    appPage,
  }) => {
    const stamp = Date.now();
    const phone = `03${String(stamp).slice(-6)}`;
    const label = `L145-A-${stamp}`;
    const note = `L145 usage A ${stamp}`;
    const SEED = 41.25;
    const NEW_BALANCE = 28.75;
    const USED = 12.5;

    const lineId = await seedMtcLine(appPage, phone, label, SEED);
    const before = await snapshot(appPage, lineId);
    expect(before.lineCredits).toBeCloseTo(SEED, 2);

    await openMtcPanel(appPage, lineId);
    await recordUsageViaDialog(appPage, lineId, NEW_BALANCE, /12\.5/, note);

    // The write round-trips before anything is asserted.
    await expect
      .poll(
        async () => (await snapshot(appPage, lineId)).lineCredits.toFixed(2),
        { timeout: 10_000 },
      )
      .toBe(NEW_BALANCE.toFixed(2));

    const after = await snapshot(appPage, lineId);

    // ── The line lands EXACTLY on the counted balance ────────────────────
    expect(after.lineCredits).toBeCloseTo(NEW_BALANCE, 2);

    // ── §0.1 in delta form: both halves move by the same number ──────────
    expect(after.mtcCreditsSum - before.mtcCreditsSum).toBeCloseTo(-USED, 2);
    expect(after.mtcDrawerUsd - before.mtcDrawerUsd).toBeCloseTo(-USED, 2);
    expect(after.mtcDrawerUsd - before.mtcDrawerUsd).toBeCloseTo(
      after.mtcCreditsSum - before.mtcCreditsSum,
      2,
    );

    // ── NO cash moved: the credits were paid for at top-up time ──────────
    expect(after.generalUsd - before.generalUsd).toBeCloseTo(0, 2);
    expect(after.generalLbp - before.generalLbp).toBeCloseTo(0, 0);

    // ── Booked as an expense at face value, USD only ─────────────────────
    expect(after.expenseTotalUsd - before.expenseTotalUsd).toBeCloseTo(USED, 2);
    expect(after.expenseTotalLbp - before.expenseTotalLbp).toBeCloseTo(0, 0);
    expect(after.expenseCount - before.expenseCount).toBe(1);

    // ── Δ owed to any counterparty = 0 (prepaid-units model, C5) ─────────
    expect(after.supplierPoolUsd - before.supplierPoolUsd).toBeCloseTo(0, 2);
    expect(after.supplierPoolLbp - before.supplierPoolLbp).toBeCloseTo(0, 0);

    // ── The unified row, matched by identity ─────────────────────────────
    const txn = await findUsageTxn(appPage, phone);
    expect(
      txn,
      "no EXPENSE transaction found for this run's phone",
    ).not.toBeNull();
    const row = txn as RecentTxn;
    expect(row.type).toBe("EXPENSE");
    expect(row.status).toBe("ACTIVE");
    expect(row.amount_usd).toBeCloseTo(-USED, 2);
    expect(row.amount_lbp).toBeCloseTo(0, 0);
    // Description contract: 'Line usage: ' + CARRIER + ' ' + phone
    //                       + ' (label)' + ' — note'
    expect(row.summary).toBe(
      `Expense: ${LINE_USAGE_CATEGORY} - Line usage: MTC ${phone} (${label}) — ${note}`,
    );
    // Shop-internal: no client anywhere on the row (rule 11 has nothing to
    // propagate — there is no client UI field on this form by design).
    expect(row.client_name).toBeFalsy();

    // The ONE leg posted lives on the MTC provider-stock drawer, so
    // `_attachPaymentLegs` correctly classifies it as internal and the row
    // carries NO customer-facing cash leg. A regression that routes the cost
    // through a cash drawer (or adds a second, customer-side leg) makes this
    // array non-empty — which is exactly the failure mode to catch.
    expect(row.payments).toHaveLength(0);

    // Profit + client + provenance, read from the full row.
    const detail = await appPage.evaluate(
      async (id) => (window as unknown as Api).api.transactions.getById(id),
      row.id,
    );
    expect(detail).not.toBeNull();
    const d = detail as NonNullable<TxnDetail>;
    expect(d.profit_usd).toBeCloseTo(0, 2);
    expect(d.profit_lbp).toBeCloseTo(0, 0);
    expect(d.client_id).toBeNull();
    expect(d.source_table).toBe("expenses");
    expect(d.source_id).not.toBeNull();
    const meta = JSON.parse(d.metadata_json ?? "{}") as {
      category?: string;
      paid_by?: string;
      carrier_line_id?: number;
      carrier?: string;
      credits_before?: number;
      credits_after?: number;
    };
    expect(meta.category).toBe(LINE_USAGE_CATEGORY);
    expect(meta.paid_by).toBe("LINE_CREDIT");
    expect(meta.carrier_line_id).toBe(lineId);
    expect(meta.carrier).toBe("mtc");
    expect(meta.credits_before).toBeCloseTo(SEED, 2);
    expect(meta.credits_after).toBeCloseTo(NEW_BALANCE, 2);

    // ── The Transactions table shows it as money going OUT ───────────────
    // EXPENSE is already mapped "out" in getCashFlowDirection — this pins
    // that no cashFlow.ts change was needed or smuggled in.
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/audit");
    const searchInput = appPage.getByPlaceholder(
      /Search summary, client, user/i,
    );
    await expect(searchInput).toBeVisible({ timeout: 8_000 });
    await searchInput.fill(phone);
    await searchInput.press("Enter");

    const tableRow = appPage.locator("tbody tr").filter({ hasText: phone });
    await expect(tableRow).toHaveCount(1, { timeout: 10_000 });
    await expect(tableRow.getByTestId("cash-flow-badge")).toHaveAttribute(
      "data-direction",
      "out",
    );
    // The span itself is NOT absent: TransactionsViewer.tsx:1239-1255 renders
    // it whenever `[legs, rate].filter(Boolean).join(" · ")` is non-empty, and
    // TransactionRepository.createTransaction auto-snapshots exchange_rate
    // whenever it's omitted (TransactionRepository.ts:479) — so this row's
    // stamped rate alone renders a rate-only span ("@ 89,500"-style) even
    // though row.payments === [] (asserted above). What proves the LINE_CREDIT
    // leg is correctly filtered as internal (never a customer-facing leg) is
    // the ABSENCE of a leg segment: formatPaymentLegs (cashFlow.ts) only ever
    // emits "in: …" / "out: …" text, joined with " · ", and only when legs is
    // non-empty. Assert on that leg-shape signature directly rather than a
    // positive "text is rate-only" regex on the rate's own
    // `Math.round(rate).toLocaleString()` formatting — its thousands
    // separator (and digit script) is locale-dependent, which would make a
    // positive match brittle across machines; the negative match below is not.
    const legsSpanText = await tableRow.getByTestId("payment-legs").innerText();
    expect(legsSpanText).not.toMatch(/\b(in|out):/);
    expect(legsSpanText).not.toContain("LINE_CREDIT");
  });

  test("(b) voiding it from the Transactions table nets the line, the carrier drawer and the active-expense total back to zero", async ({
    appPage,
  }) => {
    const stamp = Date.now();
    const phone = `03${String(stamp).slice(-6)}`;
    const label = `L145-B-${stamp}`;
    const note = `L145 usage B ${stamp}`;
    const SEED = 33.5;
    const NEW_BALANCE = 20.25;
    const USED = 13.25;

    const lineId = await seedMtcLine(appPage, phone, label, SEED);

    // Snapshot BEFORE the usage — the void must return every number here.
    const before = await snapshot(appPage, lineId);
    expect(before.lineCredits).toBeCloseTo(SEED, 2);

    await openMtcPanel(appPage, lineId);
    await recordUsageViaDialog(appPage, lineId, NEW_BALANCE, /13\.25/, note);

    await expect
      .poll(
        async () => (await snapshot(appPage, lineId)).lineCredits.toFixed(2),
        { timeout: 10_000 },
      )
      .toBe(NEW_BALANCE.toFixed(2));

    // Sanity: the usage really did move all three before we reverse it —
    // otherwise "nets to zero" would be vacuously true.
    const afterUsage = await snapshot(appPage, lineId);
    expect(afterUsage.mtcDrawerUsd - before.mtcDrawerUsd).toBeCloseTo(-USED, 2);
    expect(afterUsage.expenseTotalUsd - before.expenseTotalUsd).toBeCloseTo(
      USED,
      2,
    );

    const txn = await findUsageTxn(appPage, phone);
    expect(txn).not.toBeNull();
    const txnId = (txn as RecentTxn).id;

    // ── Void through the REAL Transactions table button (owner requirement
    //    2026-07-04: void/refund lives there only). Bounce through "/" so a
    //    viewer parked on /audit by an earlier spec actually remounts.
    await navigateTo(appPage, "/");
    await navigateTo(appPage, "/audit");
    const searchInput = appPage.getByPlaceholder(
      /Search summary, client, user/i,
    );
    await expect(searchInput).toBeVisible({ timeout: 8_000 });
    await searchInput.fill(phone);
    await searchInput.press("Enter");

    const tableRow = appPage.locator("tbody tr").filter({ hasText: phone });
    await expect(tableRow).toHaveCount(1, { timeout: 10_000 });
    const voidBtn = tableRow.getByRole("button", { name: /^Void$/ });
    await expect(voidBtn).toBeVisible();

    // Answer the confirm EXPLICITLY (voiding is the point of this test); the
    // .catch tolerates the fixtures' global auto-accept racing us to it.
    const confirmSeen = new Promise<string>((resolve) => {
      appPage.once("dialog", (dlg) => {
        dlg.accept().catch(() => {});
        resolve(dlg.message());
      });
    });
    await voidBtn.click();
    expect(await confirmSeen).toMatch(/Void this transaction/i);

    await expect
      .poll(
        async () =>
          appPage.evaluate(async (id) => {
            const w = window as unknown as Api;
            const t = await w.api.transactions.getById(id);
            return t?.status ?? "missing";
          }, txnId),
        { timeout: 10_000 },
      )
      .toBe("VOIDED");

    // ── Rule 20: create + void nets to 0 across EVERY ledger touched ─────
    const restored = await snapshot(appPage, lineId);

    // 1. The line's credits come back (proof the movement carried the
    //    transaction id — `_reverseCarrierLineMovements` is the only thing
    //    that can do this, and only when that linkage exists).
    expect(restored.lineCredits).toBeCloseTo(SEED, 2);
    expect(restored.mtcCreditsSum - before.mtcCreditsSum).toBeCloseTo(0, 2);

    // 2. The carrier drawer comes back (`_reversePayments`, by the leg's own
    //    currency_code).
    expect(restored.mtcDrawerUsd - before.mtcDrawerUsd).toBeCloseTo(0, 2);

    // 3. The active-expense bucket comes back (the generic void flags
    //    `expenses.is_refunded`, not `status` — `getExpenseTotals` has to gate
    //    on notRefunded("expenses") for this to hold).
    expect(restored.expenseTotalUsd - before.expenseTotalUsd).toBeCloseTo(0, 2);
    expect(restored.expenseTotalLbp - before.expenseTotalLbp).toBeCloseTo(0, 0);
    expect(restored.expenseCount - before.expenseCount).toBe(0);

    // 4. Nothing cash-side or counterparty-side ever moved, in either half.
    expect(restored.generalUsd - before.generalUsd).toBeCloseTo(0, 2);
    expect(restored.generalLbp - before.generalLbp).toBeCloseTo(0, 0);
    expect(restored.supplierPoolUsd - before.supplierPoolUsd).toBeCloseTo(0, 2);
    expect(restored.supplierPoolLbp - before.supplierPoolLbp).toBeCloseTo(0, 0);
  });

  test("(c) the dialog refuses a balance that did not go DOWN, client-side — and the server refuses a stale one", async ({
    appPage,
  }) => {
    const stamp = Date.now();
    const phone = `03${String(stamp).slice(-6)}`;
    const label = `L145-C-${stamp}`;
    const SEED = 5;

    const lineId = await seedMtcLine(appPage, phone, label, SEED);
    const before = await snapshot(appPage, lineId);

    await openMtcPanel(appPage, lineId);
    await clickUsageOpen(appPage, lineId);

    const newBalance = appPage.getByTestId("carrier-line-usage-new-balance");
    const submit = appPage.getByTestId("carrier-line-usage-submit");

    // A balance ABOVE the line's current credits is not a consumption — the
    // panel must never let it reach the server (which would only reject it
    // anyway: `newCredits >= line.credits` throws in recordUsage).
    await newBalance.fill(String(SEED + 2.5));
    await expect(submit).toBeDisabled();

    // Equal is also not a consumption (delta must clear
    // LINE_USAGE_MIN_DELTA_USD = $0.01, not merely be non-negative).
    await newBalance.fill(String(SEED));
    await expect(submit).toBeDisabled();

    // …and a real consumption re-enables it, so the guard above is proven to
    // be the BALANCE check and not a permanently dead button.
    await newBalance.fill(String(SEED - 1));
    await expect(submit).toBeEnabled();

    // Leave without committing: nothing moved.
    await appPage.keyboard.press("Escape").catch(() => {});
    await navigateTo(appPage, "/");

    const afterRejected = await snapshot(appPage, lineId);
    expect(afterRejected.lineCredits).toBeCloseTo(SEED, 2);
    expect(afterRejected.mtcDrawerUsd - before.mtcDrawerUsd).toBeCloseTo(0, 2);
    expect(afterRejected.expenseTotalUsd - before.expenseTotalUsd).toBeCloseTo(
      0,
      2,
    );
    expect(afterRejected.expenseCount - before.expenseCount).toBe(0);

    // The optimistic-concurrency guard is server-owned (a stale form cannot
    // be simulated through the UI — by construction the panel always sends
    // the balance it just rendered). Drive the IPC channel named in the
    // contract directly; this also proves the channel + role wiring exist.
    const stale = await appPage.evaluate(
      async (id) =>
        (window as unknown as Api).api.carrierLines.recordUsage({
          carrierLineId: id,
          newCredits: 4,
          expectedCurrentCredits: 99,
        }),
      lineId,
    );
    expect(stale.success).toBe(false);
    expect(stale.error ?? "").toMatch(/changed/i);

    const afterStale = await snapshot(appPage, lineId);
    expect(afterStale.lineCredits).toBeCloseTo(SEED, 2);
    expect(afterStale.mtcDrawerUsd - before.mtcDrawerUsd).toBeCloseTo(0, 2);
    expect(afterStale.expenseCount - before.expenseCount).toBe(0);
  });
});
