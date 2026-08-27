/**
 * E2E: GENERAL_DRAWER_UNRESTRICTED.md Phase 4 — cash-in of a foreign
 * (non-USD/LBP) currency into the General drawer, end to end through the
 * REAL UI: Dashboard's "Top Up" modal → Cash on Hand strip → the General
 * drawer's Checkpoint count sheet.
 *
 * This is the UI seam item 8's own unit test
 * (`Checkpoint.countSheet.test.tsx`) cannot cover: that file mocks
 * `getCountableDrawerCurrencies`/`getSystemExpectedBalancesDynamic` and
 * renders `CheckpointModal` in isolation, so it proves the RENDER is correct
 * once the server hands back a given list — it never proves that (a) an
 * operator can actually get a foreign currency INTO General through the real
 * top-up form (the extra-currency picker + the lot cost-basis "edit"
 * affordance, `DrawerTopUpModal.tsx`, exercised by no other e2e spec as of
 * this writing — grepped, zero hits for `drawer-topup-currency-amount-` /
 * `drawer-topup-basis-edit-` anywhere in this suite), or (b) the Dashboard →
 * Checkpoint round trip actually reads the server's countable-currency list
 * rather than some other, possibly-stale, client-side set.
 *
 * Scenario (plan doc Phase 4 / §8):
 *   1. Cash in an unusual EUR amount via the REAL Dashboard "Top Up" modal
 *      (External / Cash In mode, "Other Currencies" → EUR, with an explicit
 *      cost-basis override so the test never depends on a configured/live
 *      EUR rate surviving from another spec).
 *   2. The new EUR total appears in the "Cash on Hand" strip's General cell.
 *   3. Opening the General drawer's Checkpoint (the same per-drawer modal
 *      item 8 fixed) shows EXACTLY ONE EUR count field, pre-filled from the
 *      new balance, while USDT — held at zero throughout this whole suite,
 *      see below — gets NO field at all, and the old duplicate-field
 *      "Other currencies" popup trigger does not exist any more.
 *
 * ── Assertion discipline (CLAUDE.md rule 15) ──────────────────────────────
 *  - EUR's General balance is a running total (there is no "row" to match by
 *    identity for a drawer balance), so every EUR assertion is a DELTA
 *    snapshotted immediately before the top-up via the app's own
 *    `closing:get-system-expected-balances-dynamic` read — never an absolute
 *    total. `EUR_AMOUNT` is an unusual, easily-recognized figure so a
 *    Cash-on-Hand text match is unambiguous.
 *  - The top-up itself IS matched by identity where a row exists: a
 *    run-unique `notes` string, read back via `drawerTopUp.getHistory()`.
 *  - The "USDT never appears" assertion is necessarily an absolute check
 *    (there is no delta for "a currency nobody ever touches") — grepped the
 *    whole `e2e-electron` suite first: every other `"USDT"` hit is a
 *    Binance-drawer leg (lira-077/098/110/112/119/session-*), never a
 *    General-drawer one, so General's USDT balance is expected to be 0 for
 *    the lifetime of this suite. If that assumption is ever wrong the
 *    assertion below fails loudly with a message saying exactly that,
 *    rather than silently passing.
 *  - EUR is SELF-PROVISIONED active (`ensureEurActive`, verbatim adaptation
 *    of lira-142/lira-146's own helper — duplicated rather than imported,
 *    same precedent as every other spec's own copy of shared logic) —
 *    the setup wizard deactivates any currency not selected during setup,
 *    and reaches EUR under full-suite conditions lira-142 documented at
 *    length.
 *  - `test.describe.configure({ retries: 0 })`: a retry relaunches Electron
 *    and would re-run the EUR provisioning reload path unnecessarily.
 *
 * Selectors depended on (verified present in the current shipped markup,
 * not guessed):
 *  - `DrawerTopUpModal.tsx`: "Top Up" button (Dashboard) opens it; scoped via
 *    the SAME `div.fixed.inset-0` + `hasText: "Top Up General Drawer"`
 *    convention `lira-141-settlement-modes-and-topup-arrows.spec.ts`
 *    already established for this exact modal (`openDrawerTopUpModal`) —
 *    it has no data-testid of its own, and the Dashboard behind it stays
 *    mounted. Inside that scope: "Add currency" button,
 *    `drawer-topup-currency-amount-0`, `drawer-topup-basis-edit-0`,
 *    `drawer-topup-acquisition-rate-0`, `drawer-topup-submit`, and the
 *    `Add a note...` textarea. Nothing in this suite exercises the
 *    extra-currency picker before this file (grepped — zero hits for
 *    `drawer-topup-currency-amount-`/`drawer-topup-basis-edit-` anywhere
 *    else), so those testids are freshly verified against source here, not
 *    against a passing precedent.
 *  - `Dashboard.tsx`: the "Cash on Hand" strip (`getByText("Cash on Hand")`'s
 *    `items-stretch`-classed ancestor), and each drawer card's
 *    `<h3>{label}</h3>` + sibling `button[title="Checkpoint"]` (gated on
 *    `checkpointsEnabled`, on by default all suite long — nothing in
 *    `e2e-electron` toggles `feature_session_management`, grepped).
 *  - `Checkpoint/index.tsx` + `DrawerCard.tsx`: same `div.fixed.inset-0`
 *    overlay-scoping convention, filtered by the heading text
 *    `Checkpoint — General`; per-currency
 *    `<label htmlFor="{drawer}-{code}">{code}</label>` + input
 *    `id="{drawer}-{code}"` (e.g. `#General-EUR`) — item 8 removed the old
 *    `otherCurrencies`/"Other currencies" popup entirely, not just its
 *    trigger, so `getByTitle("Other currencies")` must resolve to nothing.
 */
import { test, expect, navigateTo } from "./fixtures";
import type { Locator, Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

const RUN_ID = Date.now();
const TOPUP_NOTE = `L147-EUR-TOPUP-${RUN_ID}`;
// Unusual (non-round) amount so it is trivially distinguishable from any
// pre-existing General/EUR balance left by lira-142/lira-146.
const EUR_AMOUNT = 173.25;
// Arbitrary, deliberately different from create_db.sql's default EUR rates
// (buy 1.16 / sell 1.20 / market 1.18) — using the "edit" override means this
// spec never depends on those surviving unchanged.
const EUR_ACQUISITION_RATE = 1.09;

// ─── Helpers ──────────────────────────────────────────────────────────────

/** General drawer's raw per-currency balances (whatever the server currently
 *  holds — not filtered to any allowlist), via the same dynamic-balances
 *  read the Dashboard/Checkpoint pages themselves use. */
async function generalBalances(page: Page): Promise<Record<string, number>> {
  return page.evaluate(async () => {
    const all = await window.api.closing.getSystemExpectedBalancesDynamic();
    return all["General"] ?? {};
  });
}

/** The server's item-8 countable-currency set for General (base ∪ non-zero
 *  balances, deduplicated, ordered — see GENERAL_DRAWER_UNRESTRICTED.md). */
async function countableGeneral(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const all = await window.api.currencies.countableDrawerCurrencies();
    return all["General"] ?? [];
  });
}

/**
 * Provision EUR as active — verbatim adaptation of lira-142's own
 * `ensureEurActive` (see that file's doc comment for the full root-cause
 * trail: the setup wizard deactivates any currency not selected during
 * setup, reached under full-suite conditions). Duplicated here rather than
 * imported because the e2e specs in this suite are deliberately
 * self-contained (no shared non-fixture helper module) — same precedent as
 * lira-146's own copy.
 */
async function ensureEurActive(page: Page): Promise<void> {
  type CurrencyRow = { id: number; code: string; is_active: number };
  type CurrencyUpdateApi = {
    update: (data: {
      id: number;
      is_active: number;
    }) => Promise<{ success: boolean; error?: string }>;
  };

  const eur = await page.evaluate(async () => {
    const list = (await window.api.currencies.list()) as unknown as CurrencyRow[];
    return list.find((c) => c.code === "EUR") ?? null;
  });
  if (!eur) {
    throw new Error(
      "EUR currency row not found via currencies:list — cannot provision lira-147's prerequisite",
    );
  }
  if (eur.is_active) return; // Idempotent: already active, nothing to do.

  const result = await page.evaluate(async (id) => {
    const api = window.api.currencies as unknown as CurrencyUpdateApi;
    return api.update({ id, is_active: 1 });
  }, eur.id);
  if (!result.success) {
    throw new Error(
      `Failed to activate EUR currency via currencies:update: ${result.error ?? "unknown error"}`,
    );
  }

  await page.reload();
  await page.waitForSelector('nav a[href], [data-testid="sidebar"]', {
    timeout: 15_000,
  });
}

/**
 * Open the Dashboard's DrawerTopUpModal and return it scoped to its own
 * overlay root — same convention lira-141-settlement-modes-and-topup-arrows.spec.ts
 * already established for this exact modal (`openDrawerTopUpModal`): the
 * component has no data-testid on its own root, so every locator below is
 * scoped to `div.fixed.inset-0` filtered by the modal's own title, never the
 * whole page (the Dashboard behind it is still mounted and has its own
 * "General"/currency text).
 */
async function openDrawerTopUpModal(page: Page): Promise<Locator> {
  const btn = page.getByRole("button", { name: "Top Up", exact: true });
  await expect(btn).toBeVisible({ timeout: 15_000 });
  await btn.click();
  const modal = page
    .locator("div.fixed.inset-0")
    .filter({ hasText: "Top Up General Drawer" });
  await expect(modal).toBeVisible({ timeout: 10_000 });
  return modal;
}

/**
 * Open the extra-currency row's Select (DrawerTopUpModal.tsx) and choose
 * `code`. `modal` MUST be the scoped overlay locator from
 * `openDrawerTopUpModal` — never page-wide (same reasoning as that helper).
 * The row is `<div className="flex items-center gap-2">` containing, in
 * order: the currency Select (a headlessui `ListboxButton`, i.e. the FIRST
 * `<button>` in the row), the amount `DecimalInput`, and a "Remove currency"
 * icon button. `ancestor::div[...][1]` picks the NEAREST matching ancestor
 * (XPath's ancestor axis is nearest-first) — the amount input's own wrapper
 * (`flex-1 flex items-center ...`) has `items-center` but not `gap-2`, so the
 * two-class predicate lands on the row div, not that wrapper. The option
 * list is portalled (LIRA-120, `anchor="bottom end"` forces
 * @headlessui/react to render `ListboxOptions` into the app's shared
 * `#headlessui-portal-root`, OUTSIDE `modal`), so the option itself is
 * queried against `page`, not `modal`.
 */
async function pickExtraCurrency(
  page: Page,
  modal: Locator,
  index: number,
  code: string,
): Promise<void> {
  const amountInput = modal.getByTestId(`drawer-topup-currency-amount-${index}`);
  const row = amountInput.locator(
    'xpath=ancestor::div[contains(@class,"items-center") and contains(@class,"gap-2")][1]',
  );
  await row.locator("button").first().click();
  await page.getByRole("option", { name: new RegExp(`^${code}\\b`) }).click();
}

/** Parse the first "€<amount>" figure out of the Cash on Hand strip's own
 *  text — regex-based rather than exact-string matching so this survives
 *  locale/thousands-separator formatting differences between the test
 *  runner's Node and the Electron renderer's Chromium. */
async function cashOnHandGeneralEur(page: Page): Promise<number | null> {
  const block = page
    .getByText("Cash on Hand", { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"items-stretch")][1]');
  const text = await block.innerText();
  const match = text.match(/€\s?([\d,]+\.\d{2})/);
  return match ? parseFloat(match[1].replace(/,/g, "")) : null;
}

// ─── Test ─────────────────────────────────────────────────────────────────

test(
  "cash-in EUR from the Dashboard top-up modal appears in Cash on Hand and " +
    "gets exactly one count field on the General Checkpoint sheet, while " +
    "zero-balance USDT gets none (GENERAL_DRAWER_UNRESTRICTED.md item 8)",
  async ({ appPage }) => {
    await navigateTo(appPage, "/");
    await ensureEurActive(appPage);

    // ── Snapshot before ────────────────────────────────────────────────
    const before = await generalBalances(appPage);
    const beforeEur = before["EUR"] ?? 0;
    const beforeUsdt = before["USDT"] ?? 0;
    expect(
      beforeUsdt,
      "General USDT balance was expected to be 0 for this whole suite " +
        "(grepped: every other USDT-touching spec is Binance-drawer-only) " +
        "— if this fails, some other spec now deposits USDT into General " +
        "and the 'zero-balance exotic gets no field' assertion below needs " +
        "re-scoping to whatever currency is actually at zero.",
    ).toBe(0);

    // ── Phase 1: drive the REAL Dashboard top-up modal ─────────────────
    const topUpModal = await openDrawerTopUpModal(appPage);

    await topUpModal.getByRole("button", { name: "Add currency" }).click();
    await pickExtraCurrency(appPage, topUpModal, 0, "EUR");

    // Explicit cost-basis override — the "edit" affordance
    // (EXCHANGE_LOT_SETTLEMENT.md Q3) — so this spec never depends on a
    // configured `exchange_rates` row or the live feed being reachable.
    await topUpModal.getByTestId("drawer-topup-basis-edit-0").click();
    await topUpModal
      .getByTestId("drawer-topup-acquisition-rate-0")
      .fill(String(EUR_ACQUISITION_RATE));
    await topUpModal
      .getByTestId("drawer-topup-currency-amount-0")
      .fill(String(EUR_AMOUNT));
    await topUpModal.getByPlaceholder("Add a note...").fill(TOPUP_NOTE);

    const submitBtn = topUpModal.getByTestId("drawer-topup-submit");
    await expect(submitBtn).toBeEnabled();
    await submitBtn.click();
    await expect(topUpModal).toBeHidden({ timeout: 15_000 });

    // ── Money moved exactly EUR_AMOUNT, matched by identity too ────────
    const after = await generalBalances(appPage);
    const afterEur = after["EUR"] ?? 0;
    expect(afterEur - beforeEur).toBeCloseTo(EUR_AMOUNT, 2);

    type TopUpHistoryRow = {
      id: number;
      notes: string | null;
      amount_usd: number;
      amount_lbp: number;
    };
    const historyRow = await appPage.evaluate(async (note) => {
      const res = (await window.api.drawerTopUp.getHistory(20)) as {
        success: boolean;
        data?: TopUpHistoryRow[];
      };
      return (res.data ?? []).find((r) => r.notes === note) ?? null;
    }, TOPUP_NOTE);
    expect(
      historyRow,
      `Expected a drawer_topups row with notes="${TOPUP_NOTE}"`,
    ).not.toBeNull();
    expect(historyRow!.amount_usd).toBeCloseTo(0, 2);
    expect(historyRow!.amount_lbp).toBeCloseTo(0, 2);

    // ── Phase 2: appears in Cash on Hand ────────────────────────────────
    await expect
      .poll(() => cashOnHandGeneralEur(appPage), { timeout: 10_000 })
      .not.toBeNull();
    const displayedEur = await cashOnHandGeneralEur(appPage);
    expect(displayedEur).toBeCloseTo(afterEur, 2);

    // ── Item 8 policy check, straight from the server ───────────────────
    const afterCountable = await countableGeneral(appPage);
    expect(afterCountable).toContain("USD");
    expect(afterCountable).toContain("LBP");
    expect(afterCountable).toContain("EUR");
    expect(afterCountable).not.toContain("USDT");
    // No duplicates — the exact shape of the pre-fix bug (USDT counted twice).
    expect(new Set(afterCountable).size).toBe(afterCountable.length);

    // ── Phase 3: the General Checkpoint count sheet ─────────────────────
    const generalHeading = appPage.getByRole("heading", {
      name: "General",
      exact: true,
    });
    await expect(generalHeading).toBeVisible();
    // The heading and its sibling `button[title="Checkpoint"]` share one
    // parent (`div.flex.items-center.justify-between.gap-1.mb-1`).
    const generalCardHeaderRow = generalHeading.locator("xpath=..");
    await generalCardHeaderRow.getByTitle("Checkpoint").click();

    // Same `div.fixed.inset-0` overlay-scoping convention as
    // `openDrawerTopUpModal` above — CheckpointModal's root
    // (`Checkpoint/index.tsx`) is `<div className="fixed inset-0 z-50 ...">`
    // too, and the Dashboard behind it is still mounted (its own "General"
    // text and Cash-on-Hand figures must not leak into these locators).
    const modal = appPage
      .locator("div.fixed.inset-0")
      .filter({ hasText: "Checkpoint — General" });
    await expect(modal).toBeVisible({ timeout: 10_000 });

    // Exactly one EUR field (the pre-fix bug rendered USDT — and would have
    // rendered any non-zero exotic — TWICE, via the coreCurrencies/
    // otherCurrencies split), pre-filled from the new balance. Read back via
    // `.inputValue()` + numeric comparison rather than a string/regex match
    // on `DecimalInput`'s comma-formatted display value, so this survives
    // exact decimal-formatting details this spec does not otherwise care
    // about.
    await expect(modal.getByLabel("EUR")).toHaveCount(1);
    const eurFieldValue = await modal.getByLabel("EUR").inputValue();
    expect(parseFloat(eurFieldValue.replace(/,/g, ""))).toBeCloseTo(
      afterEur,
      2,
    );

    // Zero-balance USDT gets no field at all (D2) — not merely deduped.
    await expect(modal.getByLabel("USDT")).toHaveCount(0);

    // The old duplicate-field delivery mechanism doesn't exist any more,
    // not just "unopened" — see Checkpoint.countSheet.test.tsx (a).
    await expect(modal.getByTitle("Other currencies")).toHaveCount(0);

    // Leave no checkpoint behind — this spec only verifies the render.
    await modal.getByRole("button", { name: "Cancel" }).click();
    await expect(modal).toHaveCount(0);
  },
);
