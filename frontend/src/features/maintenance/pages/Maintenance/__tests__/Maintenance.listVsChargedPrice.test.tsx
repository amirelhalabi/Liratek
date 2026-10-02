/**
 * LIRA-185 D6 (owner decision 2026-10-02) — list price vs amount charged.
 *
 * The reports already book a discounted maintenance job at its FINAL amount,
 * but the jobs list and the History window only ever showed the list price,
 * so a job discounted 300,000 → 250,000 LBP read as 300,000 on the page and
 * 250,000 in Profits. Both surfaces now show the list price struck through
 * next to the amount actually charged — and ONLY when they differ.
 *
 * Stored-shape facts these fixtures rely on (MaintenanceService.saveJob):
 *   - USD job: `final_amount_usd` = labour final + `parts_price_usd`
 *     (parts are folded in); `price_usd` is labour-only.
 *   - LBP job: `final_amount_lbp` = labour final; parts ride in USD.
 *   - A draft/unpaid job carries final = price (no discount exists before
 *     checkout), so only Delivered/Delivered_Paid jobs are compared.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import Maintenance from "../index";
import { HistoryModal } from "../components/HistoryModal";

const mockGetMaintenanceJobs = jest.fn();

// Rule 25: ONE stable object, so `api` identity never churns between renders.
const mockApi = {
  getMaintenanceJobs: mockGetMaintenanceJobs,
  saveMaintenanceJob: jest.fn(),
  deleteMaintenanceJob: jest.fn(),
  getMaintenanceStatusHistory: jest.fn().mockResolvedValue([]),
  getProducts: jest.fn().mockResolvedValue([]),
  getAllSettings: jest.fn().mockResolvedValue([]),
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "staff", role: "staff" } }),
  useOptionalAuth: () => null,
}));

const JOBS = [
  {
    id: 1,
    device_name: "Discounted LBP Phone",
    issue_description: "Screen",
    status: "Delivered_Paid",
    currency: "LBP",
    price_lbp: 300000,
    final_amount_lbp: 250000,
    final_amount_usd: 0,
    paid_lbp: 250000,
  },
  {
    id: 2,
    device_name: "Discounted USD Phone",
    issue_description: "Battery",
    status: "Delivered_Paid",
    currency: "USD",
    price_usd: 40,
    // labour 40 discounted to 30, plus $5 of parts folded in → 35
    parts_price_usd: 5,
    final_amount_usd: 35,
    paid_usd: 35,
  },
  {
    id: 3,
    device_name: "Full Price Phone",
    issue_description: "Port",
    status: "Delivered_Paid",
    currency: "USD",
    price_usd: 20,
    final_amount_usd: 20,
    paid_usd: 20,
  },
  {
    id: 4,
    device_name: "Draft Phone",
    issue_description: "Speaker",
    status: "Received",
    currency: "USD",
    price_usd: 60,
    // Stale/odd final on an unpaid job must NOT produce a strike-through.
    final_amount_usd: 0,
  },
];

function struck(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll("s")).map((s) => s.textContent ?? "");
}

describe("Maintenance jobs list — list price vs amount charged", () => {
  beforeEach(() => {
    mockGetMaintenanceJobs.mockReset();
    mockGetMaintenanceJobs.mockResolvedValue(JOBS);
  });

  async function rowOf(name: string): Promise<HTMLElement> {
    await waitFor(() => expect(screen.getByText(name)).toBeInTheDocument());
    const row = screen.getByText(name).closest("button");
    if (!row) throw new Error(`no row for ${name}`);
    return row as HTMLElement;
  }

  it("discounted LBP job shows the list price struck through next to the final amount", async () => {
    render(<Maintenance />);
    // Default tab is "All", so every fixture job is listed.
    const row = await rowOf("Discounted LBP Phone");
    expect(struck(row)).toEqual(["300,000 LBP"]);
    expect(row.textContent).toContain("250,000 LBP");
  });

  it("discounted USD job with parts compares list+parts against charged", async () => {
    render(<Maintenance />);
    const row = await rowOf("Discounted USD Phone");
    expect(struck(row)).toEqual(["$45.00"]);
    expect(row.textContent).toContain("$35.00");
  });

  it("undiscounted and unpaid jobs render a single amount, no strike-through", async () => {
    render(<Maintenance />);
    const full = await rowOf("Full Price Phone");
    expect(struck(full)).toEqual([]);
    expect(full.textContent).toContain("$20.00");

    const draft = await rowOf("Draft Phone");
    expect(struck(draft)).toEqual([]);
    expect(draft.textContent).toContain("$60.00");
  });
});

describe("Maintenance History window — list price vs amount charged", () => {
  function renderHistory() {
    render(
      <HistoryModal
        jobs={JOBS}
        loading={false}
        onClose={jest.fn()}
        onRefresh={jest.fn()}
        onVoid={jest.fn()}
        onEdit={jest.fn()}
      />,
    );
  }

  function historyRow(name: string): HTMLElement {
    const row = screen.getByText(name).closest("tr");
    if (!row) throw new Error(`no history row for ${name}`);
    return row as HTMLElement;
  }

  it("discounted jobs show list struck through and the final labour amount", () => {
    renderHistory();
    const lbp = historyRow("Discounted LBP Phone");
    expect(struck(lbp)).toEqual(["300,000 LBP"]);
    expect(within(lbp).getAllByText(/250,000 LBP/).length).toBeGreaterThan(0);

    // History's Price column is labour-only: list $40.00 → charged $30.00
    const usd = historyRow("Discounted USD Phone");
    expect(struck(usd)).toEqual(["$40.00"]);
    expect(usd.textContent).toContain("$30.00");
  });

  it("undiscounted and unpaid jobs render one value with no strike-through", () => {
    renderHistory();
    expect(struck(historyRow("Full Price Phone"))).toEqual([]);
    expect(struck(historyRow("Draft Phone"))).toEqual([]);
    expect(historyRow("Draft Phone").textContent).toContain("$60.00");
  });
});
