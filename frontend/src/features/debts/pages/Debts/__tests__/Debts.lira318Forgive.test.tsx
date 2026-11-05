/** @jest-environment jsdom */

/**
 * LIRA-318 (owner 2026-10-13) — Debts → Settle Debt: one discount line
 * inside the payment box replaces the separate green "Discount / Forgive"
 * box; the sheet shows "Client will owe $X" instead of "Remaining (Debt)".
 *
 * LIRA-372 (owner 2026-11-05) — rule 24 rewrite. The line is now the shared
 * "Discount" (capped $5 / 450,000 LBP), and LIRA-318's "a forgive NEVER
 * moves the payment" is REVERSED: typing a discount sets the payment to
 * owed − discount (ticked sum − discount with the picker), even a payment
 * typed by hand (option B). A payment edited AFTER the discount so that it
 * overshoots what is ticked still blocks Confirm with the hint. The payload
 * is read back through addRepaymentSchema (rule 24); the useApi() mock
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
const forgiveUsd = () =>
  screen.getByTestId("settle-discount-usd") as HTMLInputElement;
const confirm = () => screen.getByText("Confirm Payment") as HTMLButtonElement;
const sent = () => addRepaymentSchema.parse(mockAddRepayment.mock.calls[0][0]);

async function openSettle(usd: number) {
  setDebt([], usd, 0);
  render(<Debts />);
  fireEvent.click(await screen.findByText("Settle Debt"));
  await waitFor(() => expect(mockGetOpenDebtItems).toHaveBeenCalled());
  await waitFor(() => expect(amountValue()).toBe(String(usd)));
}

it("(a) owes $50: typing discount 4 moves the payment to 46", async () => {
  await openSettle(50);
  fireEvent.change(forgiveUsd(), { target: { value: "4" } });
  await waitFor(() => expect(amountValue()).toBe("46"));
});

it("(a) owes $50, pays 16, no discount: Client will owe $34.00", async () => {
  await openSettle(50);
  typeAmount("16");
  const row = await screen.findByTestId("remaining-row");
  expect(row.textContent).toContain("Client will owe");
  expect(row.textContent).toContain("$34.00");
  expect(screen.queryByText("Remaining (Debt)")).toBeNull();
});

it("(b) discount 5 on $50: the payment follows to 45, After Discount $45, owes $0.00, payload", async () => {
  await openSettle(50);
  fireEvent.change(forgiveUsd(), { target: { value: "5" } });
  await waitFor(() => expect(amountValue()).toBe("45"));
  const after = await screen.findByTestId("after-page-discount");
  expect(after.textContent).toContain("After Discount");
  expect(after.textContent).toContain("$45.00");
  const owed = await screen.findByTestId("owed-after-row");
  expect(owed.textContent).toContain("Client will owe");
  expect(owed.textContent).toContain("$0.00");
  expect(screen.queryByTestId("remaining-row")).toBeNull();
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  const p = sent();
  expect(p.amountUSD).toBeCloseTo(45, 2);
  expect(p.discount).toEqual(expect.objectContaining({ amount_usd: 5 }));
});

it("(c) no separate Discount / Forgive box; the Discount line sits in the payment box", async () => {
  await openSettle(50);
  expect(screen.queryByText("Discount / Forgive")).toBeNull();
  expect(screen.queryByText("Forgive (no cash)")).toBeNull();
  expect(screen.getByTestId("settle-discount-line")).toBeInTheDocument();
  expect(screen.getByTestId("settle-discount-usd")).toBeInTheDocument();
  expect(screen.getByTestId("settle-discount-lbp")).toBeInTheDocument();
});

it("typing more than the $5 cap shows the cap note; within it the note goes away", async () => {
  await openSettle(50);
  fireEvent.change(forgiveUsd(), { target: { value: "70" } });
  expect(
    (await screen.findByTestId("discount-cap-note")).textContent,
  ).toContain("$5.00");
  fireEvent.change(forgiveUsd(), { target: { value: "4" } });
  await waitFor(() =>
    expect(screen.queryByTestId("discount-cap-note")).toBeNull(),
  );
});

// ── Owner decision 2026-10-13, kept by LIRA-372 — a payment EDITED after
// the discount that covers what is ticked blocks Confirm, with a hint naming
// the payment to type; the ticks never change by themselves.
const A = {
  kind: "charge",
  id: 21,
  rowId: 21,
  createdAt: "2026-10-01 09:00:00",
  openUsd: 30,
  openLbp: 0,
  routingCap: null,
  label: "Loto ticket — $30",
  type: "LOTO",
  sessionId: null,
  isPrimary: false,
  primaryDrawer: null,
};
const B = {
  ...A,
  id: 22,
  rowId: 22,
  createdAt: "2026-10-02 09:00:00",
  openUsd: 20,
  label: "Loto ticket — $20",
};
const box = (it: { kind: string; id: number }) =>
  screen
    .getByTestId(`debt-item-${it.kind}-${it.id}`)
    .querySelector("input") as HTMLInputElement;

async function openWithItems() {
  setDebt([A, B], 50, 0);
  render(<Debts />);
  fireEvent.click(await screen.findByText("Settle Debt"));
  await screen.findByTestId("debt-item-picker");
  await waitFor(() => expect(amountValue()).toBe("50"));
}

it("A $30 ticked, B $20 unticked, discount 5: the payment drops to 25, B stays unticked", async () => {
  await openWithItems();
  fireEvent.click(box(B));
  await waitFor(() => expect(amountValue()).toBe("30"));
  fireEvent.change(forgiveUsd(), { target: { value: "5" } });
  await waitFor(() => expect(amountValue()).toBe("25"));
  expect(box(B).checked).toBe(false);
  expect(confirm().disabled).toBe(false);
});

it("A ticked, discount 5, payment edited back to 30 afterwards: Confirm blocked with the hint", async () => {
  await openWithItems();
  fireEvent.click(box(B));
  await waitFor(() => expect(amountValue()).toBe("30"));
  fireEvent.change(forgiveUsd(), { target: { value: "5" } });
  await waitFor(() => expect(amountValue()).toBe("25"));
  typeAmount("30");
  await waitFor(() => expect(confirm().disabled).toBe(true));
  const line = screen.getByTestId("settle-discount-line");
  expect(line.textContent).toContain("$25.00");
  expect(box(B).checked).toBe(false);
  typeAmount("25");
  await waitFor(() => expect(confirm().disabled).toBe(false));
});

it("no discount, pays 60 on 50: a genuine overpay is allowed (change box)", async () => {
  await openWithItems();
  typeAmount("60");
  expect(await screen.findByTestId("return-change")).toBeInTheDocument();
  expect(confirm().disabled).toBe(false);
});
