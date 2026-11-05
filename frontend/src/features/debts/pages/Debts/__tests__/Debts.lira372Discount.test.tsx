/** @jest-environment jsdom */

/**
 * LIRA-372 (owner 2026-11-05) — Debts → Settle Debt (picker and calendar
 * share this modal) shows the ONE shared "Discount" line, capped at $5 /
 * 450,000 LBP (bigger amounts go through the admin Write off), with no
 * Waive. Typing a discount sets the payment to owed − discount — also when
 * the cashier typed the payment by hand first (owner option B). Payload
 * read back through addRepaymentSchema (rule 24); the useApi() mock is ONE
 * stable object (rule 25).
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
const discountUsd = () =>
  screen.getByTestId("settle-discount-usd") as HTMLInputElement;
const discountLbp = () =>
  screen.getByTestId("settle-discount-lbp") as HTMLInputElement;
const confirm = () => screen.getByText("Confirm Payment") as HTMLButtonElement;
const sent = () => addRepaymentSchema.parse(mockAddRepayment.mock.calls[0][0]);

async function openSettle(usd: number, lbp = 0) {
  setDebt([], usd, lbp);
  render(<Debts />);
  fireEvent.click(await screen.findByText("Settle Debt"));
  await waitFor(() => expect(mockGetOpenDebtItems).toHaveBeenCalled());
  await waitFor(() => expect(amountValue()).toBe(String(usd || lbp)));
}

const ITEM = {
  kind: "charge",
  id: 21,
  rowId: 21,
  createdAt: "2026-10-01 09:00:00",
  openUsd: 412.5,
  openLbp: 0,
  routingCap: null,
  label: "Loto ticket — $412.50",
  type: "LOTO",
  sessionId: null,
  isPrimary: false,
  primaryDrawer: null,
};

async function openWithItem() {
  setDebt([ITEM], 412.5, 0);
  render(<Debts />);
  fireEvent.click(await screen.findByText("Settle Debt"));
  await screen.findByTestId("debt-item-picker");
  await waitFor(() => expect(amountValue()).toBe("412.5"));
}


it("the line is labelled Discount, with a USD and an LBP field", async () => {
  await openSettle(100);
  const line = screen.getByTestId("settle-discount-line");
  expect(line.textContent).toContain("Discount");
  expect(screen.queryByText("Forgive (no cash)")).toBeNull();
  expect(discountUsd()).toBeInTheDocument();
  expect(discountLbp()).toBeInTheDocument();
});

it("typed 20 on a $100 due is capped at $5 with the note, and 5 is sent", async () => {
  await openSettle(100);
  fireEvent.change(discountUsd(), { target: { value: "20" } });
  expect((await screen.findByTestId("discount-cap-note")).textContent).toBe(
    "Capped to max ($5.00)",
  );
  await waitFor(() => expect(amountValue()).toBe("95"));
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  const p = sent();
  expect(p.discount).toEqual(
    expect.objectContaining({ amount_usd: 5, amount_lbp: 0 }),
  );
  expect(p.amountUSD).toBeCloseTo(95, 2);
});

it("LBP 900,000 due, discount 500,000 → capped at 450,000, pay line 450,000", async () => {
  await openSettle(0, 900_000);
  fireEvent.change(discountLbp(), { target: { value: "500000" } });
  expect((await screen.findByTestId("discount-cap-note")).textContent).toBe(
    "Capped to max (450,000 LBP)",
  );
  await waitFor(() => expect(amountValue()).toBe("450000"));
});

it("no picker, $500 due, discount 5 → the pay line reads 495", async () => {
  await openSettle(500);
  fireEvent.change(discountUsd(), { target: { value: "5" } });
  await waitFor(() => expect(amountValue()).toBe("495"));
});

it("picker, $412.50 ticked, discount 2.50 → the pay line reads 410", async () => {
  await openWithItem();
  fireEvent.change(discountUsd(), { target: { value: "2.5" } });
  await waitFor(() => expect(amountValue()).toBe("410"));
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  const p = sent();
  expect(p.amountUSD).toBeCloseTo(410, 2);
  expect(p.discount).toEqual(expect.objectContaining({ amount_usd: 2.5 }));
});

it("a payment typed by hand ($412.50) is lowered to $410 when 2.50 is typed (owner option B)", async () => {
  await openWithItem();
  typeAmount("412.5");
  fireEvent.change(discountUsd(), { target: { value: "2.5" } });
  await waitFor(() => expect(amountValue()).toBe("410"));
  expect(confirm().disabled).toBe(false);
});

it("no Waive button on a payment $2 short", async () => {
  await openSettle(100);
  typeAmount("98");
  await screen.findByTestId("remaining-row");
  expect(screen.queryByTestId("waive-remaining")).toBeNull();
});

it("two-currency due ($11.50 + 120,000 LBP): a USD discount lowers only the USD line", async () => {
  setDebt([], 11.5, 120_000);
  render(<Debts />);
  fireEvent.click(await screen.findByText("Settle Debt"));
  await waitFor(() => expect(amountInputs()).toHaveLength(2));
  await waitFor(() => expect([amountValue(0), amountValue(1)]).toEqual(["11.5", "120000"]));
  fireEvent.change(discountUsd(), { target: { value: "1" } });
  await waitFor(() => expect([amountValue(0), amountValue(1)]).toEqual(["10.5", "120000"]));
});
