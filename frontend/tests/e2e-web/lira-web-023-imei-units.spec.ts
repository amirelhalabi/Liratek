/**
 * lira-web-023 — LIRA-143 phone IMEI units & warranty over REST (dual-
 * transport parity, rule 19). The REST twin of the desktop
 * lira-143-imei-warranty spec.
 *
 * Scope deliberately leaner than the desktop spec (house convention — see
 * lira-web-012/013/022): every lira-web spec drives `page.request` directly
 * against the backend rather than the browser UI, since the REST layer is
 * what needs proving here, not a second UI walkthrough. Category/product
 * creation and unit registration go through the SAME REST routes
 * (`backend/src/api/inventory.ts`, `backend/src/api/productUnits.ts`) the
 * real Settings/Inventory pages call.
 *
 * Covers:
 *   (a) the category `tracks_imei_units` flag round-trips over REST
 *       (POST/PUT/GET /api/inventory/categories*) — decision #9.
 *   (b) intake/duplicate/search/story parity: register two IMEIs, a
 *       duplicate re-registration is rejected with the named "already
 *       registered ... product" error (decision #3), a product search by
 *       IMEI finds the model (decision #2), and the walk-in story lookup
 *       reports a sale-less unit (decision #7).
 *   (c) the money path (rule 20 dual-transport): POST /api/sales/process
 *       with a `product_unit_id` marks the unit SOLD and stamps
 *       `sale_items.warranty_until`; POST /api/transactions/:id/refund with
 *       `refundUnitExtras` flips it back IN_STOCK with the defective flag +
 *       warranty override, nets the General USD drawer back to baseline,
 *       and the story lookup reports the OVERRIDE state — the SAME
 *       `TransactionRepository.refundTransaction` path the desktop IPC
 *       refund uses (rule 19).
 *
 * Rule 15: every row is matched by IDENTITY (the id the create call itself
 * returned, or a unique per-run product/IMEI/client marker) and every
 * money/stock number is a DELTA snapshotted immediately around its own
 * action — the DB accumulates across runs.
 *
 * NOTE — FIXED 2026-08-26 (was a deviation this spec documented as open):
 * the REST `POST /api/inventory/products` route used to pass `category`
 * straight through to `InventoryService.createProduct` without resolving
 * `category_id`, while the Electron IPC handler resolved it via
 * `catRepo.getOrCreate` — so a product created over REST never got
 * `tracks_imei_units` projected from its category. The resolution now lives
 * in `InventoryService` itself (`resolveCategoryId`) and BOTH transports go
 * through it; the two handler blocks that duplicated it are gone (rule
 * 14/19b). Test (a) below now asserts that projection over REST end-to-end.
 * Tests (b)/(c) still provision their products independently of the flagged
 * category on purpose: they key on `product_units` rows and registered-unit
 * counts, never on the category flag (which is a UI affordance gate — see
 * SalesRepository's strictness check and ProductRepository's scan/search
 * code), so they stay valid either way.
 */
import { test, expect, loginAsAdmin, BACKEND_URL } from "./fixtures";
import type { Page } from "@playwright/test";

interface ApiEnvelope {
  success: boolean;
  error?: string;
  [key: string]: unknown;
}

interface ProductUnitRow {
  id: number;
  product_id: number;
  imei: string;
  status: "IN_STOCK" | "SOLD";
  is_defective: number;
  warranty_override_until: string | null;
}

interface UnitStoryRow extends ProductUnitRow {
  product_name: string | null;
  warranty: {
    source: "OVERRIDE" | "REFUND" | "SALE" | null;
    until: string | null;
    state: "COVERED" | "EXPIRED" | "VOID" | "NONE";
  };
}

async function authHeaders(page: Page): Promise<Record<string, string>> {
  const token = await page.evaluate(() => localStorage.getItem("liratek.jwt"));
  if (!token) throw new Error("No JWT in localStorage after loginAsAdmin");
  return { Authorization: `Bearer ${token}` };
}

async function createProduct(
  page: Page,
  headers: Record<string, string>,
  data: {
    name: string;
    category?: string;
    cost_price_usd: number;
    retail_price_usd: number;
    stock: number;
    warranty_months?: number;
  },
): Promise<number> {
  const res = await (
    await page.request.post(`${BACKEND_URL}/api/inventory/products`, {
      headers,
      data: {
        category: "General",
        min_stock_threshold: 0,
        ...data,
      },
    })
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  const id = (res.data?.id ?? res.id) as number;
  expect(id).toBeTruthy();
  return id;
}

async function registerUnits(
  page: Page,
  headers: Record<string, string>,
  productId: number,
  imeis: string[],
): Promise<ApiEnvelope & { data?: { units: ProductUnitRow[] } }> {
  return (
    await page.request.post(`${BACKEND_URL}/api/product-units/register`, {
      headers,
      data: { product_id: productId, imeis },
    })
  ).json();
}

async function unitsForProduct(
  page: Page,
  headers: Record<string, string>,
  productId: number,
): Promise<ProductUnitRow[]> {
  const res = await (
    await page.request.get(
      `${BACKEND_URL}/api/product-units/for-product/${productId}`,
      { headers },
    )
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  return (res.data ?? []) as ProductUnitRow[];
}

async function storyFor(
  page: Page,
  headers: Record<string, string>,
  imei: string,
): Promise<UnitStoryRow[]> {
  const res = await (
    await page.request.get(
      `${BACKEND_URL}/api/product-units/story?imei=${encodeURIComponent(imei)}`,
      { headers },
    )
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  return (res.data ?? []) as UnitStoryRow[];
}

async function generalUsd(
  page: Page,
  headers: Record<string, string>,
): Promise<number> {
  const res = await (
    await page.request.get(`${BACKEND_URL}/api/dashboard/drawer-balances`, {
      headers,
    })
  ).json();
  expect(res.success, JSON.stringify(res)).toBeTruthy();
  return (res.balances as { generalDrawer: { usd: number } }).generalDrawer
    .usd;
}

test.describe("LIRA-143 — phone IMEI units & warranty over REST", () => {
  test("(a) category tracks_imei_units flag round-trips over REST", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const headers = await authHeaders(page);

    const categoryName = `L143-Web-Category-${Date.now()}`;
    const created = await (
      await page.request.post(`${BACKEND_URL}/api/inventory/categories`, {
        headers,
        data: { name: categoryName },
      })
    ).json();
    expect(created.success, JSON.stringify(created)).toBeTruthy();
    const categoryId = created.id as number;
    expect(categoryId).toBeTruthy();

    type CategoryFullRow = {
      id: number;
      name: string;
      tracks_imei_units: number;
    };
    const listBefore = await (
      await page.request.get(`${BACKEND_URL}/api/inventory/categories-full`, {
        headers,
      })
    ).json();
    expect(listBefore.success).toBeTruthy();
    const rowBefore = (listBefore.data as CategoryFullRow[]).find(
      (c) => c.id === categoryId,
    );
    expect(rowBefore?.tracks_imei_units).toBe(0);

    const updated = await (
      await page.request.put(
        `${BACKEND_URL}/api/inventory/categories/${categoryId}`,
        { headers, data: { tracks_imei_units: true } },
      )
    ).json();
    expect(updated.success, JSON.stringify(updated)).toBeTruthy();

    const listAfter = await (
      await page.request.get(`${BACKEND_URL}/api/inventory/categories-full`, {
        headers,
      })
    ).json();
    const rowAfter = (listAfter.data as CategoryFullRow[]).find(
      (c) => c.id === categoryId,
    );
    expect(rowAfter?.tracks_imei_units).toBe(1);

    // …and a product created over REST in that category inherits the flag:
    // `InventoryService.createProduct` resolves the category NAME to
    // `products.category_id`, which is what the product read COALESCEs
    // `tracks_imei_units` off (LIRA-143 decision #9). Before 2026-08-26 only
    // the IPC handler resolved it, so this projected 0 over REST — see the
    // fixed NOTE at the top of this file. Rule 15: the row is matched by the
    // id the create returned, never by position.
    const flaggedProductName = `L143-Web-FlaggedProduct-${Date.now()}`;
    const flaggedProductId = await createProduct(page, headers, {
      name: flaggedProductName,
      category: categoryName,
      cost_price_usd: 10,
      retail_price_usd: 20,
      stock: 1,
    });
    const productList = await (
      await page.request.get(
        `${BACKEND_URL}/api/inventory/products?search=${encodeURIComponent(flaggedProductName)}`,
        { headers },
      )
    ).json();
    expect(productList.success, JSON.stringify(productList)).toBeTruthy();
    const flaggedProduct = (
      productList.data.products as Array<{
        id: number;
        category: string;
        tracks_imei_units: number;
      }>
    ).find((p) => p.id === flaggedProductId);
    expect(flaggedProduct?.category).toBe(categoryName);
    expect(flaggedProduct?.tracks_imei_units).toBe(1);
  });

  test("(b) register/duplicate/search/story — product-units REST parity", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const headers = await authHeaders(page);

    const ts = Date.now();
    const productName = `L143-Web-Phone-${ts}`;
    const imei1 = `143${ts}b1`.replace(/\D/g, ""); // digits only, unique
    const imei2 = `143${ts}b2`.replace(/\D/g, "");

    const productId = await createProduct(page, headers, {
      name: productName,
      cost_price_usd: 50,
      retail_price_usd: 99.5,
      stock: 2,
      warranty_months: 3,
    });

    const registered = await registerUnits(page, headers, productId, [
      imei1,
      imei2,
    ]);
    expect(registered.success, JSON.stringify(registered)).toBeTruthy();
    expect(registered.data?.units.length).toBe(2);

    // Duplicate — still IN_STOCK — rejected with the named error (decision #3).
    const duplicate = await registerUnits(page, headers, productId, [imei1]);
    expect(duplicate.success).toBe(false);
    expect(duplicate.error ?? "").toContain(
      `IMEI ${imei1} is already registered in stock on product "${productName}"`,
    );

    // Search by IMEI finds the model (decision #2 — ProductRepository's
    // IMEI-join search fragment, shared by IPC and REST alike).
    const search = await (
      await page.request.get(
        `${BACKEND_URL}/api/inventory/products?search=${encodeURIComponent(imei1)}`,
        { headers },
      )
    ).json();
    expect(search.success, JSON.stringify(search)).toBeTruthy();
    const found = (
      search.data.products as Array<{ id: number; name: string }>
    ).find((p) => p.id === productId);
    expect(found?.name).toBe(productName);

    // Walk-in story lookup (decision #7) — a sale-less unit reports NONE.
    const story = await storyFor(page, headers, imei1);
    expect(story.length).toBeGreaterThan(0);
    const row = story.find((s) => s.product_id === productId);
    expect(row?.status).toBe("IN_STOCK");
    expect(row?.product_name).toBe(productName);
    expect(row?.warranty.state).toBe("NONE");
    expect(row?.warranty.until).toBeNull();
  });

  test("(c) scan-sell + refund nets unit state, stock, and warranty over REST (rule 20)", async ({
    page,
  }) => {
    await loginAsAdmin(page);
    const headers = await authHeaders(page);

    const ts = Date.now();
    const productName = `L143-Web-SellPhone-${ts}`;
    const imei = `143${ts}c1`.replace(/\D/g, "");
    const price = 88.77;
    const clientMarker = `L143-Web-Client-${ts}`;

    const productId = await createProduct(page, headers, {
      name: productName,
      cost_price_usd: 40,
      retail_price_usd: price,
      stock: 1,
      warranty_months: 4,
    });
    const registered = await registerUnits(page, headers, productId, [imei]);
    expect(registered.success, JSON.stringify(registered)).toBeTruthy();
    const unitId = registered.data!.units[0].id;

    const drawerBefore = await generalUsd(page, headers);

    // Scan-sell: the same saleProcessSchema/SalesService.processSale the
    // Electron IPC path uses (backend/src/api/sales.ts), with product_unit_id
    // set — the unit-tracked-line strictness/warranty-stamp path.
    const sale = await (
      await page.request.post(`${BACKEND_URL}/api/sales/process`, {
        headers,
        data: {
          client_id: null,
          client_name: clientMarker,
          items: [
            {
              product_id: productId,
              quantity: 1,
              price,
              imei,
              product_unit_id: unitId,
            },
          ],
          total_amount: price,
          discount: 0,
          final_amount: price,
          payment_usd: price,
          payment_lbp: 0,
          payments: [
            { method: "CASH", currency_code: "USD", amount: price, direction: "IN" },
          ],
          change_given_usd: 0,
          change_given_lbp: 0,
          exchange_rate: 90000,
          status: "completed",
        },
      })
    ).json();
    expect(sale.success, JSON.stringify(sale)).toBeTruthy();
    const saleId = sale.id as number;

    const unitsAfterSale = await unitsForProduct(page, headers, productId);
    const soldUnit = unitsAfterSale.find((u) => u.id === unitId);
    expect(soldUnit?.status).toBe("SOLD");

    const items = await (
      await page.request.get(`${BACKEND_URL}/api/sales/${saleId}/items`, {
        headers,
      })
    ).json();
    expect(items.success, JSON.stringify(items)).toBeTruthy();
    const saleItem = (
      items.items as Array<{
        product_id: number;
        imei: string | null;
        warranty_until: string | null;
      }>
    ).find((it) => it.product_id === productId);
    expect(saleItem?.imei).toBe(imei);
    expect(saleItem?.warranty_until).not.toBeNull();

    const drawerAfterSale = await generalUsd(page, headers);
    expect(drawerAfterSale - drawerBefore).toBeCloseTo(price, 2);

    // Refund with extras — the transaction id is resolved by SOURCE
    // identity (source_table + source_id), never row position.
    const bySource = await (
      await page.request.get(
        `${BACKEND_URL}/api/transactions/by-source/sales/${saleId}`,
        { headers },
      )
    ).json();
    expect(bySource.success, JSON.stringify(bySource)).toBeTruthy();
    const transactionId = (bySource.transaction as { id: number }).id;
    expect(transactionId).toBeTruthy();

    const overrideDate = new Date();
    overrideDate.setDate(overrideDate.getDate() + 45);
    const overrideDateIso = overrideDate.toISOString().slice(0, 10);

    const refund = await (
      await page.request.post(
        `${BACKEND_URL}/api/transactions/${transactionId}/refund`,
        {
          headers,
          data: {
            refundUnitExtras: [
              {
                unit_id: unitId,
                is_defective: true,
                warranty_override_until: overrideDateIso,
              },
            ],
          },
        },
      )
    ).json();
    expect(refund.success, JSON.stringify(refund)).toBeTruthy();

    const unitsAfterRefund = await unitsForProduct(page, headers, productId);
    const refundedUnit = unitsAfterRefund.find((u) => u.id === unitId);
    expect(refundedUnit?.status).toBe("IN_STOCK");
    expect(refundedUnit?.is_defective).toBe(1);
    expect(refundedUnit?.warranty_override_until).toBe(overrideDateIso);

    // Rule 20 dual-transport proof: the create+refund round trip nets the
    // ONE drawer this transaction ever touched back to its pre-sale value.
    const drawerAfterRefund = await generalUsd(page, headers);
    expect(drawerAfterRefund - drawerBefore).toBeCloseTo(0, 2);

    const storyAfterRefund = await storyFor(page, headers, imei);
    const storyRow = storyAfterRefund.find((s) => s.product_id === productId);
    expect(storyRow?.warranty.source).toBe("OVERRIDE");
    expect(storyRow?.warranty.state).toBe("COVERED");
    expect(storyRow?.warranty.until).toBe(overrideDateIso);
  });
});
