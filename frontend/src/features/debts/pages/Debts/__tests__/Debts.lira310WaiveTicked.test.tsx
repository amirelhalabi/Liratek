/** @jest-environment jsdom */

/**
 * LIRA-310 follow-up (owner decision 2026-10-12) — Waive covered ONLY the
 * ticked items. REWRITTEN for LIRA-372 (owner 2026-11-05, rule 24): Waive
 * is gone from every settle screen. The "$1.50 on ticked" remaining row
 * stays (it is driven by `waiveTotals`), but it carries no Waive button;
 * the cashier types a discount instead, and the payment follows it.
 *
 * Owner example kept: the client owes a $14 sale (unticked) and a $20 Loto
 * ticket (ticked). Typing a $1.50 discount sets the payment to $18.50 and
 * the repayment goes with the Loto ticket as its only target.
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

const SALE = {
  kind: "sale",
  id: 5,
  rowId: 5,
  createdAt: "2026-10-01 09:00:00",
  openUsd: 14,
  openLbp: 0,
  label: "Sale #5: Cable",
  type: "SALE",
  sessionId: null,
  isPrimary: false,
  primaryDrawer: null,
};
const LOTO = {
  kind: "charge",
  id: 11,
  rowId: 11,
  createdAt: "2026-10-02 09:00:00",
  openUsd: 20,
  openLbp: 0,
  routingCap: null,
  label: "Loto ticket — $20",
  type: "LOTO",
  sessionId: null,
  isPrimary: false,
  primaryDrawer: null,
};

function setDebt(items: unknown[], usd: number, lbp: number) {
  mockGetDebtors.mockResolvedValue([
    {
      id: 2,
      full_name: "Waive Ticked Demo",
      phone_number: "03999333",
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

const box = (it: { kind: string; id: number }) =>
  screen
    .getByTestId(`debt-item-${it.kind}-${it.id}`)
    .querySelector("input") as HTMLInputElement;
const amountInputs = () =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    ),
  );
const amountValue = (i = 0) => amountInputs()[i]?.value.replace(/,/g, "");
const typeAmount = (value: string, i = 0) =>
  fireEvent.change(amountInputs()[i], { target: { value } });
// LIRA-372 — the shared Discount line inside the payment box.
const discountBox = (label: "Amount (USD)" | "Amount (LBP)") =>
  screen.getByTestId(
    label === "Amount (USD)" ? "settle-discount-usd" : "settle-discount-lbp",
  ) as HTMLInputElement;
const waive = () => screen.queryByTestId("waive-remaining");
const tickedRow = () => screen.queryByTestId("remaining-ticked-row");
const confirm = () => screen.getByText("Confirm Payment") as HTMLButtonElement;
const sent = () => addRepaymentSchema.parse(mockAddRepayment.mock.calls[0][0]);

async function openWithLotoTicked() {
  setDebt([SALE, LOTO], 34, 0);
  render(<Debts />);
  fireEvent.click(await screen.findByText("Settle Debt"));
  await screen.findByTestId("debt-item-picker");
  await waitFor(() => expect(amountValue()).toBe("34"));
  // Untick the sale: the amount fills to the ticked Loto ticket.
  fireEvent.click(box(SALE));
  await waitFor(() => expect(amountValue()).toBe("20"));
  expect(box(LOTO).checked).toBe(true);
  expect(box(SALE).checked).toBe(false);
}

it("owner example: $18.50 paid on the ticked $20 Loto ticket → \"$1.50 on ticked\" with no Waive; a $1.50 discount settles it", async () => {
  await openWithLotoTicked();
  typeAmount("18.5");
  await waitFor(() => expect(tickedRow()).toBeInTheDocument());
  expect(tickedRow()!.textContent).toContain("on ticked");
  expect(tickedRow()!.textContent).toContain("1.50");
  expect(waive()).not.toBeInTheDocument();
  // The cashier types the discount; the payment follows to 18.50.
  fireEvent.change(discountBox("Amount (USD)"), { target: { value: "1.5" } });
  await waitFor(() => expect(amountValue()).toBe("18.5"));
  expect(tickedRow()).not.toBeInTheDocument();
  expect(box(SALE).checked).toBe(false);
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  const p = sent();
  expect(p.amountUSD).toBeCloseTo(18.5, 2);
  expect(p.discount).toEqual(expect.objectContaining({ amount_usd: 1.5 }));
  expect(p.targets).toEqual([{ kind: "charge", id: 11 }]);
});

it("ticked items fully paid: no Waive for the unticked remainder", async () => {
  // Whole debt $21: a $1 sale unticked + the $20 Loto ticket ticked.
  setDebt([{ ...SALE, openUsd: 1 }, LOTO], 21, 0);
  render(<Debts />);
  fireEvent.click(await screen.findByText("Settle Debt"));
  await screen.findByTestId("debt-item-picker");
  await waitFor(() => expect(amountValue()).toBe("21"));
  fireEvent.click(box(SALE));
  await waitFor(() => expect(amountValue()).toBe("20"));
  // $1 of the whole debt is left, but none of it is ticked.
  expect(screen.getByTestId("remaining-row")).toBeInTheDocument();
  expect(waive()).not.toBeInTheDocument();
});
