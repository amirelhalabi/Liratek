/** @jest-environment jsdom */
/**
 * Owner decision 2026-10-16 — Transactions exports carry each transaction's
 * details (a Details text per row + "Details" and "Payments" sheets), costs
 * for admins only.
 *
 * Also guards a regression found while building it: since the viewer's
 * cells became components (3a2be48e, 2026-08-29) the export read NO text
 * from them — every transaction row exported blank Time/Summary/User cells.
 * The export now builds plain text per column; Summary is the plain summary
 * (status / reversal / credits go in Details).
 *
 * Written before the change and seen failing (rule 17).
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import TransactionsViewer from "../TransactionsViewer";
import { getRecentTransactions } from "@/api/backendApi";
import type { TableData } from "@liratek/ui";
import * as XLSX from "xlsx";

const exportToExcel = jest.fn();
const exportToPdf = jest.fn();
jest.mock("../../../../../../packages/ui/src/utils/tableExport", () => ({
  exportToExcel: (...args: unknown[]) => exportToExcel(...args),
  exportToPdf: (...args: unknown[]) => exportToPdf(...args),
}));

const mockUser = { id: 1, username: "tester", role: "staff" };
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock("@/api/backendApi", () => ({
  getRecentTransactions: jest.fn(),
}));

// rule 25: ONE identity for the whole file.
const mockApi = {
  getSessionItemRefundPreview: jest.fn(),
  refundSessionBasketItem: jest.fn(),
};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const mockMethods = {
  methods: [],
  drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
  allMethods: [{ code: "CASH", label: "Cash" }],
  loading: false,
  refresh: jest.fn(),
};
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => mockMethods,
}));
const mockShop = { name: "Test Shop", phone: "", location: "", logo: "" };
jest.mock("@/hooks/useShopName", () => ({ useShopInfo: () => mockShop }));
const mockRate = { sellRate: 89500, buyRate: 89000, isLoading: false };
jest.mock("@/hooks/useSellRate", () => ({ useSellRate: () => mockRate }));

const mockGetRecentTransactions = getRecentTransactions as jest.MockedFunction<
  typeof getRecentTransactions
>;

const saleRow = {
  id: 801,
  type: "SALE",
  status: "VOIDED",
  source_table: "sales",
  source_id: 77,
  user_id: 1,
  amount_usd: 9,
  amount_lbp: 0,
  exchange_rate: 89500,
  client_id: null,
  reverses_id: 600,
  summary: "Sale #77",
  metadata_json: JSON.stringify({
    details: {
      v: 1,
      kind: "pos_sale",
      items: [{ name: "USB-C cable", unitPrice: 4.5, unitCost: 1.75 }],
    },
    payment_snapshot: {
      lines: [{ method: "CASH", currency: "USD", amount: 10, direction: "IN" }],
    },
  }),
  device_id: null,
  created_at: "2026-10-16 09:30:00",
  username: "cashier",
  client_name: "Ali Saad",
  session_id: null,
  reversed_by_id: null,
  payments: [],
};

async function exportExcel(): Promise<TableData> {
  mockGetRecentTransactions.mockResolvedValue([saleRow] as never);
  render(
    <TransactionsViewer
      limit="50"
      selectedFilters={[]}
      search=""
      from=""
      to=""
    />,
  );
  await waitFor(() => screen.getByText("Sale #77", { exact: false }));
  fireEvent.click(screen.getByTitle("Export to Excel"));
  expect(exportToExcel).toHaveBeenCalledTimes(1);
  return exportToExcel.mock.calls[0][0] as TableData;
}

describe("TransactionsViewer — export carries the details", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser.role = "staff";
  });

  it("exports the row's text (not blank cells), Summary plain", async () => {
    const data = await exportExcel();
    expect(data.headers).toEqual(["Time", "Summary", "User"]);
    expect(data.rows[0]).toEqual(["16 Oct, 12:30", "Sale #77", "cashier"]);
  });

  it("adds a Details text per row and the Details / Payments sheets", async () => {
    const data = await exportExcel();
    expect(data.sheetName).toBe("Transactions");
    expect(data.rowNotes?.header).toBe("Details");
    expect(data.rowNotes?.values).toHaveLength(data.rows.length);
    expect(data.rowNotes?.values[0]).toBe(
      "Status: Voided · Reverses: #600 · Item 1 · Name: USB-C cable · Item 1 · Unit price: $4.50",
    );
    expect(data.extraSheets?.map((s) => s.name)).toEqual([
      "Details",
      "Payments",
    ]);
    const payments = data.extraSheets?.[1]?.rows ?? [];
    expect(payments[0]?.slice(0, 1)).toEqual(["801"]);
    expect(payments[0]?.slice(3)).toEqual([
      "line",
      "In",
      "Cash",
      "USD",
      "$10.00",
      "",
    ]);
  });

  it("staff exports leave the cost out; admin exports include it", async () => {
    const staffText = JSON.stringify(await exportExcel());
    expect(staffText).not.toContain("1.75");

    jest.clearAllMocks();
    document.body.innerHTML = "";
    mockUser.role = "admin";
    const adminText = JSON.stringify(await exportExcel());
    expect(adminText).toContain("1.75");
  });

  it("with every column picked, each column gets its own text", async () => {
    mockGetRecentTransactions.mockResolvedValue([saleRow] as never);
    render(
      <TransactionsViewer
        limit="50"
        selectedFilters={[]}
        search=""
        from=""
        to=""
      />,
    );
    await waitFor(() => screen.getByText("Sale #77", { exact: false }));
    fireEvent.click(screen.getByTestId("export-column-picker-button"));
    fireEvent.click(screen.getByText("Select all"));
    fireEvent.click(screen.getByTitle("Export to Excel"));
    const data = exportToExcel.mock.calls[0][0] as TableData;
    expect(data.headers).toEqual([
      "Time",
      "Summary",
      "Type",
      "Client",
      "Amount",
      "Method",
      "User",
    ]);
    expect(data.rows[0]).toHaveLength(7);
    expect(data.rows[0]?.[1]).toBe("Sale #77");
    expect(data.rows[0]?.[3]).toBe("Ali Saad");
    expect(data.rows[0]?.[4]).toMatch(/\$9/);
  });

  // rule 28 — run the REAL workbook builder on what the page produced and
  // read the file back.
  it("the real Excel file has the three sheets and the Details column", async () => {
    const data = await exportExcel();
    const { buildExcelWorkbook } = jest.requireActual(
      "../../../../../../packages/ui/src/utils/tableExport",
    ) as typeof import("../../../../../../packages/ui/src/utils/tableExport");
    const buf: Buffer = XLSX.write(buildExcelWorkbook(data), {
      bookType: "xlsx",
      type: "buffer",
    });
    const wb = XLSX.read(buf, { type: "buffer" });
    const rowsOf = (name: string) =>
      XLSX.utils.sheet_to_json<string[]>(wb.Sheets[name]!, {
        header: 1,
        defval: "",
      });
    expect(wb.SheetNames).toEqual(["Transactions", "Details", "Payments"]);
    expect(rowsOf("Transactions")[0]).toEqual([
      "Time",
      "Summary",
      "User",
      "Details",
    ]);
    expect(rowsOf("Transactions")[1]?.[3]).toContain("Reverses: #600");
    expect(rowsOf("Details")).toContainEqual([
      "801",
      "16 Oct 2026, 12:30",
      expect.any(String),
      "Details",
      "Item 1 · Name",
      "USB-C cable",
    ]);
    expect(rowsOf("Payments")[1]).toEqual([
      "801",
      "16 Oct 2026, 12:30",
      expect.any(String),
      "line",
      "In",
      "Cash",
      "USD",
      "$10.00",
      "",
    ]);
  });

  it("the PDF export gets the same Details text", async () => {
    mockGetRecentTransactions.mockResolvedValue([saleRow] as never);
    render(
      <TransactionsViewer
        limit="50"
        selectedFilters={[]}
        search=""
        from=""
        to=""
      />,
    );
    await waitFor(() => screen.getByText("Sale #77", { exact: false }));
    fireEvent.click(screen.getByTitle("Export to PDF"));
    const data = exportToPdf.mock.calls[0][0] as TableData;
    expect(data.rowNotes?.values[0]).toContain("Item 1 · Name: USB-C cable");
  });
});
