/** @jest-environment jsdom */
/**
 * MobileServicesManager — TICKET B guard suite.
 *
 * Guards the specific over-promises named in the B ticket review:
 *   1. The view row surfaces Days cost / Days sell / Days margin, and the
 *      margin is exactly sell − cost (not re-derived some other way).
 *   2. All THREE split-badge states render on the right item shapes —
 *      "No split", "Split", and specifically "Split, no days price"
 *      (days_cost_lbp set, sell_days_lbp null): the state the ticket was
 *      opened to stop mis-labeling as either of the other two.
 *   3. The new-item form actually has the three Only-Days split inputs and
 *      they reach handleAddItem → api.createMobileServiceItem.
 *   4. The edit row's sort_order input actually changes sort_order end to
 *      end (state → handleSaveEdit → updateMobileServiceItem).
 *   5. The per-item economics block renders WITHOUT any hover interaction
 *      (the opacity-0/group-hover wrapper was removed).
 *
 * Rule 17 (failing-first) evidence for the state this ticket fixes:
 *   Pre-fix, `splitBadge` was a two-way ternary (`splitComplete ? "Split" :
 *   "No split"`) with no `hasDaysPrice` branch, so an item with
 *   days_cost_lbp set and sell_days_lbp null rendered "Split" — that is the
 *   over-promise. Re-running test (2) below against that two-way ternary:
 *     FAIL  MobileServicesManager.guardB.test.tsx
 *     ● all three split badge states render on the right item shapes
 *       expect(screen.queryByText('Split, no days price')).toBeInTheDocument()
 *       Unable to find an element with the text: Split, no days price
 *   Confirmed failing on the pre-fix two-way ternary, passing after the fix
 *   below, then the two-way ternary was reverted to the current three-way
 *   version.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import MobileServicesManager from "../MobileServicesManager";
import type { MobileServiceItem } from "@/types/electron";

// @liratek/core full index chains db imports that cannot resolve under jsdom.
// Real (not stubbed) implementations of the pure telecomCredit functions the
// component calls — mirrors telecomCredit.ts exactly, so assertions below are
// authoritative (same pattern as MobileServicesManager.splitEditor.test.tsx).
// Load the REAL core module. frontend/jest.config.ts maps @liratek/core to
// packages/core/src/browser.ts, which excludes the Node-only DB modules that
// once forced a hand-written mock here. Those hand-copied "faithful copies" of
// isTelecomSplitComplete / maxReturnableCredits were a rule-14 duplication:
// they let this suite agree with itself while drifting from production, and
// they broke as soon as the component imported one more core function.
jest.mock("@liratek/core", () => jest.requireActual("@liratek/core"));

const mockUpdateMobileServiceItem = jest.fn();
const mockCreateMobileServiceItem = jest.fn();
const mockGetAdminMobileServiceItems = jest.fn();
const mockGetAllSettings = jest.fn();
const mockApi = {
  getAdminMobileServiceItems: mockGetAdminMobileServiceItems,
  updateMobileServiceItem: mockUpdateMobileServiceItem,
  createMobileServiceItem: mockCreateMobileServiceItem,
  getAllSettings: mockGetAllSettings,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

// ── Fixtures ────────────────────────────────────────────────────────────
// Full split, WITH a days price → "Split" (emerald).
// margin = sell_days_lbp(1,200,000) - days_cost_lbp(1,162,000) = +38,000.
const ITEM_SPLIT_WITH_PRICE: MobileServiceItem = {
  id: 10,
  provider: "iPick",
  category: "mtc",
  subcategory: "Prepaid",
  label: "SplitFull",
  cost_lbp: 7_600_000,
  sell_lbp: 8_800_000,
  sort_order: 0,
  is_active: 1,
  validity_days: 90,
  credits: 77,
  days_cost_lbp: 1_162_000,
  sell_days_lbp: 1_200_000,
  sell_credit_lbp: 100_000,
  created_at: "2026-07-01 00:00:00",
  updated_at: "2026-07-01 00:00:00",
};

// Full cost/credits split, NO days price → the third state the ticket fixes:
// "Split, no days price" (amber) — must NOT read as "Split" or "No split".
const ITEM_SPLIT_NO_PRICE: MobileServiceItem = {
  id: 20,
  provider: "iPick",
  category: "mtc",
  subcategory: "Prepaid",
  label: "SplitNoPrice",
  cost_lbp: 3_000_000,
  sell_lbp: 3_500_000,
  sort_order: 1,
  is_active: 1,
  validity_days: 30,
  credits: 22.73,
  days_cost_lbp: 490_218,
  sell_days_lbp: null,
  sell_credit_lbp: null,
  created_at: "2026-07-01 00:00:00",
  updated_at: "2026-07-01 00:00:00",
};

// No split configured at all → "No split" (slate).
const ITEM_NO_SPLIT: MobileServiceItem = {
  id: 30,
  provider: "iPick",
  category: "mtc",
  subcategory: "Prepaid",
  label: "NoSplitAtAll",
  cost_lbp: 379_000,
  sell_lbp: 430_000,
  sort_order: 2,
  is_active: 1,
  validity_days: 10,
  credits: null,
  days_cost_lbp: null,
  sell_days_lbp: null,
  sell_credit_lbp: null,
  created_at: "2026-07-01 00:00:00",
  updated_at: "2026-07-01 00:00:00",
};

function setupWindowApi() {
  (window as unknown as { api: unknown }).api = {
    mobileServiceItems: {
      count: jest.fn().mockResolvedValue({ success: true, data: 3 }),
      seed: jest.fn(),
    },
  };
}

describe("MobileServicesManager — Ticket B guard", () => {
  beforeEach(() => {
    mockGetAdminMobileServiceItems
      .mockReset()
      .mockResolvedValue([
        ITEM_SPLIT_WITH_PRICE,
        ITEM_SPLIT_NO_PRICE,
        ITEM_NO_SPLIT,
      ]);
    mockUpdateMobileServiceItem.mockReset().mockResolvedValue({
      success: true,
      data: ITEM_SPLIT_WITH_PRICE,
    });
    mockCreateMobileServiceItem.mockReset().mockResolvedValue({
      success: true,
      data: ITEM_SPLIT_WITH_PRICE,
    });
    mockGetAllSettings.mockReset().mockResolvedValue([]);
    setupWindowApi();
  });

  afterEach(() => {
    delete (window as unknown as { api?: unknown }).api;
  });

  // ── (1) View row: days cost / days sell / days margin ──────────────────
  it("view row shows Days cost, Days sell and Days margin, and margin = sell - cost", async () => {
    render(<MobileServicesManager />);
    await screen.findByText("SplitFull");

    expect(screen.getByText("1,162,000")).toBeInTheDocument(); // Days cost
    expect(screen.getByText("1,200,000")).toBeInTheDocument(); // Days sell
    // daysMargin = 1,200,000 - 1,162,000 = 38,000, rendered with a leading "+"
    expect(screen.getByText("+38,000")).toBeInTheDocument();
  });

  it("shows '—' for Days sell/Days margin when the split has no days price", async () => {
    render(<MobileServicesManager />);
    await screen.findByText("SplitNoPrice");

    // Scope to this item's own row — three items are telecom candidates, so
    // unscoped getByText would match multiple "—" placeholders and multiple
    // "Days cost:" labels.
    const row = screen
      .getByText("SplitNoPrice")
      .closest(".flex.flex-col.px-3") as HTMLElement;
    expect(row).toBeTruthy();

    // ITEM_SPLIT_NO_PRICE: days_cost_lbp = 490,218 (real number) — present.
    expect(within(row).getByText("490,218")).toBeInTheDocument();
    // sell_days_lbp is null -> "Days sell:" shows the dash, never 0 or a
    // stale number borrowed from another item.
    // Margin has no sell_days_lbp to subtract from -> also renders "—".
    const dashes = within(row).getAllByText("—");
    expect(dashes.length).toBeGreaterThanOrEqual(2); // Days sell + Days margin
  });

  // ── (2) All three badge states ──────────────────────────────────────────
  it("all three split badge states render on the right item shapes", async () => {
    render(<MobileServicesManager />);
    await screen.findByText("SplitFull");

    // "Split" — complete split AND a days price.
    expect(screen.getByText("Split")).toBeInTheDocument();
    // "Split, no days price" — complete cost/credits split, no sell_days_lbp.
    // This is the over-promise the ticket exists to fix: without the
    // hasDaysPrice branch this item would incorrectly read "Split".
    expect(screen.getByText("Split, no days price")).toBeInTheDocument();
    // "No split" — nothing configured.
    expect(screen.getByText("No split")).toBeInTheDocument();
  });

  // ── (3) New-item form: split inputs exist and reach handleAddItem ──────
  it("new-item form's Only-Days split inputs reach handleAddItem/createMobileServiceItem", async () => {
    render(<MobileServicesManager />);
    await screen.findByText("SplitFull");

    // Open the new-item form via the subcategory's "Add item" (+) button.
    const addItemBtns = screen.getAllByTitle("Add item");
    fireEvent.click(addItemBtns[0]);

    // Required base fields.
    fireEvent.change(screen.getByPlaceholderText("e.g. 60UC, 3.6"), {
      target: { value: "NewSplitItem" },
    });

    // Locate the three Only-Days split inputs by their preceding label text
    // (the component pairs a <label> with a sibling <input>, no htmlFor/id).
    const daysCostLabel = screen.getByText("Days cost (LBP)");
    const sellDaysLabel = screen.getByText("Sell days (LBP)");
    const sellCreditLabel = screen.getByText("Sell credit (LBP)");
    const daysCostInput = daysCostLabel.parentElement!.querySelector(
      "input",
    ) as HTMLInputElement;
    const sellDaysInput = sellDaysLabel.parentElement!.querySelector(
      "input",
    ) as HTMLInputElement;
    const sellCreditInput = sellCreditLabel.parentElement!.querySelector(
      "input",
    ) as HTMLInputElement;
    expect(daysCostInput).toBeTruthy();
    expect(sellDaysInput).toBeTruthy();
    expect(sellCreditInput).toBeTruthy();

    // Fill base cost/sell too (required by handleAddItem's guard clause).
    const costLabel = screen.getByText("Cost (LBP)");
    const sellLabel = screen.getByText("Sell (LBP)");
    const costFieldInput = costLabel.parentElement!.querySelector(
      "input",
    ) as HTMLInputElement;
    const sellFieldInput = sellLabel.parentElement!.querySelector(
      "input",
    ) as HTMLInputElement;
    fireEvent.change(costFieldInput, { target: { value: "1000000" } });
    fireEvent.change(sellFieldInput, { target: { value: "1200000" } });
    fireEvent.change(daysCostInput, { target: { value: "150000" } });
    fireEvent.change(sellDaysInput, { target: { value: "180000" } });
    fireEvent.change(sellCreditInput, { target: { value: "100000" } });

    fireEvent.click(screen.getByText("Add"));

    await waitFor(() =>
      expect(mockCreateMobileServiceItem).toHaveBeenCalledWith(
        expect.objectContaining({
          label: "NewSplitItem",
          days_cost_lbp: 150000,
          sell_days_lbp: 180000,
          sell_credit_lbp: 100000,
        }),
      ),
    );
  });

  // ── (4) Edit row: sort_order is editable end to end ─────────────────────
  it("edit row changes sort_order through updateMobileServiceItem", async () => {
    render(<MobileServicesManager />);
    await screen.findByText("SplitFull");

    const editBtns = screen.getAllByTitle("Edit");
    // First edit button corresponds to ITEM_SPLIT_WITH_PRICE (sort_order 0).
    fireEvent.click(editBtns[0]);

    const sortOrderInput = screen.getByDisplayValue("0") as HTMLInputElement;
    fireEvent.change(sortOrderInput, { target: { value: "9" } });

    fireEvent.click(screen.getByLabelText("Save item"));

    await waitFor(() =>
      expect(mockUpdateMobileServiceItem).toHaveBeenCalledWith(
        10,
        expect.objectContaining({ sort_order: 9 }),
      ),
    );
  });

  // ── (5) Economics render without any hover interaction ─────────────────
  it("renders the per-item economics block without firing a hover event", async () => {
    render(<MobileServicesManager />);
    await screen.findByText("SplitFull");

    // Scope to the SplitFull row — all three fixtures are telecom
    // candidates, so each label appears multiple times unscoped.
    const row = screen
      .getByText("SplitFull")
      .closest(".flex.flex-col.px-3") as HTMLElement;
    expect(row).toBeTruthy();

    // No fireEvent.mouseEnter/mouseOver anywhere in this test — if the block
    // were still gated behind group-hover (opacity-0 by default, revealed
    // only via a hover CSS rule this test cannot trigger), a *behavioral*
    // regression back to a conditional-render guard would hide these nodes
    // from the DOM entirely, which this assertion would catch.
    expect(within(row).getByText(/Days cost:/)).toBeInTheDocument();
    expect(within(row).getByText(/Days sell:/)).toBeInTheDocument();
    expect(within(row).getByText(/Days margin:/)).toBeInTheDocument();
    expect(within(row).getByText(/Credit cost:/)).toBeInTheDocument();
    expect(within(row).getByText(/Recovered:/)).toBeInTheDocument();
    expect(within(row).getByText(/Rate\/\$:/)).toBeInTheDocument();
    expect(within(row).getByText(/Sell credit:/)).toBeInTheDocument();
  });
});
