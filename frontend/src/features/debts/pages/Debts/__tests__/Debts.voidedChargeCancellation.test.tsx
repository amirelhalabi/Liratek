/** @jest-environment jsdom */

/**
 * Debts page — a voided charge, its cancellation and a re-entry read as
 * what they are (owner decision 2026-10-28, option A "show everything,
 * clearly marked").
 *
 * Real case (Cornertech, client 9446): one OMT bill booked on account
 * (+5,630,000 LBP, tx 12708), voided ('Refund Reversal' −5,630,000 on the
 * same tx), then entered again (+5,630,000, tx 13435). All three rows
 * carried the original's client line and the list showed every amount as
 * +5,630,000, so the account read as three charges while the balance was
 * right (owes once).
 *
 * `useApi` returns ONE module-level object (rule 25).
 */

import { render, screen, waitFor, within } from "@testing-library/react";
import Debts from "../index";

const LINE = "OMT send 5,630,000 LBP";

const mockGetDebtors = jest.fn();
const mockGetClientDebtHistory = jest.fn();
const mockGetClientBalance = jest.fn();
const mockApi = {
  getDebtors: mockGetDebtors,
  getClientDebtHistory: mockGetClientDebtHistory,
  getOpenDebtItems: jest.fn().mockResolvedValue([]),
  getTransactionById: jest.fn(),
  getSaleItems: jest.fn(),
  getClientBalance: mockGetClientBalance,
  getCustomServiceById: jest.fn(),
  getSale: jest.fn(),
  cashOut: jest.fn(),
  addRepayment: jest.fn(),
  addAccountEntry: jest.fn(),
  getClientDebtTotal: jest.fn(),
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
      <div data-testid="page-header">
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
      emptyMessage,
    }: {
      data: T[];
      renderRow: (item: T) => React.ReactNode;
      emptyMessage?: string;
    }) => (
      <table>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td>{emptyMessage}</td>
            </tr>
          ) : (
            data.map((item) => renderRow(item))
          )}
        </tbody>
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

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [],
    drawerAffectingMethods: [],
    allMethods: [],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

jest.mock("@/api/backendApi", () => ({
  getDebtAging: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  logger: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

const details = {
  kind: "transfer",
  ref: null,
  line: LINE,
  fields: [],
  items: [],
  payments: [],
  onAccount: { usd: 0, lbp: 5630000 },
  note: null,
};

const row = (
  id: number,
  transaction_type: string,
  amount_lbp: number,
  transaction_id: number,
  created_at: string,
  note: string | null,
) => ({
  id,
  client_id: 9446,
  transaction_id,
  transaction_type,
  amount_usd: 0,
  amount_lbp,
  note,
  created_at,
  created_by: 1,
  edited_by: null,
  edited_at: null,
  session_id: null,
  is_refunded: 0,
  refunded_at: null,
  created_by_username: "admin",
  client_details: details,
});

describe("Debts page — voided charge, its cancellation and the re-entry", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDebtors.mockResolvedValue([
      {
        id: 9446,
        full_name: "SouheiL SALIM Kerbaj",
        phone_number: "70000000",
        total_debt: 63,
        total_debt_usd: 0,
        total_debt_lbp: 5630000,
      },
    ]);
    mockGetClientDebtHistory.mockResolvedValue([
      row(181570, "Service Debt", 5630000, 13435, "2026-10-27 23:33:57", LINE),
      row(
        181569,
        "Refund Reversal",
        -5630000,
        12708,
        "2026-10-27 23:06:07",
        "Debt cancelled by refund/void",
      ),
      row(181456, "Service Debt", 5630000, 12708, "2026-10-25 08:41:21", LINE),
    ]);
    mockGetClientBalance.mockResolvedValue({
      success: true,
      data: { balance_usd: 0, balance_lbp: 5630000 },
    });
  });

  const rowOf = (id: number) => {
    const tr = screen.getByTestId(`debt-line-${id}`).closest("tr");
    expect(tr).not.toBeNull();
    return tr as HTMLTableRowElement;
  };
  const lbpCell = (tr: HTMLTableRowElement) =>
    tr.querySelectorAll("td")[4] as HTMLTableCellElement;

  it("the voided charge is struck through with a Voided tag", async () => {
    render(<Debts />);
    await waitFor(() => screen.getByTestId("debt-line-181456"));
    const tr = rowOf(181456);
    expect(within(tr).getByText("Voided")).toBeInTheDocument();
    expect(lbpCell(tr).textContent).toBe("5,630,000");
    expect(lbpCell(tr).querySelector(".line-through")).not.toBeNull();
  });

  it("the reversal reads as a cancellation with a negative amount", async () => {
    render(<Debts />);
    await waitFor(() => screen.getByTestId("debt-line-181569"));
    const tr = rowOf(181569);
    expect(screen.getByTestId("debt-line-181569").textContent).toBe(
      `Cancelled: ${LINE}`,
    );
    expect(lbpCell(tr).textContent).toBe("−5,630,000");
    expect(within(tr).queryByText("Voided")).toBeNull();
  });

  it("the re-entry stays a normal charge", async () => {
    render(<Debts />);
    await waitFor(() => screen.getByTestId("debt-line-181570"));
    const tr = rowOf(181570);
    expect(screen.getByTestId("debt-line-181570").textContent).toBe(LINE);
    expect(within(tr).queryByText("Voided")).toBeNull();
    expect(lbpCell(tr).textContent).toBe("5,630,000");
    expect(lbpCell(tr).querySelector(".line-through")).toBeNull();
  });
  it("the purchases total leaves out the voided charge and its cancellation (agrees with the statement)", async () => {
    render(<Debts />);
    await waitFor(() => screen.getByTestId("debt-line-181456"));
    const label = screen.getByText(/^Total (Owed|Debited|Charged)$/);
    const footer = label.parentElement as HTMLElement;
    expect(footer.textContent).toContain("5,630,000 LBP");
    expect(footer.textContent).not.toContain("11,260,000");
  });
});

describe("Debts page — a cancelled credit deposit and its reversal (Payments side)", () => {
  const credit = (
    id: number,
    transaction_type: string,
    amount_usd: number,
    transaction_id: number,
    created_at: string,
    note: string,
  ) => ({
    ...row(id, transaction_type, 0, transaction_id, created_at, note),
    amount_usd,
    client_details: undefined,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDebtors.mockResolvedValue([
      {
        id: 9446,
        full_name: "SouheiL SALIM Kerbaj",
        phone_number: "70000000",
        total_debt: -20,
        total_debt_usd: -20,
        total_debt_lbp: 0,
      },
    ]);
    mockGetClientDebtHistory.mockResolvedValue([
      credit(
        902,
        "CREDIT_DEPOSIT",
        -20,
        701,
        "2026-10-27 10:00:00",
        "Store credit",
      ),
      credit(
        901,
        "Refund Reversal",
        50,
        700,
        "2026-10-26 10:00:00",
        "Debt cancelled by refund/void",
      ),
      credit(
        900,
        "CREDIT_DEPOSIT",
        -50,
        700,
        "2026-10-25 10:00:00",
        "Change returned",
      ),
    ]);
    mockGetClientBalance.mockResolvedValue({
      success: true,
      data: { balance_usd: -20, balance_lbp: 0 },
    });
  });

  it("the cancelled deposit is struck with a Voided tag; its reversal sits beside it as a cancellation", async () => {
    render(<Debts />);
    await waitFor(() => screen.getByText("Store credit"));
    const original = screen.getByText("Change returned").closest("tr")!;
    expect(within(original).getByText("Voided")).toBeInTheDocument();
    expect(original.querySelector(".line-through")).not.toBeNull();
    const reversal = screen
      .getByText("Cancelled: Change returned")
      .closest("tr")!;
    expect(reversal.querySelectorAll("td")[3]!.textContent).toBe(
      "\u2212$50.00",
    );
    // Same table as the deposit it cancels.
    expect(reversal.closest("table")).toBe(original.closest("table"));
  });

  it("the paid / deposited total counts only the live deposit", async () => {
    render(<Debts />);
    await waitFor(() => screen.getByText("Store credit"));
    const label = screen.getByText(/^Total (Paid|Deposited|Credited)$/);
    expect((label.parentElement as HTMLElement).textContent).toContain(
      "$20.00",
    );
    const charged = screen.getByText(/^Total (Owed|Debited|Charged)$/);
    expect((charged.parentElement as HTMLElement).textContent).toContain(
      "$0.00",
    );
  });
});
