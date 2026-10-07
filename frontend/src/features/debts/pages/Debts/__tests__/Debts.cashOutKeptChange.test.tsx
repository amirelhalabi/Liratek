/** @jest-environment jsdom */

/**
 * Debts page — kept change on a credit cash-out (owner decision 2026-10-07)
 * and the tender rate on every submit.
 *
 * A cash-out is the shop PAYING the client (payer "payout"): the sheet must
 * declare it, never offer a change/return block, and report a small kept
 * shortfall. When the cashier hands out $101 of a $101.12 credit, the credit
 * clears in full (amountUSD 101.12), the $0.12 goes out as keptChangeUSD and
 * the payout lines stay exactly what was handed over. Both submits always
 * carry tender_exchange_rate — the server now reconciles the lines at it.
 *
 * Field names asserted below are the core schema's own (debtCashOutSchema /
 * addRepaymentSchema in packages/core/src/validators/debt.ts — rule 24): the
 * payload is parsed through the schema in each test so a drifted name fails.
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { addRepaymentSchema, debtCashOutSchema } from "@liratek/core";
import Debts from "../index";

const mockGetDebtors = jest.fn();
const mockGetClientDebtHistory = jest.fn();
const mockGetClientBalance = jest.fn();
const mockGetClientDebtTotal = jest.fn();
const mockAddRepayment = jest.fn();
const mockCashOut = jest.fn();

// Rule 25: ONE stable object — a fresh literal per useApi() call is the
// unstable identity production hides.
const mockApi = {
  getDebtors: (...a: unknown[]) => mockGetDebtors(...a),
  getClientDebtHistory: (...a: unknown[]) => mockGetClientDebtHistory(...a),
  getClientBalance: (...a: unknown[]) => mockGetClientBalance(...a),
  getClientDebtTotal: (...a: unknown[]) => mockGetClientDebtTotal(...a),
  addRepayment: (...a: unknown[]) => mockAddRepayment(...a),
  cashOut: (...a: unknown[]) => mockCashOut(...a),
  addAccountEntry: jest.fn(),
  getTransactionById: jest.fn(),
  getSaleItems: jest.fn(),
  getCustomServiceById: jest.fn(),
  getSale: jest.fn(),
};

interface MpiProps {
  payer?: string;
  totalAmountCurrency?: string;
  paymentMethods?: Array<{ code: string }>;
  onChange: (lines: unknown[]) => void;
  onReturnChange?: (legs: unknown[]) => void;
  onKeptChange?: (
    kept: {
      usd: number;
      lbp: number;
      exactUsd?: number;
      exactLbp?: number;
    } | null,
  ) => void;
}
let lastMpi: MpiProps | null = null;

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    appEvents: { emit: jest.fn() },
    CounterpartySettleModal: ({
      title,
      onConfirm,
      confirmLabel,
      multiPaymentInput,
    }: {
      title: string;
      onConfirm: () => void;
      confirmLabel: string;
      multiPaymentInput: MpiProps;
    }) => {
      lastMpi = multiPaymentInput;
      return (
        <div data-testid="settle-modal">
          <h2 data-testid="settle-modal-title">{title}</h2>
          <button
            type="button"
            onClick={() =>
              multiPaymentInput.onChange([
                { id: "1", method: "CASH", currencyCode: "USD", amount: 101 },
              ])
            }
          >
            Lines USD 101
          </button>
          <button
            type="button"
            onClick={() =>
              multiPaymentInput.onChange([
                {
                  id: "1",
                  method: "CASH",
                  currencyCode: "LBP",
                  amount: 9_000_000,
                },
              ])
            }
          >
            Lines LBP 9M
          </button>
          <button
            type="button"
            onClick={() =>
              multiPaymentInput.onKeptChange?.({
                usd: 0.12,
                lbp: 0,
                exactUsd: 0.12,
                exactLbp: 0,
              })
            }
          >
            Keep USD
          </button>
          <button
            type="button"
            onClick={() =>
              multiPaymentInput.onKeptChange?.({
                usd: 0,
                lbp: 50_000,
                exactUsd: 0,
                exactLbp: 50_000,
              })
            }
          >
            Keep LBP
          </button>
          <button type="button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      );
    },
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
    Select: () => null,
    ServiceTypeTabs: () => null,
    MultiPaymentInput: () => null,
    DataTable: () => null,
  };
});

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" } }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
}));

const CASH = { code: "CASH", affects_drawer: 1 };
const ACCOUNT = { code: "CUSTOMER_ACCOUNT", affects_drawer: 0 };
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [CASH, ACCOUNT],
    drawerAffectingMethods: [CASH],
    allMethods: [CASH, ACCOUNT],
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

const DEBTOR = {
  id: 1,
  full_name: "Jane Doe",
  phone_number: "71234567",
  total_debt: 10,
  total_debt_usd: 10,
  total_debt_lbp: 0,
};

function withBalance(usd: number, lbp: number) {
  mockGetClientBalance.mockResolvedValue({
    success: true,
    data: { balance_usd: usd, balance_lbp: lbp },
  });
}

async function openCashOut() {
  render(<Debts />);
  fireEvent.click(await screen.findByText("Cash Out"));
}

describe("Debts page — credit cash-out kept change", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    lastMpi = null;
    mockGetDebtors.mockResolvedValue([DEBTOR]);
    mockGetClientDebtHistory.mockResolvedValue([]);
    mockGetClientDebtTotal.mockResolvedValue(0);
    mockCashOut.mockResolvedValue({ success: true, id: 1 });
    mockAddRepayment.mockResolvedValue({ success: true, id: 1 });
  });

  it("declares a payout sheet: payer payout, no change/return block, kept change wired, drawer methods only", async () => {
    withBalance(-101.12, 0);
    await openCashOut();
    expect(lastMpi?.payer).toBe("payout");
    expect(lastMpi?.onReturnChange).toBeUndefined();
    expect(typeof lastMpi?.onKeptChange).toBe("function");
    expect(lastMpi?.totalAmountCurrency ?? "USD").toBe("USD");
    expect(lastMpi?.paymentMethods?.map((m) => m.code)).toEqual(["CASH"]);
  });

  it("$101 handed out of a $101.12 credit: clears the full credit and sends the $0.12 as kept change", async () => {
    withBalance(-101.12, 0);
    await openCashOut();
    fireEvent.click(screen.getByText("Lines USD 101"));
    fireEvent.click(screen.getByText("Keep USD"));
    fireEvent.click(screen.getByText("Confirm Cash Out"));

    await waitFor(() => expect(mockCashOut).toHaveBeenCalled());
    const payload = debtCashOutSchema.parse(mockCashOut.mock.calls[0][0]);
    expect(payload.amountUSD).toBeCloseTo(101.12, 6);
    expect(payload.amountLBP).toBe(0);
    expect(payload.keptChangeUSD).toBeCloseTo(0.12, 6);
    expect(payload.keptChangeLBP ?? 0).toBe(0);
    expect(payload.payments).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 101 },
    ]);
    // Unedited sheet: the buy rate the sheet converted at is still sent.
    expect(payload.tender_exchange_rate).toBe(89000);
  });

  it("LBP-only credit: the sheet owes in LBP and the kept shortfall goes out in LBP", async () => {
    withBalance(0, -9_050_000);
    await openCashOut();
    expect(lastMpi?.totalAmountCurrency).toBe("LBP");
    fireEvent.click(screen.getByText("Lines LBP 9M"));
    fireEvent.click(screen.getByText("Keep LBP"));
    fireEvent.click(screen.getByText("Confirm Cash Out"));

    await waitFor(() => expect(mockCashOut).toHaveBeenCalled());
    const payload = debtCashOutSchema.parse(mockCashOut.mock.calls[0][0]);
    expect(payload.amountLBP).toBe(9_050_000);
    expect(payload.amountUSD).toBe(0);
    expect(payload.keptChangeLBP).toBe(50_000);
  });

  it("cash-out dialog says cash out (title + confirm button), not repayment", async () => {
    withBalance(-20, 0);
    await openCashOut();
    expect(screen.getByTestId("settle-modal-title").textContent).toBe(
      "Cash Out Credit",
    );
    expect(screen.getByText("Confirm Cash Out")).toBeTruthy();
    expect(screen.queryByText("Confirm Payment")).toBeNull();
    expect(screen.queryByText("Process Repayment")).toBeNull();
  });

  it("repayment dialog keeps its repayment wording", async () => {
    withBalance(10, 0);
    render(<Debts />);
    fireEvent.click(await screen.findByText("Settle Debt"));
    expect(screen.getByTestId("settle-modal-title").textContent).toBe(
      "Process Repayment",
    );
    expect(screen.getByText("Confirm Payment")).toBeTruthy();
  });

  it("mixed USD + LBP credit: kept change is not offered (the server refuses it)", async () => {
    withBalance(-50, -900_000);
    await openCashOut();
    expect(lastMpi?.payer).toBe("payout");
    expect(lastMpi?.onKeptChange).toBeUndefined();
  });

  it("repayment: the sheet's rate is sent even when the cashier never edited it", async () => {
    withBalance(10, 0);
    render(<Debts />);
    fireEvent.click(await screen.findByText("Settle Debt"));
    fireEvent.click(screen.getByText("Lines USD 101"));
    fireEvent.click(screen.getByText("Confirm Payment"));

    await waitFor(() => expect(mockAddRepayment).toHaveBeenCalled());
    const payload = addRepaymentSchema.parse(mockAddRepayment.mock.calls[0][0]);
    expect(payload.tender_exchange_rate).toBe(89000);
    expect(lastMpi?.payer ?? "customer").toBe("customer");
  });
});
