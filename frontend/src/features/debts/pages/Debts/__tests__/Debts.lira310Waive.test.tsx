/** @jest-environment jsdom */

/**
 * LIRA-310 (T009) — Waive on the Debts "Process Repayment" modal.
 *
 * The modal hides MultiPaymentInput's own discount (it cannot hold a mixed
 * USD + LBP figure), so the page takes the Waive itself: each currency's
 * part of what is left goes into the matching "Forgive (no cash)" field
 * (USD to cents, LBP whole) and is sent as the bundled repayment discount.
 * Repay mode only — a cash-out is a payout and never shows Waive.
 *
 * Rendered with the REAL repayment modal and payment sheet. Payload field
 * names are read through addRepaymentSchema (rule 24); the useApi() mock
 * returns ONE stable object (rule 25).
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import type { ReactNode } from "react";
import { addRepaymentSchema } from "@liratek/core";
import Debts from "../index";

const mockGetDebtors = jest.fn();
const mockGetClientDebtHistory = jest.fn();
const mockGetClientBalance = jest.fn();
const mockGetClientDebtTotal = jest.fn();
const mockAddRepayment = jest.fn();
const mockGetOpenDebtItems = jest.fn();

const mockApi = {
  getDebtors: (...a: unknown[]) => mockGetDebtors(...a),
  getClientDebtHistory: (...a: unknown[]) => mockGetClientDebtHistory(...a),
  getClientBalance: (...a: unknown[]) => mockGetClientBalance(...a),
  getClientDebtTotal: (...a: unknown[]) => mockGetClientDebtTotal(...a),
  addRepayment: (...a: unknown[]) => mockAddRepayment(...a),
  getOpenDebtItems: (...a: unknown[]) => mockGetOpenDebtItems(...a),
  cashOut: jest.fn(),
  addAccountEntry: jest.fn(),
  getTransactionById: jest.fn(),
  getSaleItems: jest.fn(),
  getCustomServiceById: jest.fn(),
  getSale: jest.fn(),
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    appEvents: { emit: jest.fn() },
    PageHeader: ({
      title,
      actions,
    }: {
      title: string;
      actions?: ReactNode;
    }) => (
      <div>
        <h1>{title}</h1>
        {actions}
      </div>
    ),
    Select: () => null,
    ServiceTypeTabs: () => null,
  };
});

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" } }),
}));
jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 90500, buyRate: 90000, isLoading: false }),
}));
const CASH = {
  code: "CASH",
  label: "Cash",
  affects_drawer: 1,
  drawer_name: "General",
};
const ACCOUNT = {
  code: "CUSTOMER_ACCOUNT",
  label: "Customer Account",
  affects_drawer: 0,
  drawer_name: "General",
};
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

const RATE = 90_000;

const OMT = {
  kind: "charge",
  id: 12,
  rowId: 12,
  createdAt: "2026-10-05 09:00:00",
  openUsd: 135,
  openLbp: 0,
  routingCap: { usd: 135, lbp: 0 },
  label: "OMT SEND — $135",
  type: "FINANCIAL_SERVICE",
  sessionId: null,
  isPrimary: true,
  primaryDrawer: "OMT_System",
};

function setDebt(items: unknown[], usd: number, lbp: number) {
  mockGetDebtors.mockResolvedValue([
    {
      id: 2,
      full_name: "Waive Demo",
      phone_number: "03999222",
      total_debt: usd + lbp / RATE,
      total_debt_usd: usd,
      total_debt_lbp: lbp,
    },
  ]);
  mockGetClientDebtHistory.mockResolvedValue([
    {
      id: 1,
      client_id: 2,
      transaction_id: null,
      transaction_type: "Loto Debt",
      amount_usd: usd,
      amount_lbp: lbp,
      note: "debt",
      created_at: "2026-10-01 09:00:00",
      created_by: 1,
      session_id: null,
      is_refunded: 0,
    },
  ]);
  mockGetClientDebtTotal.mockResolvedValue(usd);
  mockGetClientBalance.mockResolvedValue({
    success: true,
    data: { balance_usd: usd, balance_lbp: lbp },
  });
  mockGetOpenDebtItems.mockResolvedValue(items);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockAddRepayment.mockResolvedValue({ success: true, id: 1 });
});

const amountInputs = () =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    ),
  );
const amountValue = (i = 0) => amountInputs()[i]?.value.replace(/,/g, "");
const typeAmount = (value: string, i = 0) =>
  fireEvent.change(amountInputs()[i], { target: { value } });
// LIRA-318 — the "Forgive (no cash)" line inside the payment box.
const discountBox = (label: "Amount (USD)" | "Amount (LBP)") =>
  screen.getByTestId(
    label === "Amount (USD)" ? "debt-forgive-usd" : "debt-forgive-lbp",
  ) as HTMLInputElement;
const waive = () => screen.queryByTestId("waive-remaining");
const confirm = () => screen.getByText("Confirm Payment") as HTMLButtonElement;
const sent = () => addRepaymentSchema.parse(mockAddRepayment.mock.calls[0][0]);

it("$1.50 + 30,000 LBP left: Waive fills both discount boxes and sends them as the discount", async () => {
  setDebt([], 11.5, 120_000);
  render(<Debts />);
  fireEvent.click(await screen.findByText("Settle Debt"));
  await waitFor(() => expect(mockGetOpenDebtItems).toHaveBeenCalled());
  await waitFor(() => expect(amountInputs()).toHaveLength(2));
  typeAmount("10", 0);
  typeAmount("90000", 1);
  await waitFor(() => expect(waive()).toBeInTheDocument());
  fireEvent.click(waive()!);
  await waitFor(() => expect(discountBox("Amount (USD)").value).toBe("1.50"));
  expect(discountBox("Amount (LBP)").value).toBe("30000");
  // Remaining is gone: payment + discount settle the debt exactly.
  expect(screen.queryByTestId("remaining-row")).not.toBeInTheDocument();
  // The typed amounts are kept.
  expect(amountValue(0)).toBe("10");
  expect(amountValue(1)).toBe("90000");
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  const p = sent();
  expect(p.discount).toEqual(
    expect.objectContaining({ amount_usd: 1.5, amount_lbp: 30_000 }),
  );
  expect(p.amountUSD).toBeCloseTo(10, 2);
  expect(p.amountLBP).toBeCloseTo(90_000, 0);
});

it("adds to a discount already typed", async () => {
  setDebt([], 20, 0);
  render(<Debts />);
  fireEvent.click(await screen.findByText("Settle Debt"));
  await waitFor(() => expect(amountValue()).toBe("20"));
  fireEvent.change(discountBox("Amount (USD)"), { target: { value: "1" } });
  // LIRA-318 — a forgive amount never moves the payment.
  await waitFor(() => expect(discountBox("Amount (USD)").value).toBe("1"));
  expect(amountValue()).toBe("20");
  typeAmount("17");
  fireEvent.click(
    (await screen.findByTestId("waive-remaining")) as HTMLElement,
  );
  await waitFor(() => expect(discountBox("Amount (USD)").value).toBe("3.00"));
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  expect(sent().discount).toEqual(expect.objectContaining({ amount_usd: 3 }));
});

it("LIRA-308 picker kept: a waived gap keeps the typed amount and the ticked item", async () => {
  setDebt([OMT], 135, 0);
  render(<Debts />);
  fireEvent.click(await screen.findByText("Settle Debt"));
  await screen.findByTestId("debt-item-picker");
  await waitFor(() => expect(amountValue()).toBe("135"));
  typeAmount("133.5");
  fireEvent.click(
    (await screen.findByTestId("waive-remaining")) as HTMLElement,
  );
  await waitFor(() => expect(discountBox("Amount (USD)").value).toBe("1.50"));
  expect(amountValue()).toBe("133.5");
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  const p = sent();
  expect(p.amountUSD).toBeCloseTo(133.5, 2);
  expect(p.discount).toEqual(expect.objectContaining({ amount_usd: 1.5 }));
  expect(p.targets).toEqual([{ kind: "charge", id: 12 }]);
});

it("no Waive on a cash-out (payout)", async () => {
  setDebt([], -10.5, 0);
  render(<Debts />);
  const cashOut = await screen.findByText("Cash Out");
  fireEvent.click(cashOut);
  await waitFor(() => expect(amountInputs().length).toBeGreaterThan(0));
  expect(screen.getByText("Confirm Cash Out")).toBeInTheDocument();
  typeAmount("10");
  expect(waive()).not.toBeInTheDocument();
});
