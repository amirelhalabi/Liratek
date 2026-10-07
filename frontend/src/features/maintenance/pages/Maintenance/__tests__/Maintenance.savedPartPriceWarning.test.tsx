/**
 * LIRA-260 follow-up — the parts price-change warning on a SAVED job.
 *
 * A part line loaded from a saved job used to carry no catalog price, so the
 * amber `PriceChangeWarning` never showed for it. The jobs read now returns
 * each part's product `retail_price` as `catalog_price_usd`; reopening the
 * job must map it into the PartPicker line so a part whose saved price
 * differs from the catalog shows both prices — and the save payload must
 * still NOT carry it (`toPartsPayload` whitelists backend fields).
 *
 * The `useApi` mock returns a fresh object literal per call on purpose
 * (CLAUDE.md rule 25).
 *
 * Rule 17: written before the `handleEdit` mapping change and run against
 * the unfixed code — the warning test failed (no `price-change-warning`).
 */
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Maintenance from "../index";

const mockGetMaintenanceJobs = jest.fn();
const mockSaveMaintenanceJob = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getMaintenanceJobs: mockGetMaintenanceJobs,
    saveMaintenanceJob: mockSaveMaintenanceJob,
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
  useAuth: () => ({ user: { id: 1, username: "staff", role: "staff" } }),
}));

function savedJob(partOverrides: Record<string, unknown>) {
  return {
    id: 21,
    device_name: "Saved Job With Part",
    issue_description: "Battery swap",
    status: "Received",
    currency: "USD",
    cost_usd: 5,
    price_usd: 60,
    paid_usd: 0,
    paid_lbp: 0,
    parts: [
      {
        id: 7,
        maintenance_id: 21,
        product_id: 9,
        product_name: "Battery",
        quantity: 1,
        unit_cost_usd: 8,
        unit_price_usd: 15,
        stock_restored: 0,
        created_at: "2026-09-01 10:00:00",
        updated_at: "2026-09-01 10:00:00",
        ...partOverrides,
      },
    ],
  };
}

async function reopen() {
  render(<Maintenance />);
  await waitFor(() => {
    expect(screen.getByText("Saved Job With Part")).toBeInTheDocument();
  });
  fireEvent.click(screen.getByText("Saved Job With Part").closest("button")!);
}

describe("Maintenance — price warning on a saved job's parts (LIRA-260)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveMaintenanceJob.mockResolvedValue({ success: true, id: 21 });
  });

  it("reopening a job whose part price differs from the product price shows both prices", async () => {
    mockGetMaintenanceJobs.mockResolvedValue([
      savedJob({ catalog_price_usd: 20 }),
    ]);
    await reopen();

    const warning = await screen.findByTestId("price-change-warning");
    expect(warning).toHaveTextContent("$20.00");
    expect(warning).toHaveTextContent("$15.00");
  });

  it("no warning when the saved part price equals the product price", async () => {
    mockGetMaintenanceJobs.mockResolvedValue([
      savedJob({ catalog_price_usd: 15 }),
    ]);
    await reopen();

    expect(screen.getByDisplayValue("15")).toBeInTheDocument();
    expect(screen.queryByTestId("price-change-warning")).toBeNull();
  });

  it("no warning when the product no longer exists (catalog price null)", async () => {
    mockGetMaintenanceJobs.mockResolvedValue([
      savedJob({ catalog_price_usd: null }),
    ]);
    await reopen();

    expect(screen.getByDisplayValue("15")).toBeInTheDocument();
    expect(screen.queryByTestId("price-change-warning")).toBeNull();
  });

  it("the catalog price is never sent back on save", async () => {
    mockGetMaintenanceJobs.mockResolvedValue([
      savedJob({ catalog_price_usd: 20 }),
    ]);
    await reopen();

    fireEvent.click(screen.getByText("Save as Draft"));
    await waitFor(() => {
      expect(mockSaveMaintenanceJob).toHaveBeenCalledTimes(1);
    });
    expect(mockSaveMaintenanceJob.mock.calls[0][0].parts).toEqual([
      { id: 7, product_id: 9, quantity: 1, unit_price_usd: 15 },
    ]);
  });
});
