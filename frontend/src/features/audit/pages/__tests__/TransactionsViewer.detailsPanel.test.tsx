/** @jest-environment jsdom */
/**
 * Owner request 2026-10-16 — every Transactions row has a "Details" action
 * that opens a panel showing everything saved with that transaction
 * (`metadata_json.details`, the payment snapshot, and legacy keys).
 *
 * Written failing-first: before this change the row had no "Details" button
 * at all (rule 17).
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

const mockUser = { id: 1, username: "tester", role: "staff" };
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock("@/api/backendApi", () => ({
  getRecentTransactions: jest.fn(),
  voidTransaction: jest.fn(),
  refundTransaction: jest.fn(),
  voidCheckoutGroup: jest.fn(),
  voidSessionBasket: jest.fn(),
  refundSessionBasket: jest.fn(),
  getSaleItems: jest.fn(),
  getProductUnitsForSaleItems: jest.fn().mockResolvedValue([]),
  getRefundBookedRate: jest.fn(),
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
jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => mockShop,
}));

const mockRate = { sellRate: 89500, buyRate: 89000, isLoading: false };
jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => mockRate,
}));

const mockGetRecentTransactions = getRecentTransactions as jest.MockedFunction<
  typeof getRecentTransactions
>;

const posSaleRow = {
  id: 501,
  type: "SALE",
  status: "ACTIVE",
  source_table: "sales",
  source_id: 77,
  user_id: 1,
  amount_usd: 9,
  amount_lbp: 0,
  exchange_rate: 89500,
  client_id: 3,
  reverses_id: null,
  summary: "Sale #77",
  metadata_json: JSON.stringify({
    details: {
      v: 1,
      kind: "pos_sale",
      items: [
        {
          productId: 7,
          name: "USB-C cable",
          quantity: 2,
          unitPrice: 4.5,
          unitCost: 1.75,
        },
      ],
      paymentCurrency: "USD",
    },
    payment_snapshot: {
      lines: [{ method: "CASH", currency: "USD", amount: 10, direction: "IN" }],
      change_returned: [{ method: "CASH", currency: "USD", amount: 1 }],
    },
  }),
  device_id: null,
  created_at: "2026-10-16 09:30:00",
  username: "cashier",
  client_name: "Ali Saad",
  client_phone: "70123456",
  session_id: null,
  reversed_by_id: null,
  payments: [],
};

const legacyRow = {
  ...posSaleRow,
  id: 502,
  summary: "Old sale",
  client_name: null,
  client_phone: null,
  metadata_json: null,
};

async function renderRows(rows: unknown[]) {
  mockGetRecentTransactions.mockResolvedValue(rows as never);
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
}

function rowOf(summary: string): HTMLElement {
  return screen.getByText(summary, { exact: false }).closest("tr")!;
}

describe("TransactionsViewer — Details panel", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUser.role = "staff";
  });

  it("opens the Details panel for the clicked row, with header facts, details and payment", async () => {
    await renderRows([posSaleRow, legacyRow]);
    fireEvent.click(
      within(rowOf("Sale #77")).getByRole("button", { name: "Details" }),
    );

    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText(/#501/)).toBeInTheDocument();
    expect(within(panel).getByText("Ali Saad · 70123456")).toBeInTheDocument();
    expect(within(panel).getByText("POS sale")).toBeInTheDocument();
    expect(within(panel).getByText("USB-C cable")).toBeInTheDocument();
    expect(within(panel).getByText("Unit price")).toBeInTheDocument();
    // Staff: the cost column is not there at all.
    expect(within(panel).queryByText("Unit cost")).not.toBeInTheDocument();
    expect(within(panel).getByText("$10.00")).toBeInTheDocument();
    expect(within(panel).getByText(/Change returned/)).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the unit cost to an admin", async () => {
    mockUser.role = "admin";
    await renderRows([posSaleRow]);
    fireEvent.click(
      within(rowOf("Sale #77")).getByRole("button", { name: "Details" }),
    );
    const panel = await screen.findByRole("dialog");
    expect(within(panel).getByText("Unit cost")).toBeInTheDocument();
  });

  it("shows the same Amount as the table's Amount column (a signed partner row)", async () => {
    const partnerRow = {
      ...legacyRow,
      id: 503,
      type: "PARTNER_PAYMENT",
      source_table: "partners",
      amount_usd: -50,
      summary: "Partner payment to Rami",
    };
    await renderRows([posSaleRow, partnerRow]);
    const tr = rowOf("Partner payment to Rami");
    const amountCell = tr.querySelectorAll("td")[4]!.textContent;
    expect(amountCell).toBe("$50");
    fireEvent.click(within(tr).getByRole("button", { name: "Details" }));
    const panel = await screen.findByRole("dialog");
    const amountLabel = within(panel).getByText("Amount", { selector: "dt" });
    expect(amountLabel.nextElementSibling?.textContent).toBe(amountCell);
  });

  // Owner decision 2026-10-16: the Status / Reverses / Ret. Credits columns
  // left the table, so Details is where all three are always findable.
  function factOf(panel: HTMLElement, label: string): string | null {
    const dt = within(panel).queryByText(label, { selector: "dt" });
    return dt ? (dt.nextElementSibling?.textContent ?? "") : null;
  }

  it("always lists Status, and lists returned credits only when there are some", async () => {
    const creditRow = {
      ...legacyRow,
      id: 504,
      type: "FINANCIAL_SERVICE",
      source_table: "financial_services",
      summary: "Only-Days card",
      returned_credits_usd: 3,
    };
    await renderRows([posSaleRow, creditRow]);

    fireEvent.click(
      within(rowOf("Only-Days card")).getByRole("button", { name: "Details" }),
    );
    let panel = await screen.findByRole("dialog");
    expect(factOf(panel, "Status")).toBe("Active");
    expect(factOf(panel, "Returned credits")).toBe("$3");
    fireEvent.click(within(panel).getByRole("button", { name: "Close" }));

    fireEvent.click(
      within(rowOf("Sale #77")).getByRole("button", { name: "Details" }),
    );
    panel = await screen.findByRole("dialog");
    expect(factOf(panel, "Status")).toBe("Active");
    expect(factOf(panel, "Returned credits")).toBeNull();
  });

  it("a refund lists Reverses and its negative returned credits", async () => {
    const refundRow = {
      ...legacyRow,
      id: 505,
      type: "REFUND",
      source_table: "financial_services",
      amount_usd: -25,
      summary: "Refund of card",
      reverses_id: 504,
      returned_credits_usd: -3,
    };
    await renderRows([posSaleRow, refundRow]);
    fireEvent.click(
      within(rowOf("Refund of card")).getByRole("button", { name: "Details" }),
    );
    const panel = await screen.findByRole("dialog");
    expect(factOf(panel, "Reverses")).toBe("#504");
    expect(factOf(panel, "Returned credits")).toBe("−$3");
  });

  it("shows the empty state for a row with nothing saved", async () => {
    await renderRows([posSaleRow, legacyRow]);
    fireEvent.click(
      within(rowOf("Old sale")).getByRole("button", { name: "Details" }),
    );
    const panel = await screen.findByRole("dialog");
    expect(
      within(panel).getByText("Nothing else was saved for this transaction."),
    ).toBeInTheDocument();
  });
});
