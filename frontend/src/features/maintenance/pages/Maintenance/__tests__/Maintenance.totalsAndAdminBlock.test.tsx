/**
 * Maintenance form — totals block + admin-only profit block (LIRA-176 phase
 * 8b, items 4/6).
 *
 * Item 4: a USD job shows labour, parts, and a single merged "$" total. An
 * LBP job shows labour in pounds and parts in dollars with NO conversion
 * and NO rate anywhere in the output — parts are always USD (owner
 * decision "option 4") and the display must never fabricate an exchange
 * rate to merge the two currencies into one figure.
 *
 * Item 6: the Profit block (labour margin + parts margin) renders only for
 * an admin session, never for staff — it would otherwise leak the shop's
 * cost/margin to a non-admin operator.
 */
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";
import Maintenance from "../index";

const mockGetMaintenanceJobs = jest.fn();
let mockRole: "admin" | "staff" = "admin";

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getMaintenanceJobs: mockGetMaintenanceJobs,
    saveMaintenanceJob: jest.fn().mockResolvedValue({ success: true }),
    deleteMaintenanceJob: jest.fn(),
    getMaintenanceStatusHistory: jest.fn().mockResolvedValue([]),
    getProducts: jest.fn().mockResolvedValue([]),
    getAllSettings: jest.fn().mockResolvedValue([]),
  }),
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({
    user: { id: 1, username: "u", role: mockRole },
  }),
}));

const PART = {
  id: 1,
  maintenance_id: 20,
  product_id: 5,
  product_name: "Screen Assembly",
  quantity: 1,
  unit_cost_usd: 25,
  unit_price_usd: 40,
  stock_restored: 0,
  created_at: "2026-09-01 10:00:00",
  updated_at: "2026-09-01 10:00:00",
};

describe("Maintenance — totals block", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Staff role: the admin-only Profit block (tested separately below)
    // also renders a "Total" row, which would collide with the totals
    // block's own "Total"/"Due" label under an ambiguous getByText query.
    mockRole = "staff";
  });

  it("USD job: shows Labour, Parts, and a single merged $ Total", async () => {
    mockGetMaintenanceJobs.mockResolvedValue([
      {
        id: 20,
        device_name: "USD Totals Job",
        issue_description: "Screen swap",
        status: "Received",
        currency: "USD",
        cost_usd: 10,
        price_usd: 100,
        paid_usd: 0,
        paid_lbp: 0,
        parts: [PART],
        parts_cost_usd: 25,
        parts_price_usd: 40,
      },
    ]);

    render(<Maintenance />);
    await waitFor(() => {
      expect(screen.getByText("USD Totals Job")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("USD Totals Job").closest("button")!);

    expect(await screen.findByText("Labour")).toBeInTheDocument();
    // "Parts" also labels PartPicker's category-toggle row — scope to the
    // totals block (data-testid="maintenance-totals-block" in index.tsx) so
    // this can only match the totals row's own "Parts" label.
    const totalsBlock = screen.getByTestId("maintenance-totals-block");
    expect(within(totalsBlock).getByText("Parts")).toBeInTheDocument();
    expect(screen.getByText("Total")).toBeInTheDocument();
    // Labour = $100.00, Parts = $40.00, Total = $140.00 (merged, single $).
    // "$140.00" also collides with the job-list row's own grand-total badge
    // (index.tsx ~line 868, `grandTotalLabel`) once the job's edit panel is
    // open alongside the list, so scope every figure to the totals block —
    // consistent with the "Parts" anchor above.
    expect(within(totalsBlock).getByText("$100.00")).toBeInTheDocument();
    expect(within(totalsBlock).getByText("$40.00")).toBeInTheDocument();
    expect(within(totalsBlock).getByText("$140.00")).toBeInTheDocument();
    // "Due" is the LBP-with-parts label only — must not appear for a USD job.
    expect(screen.queryByText("Due")).not.toBeInTheDocument();
  });

  it("LBP job with a part: labour in LBP, parts in USD, no conversion/rate", async () => {
    mockGetMaintenanceJobs.mockResolvedValue([
      {
        id: 21,
        device_name: "LBP Totals Job",
        issue_description: "Battery swap",
        status: "Received",
        currency: "LBP",
        cost_lbp: 100000,
        price_lbp: 500000,
        paid_usd: 0,
        paid_lbp: 0,
        parts: [PART],
        parts_cost_usd: 25,
        parts_price_usd: 40,
      },
    ]);

    render(<Maintenance />);
    await waitFor(() => {
      expect(screen.getByText("LBP Totals Job")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("LBP Totals Job").closest("button")!);

    expect(await screen.findByText("Labour")).toBeInTheDocument();
    // "Parts" also labels PartPicker's category-toggle row — scope to the
    // totals block (data-testid="maintenance-totals-block" in index.tsx) so
    // this can only match the totals row's own "Parts" label.
    const totalsBlock = screen.getByTestId("maintenance-totals-block");
    expect(within(totalsBlock).getByText("Parts")).toBeInTheDocument();
    // Labour figure in LBP, parts figure in USD — never merged into one
    // number, never converted at any rate.
    expect(screen.getByText("500,000 LBP")).toBeInTheDocument();
    expect(screen.getByText("$40.00")).toBeInTheDocument();
    // The combined row is labelled "Due" (not "Total") and reads
    // "<LBP> + $<USD>" — proving the two currencies are concatenated, not
    // converted into one.
    const dueRow = within(totalsBlock).getByText("Due").closest("div");
    expect(dueRow?.textContent).toContain("500,000 LBP");
    expect(dueRow?.textContent).toContain("$40.00");
    expect(dueRow?.textContent).toContain("+");

    // No exchange rate anywhere in the totals block's rendered text.
    expect(totalsBlock.textContent).not.toMatch(/rate/i);
  });
});

describe("Maintenance — admin-only profit block", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetMaintenanceJobs.mockResolvedValue([
      {
        id: 22,
        device_name: "Profit Job",
        issue_description: "Screen swap",
        status: "Delivered_Paid",
        currency: "USD",
        cost_usd: 10,
        price_usd: 100,
        paid_usd: 140,
        paid_lbp: 0,
        parts: [PART],
        parts_cost_usd: 25,
        parts_price_usd: 40,
      },
    ]);
  });

  it("renders the Profit block for an admin", async () => {
    mockRole = "admin";
    render(<Maintenance />);
    await waitFor(() => {
      expect(screen.getByText("Profit Job")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Profit Job").closest("button")!);

    expect(await screen.findByText("Profit")).toBeInTheDocument();
    expect(screen.getByText("Labour margin")).toBeInTheDocument();
    expect(screen.getByText("Parts margin")).toBeInTheDocument();
  });

  it("does NOT render the Profit block for a non-admin", async () => {
    mockRole = "staff";
    render(<Maintenance />);
    await waitFor(() => {
      expect(screen.getByText("Profit Job")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Profit Job").closest("button")!);

    // Give any async effects a tick before asserting absence.
    await waitFor(() => {
      expect(screen.queryByLabelText(/Price to Client/i)).toBeInTheDocument();
    });
    expect(screen.queryByText("Profit")).not.toBeInTheDocument();
    expect(screen.queryByText("Labour margin")).not.toBeInTheDocument();
    expect(screen.queryByText("Parts margin")).not.toBeInTheDocument();
  });
});
