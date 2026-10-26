/** @jest-environment jsdom */

/**
 * LIRA-350 — the client's Accounts page reads every row in the client's
 * words: the line built by core (`client_details`, from the transaction's
 * saved data), a details window on EVERY purchase row (not only sales,
 * services and baskets), human labels (no "CUSTOMER ACCOUNT", no
 * "Recharge_mtc"), how each part was paid, and no cost price (C13). A
 * client with no debt can be found under "All" (C16).
 *
 * The rows' `client_details` are built by the REAL core builder from the
 * test-tenant review's saved transactions, so the screen is checked
 * against what the server actually sends.
 *
 * Rule 25: `useApi` returns ONE module-scope object.
 */
import {
  render,
  screen,
  fireEvent,
  within,
  waitFor,
} from "@testing-library/react";
import { buildClientDebtDetails, type ClientDebtTxSource } from "@liratek/core";
import Debts from "../index";

const MAINT_META = JSON.stringify({
  details: {
    v: 1,
    kind: "maintenance_job",
    jobId: 51,
    device: "iPhone 15 (black)",
    issue: "Charging port replacement + screen protector fitted",
    status: "Delivered_Paid",
    repairCost: { usd: 8, lbp: 0 },
    price: { usd: 25, lbp: 0 },
    warrantyUntil: "2027-01-27",
    parts: [
      {
        productId: 112,
        name: "iPhone 15 Tempered Glass",
        quantity: 1,
        unitPrice: 5,
        unitCost: 1,
      },
    ],
  },
  payment_snapshot: {
    lines: [
      { method: "CASH", currency: "LBP", amount: 890000, direction: "IN" },
      {
        method: "CUSTOMER_ACCOUNT",
        currency: "USD",
        amount: 20,
        direction: "IN",
      },
    ],
  },
});
const LOTO_META = JSON.stringify({
  details: { v: 1, kind: "loto_sale", saleAmount: 200000 },
  payment_snapshot: {
    lines: [
      {
        method: "CUSTOMER_ACCOUNT",
        currency: "LBP",
        amount: 200000,
        direction: "IN",
      },
    ],
  },
});

function tx(over: Partial<ClientDebtTxSource>): ClientDebtTxSource {
  return {
    id: 1,
    type: "MAINTENANCE",
    summary: null,
    metadata_json: null,
    amount_usd: 0,
    amount_lbp: 0,
    ...over,
  };
}

const maintenanceRow = {
  id: 181517,
  client_id: 1,
  transaction_id: 13110,
  transaction_type: "Maintenance Debt",
  amount_usd: 20,
  amount_lbp: 0,
  note: "Balance from Maintenance",
  created_at: "2026-10-26 22:20:13",
  created_by: null,
  session_id: null,
  client_details: buildClientDebtDetails({
    ledger: {
      transaction_type: "Maintenance Debt",
      amount_usd: 20,
      amount_lbp: 0,
      note: "x",
    },
    tx: tx({
      id: 13110,
      type: "MAINTENANCE",
      amount_usd: 30,
      metadata_json: MAINT_META,
    }),
  }),
};
const lotoRow = {
  id: 181518,
  client_id: 1,
  transaction_id: 13111,
  transaction_type: "Loto Debt",
  amount_usd: 0,
  amount_lbp: 200000,
  note: "Loto ticket sale: #217 CUSTOMER ACCOUNT",
  created_at: "2026-10-26 22:21:12",
  created_by: null,
  session_id: null,
  client_details: buildClientDebtDetails({
    ledger: {
      transaction_type: "Loto Debt",
      amount_usd: 0,
      amount_lbp: 200000,
      note: "x",
    },
    tx: tx({
      id: 13111,
      type: "LOTO",
      amount_lbp: 200000,
      metadata_json: LOTO_META,
    }),
  }),
};

const repaymentRow = {
  id: 181600,
  client_id: 1,
  transaction_id: 14000,
  transaction_type: "Repayment",
  amount_usd: -10,
  amount_lbp: 0,
  note: "Cash repayment",
  created_at: "2026-10-27 10:00:00",
  created_by: null,
  session_id: null,
  client_details: buildClientDebtDetails({
    ledger: {
      transaction_type: "Repayment",
      amount_usd: -10,
      amount_lbp: 0,
      note: "Cash repayment",
    },
    tx: tx({
      id: 14000,
      type: "DEBT_REPAYMENT",
      summary: "Debt repayment: $10",
      amount_usd: 10,
      metadata_json: JSON.stringify({
        payment_snapshot: {
          lines: [
            { method: "CASH", currency: "USD", amount: 10, direction: "IN" },
          ],
        },
      }),
    }),
  }),
};

const mockApi = {
  getDebtors: jest.fn(),
  getClients: jest.fn(),
  getClientDebtHistory: jest.fn(),
  getOpenDebtItems: jest.fn().mockResolvedValue([]),
  getTransactionById: jest.fn(),
  getSaleItems: jest.fn(),
  getCustomServiceById: jest.fn(),
  getClientBalance: jest.fn(),
  getClientDebtTotal: jest.fn(),
  cashOut: jest.fn(),
  addRepayment: jest.fn(),
  addAccountEntry: jest.fn(),
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    PageHeader: ({
      title,
      actions,
    }: {
      title: string;
      actions?: React.ReactNode;
    }) => (
      <div>
        <h1>{title}</h1>
        {actions}
      </div>
    ),
    Select: ({
      value,
      onChange,
      options,
    }: {
      value: string;
      onChange: (v: string) => void;
      options: { value: string; label: string }[];
    }) => (
      <select
        data-testid="debt-filter-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    ),
    ServiceTypeTabs: () => null,
    MultiPaymentInput: () => null,
    DataTable: <T,>({
      data,
      renderRow,
    }: {
      data: T[];
      renderRow: (item: T) => React.ReactNode;
    }) => (
      <table>
        <tbody>{data.map((item) => renderRow(item))}</tbody>
      </table>
    ),
  };
});

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" } }),
}));
jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));
const PAYMENT_METHODS = {
  methods: [
    { code: "CASH", label: "Cash" },
    { code: "CUSTOMER_ACCOUNT", label: "Customer account" },
  ],
  drawerAffectingMethods: [],
  allMethods: [
    { code: "CASH", label: "Cash" },
    { code: "CUSTOMER_ACCOUNT", label: "Customer account" },
  ],
  loading: false,
  refresh: jest.fn(),
};
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => PAYMENT_METHODS,
}));
jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));
jest.mock("@/api/backendApi", () => ({
  getDebtAging: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/utils/logger", () => {
  const l = {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  };
  return { __esModule: true, default: l, logger: l };
});

const DEBTOR = {
  id: 1,
  full_name: "Review Client 26-10",
  phone_number: "03261026",
  total_debt: 22.25,
  total_debt_usd: 20,
  total_debt_lbp: 200000,
};

beforeEach(() => {
  jest.clearAllMocks();
  mockApi.getDebtors.mockResolvedValue([DEBTOR]);
  mockApi.getClients.mockResolvedValue([
    { id: 1, full_name: "Review Client 26-10", phone_number: "03261026" },
    { id: 2, full_name: "Zero Balance Client", phone_number: "70111222" },
  ]);
  mockApi.getClientDebtHistory.mockResolvedValue([maintenanceRow, lotoRow]);
  mockApi.getClientBalance.mockResolvedValue({
    success: true,
    data: { balance_usd: 20, balance_lbp: 200000 },
  });
  mockApi.getOpenDebtItems.mockResolvedValue([]);
});

describe("Accounts page — every row in the client's words (LIRA-350)", () => {
  it("shows the core-built line, never the raw debt note or payment code", async () => {
    render(<Debts />);
    expect(
      await screen.findByText(
        "Job #51 — iPhone 15 (black): Charging port replacement + screen protector fitted — $30, paid 890,000 LBP, $20 on account",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Loto ticket — 200,000 LBP")).toBeInTheDocument();
    expect(screen.queryByText(/CUSTOMER ACCOUNT/)).toBeNull();
    // The row line is read from the server; no per-row fetch any more.
    expect(mockApi.getTransactionById).not.toHaveBeenCalled();
    expect(mockApi.getSaleItems).not.toHaveBeenCalled();
  });

  it("every purchase row has a details button; maintenance opens with its fields and how it was paid, no cost", async () => {
    render(<Debts />);
    await screen.findByText("Loto ticket — 200,000 LBP");
    const buttons = screen.getAllByTitle("See details");
    expect(buttons).toHaveLength(2);
    const maintenanceTr = screen
      .getByTestId(`debt-line-${maintenanceRow.id}`)
      .closest("tr")!;
    fireEvent.click(within(maintenanceTr).getByTitle("See details"));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Maintenance job #51")).toBeInTheDocument();
    expect(within(dialog).getByText("Device")).toBeInTheDocument();
    expect(within(dialog).getByText("iPhone 15 (black)")).toBeInTheDocument();
    expect(
      within(dialog).getByText("iPhone 15 Tempered Glass"),
    ).toBeInTheDocument();
    expect(within(dialog).getByText("Cash")).toBeInTheDocument();
    expect(within(dialog).getByText("Customer account")).toBeInTheDocument();
    expect(within(dialog).getByText("890,000 LBP")).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(
      /cost|Delivered_Paid|CUSTOMER_ACCOUNT|productId/i,
    );
  });

  it("a repayment's window shows what was taken off the account, never a debt", async () => {
    mockApi.getClientDebtHistory.mockResolvedValue([
      maintenanceRow,
      lotoRow,
      repaymentRow,
    ]);
    render(<Debts />);
    await screen.findByText("Loto ticket — 200,000 LBP");
    // Two purchase eyes + one payment eye.
    const eyes = screen.getAllByTitle("See details");
    expect(eyes).toHaveLength(3);
    fireEvent.click(eyes[2]!);
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Debt repayment: $10");
    expect(dialog).toHaveTextContent("Taken off the account");
    expect(dialog).not.toHaveTextContent("On the account");
  });

  it("C16: a client with no debt is listed under All and can be opened", async () => {
    render(<Debts />);
    await screen.findByText("Loto ticket — 200,000 LBP");
    expect(screen.queryByText("Zero Balance Client")).toBeNull();
    fireEvent.change(screen.getByTestId("debt-filter-select"), {
      target: { value: "all" },
    });
    expect(await screen.findByText("Zero Balance Client")).toBeInTheDocument();
    mockApi.getClientDebtHistory.mockResolvedValue([]);
    fireEvent.click(screen.getByText("Zero Balance Client"));
    await waitFor(() => {
      expect(mockApi.getClientDebtHistory).toHaveBeenCalledWith(2);
    });
  });
});
