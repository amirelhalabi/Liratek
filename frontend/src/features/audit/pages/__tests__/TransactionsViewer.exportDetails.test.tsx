/** @jest-environment jsdom */
/**
 * Owner decisions 2026-10-16 — the Transactions page exports through its
 * export TEMPLATE (`../../export/transactionsExportTemplate`): Excel
 * Summary / Transactions / Payments / Details sheets and a PDF report,
 * costs for admins only.
 *
 * Rewritten from the earlier version of this file, which asserted the plain
 * export's "Details" column and its half-empty payment rows — the layout
 * the template replaces. Per rule 24 the old premise became a guard that the
 * plain export is NOT used here. The template's own behaviour is proven
 * failing-first in `../../export/__tests__/transactionsExportTemplate.test.ts`;
 * this file proves the page hands it the right rows and context. These
 * assertions were written after the wiring, so they are NOT proven
 * failing-first.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import TransactionsViewer from "../TransactionsViewer";
import { getRecentTransactions } from "@/api/backendApi";
import type { ExportTemplate, ExportTemplateContext } from "@liratek/ui";
import * as XLSX from "xlsx";
import type { TransactionRow } from "../../hooks/useTransactionRows";

const exportToExcel = jest.fn();
const exportToPdf = jest.fn();
jest.mock("../../../../../../packages/ui/src/utils/tableExport", () => ({
  exportToExcel: (...args: unknown[]) => exportToExcel(...args),
  exportToPdf: (...args: unknown[]) => exportToPdf(...args),
}));
const exportTemplateToExcel = jest.fn();
const exportTemplateToPdf = jest.fn();
jest.mock("../../../../../../packages/ui/src/utils/exportTemplate", () => ({
  ...jest.requireActual(
    "../../../../../../packages/ui/src/utils/exportTemplate",
  ),
  exportTemplateToExcel: (...args: unknown[]) => exportTemplateToExcel(...args),
  exportTemplateToPdf: (...args: unknown[]) => exportTemplateToPdf(...args),
}));
const { writeTemplateWorkbook } = jest.requireActual<
  typeof import("../../../../../../packages/ui/src/utils/exportTemplate")
>("../../../../../../packages/ui/src/utils/exportTemplate");

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

type Call = [
  ExportTemplate<TransactionRow>,
  ExportTemplateContext<TransactionRow>,
  string,
];

async function renderViewer(search = "") {
  mockGetRecentTransactions.mockResolvedValue([saleRow] as never);
  render(
    <TransactionsViewer
      limit="50"
      selectedFilters={[]}
      search={search}
      from=""
      to=""
    />,
  );
  await waitFor(() => screen.getByText("Sale #77", { exact: false }));
}

async function exportExcel(search = ""): Promise<Call> {
  await renderViewer(search);
  fireEvent.click(screen.getByTitle("Export to Excel"));
  expect(exportTemplateToExcel).toHaveBeenCalledTimes(1);
  return exportTemplateToExcel.mock.calls[0] as Call;
}

/** rule 28 — the real file the page's template writes, read back. */
function workbookOf([template, ctx]: Call): XLSX.WorkBook {
  return XLSX.read(writeTemplateWorkbook(template.excel(ctx)), {
    type: "array",
  });
}

function rowsOf(wb: XLSX.WorkBook, name: string): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name]!, {
    header: 1,
    defval: "",
  });
}

describe("TransactionsViewer — export through its template", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    document.body.innerHTML = "";
    mockUser.role = "staff";
  });

  it("uses the template, never the plain export; no column picker", async () => {
    const [, ctx, filename] = await exportExcel();
    expect(exportToExcel).not.toHaveBeenCalled();
    expect(screen.queryByTestId("export-column-picker-button")).toBeNull();
    expect(ctx.rows.map((r) => r.id)).toEqual([801]);
    expect(filename).toMatch(/^transactions-\d{2}-\d{2}-\d{4}$/);
  });

  it("the file has the four sheets and the row's own text", async () => {
    const wb = workbookOf(await exportExcel());
    expect(wb.SheetNames).toEqual([
      "Summary",
      "Transactions",
      "Payments",
      "Details",
    ]);
    const [header, row] = rowsOf(wb, "Transactions");
    const cell = (h: string) => row![(header as string[]).indexOf(h)];
    expect(cell("#")).toBe(801);
    expect(cell("Summary")).toBe("Sale #77");
    expect(cell("Client")).toBe("Ali Saad");
    expect(cell("User")).toBe("cashier");
    expect(cell("Status")).toBe("Voided");
    expect(cell("Key details")).toBe("Reverses #600 · USB-C cable");
  });

  it("staff exports leave the cost out; admin exports include it", async () => {
    const text = (wb: XLSX.WorkBook) =>
      JSON.stringify(wb.SheetNames.map((n) => rowsOf(wb, n)));
    expect(text(workbookOf(await exportExcel()))).not.toContain("1.75");

    jest.clearAllMocks();
    document.body.innerHTML = "";
    mockUser.role = "admin";
    expect(text(workbookOf(await exportExcel()))).toContain("1.75");
  });

  it("the report header carries the shop, the exporter and the filters", async () => {
    const summary = rowsOf(
      workbookOf(await exportExcel("cable")),
      "Summary",
    ).map((r) => r.slice(0, 2));
    expect(summary).toContainEqual(["Shop", "Test Shop"]);
    expect(summary).toContainEqual(["Exported by", "tester"]);
    expect(summary).toContainEqual(["Filters", 'Search: "cable"']);
  });

  it("the PDF export uses the same template", async () => {
    await renderViewer();
    fireEvent.click(screen.getByTitle("Export to PDF"));
    expect(exportToPdf).not.toHaveBeenCalled();
    const [template, ctx] = exportTemplateToPdf.mock.calls[0] as Call;
    const report = template.pdf(ctx);
    expect(report.title).toMatch(/^Transactions — /);
    const item = report.groups[0]!.items[0]!;
    expect(JSON.stringify(item.cells)).toContain("#801");
    expect(item.sub).toBe("Reverses #600 · USB-C cable");
    expect(item.strike).toBe(true);
  });
});
