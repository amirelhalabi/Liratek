/**
 * LIRA-296 (T015) — the Warranty lookup page.
 *
 * Staff find any warranty item by name, phone, receipt (RCP-…), product or
 * serial, see its state and "covered x of y", and open the sale.
 *
 * Rule 19: data comes through `useApi()` only (never raw `window.api`).
 * Rule 25: the mock returns ONE stable object, and a second test returns a
 *          FRESH object on every call — the page must still search exactly
 *          once per action (it reads `api` through a ref), never loop.
 * Rule 27: the search carries the browser's own day as `client_day`.
 */
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { localDay } from "@/shared/utils/localDay";
import WarrantyLookup from "../WarrantyLookup";

const rows = [
  {
    source: "SALE",
    saleId: 100,
    receiptNumber: "RCP-100",
    saleItemId: 1000,
    maintenanceId: null,
    soldAt: "2026-09-01 10:00:00",
    customer: { id: 1, name: "Rami Haddad", phone: "71 123 456" },
    product: { id: 10, name: "Earbuds Pro", barcode: "EB-777" },
    quantity: 3,
    refundedQuantity: 1,
    coveredQuantity: 2,
    units: [],
    warrantyUntil: "2026-12-01",
    warrantyMonths: 3,
    state: "COVERED",
    openClaimId: null,
  },
  {
    source: "SALE",
    saleId: 102,
    receiptNumber: "RCP-102",
    saleItemId: 1020,
    maintenanceId: null,
    soldAt: "2025-01-01 10:00:00",
    customer: { id: null, name: null, phone: null },
    product: { id: 12, name: "Speaker", barcode: null },
    quantity: 1,
    refundedQuantity: 0,
    coveredQuantity: 1,
    units: [
      { id: 5, serial: "SN-12345", state: "EXPIRED", overrideUntil: null },
    ],
    warrantyUntil: "2025-02-01",
    warrantyMonths: 1,
    state: "EXPIRED",
    openClaimId: null,
  },
];

const searchWarranties = jest.fn();
let unstable = false;
const stableApi = { searchWarranties };

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => (unstable ? { searchWarranties } : stableApi),
  };
});

const saleModal = jest.fn();
jest.mock("@/features/sales/pages/POS/components/SaleDetailModal", () => ({
  __esModule: true,
  default: (props: { saleId: number; onClose: () => void }) => {
    saleModal(props.saleId);
    return <div data-testid="sale-detail-modal">sale {props.saleId}</div>;
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  unstable = false;
  searchWarranties.mockResolvedValue({ rows });
});

describe("WarrantyLookup", () => {
  it("searches recent warranties on open, with the browser's own day", async () => {
    render(<WarrantyLookup />);
    await screen.findByText("Earbuds Pro");
    expect(searchWarranties).toHaveBeenCalledTimes(1);
    expect(searchWarranties).toHaveBeenCalledWith({
      client_day: localDay(),
    });
  });

  it("has one search box with the hint, and searches what was typed", async () => {
    render(<WarrantyLookup />);
    await screen.findByText("Earbuds Pro");
    const box = screen.getByPlaceholderText(
      "Name, phone, receipt (RCP-…), product or serial",
    );
    fireEvent.change(box, { target: { value: "RCP-100" } });
    fireEvent.submit(box.closest("form")!);
    await waitFor(() => expect(searchWarranties).toHaveBeenCalledTimes(2));
    expect(searchWarranties).toHaveBeenLastCalledWith({
      q: "RCP-100",
      client_day: localDay(),
    });
  });

  it("filters by state", async () => {
    render(<WarrantyLookup />);
    await screen.findByText("Earbuds Pro");
    fireEvent.change(screen.getByLabelText("Warranty state"), {
      target: { value: "EXPIRED" },
    });
    await waitFor(() =>
      expect(searchWarranties).toHaveBeenLastCalledWith({
        state: "EXPIRED",
        client_day: localDay(),
      }),
    );
  });

  it("shows product, customer, receipt, until, state and covered x of y", async () => {
    render(<WarrantyLookup />);
    await screen.findByText("Earbuds Pro");
    const [first, second] = screen.getAllByTestId("warranty-row");
    const a = within(first!);
    expect(a.getByText("Rami Haddad")).toBeInTheDocument();
    expect(a.getByText("71 123 456")).toBeInTheDocument();
    expect(a.getByText("2026-09-01")).toBeInTheDocument();
    expect(a.getByText("RCP-100")).toBeInTheDocument();
    expect(a.getByText("2026-12-01")).toBeInTheDocument();
    expect(a.getByText("Covered")).toBeInTheDocument();
    expect(a.getByText("2 of 3")).toBeInTheDocument();
    // Walk-in without details, the serial, and the expired badge.
    const b = within(second!);
    expect(b.getByText("Walk-in")).toBeInTheDocument();
    expect(b.getByText("SN-12345")).toBeInTheDocument();
    expect(b.getByText("Expired")).toBeInTheDocument();
  });

  it("opens the sale when a row is clicked", async () => {
    render(<WarrantyLookup />);
    fireEvent.click(await screen.findByText("Earbuds Pro"));
    expect(await screen.findByTestId("sale-detail-modal")).toHaveTextContent(
      "sale 100",
    );
  });

  it("shows a message when nothing is found", async () => {
    searchWarranties.mockResolvedValue({ rows: [] });
    render(<WarrantyLookup />);
    expect(
      await screen.findByText("No warranty items found."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("warranty-in-stock-hint")).toBeNull();
  });

  // LIRA-296 follow-up (owner decision 2026-10-10): a phone on the shelf has
  // no warranty yet — searching its serial says so instead of "nothing found".
  it("says the item is in stock, not sold, when the serial is an in-stock unit", async () => {
    searchWarranties.mockResolvedValue({
      rows: [],
      inStockUnits: [{ imei: "350000111122223", productName: "Phone X" }],
    });
    render(<WarrantyLookup />);
    const hint = await screen.findByTestId("warranty-in-stock-hint");
    expect(hint).toHaveTextContent(
      "In stock, not sold — warranty starts when it's sold.",
    );
    expect(hint).toHaveTextContent("Phone X");
    expect(hint).toHaveTextContent("350000111122223");
    expect(screen.queryByText("No warranty items found.")).toBeNull();
  });

  it("shows the error when the search is refused", async () => {
    searchWarranties.mockRejectedValue(new Error("Forbidden"));
    render(<WarrantyLookup />);
    expect(await screen.findByText(/Forbidden/)).toBeInTheDocument();
  });

  it("never loops when useApi() returns a fresh object every render (rule 25)", async () => {
    unstable = true;
    render(<WarrantyLookup />);
    await screen.findByText("Earbuds Pro");
    await new Promise((r) => setTimeout(r, 50));
    expect(searchWarranties).toHaveBeenCalledTimes(1);
  });
});

// LIRA-296 P2 (T040) — act on a found warranty: start a claim from the row,
// see its history, and (admins) the defective-items holding.
jest.mock("@/features/auth/context/AuthContext", () => ({
  useOptionalAuth: () => ({ user: { role: "admin" } }),
}));
jest.mock("../../components/ClaimModal", () => ({
  ClaimModal: (p: { target: { saleItemId: number } }) => (
    <div data-testid="claim-modal">claim {p.target.saleItemId}</div>
  ),
}));
jest.mock("../../components/ClaimHistory", () => ({
  ClaimHistory: (p: { saleItemId: number }) => (
    <div data-testid="claim-history">history {p.saleItemId}</div>
  ),
}));
jest.mock("../../components/DefectiveItems", () => ({
  DefectiveItems: () => <div data-testid="defective-items" />,
}));

describe("WarrantyLookup — claims (P2)", () => {
  it("a covered row offers a claim, without opening the sale", async () => {
    render(<WarrantyLookup />);
    const row = (await screen.findByText("Earbuds Pro")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "Claim" }));
    expect(await screen.findByTestId("claim-modal")).toHaveTextContent(
      "claim 1000",
    );
    expect(screen.queryByTestId("sale-detail-modal")).toBeNull();
  });

  it("shows a row's claim history", async () => {
    render(<WarrantyLookup />);
    const row = (await screen.findByText("Earbuds Pro")).closest("tr")!;
    fireEvent.click(within(row).getByRole("button", { name: "History" }));
    expect(await screen.findByTestId("claim-history")).toHaveTextContent(
      "history 1000",
    );
  });

  it("admins get a Defective items tab", async () => {
    render(<WarrantyLookup />);
    await screen.findByText("Earbuds Pro");
    fireEvent.click(screen.getByRole("tab", { name: "Defective items" }));
    expect(await screen.findByTestId("defective-items")).toBeInTheDocument();
  });
});

jest.mock("../../components/SupplierReturns", () => ({
  SupplierReturns: () => <div data-testid="supplier-returns" />,
}));
jest.mock("../../components/WarrantyReport", () => ({
  WarrantyReport: () => <div data-testid="warranty-report" />,
}));

describe("WarrantyLookup — supplier returns and report (P3)", () => {
  it("admins get a Supplier returns tab", async () => {
    render(<WarrantyLookup />);
    await screen.findByText("Earbuds Pro");
    fireEvent.click(screen.getByRole("tab", { name: "Supplier returns" }));
    expect(await screen.findByTestId("supplier-returns")).toBeInTheDocument();
  });

  it("admins get a Report tab", async () => {
    render(<WarrantyLookup />);
    await screen.findByText("Earbuds Pro");
    fireEvent.click(screen.getByRole("tab", { name: "Report" }));
    expect(await screen.findByTestId("warranty-report")).toBeInTheDocument();
  });
});
