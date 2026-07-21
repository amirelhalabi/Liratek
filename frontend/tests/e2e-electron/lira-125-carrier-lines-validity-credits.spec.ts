/**
 * E2E: LIRA W6 — Carrier Lines (shop SIM tracking) + mobile_service_items
 * structured validity/credits.
 *
 * WRITTEN BUT NOT RUN by this workstream (W6, solo run) — per the global
 * constraint "NEVER run yarn test:e2e"; the verifier runs this in the
 * centralized phase (`yarn dev` → stop → `env -u ELECTRON_RUN_AS_NODE yarn
 * test:e2e`).
 *
 * Scope: BOTH W6.a (carrier_lines CRUD + Recharge-tab compact panel) and
 * W6.b (mobile_service_items.validity_days/credits, seeded from
 * mobileServices.ts and rendered on iPick/Katsh mtc Prepaid item cards).
 * Informational only — no drawer legs, no checkout/closing involvement, so
 * every assertion here is either identity-matched (rule 15: unique phone
 * number / unique catalog label, never row position / getRecent()[0]) or a
 * direct value read-back (not a money delta — there is no drawer to delta).
 *
 * Failing-first procedure for the verifier (rule 17):
 *  - W6.a: in packages/core/src/repositories/CarrierLineRepository.ts,
 *    temporarily make updateBalance() a no-op (`return this.getById(id);`
 *    without applying `data`). The "quick-update" test's read-back
 *    assertions fail (credits/validity_expires_at unchanged); the create/list
 *    assertions still pass. Restore afterward.
 *  - W6.b: in packages/core/src/db/migrations/index.ts v135, or in
 *    frontend/src/data/mobileServices.ts, temporarily remove the
 *    `validity_days`/`credits` fields from the iPick mtc Prepaid "3.79" /
 *    "1" entries. The item-card assertions ("10d validity", "Credit only
 *    $1") fail while the rest of the catalog UI keeps working. Restore
 *    afterward.
 */

import { test, expect, navigateTo } from "./fixtures";

test.describe.configure({ retries: 0 });

type CarrierLineRow = {
  id: number;
  carrier: "alfa" | "mtc";
  phone_number: string;
  label: string | null;
  credits: number;
  validity_expires_at: string | null;
  is_active: number;
};

type MobileServiceItemRow = {
  provider: string;
  category: string;
  subcategory: string;
  label: string;
  validity_days: number | null;
  credits: number | null;
};

type Api = {
  api: {
    carrierLines: {
      getAllAdmin: () => Promise<{
        success: boolean;
        data?: CarrierLineRow[];
        error?: string;
      }>;
    };
    mobileServiceItems: {
      getByProviderCategory: (
        provider: string,
        category: string,
      ) => Promise<{
        success: boolean;
        data?: MobileServiceItemRow[];
        error?: string;
      }>;
    };
  };
};

/** Local Y/M/D — mirrors CarrierLinesPanel's own date-only arithmetic
 *  exactly (no UTC/ISO conversion, which would risk an off-by-one near
 *  midnight in a non-UTC timezone). */
function addDaysToToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

async function findCarrierLineByPhone(
  appPage: import("@playwright/test").Page,
  phone: string,
): Promise<CarrierLineRow | null> {
  return appPage.evaluate(async (phoneNumber) => {
    const w = window as unknown as {
      api: {
        carrierLines: {
          getAllAdmin: () => Promise<{
            success: boolean;
            data?: Array<{
              id: number;
              carrier: "alfa" | "mtc";
              phone_number: string;
              label: string | null;
              credits: number;
              validity_expires_at: string | null;
              is_active: number;
            }>;
          }>;
        };
      };
    };
    const res = await w.api.carrierLines.getAllAdmin();
    const rows = res.success ? (res.data ?? []) : [];
    return rows.find((r) => r.phone_number === phoneNumber) ?? null;
  }, phone);
}

test.describe("LIRA W6.a — Carrier Lines: Settings CRUD + Recharge-tab panel", () => {
  test("create in Settings, read back exactly, then quick-update from the Recharge MTC panel", async ({
    appPage,
  }) => {
    const uniquePhone = `03${Date.now().toString().slice(-6)}`;
    const initialExpiry = "2026-12-31"; // far enough out to never be "today" for this run
    const uniqueLabel = `E2E-W6-${Date.now()}`;

    // ── Settings → Carrier Lines: create ──────────────────────────────────
    await navigateTo(appPage, "/settings");
    await appPage.getByRole("button", { name: "Carrier Lines" }).click();
    await expect(
      appPage.getByRole("heading", { name: "Carrier Lines" }),
    ).toBeVisible({ timeout: 10_000 });

    await appPage.getByText("+ Add Line").click();
    await appPage.getByPlaceholder("e.g. 03123456").fill(uniquePhone);
    await appPage.getByPlaceholder("e.g. Shop Line 1").fill(uniqueLabel);
    const creditsField = appPage.locator("input[type='number']").first();
    await creditsField.fill("8");
    await appPage.locator("input[type='date']").fill(initialExpiry);
    await appPage.getByRole("button", { name: "Create" }).click();

    // Row appears in the manager table, identity-matched by phone number.
    await expect(appPage.getByText(uniquePhone)).toBeVisible({
      timeout: 10_000,
    });

    // Read back via IPC — exact values, not a "first row" assumption.
    const created = await findCarrierLineByPhone(appPage, uniquePhone);
    expect(created).not.toBeNull();
    expect(created!.carrier).toBe("mtc");
    expect(created!.label).toBe(uniqueLabel);
    expect(created!.credits).toBe(8);
    expect(created!.validity_expires_at).toBe(initialExpiry);
    expect(created!.is_active).toBe(1);
    const lineId = created!.id;

    // ── Recharge → MTC tab: the compact panel shows the new line ─────────
    await navigateTo(appPage, "/recharge");
    // Recharge defaults to the MTC tab (first ProviderTabs entry).
    await expect(appPage.getByTestId(`carrier-line-${lineId}`)).toBeVisible({
      timeout: 10_000,
    });
    await expect(appPage.getByTestId(`carrier-line-${lineId}`)).toContainText(
      uniqueLabel,
    );
    await expect(appPage.getByTestId(`carrier-line-${lineId}`)).toContainText(
      "$8",
    );

    // ── Inline quick-update: "days from today" resolves to a date ────────
    await appPage.getByTestId(`carrier-line-${lineId}`).click();
    const expectedNewExpiry = addDaysToToday(5);

    const panel = appPage.getByTestId("carrier-lines-panel");
    await panel.locator("input[type='number']").first().fill("3.5");
    await panel.getByPlaceholder("30").fill("5");
    await panel.getByText("Save").click();

    // Panel reflects the new credits after the save round-trips.
    await expect(appPage.getByTestId(`carrier-line-${lineId}`)).toContainText(
      "$3.5",
      { timeout: 10_000 },
    );

    // Read back via IPC — exact values (credits AND the resolved date).
    const updated = await findCarrierLineByPhone(appPage, uniquePhone);
    expect(updated).not.toBeNull();
    expect(updated!.credits).toBe(3.5);
    expect(updated!.validity_expires_at).toBe(expectedNewExpiry);
  });
});

test.describe("LIRA W6.b — mobile_service_items structured validity/credits", () => {
  test("iPick mtc Prepaid rows carry validity_days/credits end-to-end (seed → IPC → item card)", async ({
    appPage,
  }) => {
    // ── DB-level proof: the seed path threaded validity_days/credits ─────
    const items = await appPage.evaluate(async () => {
      const w = window as unknown as Api;
      const res = await w.api.mobileServiceItems.getByProviderCategory(
        "iPick",
        "mtc",
      );
      return res.success ? (res.data ?? []) : [];
    });

    const tenDayCard = items.find(
      (i) => i.subcategory === "Prepaid" && i.label === "3.79",
    );
    expect(tenDayCard).toBeTruthy();
    expect(tenDayCard!.validity_days).toBe(10);
    expect(tenDayCard!.credits).toBeNull();

    const creditOnlyCard = items.find(
      (i) => i.subcategory === "Prepaid" && i.label === "1",
    );
    expect(creditOnlyCard).toBeTruthy();
    expect(creditOnlyCard!.credits).toBe(1);
    expect(creditOnlyCard!.validity_days).toBeNull();

    // The "start" item has no derivable validity/credit — must stay null.
    const startCard = items.find(
      (i) => i.subcategory === "Prepaid" && i.label === "start",
    );
    expect(startCard).toBeTruthy();
    expect(startCard!.validity_days).toBeNull();
    expect(startCard!.credits).toBeNull();

    // ── UI-level proof: the item card renders the structured fields ──────
    await navigateTo(appPage, "/recharge");
    await appPage.getByRole("button", { name: "iPick" }).click();

    const searchBox = appPage.getByPlaceholder(/search ipick items/i);
    await expect(searchBox).toBeVisible({ timeout: 10_000 });

    await searchBox.fill("3.79");
    await expect(appPage.getByText("10d validity")).toBeVisible({
      timeout: 10_000,
    });

    await searchBox.fill("1.67");
    await expect(appPage.getByText("Credit only")).toBeVisible({
      timeout: 10_000,
    });
    await expect(appPage.getByText("$1.67")).toBeVisible();
  });
});
