/**
 * lira-web-028 — inventory batch delete over REST (dual-transport parity,
 * rule 19). The REST twin of the desktop
 * lira-151-inventory-batch-delete-transport spec, and the half that proves
 * the ticket's actual bug (a):
 *
 * `ProductList.tsx`'s `handleBatchDelete` used to gate on raw `window.api`
 * truthiness (`window.api ? await (window.api as any).inventory.batchDelete
 * (ids) : null`). In the BROWSER `window.api` is undefined, so `result`
 * stayed `null`, the `if (result && !result.success)` failure guard could
 * never fire, and the notification fell back to `ids.length` — reporting
 * products "deleted" that were never touched, over a request that was never
 * even sent (no REST route existed for this action at all before this
 * ticket). Test (d) below drives the real /products toolbar in a real
 * browser (no window.api, no shim) and proves BOTH halves: a request is
 * actually sent (products are actually gone afterward) AND the reported
 * count matches what the backend actually did.
 *
 * Also covers, at the REST layer directly (`page.request`, no browser
 * chrome):
 *   (a) POST /api/inventory/products/batch-delete deletes the given ids and
 *       returns the service's envelope verbatim;
 *   (b) role gate matches the IPC handler's `["admin", "staff"]` (NOT the
 *       singular DELETE's admin-only gate) — staff can batch-delete;
 *   (c) rule 19c envelope parity: an empty/invalid `ids` body is HTTP 200 +
 *       `{success:false}`, never a 4xx, and the service is never reached;
 *   (d)/(e) see above — UI smoke, driven in the real browser.
 *   (f) DELETE /api/inventory/products/:id envelope parity fix: an invalid
 *       `:id` now answers HTTP 200 + `{success:false}` (was 400) — proven
 *       against the REAL backend (not the mocked one the backend jest guard
 *       uses), so this is the one place the fix is exercised end-to-end.
 *
 * Rule 15: the web DB ACCUMULATES ACROSS RUNS (tests/e2e-web/README.md), so
 * every identity here carries a `Date.now()` stamp and every row is matched
 * by the id the create call returned or by that stamped name — never by
 * position or "newest row".
 */

import {
  test,
  expect,
  loginAsAdmin,
  seedStaffUser,
  staffHeaders,
  BACKEND_URL,
} from "./fixtures";
import type { Page } from "@playwright/test";

const RUN = Date.now();
const NAME_A = `LW28 BatchDel A ${RUN}`;
const NAME_B = `LW28 BatchDel B ${RUN}`;
const NAME_C = `LW28 BatchDel C ${RUN}`;

const STAFF_USERNAME = "e2e028staff";
const STAFF_PASSWORD = "E2e028Staff!1";

async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  if (!token) throw new Error("No JWT in localStorage after loginAsAdmin");
  return { Authorization: `Bearer ${token}` };
}

interface CreateEnvelope {
  success?: boolean;
  id?: number;
  data?: { id?: number };
  error?: string;
}

async function createProduct(
  page: Page,
  headers: Record<string, string>,
  name: string,
): Promise<number> {
  const res = await page.request.post(`${BACKEND_URL}/api/inventory/products`, {
    headers,
    data: {
      name,
      category: "LW28Cat",
      cost_price_usd: 5,
      retail_price_usd: 10,
      stock: 1,
      min_stock_threshold: 0,
    },
  });
  const body = (await res.json()) as CreateEnvelope;
  expect(body.success, JSON.stringify(body)).toBeTruthy();
  const id = body.data?.id ?? body.id;
  expect(id, "create must return the new product id").toBeTruthy();
  return id as number;
}

interface ProductEnvelope {
  success: boolean;
  product?: { id: number } | null;
  error?: string;
}

async function getProduct(
  page: Page,
  headers: Record<string, string>,
  id: number,
): Promise<ProductEnvelope> {
  const res = await page.request.get(
    `${BACKEND_URL}/api/inventory/products/${id}`,
    { headers },
  );
  return (await res.json()) as ProductEnvelope;
}

interface BatchDeleteEnvelope {
  success: boolean;
  deleted?: number;
  removed_unit_count?: number;
  removed_unit_imeis?: string[];
  error?: string;
}

async function batchDelete(
  page: Page,
  headers: Record<string, string>,
  ids: number[],
): Promise<{ status: number; body: BatchDeleteEnvelope }> {
  const res = await page.request.post(
    `${BACKEND_URL}/api/inventory/products/batch-delete`,
    { headers, data: { ids } },
  );
  return {
    status: res.status(),
    body: (await res.json()) as BatchDeleteEnvelope,
  };
}

test.describe("Inventory batch delete — REST transport (LIRA-149)", () => {
  test("(a) deletes the given ids over REST — envelope + soft-delete verified via a follow-up GET", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const headers = await authHeaders(page);
    const idA = await createProduct(page, headers, NAME_A);
    const idB = await createProduct(page, headers, NAME_B);

    // Both exist before the delete — the delta this test proves.
    expect((await getProduct(page, headers, idA)).product?.id).toBe(idA);
    expect((await getProduct(page, headers, idB)).product?.id).toBe(idB);

    const { status, body } = await batchDelete(page, headers, [idA, idB]);
    expect(status, "rule 19c: envelope parity, always HTTP 200").toBe(200);
    expect(body.success, JSON.stringify(body)).toBe(true);
    expect(body.deleted).toBe(2);

    // Soft-deleted: the singular GET's own service filters `is_active = 1
    // AND is_deleted = 0`, so a deleted product now 404s.
    const afterA = await getProduct(page, headers, idA);
    const afterB = await getProduct(page, headers, idB);
    expect(afterA.success).toBe(false);
    expect(afterB.success).toBe(false);
  });

  test("(b) matches the IPC handler's role gate — staff can batch-delete (not the singular DELETE's admin-only gate)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const adminAuthHeaders = await authHeaders(page);
    const idC = await createProduct(page, adminAuthHeaders, NAME_C);

    // A REAL staff-role JWT (LIRA-235 — fixtures.ts's seedStaffUser/
    // staffHeaders), not the admin token used everywhere else in this file.
    // The IPC handler's own gate is `requireRole(["admin", "staff"])`
    // (`electron-app/handlers/inventoryHandlers.ts`), unlike the singular
    // DELETE route beside it which is admin-only — this proves the REST
    // route matches the IPC handler's WIDER gate, not just "some token
    // works". The backend jest guard (inventoryBatchDelete.api.test.ts)
    // already pins the same contract at the unit level with a mocked role
    // header; this is the end-to-end proof over a real backend + real login.
    seedStaffUser(STAFF_USERNAME, STAFF_PASSWORD);
    const staff = await staffHeaders(page, STAFF_USERNAME, STAFF_PASSWORD);

    const { status, body } = await batchDelete(page, staff, [idC]);
    expect(status).toBe(200);
    expect(body.success, JSON.stringify(body)).toBe(true);
    expect(body.deleted).toBe(1);

    // Ground truth: the staff-issued delete actually took effect, read back
    // with the (unrelated) admin token to isolate the read from the gate
    // under test.
    const after = await getProduct(page, adminAuthHeaders, idC);
    expect(after.success).toBe(false);
  });

  test("(c) rejects an empty ids array — rule 19c: HTTP 200 + string error", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const headers = await authHeaders(page);

    const { status, body } = await batchDelete(page, headers, []);
    expect(status).toBe(200);
    expect(body.success).toBe(false);
    expect(typeof body.error).toBe("string");
  });

  test("(f) DELETE /api/inventory/products/:id envelope parity: an invalid id is HTTP 200 + {success:false}, never a 4xx", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const headers = await authHeaders(page);

    const res = await page.request.delete(
      `${BACKEND_URL}/api/inventory/products/not-a-number`,
      { headers },
    );
    expect(
      res.status(),
      "envelope parity — pre-fix this route answered 400",
    ).toBe(200);
    const body = (await res.json()) as { success: boolean; error?: string };
    expect(body).toEqual({ success: false, error: "Invalid id" });
  });

  test("(d) UI smoke: the real /products toolbar batch-deletes over REST in the browser — the exact scenario the ticket's bug shipped in", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const headers = await authHeaders(page);
    const idA = await createProduct(page, headers, `${NAME_A} UI`);
    const idB = await createProduct(page, headers, `${NAME_B} UI`);

    await page.goto("/#/products");
    await expect(page.getByRole("button", { name: "Add Product" })).toBeVisible(
      { timeout: 20_000 },
    );

    const row = (name: string) =>
      page.locator("tbody tr").filter({ hasText: name });

    // Scope the list to exactly THIS test's two seeds — `${RUN} UI` is a
    // substring only they carry (unlike the bare "LW28 BatchDel" prefix,
    // which tests (a)/(b) above also use), so this assertion doesn't depend
    // on those tests' own cleanup having already run.
    await page.getByPlaceholder(/search by name, barcode/i).fill(`${RUN} UI`);
    await expect(row(`${NAME_A} UI`)).toHaveCount(1, { timeout: 20_000 });
    await expect(row(`${NAME_B} UI`)).toHaveCount(1, { timeout: 20_000 });

    await row(`${NAME_A} UI`).locator('input[type="checkbox"]').check();
    await row(`${NAME_B} UI`).locator('input[type="checkbox"]').check();

    await page.getByTestId("inventory-batch-delete").click();
    await expect(page.getByTestId("confirm-modal")).toBeVisible();
    await expect(page.getByTestId("confirm-modal-confirm-btn")).toHaveText(
      "Confirm",
    );
    await page.getByTestId("confirm-modal-confirm-btn").click();

    // The pre-fix bug's exact false-success shape was "2 products deleted"
    // shown with NO request ever sent. This assertion only distinguishes a
    // real fix from that bug because of the follow-up REST reads below —
    // together they prove the count is real, not assumed from ids.length.
    await expect(
      page
        .locator('[role="alert"]', { hasText: /2 products deleted/i })
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    await expect(row(`${NAME_A} UI`)).toHaveCount(0);
    await expect(row(`${NAME_B} UI`)).toHaveCount(0);

    // Ground truth over REST, independent of the UI's own list re-render:
    // both ids are genuinely gone, proving a real request reached the
    // backend rather than the pre-fix no-op.
    const afterA = await getProduct(page, headers, idA);
    const afterB = await getProduct(page, headers, idB);
    expect(afterA.success, "product A must be genuinely deleted").toBe(false);
    expect(afterB.success, "product B must be genuinely deleted").toBe(false);
  });
});
