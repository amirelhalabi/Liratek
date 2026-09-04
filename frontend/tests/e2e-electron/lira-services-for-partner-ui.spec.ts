/**
 * E2E: Services (OMT/Whish, route `/omt-whish`) — the real For-Partner form,
 * driven through the UI, not a hand-built IPC payload.
 *
 * WHY THIS SPEC EXISTS. Commit `fd5444cc` fixed LIRA-114 §4: the For-Partner
 * payment section on this page offered "Customer Account" on a For-Partner
 * SEND, which the backend then hard-rejects at
 * `FinancialServiceRepository.ts:2116` (`assertNoCustomerAccountLeg`). The
 * backend was correct and guarded the whole time — the bug lived purely at
 * the frontend↔backend seam, for two weeks, because **no e2e spec has ever
 * rendered this form**. `lira-119-partner-for-financial-service.spec.ts` is
 * 585 lines of For-Partner financial-service coverage that reaches
 * `FinancialServiceRepository` entirely through `page.evaluate` hand-built
 * `window.api.omt.addTransaction(...)` payloads — it never mounts
 * `Services/index.tsx`, so it structurally cannot see what the UI offers an
 * operator. This spec is the counter-example: every assertion below drives
 * a real locator on the real page.
 *
 * PART A — UI gating (Services/index.tsx ~:1508 "For Partner" toggle,
 * ~:2143 payment-section gate). Checked in this order so the later
 * assertions are proven CONDITIONAL, not incidental defaults:
 *   1. For Partner ON + SEND  → section labelled "Paid from", Customer
 *      Account no longer offered (drawerAffectingMethods only).
 *   2. The two-sided `services-for-partner-send-payout-notice` names the
 *      selected partner and states both the shop's payout and that the
 *      partner owes it.
 *   3. For Partner ON + RECEIVE (same tab, same partner — the toggle isn't
 *      reset by a direction switch) → the whole payment section disappears,
 *      replaced by `services-for-partner-receive-no-payout-notice`.
 *   4. Toggling For Partner back OFF on SEND restores Customer Account and
 *      the "Payment" label — proving the gate is conditional on the toggle,
 *      not a blanket removal that happens to look right by coincidence.
 *
 * PART B — the seam itself: submit a real For-Partner SEND through the form
 * (not `page.evaluate`) and prove it lands correctly — the chosen drawer
 * (the shop's own base-system cash drawer, `resolveServiceCashDrawer`
 * routes CASH there only when `provider === baseSystem`, `utils/payments.ts`)
 * is debited by exactly what the sheet disbursed, General stays untouched,
 * and the partner ledger carries the matching DEBIT. This is the half
 * `lira-119` cannot cover by construction.
 *
 * Rule 15 (shared accumulating DB): a FRESH partner (identity by returned
 * id — a brand-new partner's ledger has exactly zero rows before, one
 * after) plus a run-unique, `Date.now()`-derived amount. A decoy partner is
 * created alongside the target (mirrors
 * `lira-114-partner-for-pos-ui.spec.ts`) so `PartnerSelector`'s dropdown
 * branch renders deterministically regardless of how many partners the
 * shared DB already has — LIRA-118: exactly one partner collapses to a
 * non-interactive label with no click target.
 *
 * BASE-SYSTEM ASSUMPTION: `shop_base_system` is read at RUNTIME via
 * `window.api.settings.getAll()`, never assumed to be "OMT" — the "For
 * Partner" toggle only renders on `provider !== partnerSystem`
 * (Services/index.tsx ~:1509), and which of OMT/WHISH that is depends
 * entirely on this setting. The suite's `completeSetup()` sets it to OMT
 * once per worker and nothing observed in this codebase's e2e specs flips
 * it afterward, so in practice this spec is expected to exercise the OMT
 * tab — but it computes `forType`/`systemDrawer`/the OMT-vs-WHISH fee
 * (`$1` INTRA tier vs `$0`, LIRA-023) from the SAME reading, so it is
 * correct either way, not merely "probably OMT".
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

type BaseSystem = "OMT" | "WHISH";

type Api = {
  api: {
    settings: {
      getAll: () => Promise<Array<{ key_name: string; value: string }>>;
    };
    partners: {
      create: (d: { name: string; phone?: string }) => Promise<{
        success: boolean;
        data?: { id: number };
        error?: string;
      }>;
      getBalance: (id: number) => Promise<{ usd: number; lbp: number }>;
      getLedger: (id: number) => Promise<{
        entries: Array<{
          transaction_type: string | null;
          amount: number;
          currency: string;
          direction: "DEBIT" | "CREDIT";
          notes: string | null;
        }>;
      }>;
    };
    recharge: {
      getDrawerBalances: () => Promise<
        Array<{
          name: string;
          usdBalance: number;
          lbpBalance: number;
          usdtBalance: number;
        }>
      >;
    };
  };
};

/** The shop's own base system (`system_settings.shop_base_system`) — read at
 *  runtime, never assumed. See file header "BASE-SYSTEM ASSUMPTION". */
async function getBaseSystem(page: Page): Promise<BaseSystem> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const settings = await w.api.settings.getAll();
    const row = settings.find((s) => s.key_name === "shop_base_system");
    return row?.value === "WHISH" ? "WHISH" : "OMT";
  });
}

/** Click the real combined provider+service-type tab button (four total: OMT
 *  ↑/↓, WHISH ↑/↓) — generalizes
 *  `lira-131-omt-fee-ui-driven.spec.ts`'s `pickOmt` to either provider so
 *  this spec never hardcodes which one is the shop's base system. */
async function pickTab(
  page: Page,
  provider: BaseSystem,
  direction: "SEND" | "RECEIVE",
) {
  const arrow = direction === "SEND" ? "↑" : "↓";
  const tile = page
    .locator("button")
    .filter({ hasText: provider })
    .filter({ hasText: arrow })
    .first();
  await expect(tile).toBeVisible({ timeout: 15_000 });
  await tile.click();
}

/** Create a decoy + a uniquely-named target partner (see file header on why
 *  the decoy is required), returning the target's id. Mirrors
 *  `lira-114-partner-for-pos-ui.spec.ts`'s setup. */
async function createPartners(
  page: Page,
  targetName: string,
  decoyName: string,
): Promise<number> {
  return page.evaluate(
    async ({ targetName, decoyName }) => {
      const w = window as unknown as Api;
      const decoy = await w.api.partners.create({ name: decoyName });
      const target = await w.api.partners.create({
        name: targetName,
        phone: `${Date.now()}`.slice(-8),
      });
      if (!decoy.success || !target.success || !target.data) {
        throw new Error(decoy.error ?? target.error ?? "partner create failed");
      }
      return target.data.id;
    },
    { targetName, decoyName },
  );
}

async function drawerUsd(page: Page, name: string): Promise<number> {
  return page.evaluate(async (n) => {
    const w = window as unknown as Api;
    const rows = await w.api.recharge.getDrawerBalances();
    return rows.find((d) => d.name === n)?.usdBalance ?? 0;
  }, name);
}

async function partnerLedgerEntries(page: Page, partnerId: number) {
  return page.evaluate(async (id) => {
    const w = window as unknown as Api;
    return (await w.api.partners.getLedger(id)).entries;
  }, partnerId);
}

async function partnerUsd(page: Page, partnerId: number): Promise<number> {
  return page.evaluate(async (id) => {
    const w = window as unknown as Api;
    return (await w.api.partners.getBalance(id)).usd;
  }, partnerId);
}

/** The payment-method `<select>` inside the real MultiPaymentInput
 *  single-line mode — its id is a random uuid, so matched by the
 *  `payment-method-` prefix (same pattern
 *  `lira-141-settlement-modes-and-topup-arrows.spec.ts` uses). */
function paymentMethodSelect(page: Page) {
  return page.locator('[data-testid^="payment-method-"]').first();
}

/** Check "For Partner" (idempotent) and pick `partnerName` from the real
 *  dropdown — requires 2+ partners in the list (see `createPartners`). */
async function toggleForPartnerOnAndSelect(page: Page, partnerName: string) {
  const checkbox = page.getByRole("checkbox", { name: /For Partner/i });
  await expect(checkbox).toBeVisible({ timeout: 10_000 });
  await checkbox.check();

  const partnerPicker = page.getByRole("button", { name: "Select partner" });
  await expect(partnerPicker).toBeVisible({ timeout: 10_000 });
  await partnerPicker.click();
  await page.getByRole("option", { name: partnerName, exact: true }).click();
}

test.describe("Services (OMT/Whish) — real For-Partner form, UI-driven", () => {
  test("For-Partner payment gating (Paid from / notices / Customer Account) and a real SEND lands on the partner ledger + drawer", async ({
    appPage,
  }) => {
    const ts = Date.now();
    const TARGET_NAME = `L-FP-SVC Target ${ts}`;
    const DECOY_NAME = `L-FP-SVC Decoy ${ts}`;

    const baseSystem = await getBaseSystem(appPage);
    const partnerId = await createPartners(appPage, TARGET_NAME, DECOY_NAME);

    // Run-unique, inside the OMT INTRA $0-100 tier ($1 fee) — when the base
    // system is WHISH there is no default fee (LIRA-023, no fee typed) so
    // EXPECTED_OUT collapses to the bare amount. Either way this is
    // deterministic, not "probably OMT" (see file header).
    const AMOUNT = Number((44 + (ts % 900) / 100).toFixed(2));
    const FEE = baseSystem === "OMT" ? 1 : 0;
    const EXPECTED_OUT = Number((AMOUNT + FEE).toFixed(2));
    const forType = baseSystem === "OMT" ? "FOR_OMT_SEND" : "FOR_WHISH_SEND";
    const systemDrawer = baseSystem === "OMT" ? "OMT_System" : "Whish_System";

    await navigateTo(appPage, "/omt-whish");
    await pickTab(appPage, baseSystem, "SEND");

    const amountInput = appPage.locator("#service-amount");
    await expect(amountInput).toBeVisible({ timeout: 15_000 });
    await amountInput.fill(String(AMOUNT));

    const paymentPanel = appPage.locator('[data-testid="multi-payment-input"]');

    // ── Toggle "For Partner" ON and pick the target partner via the real
    // dropdown. ───────────────────────────────────────────────────────────
    await toggleForPartnerOnAndSelect(appPage, TARGET_NAME);

    // ── Part A.1: label becomes "Paid from"; Customer Account is no longer
    // offered — the exact combination the backend hard-rejects at
    // FinancialServiceRepository.ts:2116 (assertNoCustomerAccountLeg). ─────
    await expect(
      paymentPanel.getByText("Paid from", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    const optionsOn = await paymentMethodSelect(appPage)
      .locator("option")
      .allTextContents();
    expect(optionsOn.some((t) => /customer account/i.test(t))).toBe(false);

    // ── Part A.2: the two-sided send-payout notice names the partner and
    // states both the shop's payout and that the partner owes it. ─────────
    const sendNotice = appPage.getByTestId(
      "services-for-partner-send-payout-notice",
    );
    await expect(sendNotice).toBeVisible({ timeout: 10_000 });
    await expect(sendNotice).toContainText(TARGET_NAME);
    await expect(sendNotice).toContainText("You pay out");
    await expect(sendNotice).toContainText("owes you");

    // ── Part A.3: For Partner ON + RECEIVE (same base-system tab) — the
    // whole payment section is replaced by a notice, never silently
    // discarded. The tab-switch handler only clears sender/receiver/fee
    // state (Services/index.tsx's tab onClick), so forPartner/forPartnerId
    // survive and the SAME partner stays selected. ─────────────────────────
    await pickTab(appPage, baseSystem, "RECEIVE");
    await expect(paymentPanel).toHaveCount(0);
    await expect(
      appPage.getByTestId("services-for-partner-receive-no-payout-notice"),
    ).toBeVisible({ timeout: 10_000 });

    // Back to SEND — forPartner/forPartnerId and the typed amount persist
    // across the tab switches (neither is touched by the tab onClick).
    await pickTab(appPage, baseSystem, "SEND");
    await expect(sendNotice).toBeVisible({ timeout: 10_000 });

    // ── Part A.4: toggling OFF restores Customer Account and the "Payment"
    // label — proves the gate is conditional on the toggle, not a blanket
    // removal that happened to look right by coincidence. ──────────────────
    await appPage.getByRole("checkbox", { name: /For Partner/i }).uncheck();
    await expect(
      paymentPanel.getByText("Payment", { exact: true }),
    ).toBeVisible({ timeout: 10_000 });
    const optionsOff = await paymentMethodSelect(appPage)
      .locator("option")
      .allTextContents();
    expect(optionsOff.some((t) => /customer account/i.test(t))).toBe(true);

    // ── Part B: submit a real For-Partner SEND through the form (not
    // page.evaluate) — the seam lira-119-partner-for-financial-service.spec.ts
    // cannot cover, since it drives window.api.omt.addTransaction directly
    // and never renders this page. Re-enable the toggle (unchecking above
    // cleared forPartnerId) and re-pick the same partner, then explicitly
    // pick CASH as the disbursing method — the "chosen drawer" this test
    // proves gets debited. ──────────────────────────────────────────────────
    await toggleForPartnerOnAndSelect(appPage, TARGET_NAME);
    await paymentMethodSelect(appPage).selectOption("CASH");
    await expect(amountInput).toHaveValue(String(AMOUNT));

    const drawerBefore = await drawerUsd(appPage, systemDrawer);
    const generalBefore = await drawerUsd(appPage, "General");
    const ledgerBefore = await partnerLedgerEntries(appPage, partnerId);
    expect(ledgerBefore).toHaveLength(0);
    const partnerBefore = await partnerUsd(appPage, partnerId);

    await appPage.getByRole("button", { name: /Record Send/i }).click();
    // A successful submit clears the amount; a rejected one leaves it filled
    // (mirrors lira-131-omt-fee-ui-driven.spec.ts's own success signal).
    await expect(amountInput).toHaveValue("", { timeout: 15_000 });

    const drawerAfter = await drawerUsd(appPage, systemDrawer);
    const generalAfter = await drawerUsd(appPage, "General");
    const ledgerAfter = await partnerLedgerEntries(appPage, partnerId);
    const partnerAfter = await partnerUsd(appPage, partnerId);

    // The shop's own disbursement debits the BASE system's cash drawer —
    // never General (resolveServiceCashDrawer routes CASH to the primary
    // cash drawer only when provider === baseSystem, which is exactly this
    // tab, packages/core/src/utils/payments.ts).
    expect(drawerAfter - drawerBefore).toBeCloseTo(-EXPECTED_OUT, 2);
    expect(generalAfter - generalBefore).toBeCloseTo(0, 2);

    // Identity: the fresh partner has EXACTLY one ledger row — ours.
    expect(ledgerAfter).toHaveLength(1);
    expect(ledgerAfter[0].transaction_type).toBe(forType);
    expect(ledgerAfter[0].direction).toBe("DEBIT");
    expect(ledgerAfter[0].currency).toBe("USD");
    expect(ledgerAfter[0].amount).toBeCloseTo(EXPECTED_OUT, 2);
    expect(partnerAfter - partnerBefore).toBeCloseTo(EXPECTED_OUT, 2);
  });
});
