/**
 * Katsh KatchForm + Suppliers-settle-modal helpers (LIRA-137/LIRA-141).
 *
 * Extracted out of `lira-137-katsh-bill-settlement-commission-topup.spec.ts`
 * (originally defined there, unchanged otherwise) so a SECOND spec
 * (`lira-141-settlement-modes-and-topup-arrows.spec.ts`) can reuse the same
 * DOM navigation instead of re-deriving it. Playwright rejects a spec file
 * importing another spec file outright ("test file X should not import test
 * file Y"), so this non-spec `helpers/` module — the same convention already
 * used by `helpers/nav.ts` and `helpers/seed.ts` — is the only place two
 * spec files can both pull these from.
 */

import { expect } from "@playwright/test";
import type { Page, Locator } from "@playwright/test";

// ── KatchForm UI helpers (mirrors lira-089/lira-095's real-form conventions) ─

const PROVIDER_MARKER = "Search Katsh items";

export async function providerTabKatsh(page: Page) {
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
export function billCard(page: Page) {
  return page
    .locator("div.bg-slate-800")
    .filter({ has: page.getByText("BILL", { exact: true }) })
    .last();
}

/** Stage one bill in the pending cart (LBP) and wait for its pending chip. */
export async function addBill(page: Page, amount: number) {
  await page.getByPlaceholder(new RegExp(PROVIDER_MARKER, "i")).fill("");
  const card = billCard(page);
  await card.getByRole("button", { name: /^LBP$/ }).click();
  await card.locator("input").last().fill(String(amount));
  await card.getByRole("button", { name: /^Add Bill$/ }).click();
  await expect(
    page.getByText(`Pending: ${amount.toLocaleString()} LBP`),
  ).toBeVisible();
}

export async function payCashWithClient(
  page: Page,
  name: string,
  phone: string,
) {
  await page.getByRole("button", { name: /Proceed to Pay/i }).click();
  await page.getByPlaceholder(/Client name \(optional\)/i).fill(name);
  await page.keyboard.press("Escape"); // dismiss autocomplete dropdown if any
  await page.getByPlaceholder(/Phone number/i).fill(phone);
  const methodSelect = page.locator('[data-testid^="payment-method-"]').first();
  await expect(methodSelect).toBeVisible();
  await methodSelect.selectOption("CASH");
  await page.getByRole("button", { name: /^Pay / }).click();
}

/**
 * Select the Katsh supplier tile on the Suppliers page (Companies list, left
 * panel) and wait for its "Transactions" tab (default `activeTab`) to
 * actually render the Settle-tab header — not just that the tile itself
 * became visible/clickable.
 *
 * This was the FIRST e2e spec in the whole suite to drive the real
 * `/suppliers` page through the UI at all (every other Suppliers-related
 * spec — lira-059/080/089/095/126/lira-supplier-secondary-system — drives
 * `w.api.suppliers.*` directly over raw IPC and never mounts this page), so
 * there was no precedent to lean on for click reliability. Matched by a
 * stable `data-testid="supplier-tile-Katsh"` instead of the fragile
 * `getByRole("button").filter({ has: getByText(...) })` text scan an earlier
 * version used — a role+text scan over the WHOLE page has no guarantee of
 * hitting the supplier-list row specifically if any other button anywhere on
 * the page ever also contains the literal text "Katsh" (e.g. the recharge
 * page's own provider tab, if a navigation timing hiccup left it in the
 * DOM). Retries with an escalating wait + a force-click/dispatch fallback,
 * mirroring `providerTabKatsh` above and lira-095's `providerTab` (whose own
 * comment: "Toasts from a previous action can sit OVER the tab row and
 * swallow force-clicks").
 */
export async function selectKatshSupplierTile(page: Page) {
  const tile = page.getByTestId("supplier-tile-Katsh");
  // Owner request (2026-08-13): the section heading was renamed from
  // "Settle transactions — select all (N)" to "Commission Settlement" (a
  // separate <h3>), with the checkbox affordance now reading "Select all
  // (N)" alone — see Suppliers/index.tsx. The heading is the more stable
  // anchor (unique to this table, doesn't depend on the row count).
  const settleHeader = page.getByText("Commission Settlement");
  for (let attempt = 0; attempt < 3; attempt++) {
    await expect(tile).toBeVisible({ timeout: 15_000 });
    if (attempt === 0) {
      await tile.click();
    } else {
      await page.mouse.move(5, 400);
      await tile.evaluate((el) => (el as HTMLButtonElement).click());
    }
    const waitMs = [8_000, 12_000, 12_000][attempt] ?? 12_000;
    const ok = await settleHeader
      .waitFor({ state: "visible", timeout: waitMs })
      .then(() => true)
      .catch(() => false);
    if (ok) return;
  }
  // Diagnostics on exhaustion (mirrors lira-095's providerTab) -- this was
  // the FIRST real-UI visit to /suppliers in the suite, so if this ever
  // fires, the message needs to carry enough to root-cause it without a
  // repro: is the tile even the Katsh one, is admin still logged in
  // (isAdmin gates the whole Settle-tab block), is some overlay covering it.
  const tileText = await tile.innerText().catch(() => "<tile not found>");
  const overlay = await page
    .locator("div.fixed.inset-0")
    .first()
    .isVisible({ timeout: 200 })
    .catch(() => false);
  const url = page.url();
  throw new Error(
    `Katsh supplier tile selected but "Commission Settlement" heading ` +
      `never appeared. tileText=${JSON.stringify(tileText)} overlay=${overlay} url=${url}`,
  );
}

/** The Katsh row's own bill in the Settle-tab checklist, matched by its
 *  unique LBP amount text -- never by position (rule 15: the tab also lists
 *  stale unsettled bills from earlier spec files). */
export function billRowLabel(page: Page, amountLbp: number): Locator {
  const amountText = `${amountLbp.toLocaleString()} LBP`;
  return page
    .locator("label")
    .filter({ hasText: "Bill" })
    .filter({ hasText: amountText });
}

/** The settle confirm modal root (CounterpartySettleModal, data-testid). */
export function settleModalRoot(page: Page): Locator {
  return page.getByTestId("counterparty-settle-modal");
}
export function beforeContentBlock(page: Page): Locator {
  // beforeContent is literally the first direct child of the body's
  // data-testid="counterparty-settle-body" container
  // (packages/ui/src/components/ui/CounterpartySettleModal.tsx).
  return page.getByTestId("counterparty-settle-body").locator("> div").first();
}

export async function captureModalState(page: Page, label: string) {
  const before = beforeContentBlock(page);
  const mpi = page.getByTestId("multi-payment-input");

  const entryModeBtn = (mode: "Lump sum" | "Rate × count") =>
    before.getByRole("button", { name: mode, exact: true });
  const rateActiveClass =
    await entryModeBtn("Rate × count").getAttribute("class");
  const lumpActiveClass = await entryModeBtn("Lump sum").getAttribute("class");

  const rateInput = before
    .locator('label:text-is("Rate per unit")')
    .locator("xpath=following-sibling::input[1]");
  const countInput = before
    .locator('label:text-is("Count")')
    .locator("xpath=following-sibling::input[1]");
  const currencyLbpBtn = before.getByRole("button", {
    name: "LBP",
    exact: true,
  });
  const currencyUsdBtn = before.getByRole("button", {
    name: "USD",
    exact: true,
  });

  const rateVal = await rateInput.inputValue().catch(() => "<not found>");
  const countVal = await countInput.inputValue().catch(() => "<not found>");
  const lbpBtnClass = await currencyLbpBtn
    .getAttribute("class")
    .catch(() => null);
  const usdBtnClass = await currencyUsdBtn
    .getAttribute("class")
    .catch(() => null);

  const computedLine = before.locator("div.text-slate-500.text-right");
  const computedLineText = await computedLine
    .innerText()
    .catch(() => "<not found>");

  // "Total owed to Katsh (fee-net)" -- gone entirely for a bills-only batch
  // (Suppliers/index.tsx's isBillsOnlyBatch gate). Checked via `.count()`
  // FIRST (fast, no polling) -- calling `.innerText()` on a locator that
  // will NEVER match anything makes Playwright poll until the test's own
  // 90s timeout, not a quick failure; `.catch()` alone would silently eat
  // that entire wait on every call.
  const totalOwedRow = before.locator(
    "div.flex.justify-between.text-slate-300",
  );
  const totalOwedText =
    (await totalOwedRow.count()) > 0
      ? await totalOwedRow.innerText().catch(() => "<not found>")
      : "<not found>";

  // The old "Net payment to Katsh:" row is REPLACED by "Katsh owes you:" for
  // a bills-only batch -- same class combo (flex justify-between font-bold),
  // different label/value, so this locator finds the NEW row for free.
  // Always renders in one shape or the other, so no fast-path count guard
  // is needed here.
  const netPayRow = before.locator("div.flex.justify-between.font-bold");
  const netPayText = await netPayRow.innerText().catch(() => "<not found>");

  // MultiPaymentInput does not render at all for a bills-only batch -- same
  // fast-path `.count()` guard as totalOwedRow above.
  const mpiVisibleCount = await mpi.count();
  const totalAmountRow = mpi.locator("div.flex.justify-between.text-xs", {
    hasText: "Total Amount",
  });
  const totalAmountText =
    mpiVisibleCount > 0 && (await totalAmountRow.count()) > 0
      ? await totalAmountRow.innerText().catch(() => "<not found>")
      : "<not found>";

  const confirmBtn = settleModalRoot(page).getByRole("button", {
    name: "Confirm Settlement",
  });
  const confirmDisabled = await confirmBtn.isDisabled();

  console.warn(`\n=== ${label} ===`);
  console.warn(
    `  Entry mode toggle -- "Rate x count" active: ${(rateActiveClass ?? "").includes("bg-emerald-600")}, "Lump sum" active: ${(lumpActiveClass ?? "").includes("bg-emerald-600")}`,
  );
  console.warn(`  RATE PER UNIT input value: "${rateVal}"`);
  console.warn(`  COUNT input value: "${countVal}"`);
  console.warn(
    `  CURRENCY -- LBP active: ${(lbpBtnClass ?? "").includes("emerald-900")}, USD active: ${(usdBtnClass ?? "").includes("emerald-900")}`,
  );
  console.warn(
    `  Computed "rate x count = ..." line: "${computedLineText.replace(/\n/g, " ")}"`,
  );
  console.warn(
    `  "Total owed to Katsh (fee-net)" row: "${totalOwedText.replace(/\n/g, " ")}"`,
  );
  console.warn(`  "Katsh owes you:" row: "${netPayText.replace(/\n/g, " ")}"`);
  console.warn(`  MultiPaymentInput rendered at all: ${mpiVisibleCount > 0}`);
  console.warn(
    `  Payment sheet "Total Amount" row: "${totalAmountText.replace(/\n/g, " ")}"`,
  );
  console.warn(`  "Confirm Settlement" button disabled: ${confirmDisabled}`);

  return {
    rateVal,
    countVal,
    lbpActive: (lbpBtnClass ?? "").includes("emerald-900"),
    computedLineText,
    totalOwedText,
    netPayText,
    mpiVisibleCount,
    totalAmountText,
    confirmDisabled,
  };
}
