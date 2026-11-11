/** @jest-environment jsdom */

/**
 * LIRA-383 (owner decisions 2026-11-11) — "Process Repayment" opens with
 * NOTHING ticked (reverses LIRA-308 decision 1) and the typed amount stays
 * free:
 *  - on open no item is ticked; the amount is the whole due (the same fill
 *    as a debt with no item list) and Confirm is enabled — paid oldest
 *    first (no `targets` sent);
 *  - ticking items fills the amount from the ticks; a typed amount after
 *    ticking is never overwritten (less = partial on the ticked items,
 *    more = the extra pays the next items / account as today);
 *  - no ticks + a discount is not blocked;
 *  - the picker hint is neutral, not the old "Tick what this payment is for".
 *
 * Payload field names are read through addRepaymentSchema (rule 24); the
 * useApi() mock returns ONE stable object (rule 25).
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
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000, isLoading: false }),
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

const RATE = 89_000;

// A $14 cable sale (oldest), a $20 Loto ticket, a newer $101 OMT send (cash
// drawer). Whole debt $135.
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
const OMT = {
  kind: "charge",
  id: 12,
  rowId: 12,
  createdAt: "2026-10-05 09:00:00",
  openUsd: 101,
  openLbp: 0,
  routingCap: { usd: 101, lbp: 0 },
  label: "OMT SEND — $101",
  type: "FINANCIAL_SERVICE",
  sessionId: null,
  isPrimary: true,
  primaryDrawer: "OMT_System",
};
const LBP_LOTO = {
  kind: "charge",
  id: 14,
  rowId: 14,
  createdAt: "2026-10-03 09:00:00",
  openUsd: 0,
  openLbp: 890_000,
  routingCap: null,
  label: "Loto ticket — 890,000 LBP",
  type: "LOTO",
  sessionId: null,
  isPrimary: false,
  primaryDrawer: null,
};

function setDebt(items: unknown[], usd: number, lbp: number) {
  mockGetDebtors.mockResolvedValue([
    {
      id: 2,
      full_name: "Ticks Demo",
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
  setDebt([SALE, LOTO, OMT], 135, 0);
});

async function openSettle() {
  render(<Debts />);
  fireEvent.click(await screen.findByText("Settle Debt"));
  await screen.findByTestId("debt-item-picker");
}

const row = (it: { kind: string; id: number }) =>
  screen.getByTestId(`debt-item-${it.kind}-${it.id}`);
const box = (it: { kind: string; id: number }) =>
  row(it).querySelector("input") as HTMLInputElement;
const amountInputs = () =>
  Array.from(
    document.querySelectorAll<HTMLInputElement>(
      '[data-testid^="payment-amount-"]',
    ),
  );
const amountValue = (i = 0) => amountInputs()[i]?.value.replace(/,/g, "");
const typeAmount = (value: string, i = 0) =>
  fireEvent.change(amountInputs()[i], { target: { value } });
const confirm = () => screen.getByText("Confirm Payment") as HTMLButtonElement;
const sent = () => addRepaymentSchema.parse(mockAddRepayment.mock.calls[0][0]);


it("opens with nothing ticked; the amount is the whole due and Confirm is enabled", async () => {
  await openSettle();
  await waitFor(() => expect(amountValue()).toBe("135"));
  expect(box(SALE).checked).toBe(false);
  expect(box(LOTO).checked).toBe(false);
  expect(box(OMT).checked).toBe(false);
  expect(confirm().disabled).toBe(false);
  expect(screen.queryByText("Tick what this payment is for")).toBeNull();
});

it("no ticks + a typed amount: sent with no targets (paid oldest first)", async () => {
  await openSettle();
  await waitFor(() => expect(amountValue()).toBe("135"));
  typeAmount("30");
  await waitFor(() => expect(confirm().disabled).toBe(false));
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  expect(sent().targets).toBeUndefined();
  expect(sent().amountUSD).toBeCloseTo(30, 2);
});

it("ticking one item fills its amount; a LOWER typed amount stays and pays that item partly", async () => {
  await openSettle();
  await waitFor(() => expect(amountValue()).toBe("135"));
  fireEvent.click(box(LOTO));
  await waitFor(() => expect(amountValue()).toBe("20"));
  expect(box(SALE).checked).toBe(false);
  typeAmount("8");
  await waitFor(() =>
    expect(row(LOTO).textContent).toContain("pays $8 · leaves $12"),
  );
  expect(amountValue()).toBe("8");
  expect(box(LOTO).checked).toBe(true);
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  expect(sent().targets).toEqual([{ kind: "charge", id: 11 }]);
  expect(sent().amountUSD).toBeCloseTo(8, 2);
});

it("a HIGHER typed amount after ticking is never clamped", async () => {
  await openSettle();
  await waitFor(() => expect(amountValue()).toBe("135"));
  fireEvent.click(box(LOTO));
  await waitFor(() => expect(amountValue()).toBe("20"));
  typeAmount("50");
  await waitFor(() => expect(box(OMT).checked).toBe(true));
  expect(amountValue()).toBe("50");
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  expect(sent().amountUSD).toBeCloseTo(50, 2);
  expect(sent().targets?.[0]).toEqual({ kind: "charge", id: 11 });
});

it("unticking everything goes back to the whole due", async () => {
  await openSettle();
  await waitFor(() => expect(amountValue()).toBe("135"));
  fireEvent.click(box(SALE));
  await waitFor(() => expect(amountValue()).toBe("14"));
  fireEvent.click(box(SALE));
  await waitFor(() => expect(amountValue()).toBe("135"));
});

it("no ticks + a discount: Confirm is not blocked", async () => {
  await openSettle();
  await waitFor(() => expect(amountValue()).toBe("135"));
  fireEvent.change(screen.getByTestId("settle-discount-usd"), {
    target: { value: "5" },
  });
  await waitFor(() => expect(amountValue()).toBe("130"));
  typeAmount("40");
  await waitFor(() => expect(amountValue()).toBe("40"));
  expect(confirm().disabled).toBe(false);
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  expect(sent().amountUSD).toBeCloseTo(40, 2);
  expect(sent().discount).toEqual(expect.objectContaining({ amount_usd: 5 }));
  expect(sent().targets).toBeUndefined();
});

// ── Decision 3: paid / left per item on the account history ─────────────
const ledgerRow = (
  id: number,
  type: string,
  usd: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  client_id: 2,
  transaction_id: null,
  transaction_type: type,
  amount_usd: usd,
  amount_lbp: 0,
  note: `row ${id}`,
  created_at: "2026-10-02 09:00:00",
  created_by: 1,
  session_id: null,
  is_refunded: 0,
  ...extra,
});

it("account history: paid / left on a part-paid charge, Paid on a closed one, nothing on a refunded one", async () => {
  mockGetClientDebtHistory.mockResolvedValue([
    ledgerRow(11, "Loto Debt", 20),
    ledgerRow(13, "Loto Debt", 5),
    ledgerRow(15, "Loto Debt", 7, { is_refunded: 1 }),
  ]);
  // Charge 11 has $8 left; 13 and 15 are no longer open.
  mockGetOpenDebtItems.mockResolvedValue([{ ...LOTO, openUsd: 8 }]);
  render(<Debts />);
  const partial = await screen.findByTestId("debt-row-paid-11");
  expect(partial.textContent).toContain("paid $12.00");
  expect(partial.textContent).toContain("left $8.00");
  expect((await screen.findByTestId("debt-row-paid-13")).textContent).toBe(
    "Paid",
  );
  expect(screen.queryByTestId("debt-row-paid-15")).toBeNull();
});

// ── Mixed-currency client (Corner Tech's symptom): the box follows the
//    ticked items' own currencies; nothing is converted onto an unticked
//    item of the other currency. ─────────────────────────────────────────
it("mixed client: tick only the LBP item → one LBP line of 890,000; the USD sale is never ticked or paid", async () => {
  setDebt([SALE, LBP_LOTO], 14, 890_000);
  await openSettle();
  await waitFor(() => expect(amountInputs()).toHaveLength(2));
  fireEvent.click(box(LBP_LOTO));
  await waitFor(() => expect(amountInputs()).toHaveLength(1));
  await waitFor(() => expect(amountValue()).toBe("890000"));
  expect(box(SALE).checked).toBe(false);
  expect(row(LBP_LOTO).textContent).toContain(
    "pays 890,000 LBP · leaves 0 LBP",
  );
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  const p = sent();
  expect(p.amountUSD).toBeCloseTo(0, 2);
  expect(p.amountLBP).toBeCloseTo(890_000, 0);
  expect(p.targets).toEqual([{ kind: "charge", id: 14 }]);
  expect(p.payments).toEqual([
    expect.objectContaining({ currencyCode: "LBP", amount: 890_000 }),
  ]);
});

it("mixed client (mirror): tick only the USD sale → one USD line of $14, no LBP", async () => {
  setDebt([SALE, LBP_LOTO], 14, 890_000);
  await openSettle();
  await waitFor(() => expect(amountInputs()).toHaveLength(2));
  fireEvent.click(box(SALE));
  await waitFor(() => expect(amountInputs()).toHaveLength(1));
  await waitFor(() => expect(amountValue()).toBe("14"));
  expect(box(LBP_LOTO).checked).toBe(false);
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  const p = sent();
  expect(p.amountUSD).toBeCloseTo(14, 2);
  expect(p.amountLBP).toBeCloseTo(0, 0);
  expect(p.targets).toEqual([{ kind: "sale", id: 5 }]);
  expect(p.payments).toEqual([
    expect.objectContaining({ currencyCode: "USD", amount: 14 }),
  ]);
});

it("mixed client: LBP item ticked, then the sale too → one line per currency ($14 and 890,000 LBP)", async () => {
  setDebt([SALE, LBP_LOTO], 14, 890_000);
  await openSettle();
  await waitFor(() => expect(amountInputs()).toHaveLength(2));
  fireEvent.click(box(LBP_LOTO));
  await waitFor(() => expect(amountValue()).toBe("890000"));
  fireEvent.click(box(SALE));
  await waitFor(() => expect(amountInputs()).toHaveLength(2));
  const values = amountInputs().map((x) => x.value.replace(/,/g, ""));
  expect(values.sort()).toEqual(["14", "890000"]);
  fireEvent.click(confirm());
  await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
  const p = sent();
  expect(p.amountUSD).toBeCloseTo(14, 2);
  expect(p.amountLBP).toBeCloseTo(890_000, 0);
});
