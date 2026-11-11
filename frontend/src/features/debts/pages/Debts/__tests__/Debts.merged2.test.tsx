/**
 * Debts — 2 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 2).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import {
  render,
  screen,
  fireEvent,
  act,
  waitFor,
  within,
} from "@testing-library/react";
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

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockGetDebtors as unknown as jest.Mock).mockReset();
  (mockGetClientDebtHistory as unknown as jest.Mock).mockReset();
  (mockGetClientBalance as unknown as jest.Mock).mockReset();
  (mockApi.getOpenDebtItems as unknown as jest.Mock).mockReset();
  (mockApi.getOpenDebtItems as unknown as jest.Mock).mockResolvedValue([]);
  (mockApi.getTransactionById as unknown as jest.Mock).mockReset();
  (mockApi.getSaleItems as unknown as jest.Mock).mockReset();
  (mockApi.getCustomServiceById as unknown as jest.Mock).mockReset();
  (mockApi.getSale as unknown as jest.Mock).mockReset();
  (mockApi.cashOut as unknown as jest.Mock).mockReset();
  (mockApi.addRepayment as unknown as jest.Mock).mockReset();
  (mockApi.addAccountEntry as unknown as jest.Mock).mockReset();
  (mockApi.getClientDebtTotal as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("Debts.staleClientSwitch", () => {
  beforeAll(resetBetweenFiles);

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
});

describe("Debts.voidedChargeCancellation", () => {
  beforeAll(resetBetweenFiles);

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

  const LINE = "OMT send 5,630,000 LBP";

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
        row(
          181570,
          "Service Debt",
          5630000,
          13435,
          "2026-10-27 23:33:57",
          LINE,
        ),
        row(
          181569,
          "Refund Reversal",
          -5630000,
          12708,
          "2026-10-27 23:06:07",
          "Debt cancelled by refund/void",
        ),
        row(
          181456,
          "Service Debt",
          5630000,
          12708,
          "2026-10-25 08:41:21",
          LINE,
        ),
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
});
