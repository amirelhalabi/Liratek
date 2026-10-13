/** @jest-environment jsdom */

/**
 * LIRA-318 (owner 2026-10-13) — Debts → Settle Debt: one "Forgive (no cash)"
 * line inside the payment box replaces the separate green "Discount /
 * Forgive" box. Typing a forgive amount NEVER moves the payment the cashier
 * sees; the sheet shows "Client will owe $X" instead of "Remaining (Debt)".
 * The repayment payload is unchanged (discount {amount_usd, amount_lbp}),
 * read back through addRepaymentSchema (rule 24). The useApi() mock returns
 * ONE stable object (rule 25).
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
  (screen.queryByTestId("debt-forgive-usd") as HTMLInputElement | null) ??
  screen.getByText("Amount (USD)").parentElement!.querySelector("input")!;
const confirm = () => screen.getByText("Confirm Payment") as HTMLButtonElement;
const sent = () => addRepaymentSchema.parse(mockAddRepayment.mock.calls[0][0]);

async function openSettle(usd: number) {
  setDebt([], usd, 0);
  render(<Debts />);
  fireEvent.click(await screen.findByText("Settle Debt"));
  await waitFor(() => expect(mockGetOpenDebtItems).toHaveBeenCalled());
  await waitFor(() => expect(amountValue()).toBe(String(usd)));
}

it("(a) owes $50: typing forgive 16 keeps the payment at 50", async () => {
  await openSettle(50);
  fireEvent.change(forgiveUsd(), { target: { value: "16" } });
  // Give any re-fill a chance to run before asserting it did not.
  await waitFor(() => expect(forgiveUsd().value).toBe("16"));
  await new Promise((r) => setTimeout(r, 50));
  expect(amountValue()).toBe("50");
});

it("(a) owes $50, pays 16, no forgive: Client will owe $34.00", async () => {
  await openSettle(50);
  typeAmount("16");
  const row = await screen.findByTestId("remaining-row");
  expect(row.textContent).toContain("Client will owe");
  expect(row.textContent).toContain("$34.00");
  expect(screen.queryByText("Remaining (Debt)")).toBeNull();
});

it("(b) forgive 20 + pay 30 on $50: After Forgive $30, owes $0.00, payload unchanged", async () => {
  await openSettle(50);
  fireEvent.change(forgiveUsd(), { target: { value: "20" } });
  typeAmount("30");
  const after = await screen.findByTestId("after-page-discount");
  expect(after.textContent).toContain("After Forgive");
  expect(after.textContent).toContain("$30.00");
  const owed = await screen.findByTestId("owed-after-row");
  expect(owed.textContent).toContain("Client will owe");
  expect(owed.textContent).toContain("$0.00");
  expect(screen.queryByTestId("remaining-row")).toBeNull();
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  const p = sent();
  expect(p.amountUSD).toBeCloseTo(30, 2);
  expect(p.discount).toEqual(expect.objectContaining({ amount_usd: 20 }));
});

it("(c) no separate Discount / Forgive box; the forgive line sits in the payment box", async () => {
  await openSettle(50);
  expect(screen.queryByText("Discount / Forgive")).toBeNull();
  expect(screen.queryByText("Amount (USD)")).toBeNull();
  expect(screen.getByText("Forgive (no cash)")).toBeInTheDocument();
  expect(screen.getByTestId("debt-forgive-usd")).toBeInTheDocument();
  expect(screen.getByTestId("debt-forgive-lbp")).toBeInTheDocument();
});

it("typing more than is due shows the cap note; within the due it goes away", async () => {
  await openSettle(50);
  fireEvent.change(forgiveUsd(), { target: { value: "70" } });
  expect(
    (await screen.findByTestId("discount-cap-note")).textContent,
  ).toContain("$50.00");
  fireEvent.change(forgiveUsd(), { target: { value: "40" } });
  await waitFor(() =>
    expect(screen.queryByTestId("discount-cap-note")).toBeNull(),
  );
});

// ── Owner decision 2026-10-13 (review follow-up) — a forgive on top of a
// payment that already covers what is ticked / due blocks Confirm, with a
// hint naming the payment to type; the ticks never change by themselves.
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

it("A $30 ticked, B $20 unticked, payment 30 + forgive 10: Confirm blocked, hint, B stays unticked", async () => {
  await openWithItems();
  fireEvent.click(box(B));
  await waitFor(() => expect(amountValue()).toBe("30"));
  fireEvent.change(forgiveUsd(), { target: { value: "10" } });
  await waitFor(() => expect(forgiveUsd().value).toBe("10"));
  await new Promise((r) => setTimeout(r, 50));
  expect(amountValue()).toBe("30");
  expect(box(B).checked).toBe(false);
  expect(confirm().disabled).toBe(true);
  const line = screen.getByTestId("debt-forgive-line");
  expect(line.textContent).toContain("Lower the payment to $20.00");
  expect(line.textContent).toContain("$10.00");
  // Lowering the payment clears the block.
  typeAmount("20");
  await waitFor(() => expect(confirm().disabled).toBe(false));
  expect(box(B).checked).toBe(false);
});

it("all ticked, owes 50: payment 50 + forgive 16 blocked; payment 34 + forgive 16 sends", async () => {
  await openWithItems();
  fireEvent.change(forgiveUsd(), { target: { value: "16" } });
  await waitFor(() => expect(confirm().disabled).toBe(true));
  expect(screen.getByTestId("debt-forgive-line").textContent).toContain(
    "Lower the payment to $34.00",
  );
  typeAmount("34");
  await waitFor(() => expect(confirm().disabled).toBe(false));
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  const p = sent();
  expect(p.amountUSD).toBeCloseTo(34, 2);
  expect(p.discount).toEqual(expect.objectContaining({ amount_usd: 16 }));
});

it("no forgive, pays 60 on 50: a genuine overpay is allowed (change box)", async () => {
  await openWithItems();
  typeAmount("60");
  expect(await screen.findByTestId("return-change")).toBeInTheDocument();
  expect(confirm().disabled).toBe(false);
});
