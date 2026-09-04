/** @jest-environment jsdom */
/**
 * LIRA-143 owner item #7 — the product-delete confirm must DISCLOSE the
 * registered IN_STOCK IMEIs that the delete cascade will also remove, before
 * the operator confirms. The message COPY is covered exhaustively in
 * `features/inventory/__tests__/productUnitsLogic.test.ts`
 * (`buildUnitDeleteWarning`); this file covers the wiring the copy depends on:
 *
 *   1. the units are read (`productUnits.getForProduct(id, "IN_STOCK")`)
 *      BEFORE the delete call, per product being deleted,
 *   2. the dialog renders the disclosure it got back,
 *   3. a product with no units keeps EXACTLY today's dialog,
 *   4. the batch dialog probes every selected product,
 *   5. the delete itself is unchanged — this informs, it never blocks.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { appEvents } from "@liratek/ui";
import type { Product } from "@liratek/ui";
import ProductList from "../ProductList";

const mockGetProducts = jest.fn();
const mockGetFilterOptions = jest.fn();
const mockDeleteProduct = jest.fn();
const mockBatchDeleteProducts = jest.fn();
const mockGetForProduct = jest.fn();
const mockNavigate = jest.fn();

jest.mock("react-router-dom", () => ({
  ...jest.requireActual("react-router-dom"),
  useNavigate: () => mockNavigate,
}));

/**
 * ONE stable object, not a fresh literal per `useApi()` call: ProductList's
 * `loadProducts` is a `useCallback` keyed on `api`, and its debounce effect is
 * keyed on that callback — a new api identity per render makes the effect
 * re-arm forever and the list never settles.
 */
const mockApi = {
  getProducts: mockGetProducts,
  getProductFilterOptions: mockGetFilterOptions,
  deleteProduct: mockDeleteProduct,
  batchDeleteProducts: mockBatchDeleteProducts,
  createProduct: jest.fn(),
  productUnits: { getForProduct: mockGetForProduct },
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

// The walk-in IMEI lookup card is a sibling feature of the search box and is
// not under test here; its query would otherwise need its own api stub.
jest.mock("../../../hooks/useProductUnits", () => ({
  ...jest.requireActual("../../../hooks/useProductUnits"),
  useUnitStoryQuery: () => ({ data: [] }),
}));

function product(overrides: Partial<Product> = {}): Product {
  return {
    id: 1,
    barcode: "P-0001",
    name: "iPhone 15 Pro",
    category: "Phones",
    cost_price: 700,
    retail_price: 999,
    stock_quantity: 3,
    min_stock_level: 1,
    tracks_imei_units: 1,
    warranty_months: 6,
    created_at: "2026-08-01 10:00:00",
    updated_at: "2026-08-01 10:00:00",
    ...overrides,
  } as unknown as Product;
}

/** Render and wait out the list's 300ms search/filter debounce. */
async function renderList(products: Product[]) {
  mockGetProducts.mockResolvedValue(products);
  const view = render(<ProductList />);
  for (const p of products) {
    await screen.findByText(p.name, undefined, { timeout: 3000 });
  }
  return view;
}

function confirmMessage(): string {
  return screen.getByTestId("confirm-modal").textContent ?? "";
}

/** Let any pending promise .then/.catch chain (e.g. a just-resolved probe
 *  working its way through `probeInStockUnits` → `requestDelete`) settle,
 *  and its resulting state update commit, before asserting nothing changed. */
async function flushMicrotasks() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetFilterOptions.mockResolvedValue({ categories: [], suppliers: [] });
  mockGetForProduct.mockResolvedValue([]);
  mockDeleteProduct.mockResolvedValue({ success: true });
  mockBatchDeleteProducts.mockResolvedValue({ success: true, deleted: 2 });
  localStorage.clear();
});

describe("ProductList delete confirm — IMEI disclosure", () => {
  it("reads the product's IN_STOCK units and lists them in the dialog", async () => {
    await renderList([product({ id: 42, name: "iPhone 15 Pro" })]);
    mockGetForProduct.mockResolvedValue([
      { id: 1, imei: "111111111111111" },
      { id: 2, imei: "222222222222222" },
    ]);

    fireEvent.click(screen.getByTestId("inventory-delete-42"));

    // IN_STOCK only — a SOLD unit is history, not something the delete removes
    // from the shelf, and the backend cascade is what actually acts on them.
    await waitFor(() =>
      expect(mockGetForProduct).toHaveBeenCalledWith(42, "IN_STOCK"),
    );
    await waitFor(() =>
      expect(confirmMessage()).toContain(
        "also removes 2 registered in-stock IMEIs",
      ),
    );
    expect(confirmMessage()).toContain("111111111111111");
    expect(confirmMessage()).toContain("222222222222222");
    // The original warning is still there — the disclosure is additive.
    expect(confirmMessage()).toContain("cannot be undone");
    // Nothing was deleted by opening the dialog.
    expect(mockDeleteProduct).not.toHaveBeenCalled();
  });

  it("keeps today's dialog verbatim for a product with no registered units", async () => {
    await renderList([product({ id: 7, name: "Milk 1L" })]);
    mockGetForProduct.mockResolvedValue([]);

    fireEvent.click(screen.getByTestId("inventory-delete-7"));

    await waitFor(() => expect(mockGetForProduct).toHaveBeenCalled());
    await waitFor(() =>
      expect(screen.getByTestId("confirm-modal-confirm-btn")).toHaveTextContent(
        "Confirm",
      ),
    );
    expect(confirmMessage()).toContain(
      "Are you sure you want to delete this product?",
    );
    expect(confirmMessage()).not.toContain("in-stock IMEI");
  });

  it("still deletes on confirm — the dialog informs, it never blocks", async () => {
    await renderList([product({ id: 42 })]);
    mockGetForProduct.mockResolvedValue([{ id: 1, imei: "111111111111111" }]);

    fireEvent.click(screen.getByTestId("inventory-delete-42"));
    await waitFor(() => expect(confirmMessage()).toContain("111111111111111"));

    fireEvent.click(screen.getByTestId("confirm-modal-confirm-btn"));
    await waitFor(() => expect(mockDeleteProduct).toHaveBeenCalledWith(42));
  });

  it("discloses a FAILED unit read rather than implying there are none", async () => {
    await renderList([product({ id: 42 })]);
    mockGetForProduct.mockRejectedValue(new Error("IPC failed"));

    fireEvent.click(screen.getByTestId("inventory-delete-42"));

    await waitFor(() =>
      expect(confirmMessage()).toContain("could not be checked"),
    );
  });

  it("closing the dialog clears the disclosure so the next one starts clean", async () => {
    await renderList([
      product({ id: 42, name: "iPhone 15 Pro" }),
      product({ id: 7, name: "Milk 1L", tracks_imei_units: 0 }),
    ]);
    mockGetForProduct.mockResolvedValue([{ id: 1, imei: "111111111111111" }]);

    fireEvent.click(screen.getByTestId("inventory-delete-42"));
    await waitFor(() => expect(confirmMessage()).toContain("111111111111111"));
    fireEvent.click(screen.getByTestId("confirm-modal-cancel-btn"));

    mockGetForProduct.mockResolvedValue([]);
    fireEvent.click(screen.getByTestId("inventory-delete-7"));
    await waitFor(() =>
      expect(mockGetForProduct).toHaveBeenLastCalledWith(7, "IN_STOCK"),
    );
    await waitFor(() =>
      expect(confirmMessage()).not.toContain("111111111111111"),
    );
  });

  it("probes EVERY selected product for the batch dialog, flag or not", async () => {
    // `tracks_imei_units` is inherited from the CATEGORY, so a re-categorised
    // product can still hold units — the batch dialog must not skip it.
    await renderList([
      product({ id: 42, name: "iPhone 15 Pro", tracks_imei_units: 1 }),
      product({ id: 7, name: "Milk 1L", tracks_imei_units: 0 }),
    ]);
    mockGetForProduct.mockImplementation(async (id: number) =>
      id === 42
        ? [
            { id: 1, imei: "111111111111111" },
            { id: 2, imei: "222222222222222" },
          ]
        : [{ id: 3, imei: "333333333333333" }],
    );

    // Select both rows, then open the batch delete confirm.
    fireEvent.click(
      screen.getByLabelText("Delete iPhone 15 Pro").closest("tr")!,
    );
    fireEvent.click(screen.getByLabelText("Delete Milk 1L").closest("tr")!);
    fireEvent.click(await screen.findByTestId("inventory-batch-delete"));

    await waitFor(() => expect(mockGetForProduct).toHaveBeenCalledTimes(2));
    expect(mockGetForProduct).toHaveBeenCalledWith(42, "IN_STOCK");
    expect(mockGetForProduct).toHaveBeenCalledWith(7, "IN_STOCK");

    await waitFor(() =>
      expect(confirmMessage()).toContain(
        "also removes 3 registered in-stock IMEIs across 2 products",
      ),
    );
    expect(confirmMessage()).toContain("iPhone 15 Pro (2)");
    expect(confirmMessage()).toContain("Milk 1L (1)");
  });
});

/**
 * LIRA-149 — `handleBatchDelete` used to gate on raw `window.api` truthiness
 * (`window.api ? await (window.api as any).inventory.batchDelete(ids) :
 * null`), which is falsy in the browser. There `result` stayed `null`, the
 * `if (result && !result.success)` failure guard could never fire, and the
 * notification fell back to `ids.length` — reporting products "deleted" that
 * were never touched (bug (a) in the ticket). `handleBatchDelete` now calls
 * `useApi().batchDeleteProducts(ids)`, which routes through IPC or REST on
 * BOTH transports (rule 19), so `result` is always the real outcome.
 *
 * These two cases would have been unreachable/wrong on the pre-fix code:
 * `window.api` is undefined in this jsdom unit-test environment (no Electron
 * preload bridge), so the OLD code always took the `null` branch — the
 * mocked `batchDeleteProducts` would never even have been called, and the
 * notification would always read "2 products deleted" (ids.length) no
 * matter what the mock returns. Proven failing pre-fix (rule 17): see the
 * ticket report for the captured output of reverting `handleBatchDelete` to
 * the raw `window.api` gate and re-running this describe block.
 */
describe("ProductList batch delete — dual-transport result handling (LIRA-149)", () => {
  async function selectAndOpenBatchDeleteConfirm() {
    await renderList([
      product({ id: 42, name: "iPhone 15 Pro" }),
      product({ id: 7, name: "Milk 1L" }),
    ]);
    fireEvent.click(
      screen.getByLabelText("Delete iPhone 15 Pro").closest("tr")!,
    );
    fireEvent.click(screen.getByLabelText("Delete Milk 1L").closest("tr")!);
    fireEvent.click(await screen.findByTestId("inventory-batch-delete"));
    // The unit-check runs first (confirmLabel reads "Checking…" — see the
    // file-level docblock's point 5); wait it out so the click below lands
    // on the real "Confirm" state, same pattern as the IMEI-disclosure tests
    // above.
    await waitFor(() =>
      expect(screen.getByTestId("confirm-modal-confirm-btn")).toHaveTextContent(
        "Confirm",
      ),
    );
  }

  it("reports the ACTUAL deleted count from the API result, not ids.length", async () => {
    // 2 products selected, but the backend only actually deleted 1 (e.g. one
    // id was already gone) — the notification must reflect THAT, not the
    // selection size. The pre-fix code could never even reach this branch in
    // this test environment (see the file-level comment above).
    mockBatchDeleteProducts.mockResolvedValue({ success: true, deleted: 1 });
    const emitSpy = jest.spyOn(appEvents, "emit");

    await selectAndOpenBatchDeleteConfirm();
    fireEvent.click(screen.getByTestId("confirm-modal-confirm-btn"));

    await waitFor(() =>
      expect(mockBatchDeleteProducts).toHaveBeenCalledWith([42, 7]),
    );
    await waitFor(() =>
      expect(emitSpy).toHaveBeenCalledWith(
        "notification:show",
        "1 product deleted",
        "success",
      ),
    );
  });

  it("surfaces a batch-delete failure as an error — never a false success", async () => {
    mockBatchDeleteProducts.mockResolvedValue({
      success: false,
      error: "Batch delete failed: db locked",
    });
    const emitSpy = jest.spyOn(appEvents, "emit");

    await selectAndOpenBatchDeleteConfirm();
    fireEvent.click(screen.getByTestId("confirm-modal-confirm-btn"));

    await waitFor(() =>
      expect(emitSpy).toHaveBeenCalledWith(
        "notification:show",
        "Batch delete failed: db locked",
        "error",
      ),
    );
    // Never the false "N products deleted" success this ticket's bug (a) shipped.
    expect(emitSpy).not.toHaveBeenCalledWith(
      "notification:show",
      expect.stringContaining("deleted"),
      "success",
    );
  });
});

/**
 * LIRA-150 — the IN_STOCK-unit probe behind the delete-confirm disclosure is
 * fired async (`probeInStockUnits`, awaited inside `requestDelete`/
 * `requestBatchDelete`) with no request-id/abort/in-flight guard until this
 * fix. Clicking product A's delete and then quickly product B's could let
 * A's probe — if it happens to resolve AFTER B's — overwrite the dialog with
 * A's IMEIs while B's destructive confirm is on screen: the operator would
 * be confirming a delete against the WRONG disclosure. The fix is a shared
 * `deleteProbeToken` ref bumped on every `requestDelete`/`requestBatchDelete`
 * call; only the probe whose token still matches the ref when it resolves is
 * allowed to touch state.
 *
 * This test proves the fix the rule-17 way: it deliberately resolves the
 * EARLIER click's (A's) fetch AFTER the LATER click's (B's) fetch — the
 * exact inversion the bug depended on — and asserts the dialog shows only
 * B's IMEI, never A's, at any point.
 */
describe("ProductList delete confirm — stale-probe guard (LIRA-150)", () => {
  it("never lets an earlier product's IMEI probe overwrite a later product's dialog", async () => {
    await renderList([
      product({ id: 42, name: "iPhone 15 Pro" }),
      product({ id: 7, name: "Galaxy S24" }),
    ]);

    // Deferred promises: we control exactly when each product's fetch
    // resolves, independent of click order.
    let resolveA!: (units: Array<{ id: number; imei: string }>) => void;
    let resolveB!: (units: Array<{ id: number; imei: string }>) => void;
    const promiseA = new Promise<Array<{ id: number; imei: string }>>(
      (resolve) => {
        resolveA = resolve;
      },
    );
    const promiseB = new Promise<Array<{ id: number; imei: string }>>(
      (resolve) => {
        resolveB = resolve;
      },
    );
    mockGetForProduct.mockImplementation(async (id: number) =>
      id === 42 ? promiseA : promiseB,
    );

    // Click A's delete, then — before A's fetch has resolved — click B's.
    fireEvent.click(screen.getByTestId("inventory-delete-42"));
    await waitFor(() =>
      expect(mockGetForProduct).toHaveBeenCalledWith(42, "IN_STOCK"),
    );

    fireEvent.click(screen.getByTestId("inventory-delete-7"));
    await waitFor(() =>
      expect(mockGetForProduct).toHaveBeenCalledWith(7, "IN_STOCK"),
    );

    // Resolve in INVERTED order: B (the later click) lands first, A (now
    // stale) lands last — the interleaving that overwrites the dialog on
    // the pre-fix code.
    await act(async () => {
      resolveB([{ id: 3, imei: "222222222222222" }]);
      await promiseB;
    });
    await waitFor(() =>
      expect(confirmMessage()).toContain("222222222222222"),
    );
    // Never assert only the positive — a version that renders BOTH products'
    // IMEIs would still pass a "B is present" check. Assert A's is absent.
    expect(confirmMessage()).not.toContain("111111111111111");
    expect(screen.getByTestId("confirm-modal-confirm-btn")).toHaveTextContent(
      "Confirm",
    );

    // Now let A's stale probe land.
    await act(async () => {
      resolveA([{ id: 1, imei: "111111111111111" }]);
      await promiseA;
    });
    await flushMicrotasks();

    // The dialog must still show only B's disclosure — A's stale result
    // must never have reached state.
    expect(confirmMessage()).toContain("222222222222222");
    expect(confirmMessage()).not.toContain("111111111111111");
    // And the superseded probe's `finally` must not have re-armed
    // "Checking…" for a request that already finished.
    expect(screen.getByTestId("confirm-modal-confirm-btn")).toHaveTextContent(
      "Confirm",
    );
  });
});
