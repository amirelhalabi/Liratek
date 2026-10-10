/** @jest-environment jsdom */
/**
 * LIRA-296 P3 (T052, US8) — the warranty report (admin): items still under
 * warranty by category, and claims in the chosen period with their cost to
 * the shop and to suppliers. "Today" is the browser's own day (rule 27).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { WarrantyReport } from "../WarrantyReport";

const api = { getWarrantyReport: jest.fn() };
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => api,
}));

const pad = (n: number) => String(n).padStart(2, "0");
const d = new Date();
const TODAY = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const MONTH_START = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;

beforeEach(() => {
  jest.clearAllMocks();
  api.getWarrantyReport.mockResolvedValue({
    underWarranty: [
      {
        category: "Chargers",
        count: 2,
        items: [
          {
            source: "SALE",
            saleId: 12,
            receiptNumber: "RCP-12",
            saleItemId: 30,
            maintenanceId: null,
            productName: "Charger",
            customerName: "Rami Haddad",
            customerPhone: "71123456",
            coveredQuantity: 2,
            warrantyUntil: "2027-01-10",
          },
        ],
      },
    ],
    claims: {
      byAction: { REPAIR: 1, REPLACE: 2, REFUND: 0 },
      total: 3,
      grossCostUsd: 10,
      supplierRecoveredUsd: 4,
      netCostUsd: 6,
      grossCostLbp: 0,
      supplierRecoveredLbp: 0,
      netCostLbp: 0,
    },
  });
});

it("asks for this month to today, with the browser's own day", async () => {
  render(<WarrantyReport />);
  await waitFor(() =>
    expect(api.getWarrantyReport).toHaveBeenCalledWith({
      from: MONTH_START,
      to: TODAY,
      client_day: TODAY,
    }),
  );
});

it("shows items under warranty by category and the claims' cost", async () => {
  render(<WarrantyReport />);
  expect(await screen.findByTestId("report-category-Chargers")).toHaveTextContent(
    "Chargers 2",
  );
  expect(screen.getByText("RCP-12")).toBeInTheDocument();
  expect(screen.getByTestId("report-claims-total")).toHaveTextContent("3");
  expect(screen.getByTestId("report-gross")).toHaveTextContent("$10.00");
  expect(screen.getByTestId("report-recovered")).toHaveTextContent("$4.00");
  expect(screen.getByTestId("report-net")).toHaveTextContent("$6.00");
  expect(screen.getByTestId("report-by-action")).toHaveTextContent(
    "Repair 1",
  );
  expect(screen.getByTestId("report-by-action")).toHaveTextContent(
    "Replace 2",
  );
});

it("reloads for a new period", async () => {
  render(<WarrantyReport />);
  await screen.findByTestId("report-category-Chargers");
  fireEvent.change(screen.getByLabelText("From"), {
    target: { value: "2026-09-01" },
  });
  await waitFor(() =>
    expect(api.getWarrantyReport).toHaveBeenLastCalledWith({
      from: "2026-09-01",
      to: TODAY,
      client_day: TODAY,
    }),
  );
});
