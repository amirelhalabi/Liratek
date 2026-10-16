/** @jest-environment jsdom */

/**
 * Shop-day finding (2026-10-16): on Accounts, clicking a second client left
 * the FIRST client's charges and an active "Cash Out" button on screen under
 * the new client's header for as long as the new client's requests took
 * (~1.5 s on web). Acting in that window pays out against the wrong account.
 *
 * Root cause: switching client never cleared `history`, and
 * `setLedgerBalance(null)` made the balance fall back to totals computed
 * from that stale history — so the previous client's credit drove
 * `hasCredit` and rendered Cash Out. A late response for the previous
 * client could also land after the new one (no guard on the client id).
 *
 * Deferred promises make the timing deterministic here.
 */

import { render, screen, fireEvent, act } from "@testing-library/react";
import Debts from "../index";

const mockGetDebtors = jest.fn();
const mockGetClientDebtHistory = jest.fn();
const mockGetClientBalance = jest.fn();

// Module-level, stable identity (rule 25).
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

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

// Client A: the shop owes them $50 (a credit) → Cash Out applies to A only.
const A_HISTORY = [
  {
    id: 11,
    client_id: 1,
    transaction_type: "CREDIT_DEPOSIT",
    amount_usd: -50,
    amount_lbp: 0,
    note: "A-credit-note",
    created_at: "2026-10-16 10:00:00",
  },
];
// Client B: owes the shop $20 → no Cash Out.
const B_HISTORY = [
  {
    id: 22,
    client_id: 2,
    transaction_type: "Sale Debt",
    amount_usd: 20,
    amount_lbp: 0,
    note: "Sale #9: B-charge-note",
    created_at: "2026-10-16 11:00:00",
  },
];

const DEBTORS = [
  {
    id: 1,
    full_name: "Alice Credit",
    phone_number: "70111111",
    total_debt: -50,
    total_debt_usd: -50,
    total_debt_lbp: 0,
  },
  {
    id: 2,
    full_name: "Bob Debt",
    phone_number: "70222222",
    total_debt: 20,
    total_debt_usd: 20,
    total_debt_lbp: 0,
  },
];

function cashOutButton() {
  return screen.queryByRole("button", { name: /Cash Out/ });
}

describe("Accounts page — switching client never shows the previous client's data", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetDebtors.mockResolvedValue(DEBTORS);
  });

  it("hides A's rows and A's Cash Out while B is still loading", async () => {
    const bHistory = deferred<typeof B_HISTORY>();
    const bBalance = deferred<{
      success: boolean;
      data: { balance_usd: number; balance_lbp: number };
    }>();
    mockGetClientDebtHistory.mockImplementation((id: number) =>
      id === 1 ? Promise.resolve(A_HISTORY) : bHistory.promise,
    );
    mockGetClientBalance.mockImplementation((id: number) =>
      id === 1
        ? Promise.resolve({
            success: true,
            data: { balance_usd: -50, balance_lbp: 0 },
          })
        : bBalance.promise,
    );

    render(<Debts />);

    // A auto-selected, fully loaded: its credit row and Cash Out are there.
    expect(await screen.findByText("A-credit-note")).toBeInTheDocument();
    expect(cashOutButton()).not.toBeNull();

    // Switch to B — B's requests are still pending.
    fireEvent.click(screen.getByText("Bob Debt"));
    expect(
      await screen.findByRole("heading", { name: "Bob Debt" }),
    ).toBeInTheDocument();

    // The bug: A's row and an active Cash Out under B's header.
    expect(screen.queryByText("A-credit-note")).toBeNull();
    expect(cashOutButton()).toBeNull();
    expect(screen.getByTestId("debts-client-loading")).toBeInTheDocument();

    // B arrives: B's data, still no Cash Out (B owes the shop).
    await act(async () => {
      bHistory.resolve(B_HISTORY);
      bBalance.resolve({
        success: true,
        data: { balance_usd: 20, balance_lbp: 0 },
      });
    });
    expect(
      await screen.findByText("Sale #9: B-charge-note"),
    ).toBeInTheDocument();
    expect(cashOutButton()).toBeNull();
    expect(screen.queryByTestId("debts-client-loading")).toBeNull();
  });

  it("drops a late response for the previous client (out-of-order)", async () => {
    const aHistory = deferred<typeof A_HISTORY>();
    const aBalance = deferred<{
      success: boolean;
      data: { balance_usd: number; balance_lbp: number };
    }>();
    mockGetClientDebtHistory.mockImplementation((id: number) =>
      id === 1 ? aHistory.promise : Promise.resolve(B_HISTORY),
    );
    mockGetClientBalance.mockImplementation((id: number) =>
      id === 1
        ? aBalance.promise
        : Promise.resolve({
            success: true,
            data: { balance_usd: 20, balance_lbp: 0 },
          }),
    );

    render(<Debts />);
    // A auto-selected but never answers before the switch.
    await screen.findByRole("heading", { name: "Alice Credit" });

    fireEvent.click(screen.getByText("Bob Debt"));
    expect(
      await screen.findByText("Sale #9: B-charge-note"),
    ).toBeInTheDocument();

    // A's answers land late — they must not replace B's.
    await act(async () => {
      aHistory.resolve(A_HISTORY);
      aBalance.resolve({
        success: true,
        data: { balance_usd: -50, balance_lbp: 0 },
      });
    });

    expect(screen.queryByText("A-credit-note")).toBeNull();
    expect(screen.getByText("Sale #9: B-charge-note")).toBeInTheDocument();
    expect(cashOutButton()).toBeNull();
  });
});
