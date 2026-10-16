/** @jest-environment jsdom */
/**
 * Shop-day test 2026-10-16 — the Transactions page side of the Details
 * panel / export fixes, on REAL rows from that day
 * (`../../__fixtures__/shopDayRows.ts`, rule 24):
 *
 *  - the export's payment lines no longer run together ("In — Cash: $50Out
 *    — Cash: $5"): since the export template (owner decision 2026-10-16)
 *    each one is its own row on the Payments sheet;
 *  - an item refund's original is tagged PARTLY REFUNDED, offers no whole
 *    Void / Refund, and the refund row links back to it (server fields
 *    `item_refunded` / `item_refund_remaining` / `item_refund_of_id`);
 *  - the panel's header agrees: readable title, the forgiven amount of a
 *    write-off, Status "Partly refunded", Reverses on an item refund.
 *
 * Written before the fixes and seen failing (rule 17).
 */
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import TransactionsViewer from "../TransactionsViewer";
import { getRecentTransactions } from "@/api/backendApi";
import type { ExportTableBlock } from "@liratek/ui";
import { shopDayRow } from "../../__fixtures__/shopDayRows";

const exportToExcel = jest.fn();
const exportToPdf = jest.fn();
jest.mock("../../../../../../packages/ui/src/utils/tableExport", () => ({
  exportToExcel: (...args: unknown[]) => exportToExcel(...args),
  exportToPdf: (...args: unknown[]) => exportToPdf(...args),
}));
const exportTemplateToExcel = jest.fn();
jest.mock("../../../../../../packages/ui/src/utils/exportTemplate", () => ({
  ...jest.requireActual(
    "../../../../../../packages/ui/src/utils/exportTemplate",
  ),
  exportTemplateToExcel: (...args: unknown[]) => exportTemplateToExcel(...args),
}));

const mockUser = { id: 1, username: "tester", role: "staff" };
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock("@/api/backendApi", () => ({
  getRecentTransactions: jest.fn(),
  getProductUnitsForSaleItems: jest.fn().mockResolvedValue([]),
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

/** Real rows plus the item-refund link fields core's `getRecent` now
 *  returns (captured before that landed). */
const LINK_FIELDS: Record<number, Record<string, unknown>> = {
  10939: { item_refund_of_id: 10895 },
  10895: { item_refunded: true, item_refund_remaining: true },
};

async function renderRows(ids: number[], waitFor_: string) {
  mockGetRecentTransactions.mockResolvedValue(
    ids.map((id) => ({ ...shopDayRow(id), ...LINK_FIELDS[id] })) as never,
  );
  render(
    <TransactionsViewer
      limit="50"
      selectedFilters={[]}
      search=""
      from=""
      to=""
    />,
  );
  await waitFor(() => screen.getByText(waitFor_, { exact: false }));
}

function rowOf(summary: string): HTMLElement {
  return screen.getByText(summary, { exact: false }).closest("tr")!;
}

function factOf(panel: HTMLElement, label: string): string | null {
  const dt = within(panel).queryByText(label, { selector: "dt" });
  return dt ? (dt.nextElementSibling?.textContent ?? "") : null;
}

async function openDetails(summary: string): Promise<HTMLElement> {
  fireEvent.click(
    within(rowOf(summary)).getByRole("button", { name: "Details" }),
  );
  return screen.findByRole("dialog");
}

describe("TransactionsViewer — shop-day fixes", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser.role = "staff";
  });

  it("the export's payment lines are separate rows", async () => {
    await renderRows([10933], "Generator subscription");
    fireEvent.click(screen.getByTitle("Export to Excel"));
    const [template, ctx] = exportTemplateToExcel.mock.calls[0] as [
      { excel: (c: unknown) => { name: string; blocks: ExportTableBlock[] }[] },
      unknown,
    ];
    const payments = template.excel(ctx).find((s) => s.name === "Payments")!;
    const lines = payments.blocks[0]!.rows.map((r) =>
      r.cells.slice(4, 9).map((c) => c.value),
    );
    expect(lines).toEqual([
      ["line", "Out", "Cash", "USD", 20],
      ["change received", "In", "Cash", "USD", 1],
      ["kept by them", null, null, "USD", 0.5],
    ]);
  });

  it("an item refund's original is PARTLY REFUNDED; the refund links back", async () => {
    await renderRows([10939, 10895], "ITEM REFUND");
    expect(
      within(rowOf("Sale #182: 1×")).getByText("PARTLY REFUNDED"),
    ).toBeTruthy();
    expect(within(rowOf("ITEM REFUND")).getByText("↩ #10895")).toBeTruthy();
  });

  it("the item-refunded sale shows no whole Void / Refund button", async () => {
    await renderRows([10939, 10895], "ITEM REFUND");
    const tr = rowOf("Sale #182: 1×");
    expect(within(tr).queryByRole("button", { name: "Void" })).toBeNull();
    expect(within(tr).queryByRole("button", { name: "Refund" })).toBeNull();
  });

  it("the panel agrees: Status and Reverses", async () => {
    await renderRows([10939, 10895], "ITEM REFUND");
    let panel = await openDetails("Sale #182: 1×");
    expect(factOf(panel, "Status")).toBe("Partly refunded");
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    panel = await openDetails("ITEM REFUND");
    expect(factOf(panel, "Reverses")).toBe("#10895");
  });

  it("the panel shows a write-off's forgiven amount, same as the table", async () => {
    await renderRows([10944], "Discount: 15 USD forgiven");
    const tr = rowOf("Discount: 15 USD forgiven");
    expect(tr.querySelectorAll("td")[4]!.textContent).toBe("$15 forgiven");
    const panel = await openDetails("Discount: 15 USD forgiven");
    expect(factOf(panel, "Amount")).toBe("$15 forgiven");
  });

  it("the panel title reads as words", async () => {
    await renderRows([10945], "Board-level repair");
    const panel = await openDetails("Board-level repair");
    expect(
      within(panel)
        .getByRole("heading", { level: 2 })
        .textContent?.startsWith("Custom service"),
    ).toBe(true);
  });
});
