/** @jest-environment jsdom */

/**
 * Debts page — client history table gains a "User" column (LIRA-241, owner
 * decision 2026-09-28), the same way the Transactions page shows who
 * recorded each row. `DebtRepository.findClientHistory()` now LEFT JOINs
 * `users` and returns `created_by_username`; this test proves the frontend
 * half — the column header renders in both the Purchases/Charges table and
 * the Payments/Deposits table, a row WITH a recording user shows that
 * user's name, and a row with none (system-authored / no created_by) shows
 * "—" rather than blank or crashing.
 *
 * FAILING-FIRST (rule 17): pre-fix, Debts/index.tsx's `columns` arrays for
 * both tables list only Date/Note/USD/LBP — there is no "User" header and no
 * cell reads `item.created_by_username` — so `screen.getByText("User")` and
 * the per-row username assertions below fail pre-fix.
 *
 * Modeled on the sibling Debts.refundedBadge.test.tsx (same mocking shape —
 * spread the REAL `@liratek/ui` module, stub only what must be stubbed).
 */

import { render, screen, waitFor } from "@testing-library/react";
import Debts from "../index";

const PURCHASE_NOTE = "Manual charge by staff";
const PAYMENT_NOTE = "Repayment with no recorded user";

const mockGetDebtors = jest.fn();
const mockGetClientDebtHistory = jest.fn();
const mockGetTransactionById = jest.fn();
const mockGetSaleItems = jest.fn();
const mockGetClientBalance = jest.fn();
const mockGetSale = jest.fn();

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => ({
      getDebtors: mockGetDebtors,
      getClientDebtHistory: mockGetClientDebtHistory,
      getTransactionById: mockGetTransactionById,
      getSaleItems: mockGetSaleItems,
      getClientBalance: mockGetClientBalance,
      getCustomServiceById: jest.fn(),
      getSale: mockGetSale,
      cashOut: jest.fn(),
      addRepayment: jest.fn(),
      addAccountEntry: jest.fn(),
      getClientDebtTotal: jest.fn(),
    }),
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
      columns,
      data,
      renderRow,
      emptyMessage,
    }: {
      columns: { header: React.ReactNode }[];
      data: T[];
      renderRow: (item: T) => React.ReactNode;
      emptyMessage?: string;
    }) => (
      <table>
        <thead>
          <tr>
            {columns.map((c, i) => (
              <th key={i}>{c.header}</th>
            ))}
          </tr>
        </thead>
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

describe("Debts page — client history User column (LIRA-241)", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    mockGetDebtors.mockResolvedValue([
      {
        id: 1,
        full_name: "Jane Doe",
        phone_number: "71234567",
        total_debt: 10,
        total_debt_usd: 10,
        total_debt_lbp: 0,
      },
    ]);

    // Purchase-side row (transaction_type != Repayment/CREDIT_DEPOSIT)
    // recorded by a real user; payment-side row (Repayment) with no
    // created_by at all (system/unattributed) — must render "—", never a
    // crash on a null/undefined username.
    mockGetClientDebtHistory.mockResolvedValue([
      {
        id: 400,
        client_id: 1,
        transaction_id: null,
        transaction_type: "Manual Debt",
        amount_usd: 12,
        amount_lbp: 0,
        note: PURCHASE_NOTE,
        created_at: "2026-09-28 10:00:00",
        created_by: 3,
        created_by_username: "staffnour",
        session_id: null,
        is_refunded: 0,
        refunded_at: null,
      },
      {
        id: 401,
        client_id: 1,
        transaction_id: null,
        transaction_type: "Repayment",
        amount_usd: -5,
        amount_lbp: 0,
        note: PAYMENT_NOTE,
        created_at: "2026-09-28 09:00:00",
        created_by: null,
        created_by_username: null,
        session_id: null,
        is_refunded: 0,
        refunded_at: null,
      },
    ]);

    mockGetClientBalance.mockResolvedValue({
      success: true,
      data: { balance_usd: 7, balance_lbp: 0 },
    });
  });

  it("shows a User column header and the recording user's name per row, with '—' when absent", async () => {
    render(<Debts />);

    await waitFor(() => screen.getByText(PURCHASE_NOTE));
    await waitFor(() => screen.getByText(PAYMENT_NOTE));

    // The header appears once per table (Purchases + Payments).
    const userHeaders = screen.getAllByText("User");
    expect(userHeaders.length).toBeGreaterThanOrEqual(2);

    const purchaseRow = screen.getByText(PURCHASE_NOTE).closest("tr");
    const paymentRow = screen.getByText(PAYMENT_NOTE).closest("tr");
    expect(purchaseRow).not.toBeNull();
    expect(paymentRow).not.toBeNull();

    expect(purchaseRow!.textContent).toContain("staffnour");
    expect(paymentRow!.textContent).toContain("—");
  });
});
