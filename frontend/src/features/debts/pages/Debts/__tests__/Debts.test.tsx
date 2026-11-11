/**
 * Debts — 4 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 4).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import { type ReactNode } from "react";
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

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockGetDebtors as unknown as jest.Mock).mockReset();
  (mockGetClientDebtHistory as unknown as jest.Mock).mockReset();
  (mockGetClientBalance as unknown as jest.Mock).mockReset();
  (mockGetClientDebtTotal as unknown as jest.Mock).mockReset();
  (mockAddRepayment as unknown as jest.Mock).mockReset();
  (mockGetOpenDebtItems as unknown as jest.Mock).mockReset();
  (mockApi.cashOut as unknown as jest.Mock).mockReset();
  (mockApi.addAccountEntry as unknown as jest.Mock).mockReset();
  (mockApi.getTransactionById as unknown as jest.Mock).mockReset();
  (mockApi.getSaleItems as unknown as jest.Mock).mockReset();
  (mockApi.getCustomServiceById as unknown as jest.Mock).mockReset();
  (mockApi.getSale as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("Debts.lira310Waive (LIRA-310)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-310 (T009) — Waive on the Debts "Process Repayment" modal, REWRITTEN
   * for LIRA-372 (owner 2026-11-05, rule 24): no settle screen shows Waive
   * any more; the cashier types the discount in the shared Discount line and
   * the payment follows it. These cases are now guards that Waive is NOT
   * offered for a short payment (mixed currency, picker, typed discount, and
   * cash-out), and that a short payment is sent as typed, with no discount
   * invented for the gap.
   *
   * Rendered with the REAL repayment modal and payment sheet. Payload field
   * names are read through addRepaymentSchema (rule 24); the useApi() mock
   * returns ONE stable object (rule 25).
   */

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
  // LIRA-372 — the shared Discount line inside the payment box.
  const discountBox = (label: "Amount (USD)" | "Amount (LBP)") =>
    screen.getByTestId(
      label === "Amount (USD)" ? "settle-discount-usd" : "settle-discount-lbp",
    ) as HTMLInputElement;
  const waive = () => screen.queryByTestId("waive-remaining");
  const confirm = () =>
    screen.getByText("Confirm Payment") as HTMLButtonElement;
  const sent = () =>
    addRepaymentSchema.parse(mockAddRepayment.mock.calls[0][0]);

  it("$1.50 + 30,000 LBP left: no Waive; the short payment is sent as typed, no discount", async () => {
    setDebt([], 11.5, 120_000);
    render(<Debts />);
    fireEvent.click(await screen.findByText("Settle Debt"));
    await waitFor(() => expect(mockGetOpenDebtItems).toHaveBeenCalled());
    await waitFor(() => expect(amountInputs()).toHaveLength(2));
    typeAmount("10", 0);
    typeAmount("90000", 1);
    await screen.findByTestId("remaining-row");
    expect(waive()).not.toBeInTheDocument();
    expect(discountBox("Amount (USD)").value).toBe("");
    fireEvent.click(confirm());
    await waitFor(() => expect(mockAddRepayment).toHaveBeenCalledTimes(1));
    const p = sent();
    expect(p.discount).toBeUndefined();
    expect(p.amountUSD).toBeCloseTo(10, 2);
    expect(p.amountLBP).toBeCloseTo(90_000, 0);
  });

  it("a typed discount moves the payment; a later short payment shows no Waive", async () => {
    setDebt([], 20, 0);
    render(<Debts />);
    fireEvent.click(await screen.findByText("Settle Debt"));
    await waitFor(() => expect(amountValue()).toBe("20"));
    fireEvent.change(discountBox("Amount (USD)"), { target: { value: "1" } });
    await waitFor(() => expect(amountValue()).toBe("19"));
    typeAmount("17");
    await screen.findByTestId("remaining-row");
    expect(waive()).not.toBeInTheDocument();
  });

  it("LIRA-308 picker kept: a short payment on a ticked item shows no Waive", async () => {
    setDebt([OMT], 135, 0);
    render(<Debts />);
    fireEvent.click(await screen.findByText("Settle Debt"));
    await screen.findByTestId("debt-item-picker");
    await waitFor(() => expect(amountValue()).toBe("135"));
    typeAmount("133.5");
    await screen.findByTestId("remaining-row");
    expect(waive()).not.toBeInTheDocument();
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
});

describe("Debts.lira310WaiveTicked (LIRA-310)", () => {
  beforeAll(resetBetweenFiles);

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
  const confirm = () =>
    screen.getByText("Confirm Payment") as HTMLButtonElement;
  const sent = () =>
    addRepaymentSchema.parse(mockAddRepayment.mock.calls[0][0]);

  async function openWithLotoTicked() {
    setDebt([SALE, LOTO], 34, 0);
    render(<Debts />);
    fireEvent.click(await screen.findByText("Settle Debt"));
    await screen.findByTestId("debt-item-picker");
    await waitFor(() => expect(amountValue()).toBe("34"));
    // LIRA-383 — nothing is ticked on open: tick the Loto ticket; the
    // amount fills to it.
    fireEvent.click(box(LOTO));
    await waitFor(() => expect(amountValue()).toBe("20"));
    expect(box(LOTO).checked).toBe(true);
    expect(box(SALE).checked).toBe(false);
  }

  it('owner example: $18.50 paid on the ticked $20 Loto ticket → "$1.50 on ticked" with no Waive; a $1.50 discount settles it', async () => {
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
    // LIRA-383 — nothing ticked on open: tick only the Loto ticket.
    fireEvent.click(box(LOTO));
    await waitFor(() => expect(amountValue()).toBe("20"));
    // $1 of the whole debt is left, but none of it is ticked.
    expect(screen.getByTestId("remaining-row")).toBeInTheDocument();
    expect(waive()).not.toBeInTheDocument();
  });
});

describe("Debts.lira318Forgive (LIRA-318)", () => {
  beforeAll(resetBetweenFiles);

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
  const confirm = () =>
    screen.getByText("Confirm Payment") as HTMLButtonElement;
  const sent = () =>
    addRepaymentSchema.parse(mockAddRepayment.mock.calls[0][0]);

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
  // LIRA-383 — nothing is ticked on open; the cases below start from
  // everything ticked (the LIRA-318 premise) and untick B.
  async function openWithAllTicked() {
    await openWithItems();
    fireEvent.click(box(A));
    fireEvent.click(box(B));
    await waitFor(() => expect(box(B).checked).toBe(true));
    await waitFor(() => expect(amountValue()).toBe("50"));
  }

  it("A $30 ticked, B $20 unticked, discount 5: the payment drops to 25, B stays unticked", async () => {
    await openWithAllTicked();
    fireEvent.click(box(B));
    await waitFor(() => expect(amountValue()).toBe("30"));
    fireEvent.change(forgiveUsd(), { target: { value: "5" } });
    await waitFor(() => expect(amountValue()).toBe("25"));
    expect(box(B).checked).toBe(false);
    expect(confirm().disabled).toBe(false);
  });

  it("A ticked, discount 5, payment edited back to 30 afterwards: Confirm blocked with the hint", async () => {
    await openWithAllTicked();
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
});

describe("Debts.lira372Discount (LIRA-372)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-372 (owner 2026-11-05) — Debts → Settle Debt (picker and calendar
   * share this modal) shows the ONE shared "Discount" line, capped at $5 /
   * 450,000 LBP (bigger amounts go through the admin Write off), with no
   * Waive. Typing a discount sets the payment to owed − discount — also when
   * the cashier typed the payment by hand first (owner option B). Payload
   * read back through addRepaymentSchema (rule 24); the useApi() mock is ONE
   * stable object (rule 25).
   */

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
  const confirm = () =>
    screen.getByText("Confirm Payment") as HTMLButtonElement;
  const sent = () =>
    addRepaymentSchema.parse(mockAddRepayment.mock.calls[0][0]);

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
    await waitFor(() =>
      expect([amountValue(0), amountValue(1)]).toEqual(["11.5", "120000"]),
    );
    fireEvent.change(discountUsd(), { target: { value: "1" } });
    await waitFor(() =>
      expect([amountValue(0), amountValue(1)]).toEqual(["10.5", "120000"]),
    );
  });
});
