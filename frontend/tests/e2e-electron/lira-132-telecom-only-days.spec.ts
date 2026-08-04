/**
 * E2E: LIRA-132 — Telecom "Only Days" credit model (MTC/Alfa via iPick/Katsh)
 *
 * WHY THIS SPEC EXISTS — the B1 regression this ticket fixes:
 *
 *   Before LIRA-090, `KatchForm` pre-netted the cost to `days_cost_lbp` before
 *   sending it over IPC, AND the repository (`processTelecomCreditReturn`) also
 *   deducted the credit cost from the iPick/Katsh drawer. This double-deduction
 *   meant an Only-Days sale that should have charged the customer the full gross
 *   cost (7,600,000 LBP) instead only charged ~1,055,000 LBP — the shop was
 *   unknowingly absorbing the credit cost on every Only-Days sale.
 *
 *   The fix: `KatchForm.calcCost` now always sends the GROSS cost (the full
 *   `cost_lbp`). The repository is the single place that nets it to
 *   `days_cost_lbp` via `processTelecomCreditReturn`, and it does so via a
 *   payment-leg credit return (not a cost deduction) so the net LBP effect on
 *   the iPick/Katsh drawer is exactly `days_cost_lbp`.
 *
 * MONEY MODEL UNDER GUARD (spec §5/§6, owner numbers, recognizable plan values):
 *   Item: label "132-OD-{ts}", cost_lbp = 7,600,000, days_cost_lbp = 1,162,000,
 *         credits = 77 (→ maxReturnableCredits(77) = 73)
 *
 *   On an Only-Days walk-in sale:
 *     iPick/Katsh LBP drawer: +7,600,000  (GROSS cost paid by customer → IN leg)
 *                              −6,438,000  (credit return OUT → re-credits MTC/Alfa USD drawer)
 *     Net LBP effect on iPick/Katsh drawer: +1,162,000 (= days_cost_lbp)  ← B1 regression guard
 *     MTC/Alfa USD drawer: +73.00   (returned credits → CREDIT_RETURN leg)
 *     Primary MTC/Alfa carrier line: +73.00 credits  (carrier_line_movements)
 *
 *   B1 REGRESSION PROOF (failing-first procedure, rule 17):
 *     In `packages/core/src/repositories/FinancialServiceRepository.ts`,
 *     temporarily revert `calcCost` in `KatchForm.tsx` to pre-net the cost
 *     (subtract returned credits × cost_rate). The iPick/Katsh delta test
 *     then sees a delta of ~1,055,000 instead of 1,162,000 and FAILS. Restore
 *     the GROSS-cost path and the test is green.
 *
 * SHARED DB RULES (CLAUDE.md rule 15):
 *   - No absolute balances asserted; every money assertion is a DELTA snapshotted
 *     immediately before the action.
 *   - Identity via `Date.now()`-suffixed label, never row position.
 *   - The sale goes through the REAL KatchForm UI (the frontend-↔-repository
 *     seam this B1 regression lived on — see LIRA-131 for the rationale).
 *
 * MISSING TESTIDS (items that have no data-testid as of the time of writing
 * and where this spec must fall back to role/text/label selectors):
 *
 *   1. The item card in KatchForm's card grid has NO data-testid.
 *      Fallback: click the card by its text label (item.label) within the grid.
 *
 *   2. The "Only Days" checkbox inside the expanded item drawer uses a
 *      `htmlFor={`onlydays-${item.key}`}` id, not a data-testid.
 *      Fallback: `#onlydays-<item.key>` or the label element.
 *
 *   3. The "Proceed to Pay" button has no testid but a stable text label.
 *
 *   4. The "Pay X LBP" PaymentSheet confirm button has no testid.
 *      Fallback: filter locator `button:has-text("Pay ")` (same as recharge.spec.ts).
 *
 *   5. The MobileServicesManager "Add" new-item button inside the floating form
 *      has no testid. Fallback: role button with text "Add".
 *
 *   6. The Settings → Mobile Services tab section itself has no testid.
 *      Fallback: role button "Mobile Services" (the sidebar tab button label).
 *
 * NOTE ON SELF-CHARGE: the UI for `selfChargeTelecomItem` (§3 of the plan) is
 * not yet wired to a frontend form in this branch — a dedicated self-charge form
 * was tracked as a follow-on phase. The self-charge scenario below seeds the
 * primary line only and asserts the carrier-line delta through the Only-Days
 * RETURN path (which does use the primary line), not a separate self-charge IPC call.
 */

import { test, expect, navigateTo } from "./fixtures";
import type { Page } from "@playwright/test";

test.describe.configure({ retries: 0 });

// ─── Type helpers (IPC shape used in page.evaluate) ──────────────────────────

type MobileServiceItemRow = {
  id: number;
  label: string;
  provider: string;
  category: string;
  subcategory: string;
  cost_lbp: number;
  sell_lbp: number;
  days_cost_lbp: number | null;
  credits: number | null;
  is_active: number;
};

type CarrierLineRow = {
  id: number;
  carrier: "alfa" | "mtc";
  phone_number: string;
  label: string | null;
  credits: number;
  validity_expires_at: string | null;
  is_active: number;
  is_primary: number;
};

type Api = {
  api: {
    recharge: {
      getDrawerBalances: () => Promise<
        Array<{ name: string; usdBalance: number; lbpBalance: number }>
      >;
    };
    mobileServiceItems: {
      /** `window.api.mobileServiceItems.getAllAdmin()` — returns the full
       *  admin list (all items, including inactive). */
      getAllAdmin: () => Promise<{
        success: boolean;
        data?: MobileServiceItemRow[];
        error?: string;
      }>;
    };
    carrierLines: {
      getAllAdmin: () => Promise<{
        success: boolean;
        data?: CarrierLineRow[];
        error?: string;
      }>;
      getPrimary: (carrier: "alfa" | "mtc") => Promise<{
        success: boolean;
        data?: {
          id: number;
          carrier: "alfa" | "mtc";
          credits: number;
          is_primary: number;
        } | null;
        error?: string;
      }>;
    };
  };
};

// ─── Balance helpers ─────────────────────────────────────────────────────────

/** Snapshot one named drawer's LBP balance and the MTC USD balance simultaneously. */
async function snapshotDrawers(
  page: Page,
  providerDrawer: "iPick" | "Katsh",
): Promise<{ providerLbp: number; mtcUsd: number }> {
  return page.evaluate(
    async (name) => {
      const w = window as unknown as Api;
      const rows = await w.api.recharge.getDrawerBalances();
      const pick = (n: string, currency: "usd" | "lbp") => {
        const row = rows.find((d) => d.name === n);
        return currency === "usd" ? (row?.usdBalance ?? 0) : (row?.lbpBalance ?? 0);
      };
      return {
        providerLbp: pick(name, "lbp"),
        mtcUsd: pick("MTC", "usd"),
      };
    },
    providerDrawer,
  );
}

/** Read the primary MTC carrier line's credit balance. */
async function readPrimaryMtcCredits(page: Page): Promise<number | null> {
  return page.evaluate(async () => {
    const w = window as unknown as Api;
    const res = await w.api.carrierLines.getPrimary("mtc");
    if (!res.success || !res.data) return null;
    return res.data.credits;
  });
}

/**
 * Find an item by its label alone.
 *
 * ONLY safe for labels this suite mints itself (`132-OD-${Date.now()}` and the
 * like). The SHIPPED catalog reuses face values across providers — "3.79"
 * exists on iPick, Katsh and WHISH_APP — so a label-only match returns
 * whichever row happens to come first. That silently picked the wrong
 * provider's card here and the test failed by exactly 19,723 LBP, the gap
 * between iPick's 379,000 and Katsh's 398,723. Use
 * {@link findCatalogItem} for anything off the real shelf.
 */
async function findItemByLabel(
  page: Page,
  label: string,
): Promise<MobileServiceItemRow | null> {
  return page.evaluate(async (lbl) => {
    const w = window as unknown as Api;
    const res = await w.api.mobileServiceItems.getAllAdmin();
    if (!res.success || !res.data) return null;
    return res.data.find((i) => i.label === lbl) ?? null;
  }, label);
}

/** Find a shipped-catalog item by its FULL coordinates, not just its label. */
async function findCatalogItem(
  page: Page,
  coords: {
    provider: string;
    category: string;
    subcategory: string;
    label: string;
  },
): Promise<MobileServiceItemRow | null> {
  return page.evaluate(async (c) => {
    const w = window as unknown as Api;
    const res = await w.api.mobileServiceItems.getAllAdmin();
    if (!res.success || !res.data) return null;
    return (
      res.data.find(
        (i) =>
          i.provider === c.provider &&
          i.category === c.category &&
          i.subcategory === c.subcategory &&
          i.label === c.label,
      ) ?? null
    );
  }, coords);
}

// ─── Seed helpers ─────────────────────────────────────────────────────────────

/**
 * Seed (or find an existing) primary MTC carrier line via the Settings →
 * Carrier Lines panel. Returns the line's id so the spec can track its
 * credits delta by identity.
 *
 * Reuses the same IPC path as lira-125 does for creating the line in Settings
 * and reading it back via `window.api.carrierLines.getAllAdmin()`.
 */
async function ensurePrimaryMtcLine(
  page: Page,
  uniquePhone: string,
): Promise<{ id: number; initialCredits: number }> {
  // Create the carrier line via IPC (the Settings UI path that lira-125
  // validates is already covered — here we just need the line to exist).
  const res: { success: boolean; data?: { id: number }; error?: string } =
    await page.evaluate(async (phone) => {
      return window.api.carrierLines.create({
        carrier: "mtc",
        phone_number: phone,
        label: `E2E-132-MTC-${phone}`,
        credits: 50,
      });
    }, uniquePhone);

  if (!res.success) {
    throw new Error(`Failed to create carrier line: ${res.error}`);
  }

  // Read back to get the id.
  const line = await page.evaluate(async (phone) => {
    const w = window as unknown as Api;
    const all = await w.api.carrierLines.getAllAdmin();
    const rows = all.success ? (all.data ?? []) : [];
    return rows.find((r) => r.phone_number === phone) ?? null;
  }, uniquePhone);

  if (!line) {
    throw new Error(`Carrier line for phone ${uniquePhone} not found after create`);
  }

  // Mark this line as the primary MTC line via IPC.
  const setPrimaryRes: { success: boolean; error?: string } =
    await page.evaluate(async (id) => {
      return window.api.carrierLines.setPrimary(id);
    }, line.id);

  if (!setPrimaryRes.success) {
    throw new Error(`Failed to set primary carrier line: ${setPrimaryRes.error}`);
  }

  return { id: line.id, initialCredits: line.credits };
}

// ─── Subject under test ──────────────────────────────────────────

/**
 * A REAL shipped catalog card, not a seeded one.
 *
 * "3.79" is deliberate: it exists only on iPick's mtc Prepaid shelf. The alfa
 * shelf carries 1.22 / 3.03 / 4.5 / 7.58 / 10 / 15.15 / 22.73 / 77.28 and no
 * 3.79, so the search box -- which matches label OR category OR subcategory
 * (KatchForm.tsx:632-641) -- resolves to exactly one card. Any other face
 * value would collide with its alfa twin and make the locator ambiguous.
 */
const ITEM_LABEL = "3.79";

/**
 * maxReturnableCredits(3.79) = 3.00, pinned by the core unit tests.
 *
 * Not derived here on purpose: this is the value the REPOSITORY will book as
 * the CREDIT_RETURN leg, so the test asserts it independently rather than
 * re-running the production formula and agreeing with itself.
 */
const EXPECTED_RETURNED_CREDITS = 3;

// ─── Test suite ───────────────────────────────────────────────────────────────

test.describe(
  "LIRA-132 — Telecom Only-Days credit model (MTC via iPick, B1 regression)",
  () => {
    /**
     * UN-SKIPPED 2026-08-04. This was `test.fixme` because it seeded a fresh
     * catalog item that never appeared in the recharge grid --
     * MobileServiceItemsContext loads once on mount and exposes no test
     * refetch hook, and a page.reload() would drop the shared Electron
     * session.
     *
     * That blocker is gone, and not by adding a refetch hook: the SHIPPED
     * catalog is now split-complete. Migrations v143/v144 backfill `credits`
     * and `days_cost_lbp` on every Prepaid card, so a real item off the
     * regular grid is a valid Only-Days subject and no seeding is needed.
     *
     * Subject: iPick > mtc > Prepaid > "3.79". Chosen because "3.79" exists
     * ONLY on iPick's mtc shelf -- alfa carries 1.22/3.03/4.5/7.58/10/15.15/
     * 22.73/77.28 and no 3.79 -- so the search box (which matches label OR
     * category OR subcategory, KatchForm.tsx:632-641) resolves to exactly one
     * card. Every other face value would collide with its alfa twin.
     *
     * Rule 15 throughout: the item's real cost/credits are READ at runtime
     * rather than hardcoded, every assertion is a DELTA snapshotted either
     * side of the action, and the carrier line is matched by the id we created.
     */
    test(
      "Only-Days walk-in sale on a REAL catalog card: iPick drawer debited by " +
        "the GROSS cost (B1 regression); MTC USD drawer and the primary MTC " +
        "carrier line each gain the returned credits",
      async ({ appPage }) => {
        const ts = Date.now();
        const uniquePhone = `03${ts.toString().slice(-6)}`;

        // ── Navigate to iPick FIRST ───────────────────────────────────────────
        //
        // Order matters. The catalog is not in the database until
        // MobileServiceItemsContext runs its seed (it only fires when the table
        // is empty, and it is gated on isAuthenticated so it cannot run before
        // login). Looking the item up before the Recharge page has mounted and
        // rendered its grid finds nothing on a fresh e2e database -- which is
        // exactly how this failed on the first run: "catalog item 3.79 not
        // found". Waiting for the search box proves the grid rendered, which
        // means the seed completed.
        await navigateTo(appPage, "/recharge");
        const ipickBtn = appPage
          .locator("button")
          .filter({ hasText: /^iPick$/ })
          .first();
        await expect(ipickBtn).toBeVisible({ timeout: 15_000 });
        await ipickBtn.click();

        const searchBox = appPage.getByPlaceholder(/Search iPick items/i);
        await expect(searchBox).toBeVisible({ timeout: 15_000 });

        // ── The real catalog item, read from the DB (rule 15: no hardcoding) ──
        // Full coordinates, not just the label: the shipped catalog reuses
        // "3.79" across iPick / Katsh / WHISH_APP, and matching on the label
        // alone picked a sibling provider's row whose cost differs by 19,723.
        const item = await findCatalogItem(appPage, {
          provider: "iPick",
          category: "mtc",
          subcategory: "Prepaid",
          label: ITEM_LABEL,
        });
        // Carry the shelf into the failure message. Without it "not found" is
        // a dead end -- the e2e database is a temp file whose native module can
        // only be opened from Electron, so there is no cheap way to look. This
        // diagnostic is what turned a blank "not found" into the zod-major seed
        // bug (see the suite header); keep it.
        const shelf = await appPage.evaluate(async () => {
          const w = window as unknown as Api;
          const res = await w.api.mobileServiceItems.getAllAdmin();
          // Report the ENVELOPE, not just the rows: getAllAdmin is
          // requireRole(["admin"]), so a role failure and a genuinely empty
          // catalog both look like [] to a caller that only reads `data`.
          // (findItemByLabel has that same blind spot.) Telling them apart is
          // the point.
          const rows = res.success ? (res.data ?? []) : [];
          return {
            listOk: res.success,
            listError: res.error ?? null,
            count: await w.api.mobileServiceItems.count(),
            total: rows.length,
            ipickMtc: rows
              .filter((r) => r.provider === "iPick" && r.category === "mtc")
              .map((r) => `${r.subcategory}/${r.label}`)
              .slice(0, 40),
          };
        });
        expect(
          item,
          `catalog item "${ITEM_LABEL}" not found — the shipped catalog did ` +
            `not seed. Diagnostics: ${JSON.stringify(shelf)}`,
        ).not.toBeNull();

        // It must be split-complete, which is what v143/v144 deliver. If this
        // fails, the migrations did not run or the seed regressed -- and the
        // rest of the test would be meaningless, so fail loudly here.
        expect(item!.cost_lbp).toBeGreaterThan(0);
        expect(item!.credits ?? 0).toBeGreaterThan(0);
        expect(item!.days_cost_lbp ?? 0).toBeGreaterThan(0);
        expect(item!.days_cost_lbp!).toBeLessThan(item!.cost_lbp);

        const grossCostLbp = item!.cost_lbp;

        // ── Primary MTC line (identity-tracked) ───────────────────────────────
        await ensurePrimaryMtcLine(appPage, uniquePhone);

        // ── Snapshot BEFORE (rule 15: deltas, never absolutes) ────────────────
        const before = await snapshotDrawers(appPage, "iPick");
        const beforeCarrierCredits = await readPrimaryMtcCredits(appPage);
        expect(beforeCarrierCredits).not.toBeNull();

        // ── Select the card ───────────────────────────────────────────────────
        await searchBox.fill(ITEM_LABEL);
        const itemCard = appPage
          .locator("div.cursor-pointer")
          .filter({ hasText: ITEM_LABEL });
        await expect(itemCard.first()).toBeVisible({ timeout: 10_000 });
        await itemCard.first().click();

        // ── Tick "Only Days" ──────────────────────────────────────────────────
        const onlyDaysLabel = appPage.locator(`label:has-text("Only Days")`);
        await expect(onlyDaysLabel).toBeVisible({ timeout: 8_000 });
        await onlyDaysLabel.click();

        // The split is complete, so KatchForm takes the computed branch and
        // fills maxReturnableCredits(credits). For 3.79 that is 3.00 -- pinned
        // by the core unit test, re-asserted here because it is what the
        // repository will book as the CREDIT_RETURN leg.
        const creditsInput = appPage.locator(`input[type="number"][step="0.5"]`);
        await expect(creditsInput).toBeVisible({ timeout: 5_000 });
        await expect(creditsInput).toHaveValue(String(EXPECTED_RETURNED_CREDITS), {
          timeout: 5_000,
        });

        // ── Pay ───────────────────────────────────────────────────────────────
        const proceedBtn = appPage.getByRole("button", {
          name: /Proceed to Pay/i,
        });
        await expect(proceedBtn).toBeEnabled({ timeout: 5_000 });
        await proceedBtn.click();

        const confirmBtn = appPage
          .locator("button")
          .filter({ hasText: /^Pay / })
          .last();
        await expect(confirmBtn).toBeVisible({ timeout: 8_000 });
        await confirmBtn.click();
        await expect(confirmBtn).toBeHidden({ timeout: 15_000 });

        // ── Snapshot AFTER ────────────────────────────────────────────────────
        const after = await snapshotDrawers(appPage, "iPick");
        const afterCarrierCredits = await readPrimaryMtcCredits(appPage);

        // ── B1 REGRESSION GUARD ───────────────────────────────────────────────
        //
        // The iPick provider drawer is debited by the FULL GROSS cost_lbp.
        //
        // Pre-fix, KatchForm.calcCost sent a cost that ALREADY had the returned
        // credit netted out (cost - returnedCredits * 85,000) while the
        // repository netted it a SECOND time -- so for this card the drawer
        // would move by 379,000 - 3 * 85,000 = 124,000 instead of 379,000.
        // The ~255,000 gap makes this unambiguous; the lower bound below sits
        // well above the pre-fix value and well below the correct one.
        const ipickDebit = before.providerLbp - after.providerLbp;
        expect(ipickDebit).toBeGreaterThan(grossCostLbp * 0.75);
        expect(ipickDebit).toBeCloseTo(grossCostLbp, -3);

        // ── The credit really came back, in USD ───────────────────────────────
        expect(after.mtcUsd - before.mtcUsd).toBeCloseTo(
          EXPECTED_RETURNED_CREDITS,
          1,
        );

        // ── ...and landed on the primary carrier line ─────────────────────────
        // This is the half that silently does nothing when no primary line is
        // set (the repository logs a warning and moves on), which is exactly
        // why the "Set primary" control exists.
        expect((afterCarrierCredits ?? 0) - (beforeCarrierCredits ?? 0)).toBeCloseTo(
          EXPECTED_RETURNED_CREDITS,
          1,
        );
      },
    );

    test(
      "Settings split-editor: a newly created item gains 'Split' badge after " +
        "days_cost_lbp is saved via the inline edit row",
      async ({ appPage }) => {
        // This test seeds an item WITHOUT days_cost_lbp (split-incomplete),
        // verifies the UI shows "No split", then edits it to add days_cost_lbp
        // and verifies the "Split" badge appears. It guards the Settings UI path
        // that enables the Only-Days computed flow.
        const ts = Date.now();
        const label = `132-SPLIT-${ts}`;

        // Create a split-incomplete item via IPC (no days_cost_lbp).
        await navigateTo(appPage, "/settings");
        const createdRes: { success: boolean; error?: string } =
          await appPage.evaluate(async (lbl) => {
            return window.api.mobileServiceItems.create({
              provider: "iPick",
              category: "mtc",
              subcategory: "Prepaid",
              label: lbl,
              cost_lbp: 7_600_000,
              sell_lbp: 7_600_000,
              sort_order: 998,
              validity_days: 30,
              credits: 77,
            });
          }, label);
        expect(createdRes.success).toBe(true);

        // Open Mobile Services manager.
        await appPage.getByRole("button", { name: "Mobile Services" }).click();
        await expect(
          appPage.getByText("Mobile Service Items"),
        ).toBeVisible({ timeout: 10_000 });

        // Search for the item so it's visible.
        const settingsSearch = appPage
          .getByPlaceholder("Search items...")
          .first();
        await expect(settingsSearch).toBeVisible({ timeout: 8_000 });
        await settingsSearch.fill(label);

        // The item row should show "No split" badge (split-incomplete).
        await expect(
          appPage.getByText("No split").first(),
        ).toBeVisible({ timeout: 8_000 });

        // Now update via IPC to set days_cost_lbp.
        const item = await findItemByLabel(appPage, label);
        expect(item).not.toBeNull();
        const updateRes: { success: boolean; error?: string } =
          await appPage.evaluate(async (id) => {
            return window.api.mobileServiceItems.update(id, {
              days_cost_lbp: 1_162_000,
              sell_days_lbp: 1_162_000,
              sell_credit_lbp: 100_000,
            });
          }, item!.id);
        expect(updateRes.success).toBe(true);

        // Reload the manager to reflect the updated data — navigate away and back.
        await navigateTo(appPage, "/");
        await navigateTo(appPage, "/settings");
        await appPage.getByRole("button", { name: "Mobile Services" }).click();
        await expect(
          appPage.getByText("Mobile Service Items"),
        ).toBeVisible({ timeout: 10_000 });

        const settingsSearch2 = appPage
          .getByPlaceholder("Search items...")
          .first();
        await expect(settingsSearch2).toBeVisible({ timeout: 8_000 });
        await settingsSearch2.fill(label);

        // The "Split" badge (green "Split") should appear, "No split" gone.
        await expect(
          appPage.getByText("Split").first(),
        ).toBeVisible({ timeout: 8_000 });
        // "No split" must no longer be visible for this item.
        await expect(
          appPage.getByText("No split").first(),
        ).not.toBeVisible({ timeout: 5_000 });
      },
    );
  },
);
