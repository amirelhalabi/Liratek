/** @jest-environment jsdom */

/**
 * LIRA-310 follow-up (owner decision 2026-10-12) — on the Debts "Process
 * Repayment" modal, Waive covers ONLY the ticked items.
 *
 * Owner example: the client owes a $14 sale (unticked) and a $20 Loto
 * ticket (ticked) and pays $18.50. The sheet's Remaining row shows "$1.50
 * on ticked [Waive]" above the "$15.50 total" (one row since owner
 * 2026-10-13 — the wording update is not proven failing-first); Waive puts $1.50 in Discount / Forgive; the repayment is
 * sent with a $1.50 discount and the Loto ticket as its only target, so the
 * ticket ends at $0 and the $14 sale stays owed (the server side of that —
 * the discount walking the same ticked targets — is pinned by
 * packages/core DebtRepository.lira308.test.ts, decision 8).
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
const discountBox = (label: "Amount (USD)" | "Amount (LBP)") =>
  screen.getByText(label).parentElement!.querySelector("input")!;
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

it("owner example: $14 sale unticked, $20 Loto ticked, $18.50 paid → Waive $1.50 forgives the Loto ticket only", async () => {
  await openWithLotoTicked();
  typeAmount("18.5");
  // One Remaining row: "$1.50 on ticked [Waive]" above "$15.50 total".
  await waitFor(() => expect(tickedRow()).toBeInTheDocument());
  expect(screen.getByTestId("remaining-row").contains(tickedRow())).toBe(true);
  expect(tickedRow()!.textContent).toContain("on ticked");
  expect(tickedRow()!.textContent).toContain("1.50");
  expect(
    tickedRow()!.querySelector('[data-testid="waive-remaining"]'),
  ).not.toBeNull();
  fireEvent.click(waive()!);
  await waitFor(() => expect(discountBox("Amount (USD)").value).toBe("1.50"));
  // The typed amount and the ticks are kept; the ticked line is settled.
  expect(amountValue()).toBe("18.5");
  expect(tickedRow()).not.toBeInTheDocument();
  expect(box(SALE).checked).toBe(false);
  // The $14 sale is still owed.
  expect(screen.getByTestId("remaining-row").textContent).toContain("14");
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
