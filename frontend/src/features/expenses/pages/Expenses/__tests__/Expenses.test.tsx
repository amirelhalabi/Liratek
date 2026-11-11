/**
 * Expenses — 3 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 3).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createExpenseSchema } from "@liratek/core";
import Expenses from "../index";

const mockDeleteExpense = jest.fn();

const mockGetTodayExpenses = jest.fn();

const mockAddExpense = jest.fn();

const mockApi = {
  deleteExpense: mockDeleteExpense,
  getTodayExpenses: mockGetTodayExpenses,
  addExpense: mockAddExpense,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("../components/HistoryModal", () => ({
  HistoryModal: () => <div data-testid="history-modal" />,
}));

jest.mock("../../../components/StatsCards", () => ({
  StatsCards: () => <div data-testid="stats-cards" />,
}));

jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "WHISH", label: "Whish" },
    ],
    drawerAffectingMethods: [
      { code: "CASH", label: "Cash" },
      { code: "WHISH", label: "Whish" },
    ],
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ buyRate: 89000, sellRate: 90000, isLoading: false }),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockDeleteExpense as unknown as jest.Mock).mockReset();
  (mockGetTodayExpenses as unknown as jest.Mock).mockReset();
  (mockAddExpense as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("Expenses.billAmountChange", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Owner decision 2026-10-07 — Expenses get a "Bill amount" field (payer =
   * "shop", docs/FEATURE_GUIDE.md "Kept change"). Two numbers: the bill (the
   * cost) and the cash handed (the payment line). The change fields appear
   * only when the cash handed is more than the bill; the change the vendor
   * returns comes back INTO the drawer (OUT legs on the same payload), and
   * change NOT returned is added to the cost (`kept_change_*`, checked by the
   * server). Paying exactly works as before.
   *
   * Renders the REAL `MultiPaymentInput` (only `useApi` is mocked, with a
   * stable module-level object — rule 25). Every payload is read back through
   * the shared core schema, so the field names asserted are the schema's own
   * (rule 24).
   *
   * Rule 17 note: written AFTER the page change — not proven failing-first.
   * (The pre-change page had no bill field, so `getByLabelText(/bill
   * amount/i)` could not have passed; that was not run.)
   */

  async function fillBill(value: string) {
    render(<Expenses />);
    await waitFor(() => expect(mockGetTodayExpenses).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: "Printer ink" },
    });
    fireEvent.change(screen.getByLabelText(/bill amount/i), {
      target: { value },
    });
  }

  function submittedPayload() {
    return createExpenseSchema.parse(mockAddExpense.mock.calls[0][0]);
  }

  describe("Expenses — bill amount, cash handed and change back (payer = shop)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockGetTodayExpenses.mockResolvedValue([]);
      mockAddExpense.mockResolvedValue({ success: true });
      window.alert = jest.fn();
    });

    it("paying exactly: the cash line follows the bill, no change fields, no change legs", async () => {
      await fillBill("18.50");

      expect(screen.queryByTestId("return-change")).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /record expense/i }));

      await waitFor(() => expect(mockAddExpense).toHaveBeenCalled());
      const payload = submittedPayload();
      expect(payload.amount_usd).toBe(18.5);
      expect(payload.amount_lbp).toBe(0);
      expect(payload.paid_by_method).toBe("CASH");
      expect(payload.payments).toEqual([
        { method: "CASH", currencyCode: "USD", amount: 18.5 },
      ]);
      expect(payload.kept_change_usd).toBeUndefined();
      expect(payload.kept_change_lbp).toBeUndefined();
      expect(payload.tender_exchange_rate).toBe(89000);
    });

    it("owner example: bill $18.50, hand $20, get $1 back — the $1 comes back into the drawer, $0.50 is added to the cost", async () => {
      await fillBill("18.50");

      fireEvent.change(screen.getByTestId(/^payment-amount-/), {
        target: { value: "20" },
      });
      // Overpaid → the change fields appear; the vendor hands back $1.
      expect(await screen.findByTestId("return-change")).toBeInTheDocument();
      fireEvent.change(screen.getByTestId("return-lbp"), {
        target: { value: "" },
      });
      fireEvent.change(screen.getByTestId("return-usd"), {
        target: { value: "1" },
      });
      expect(
        await screen.findByTestId("keep-change-summary"),
      ).toHaveTextContent(/added to\s+the cost/i);

      fireEvent.click(screen.getByRole("button", { name: /record expense/i }));

      await waitFor(() => expect(mockAddExpense).toHaveBeenCalled());
      const payload = submittedPayload();
      // The bill stays the bill; the server derives the $19.00 cost.
      expect(payload.amount_usd).toBe(18.5);
      expect(payload.payments).toEqual([
        { method: "CASH", currencyCode: "USD", amount: 20 },
        { method: "CASH", currencyCode: "USD", amount: 1, direction: "OUT" },
      ]);
      expect(payload.kept_change_usd).toBe(0.5);
      expect(payload.kept_change_lbp ?? 0).toBe(0);
    });

    it("refuses to submit when the cash handed is less than the bill", async () => {
      await fillBill("18.50");
      fireEvent.change(screen.getByTestId(/^payment-amount-/), {
        target: { value: "10" },
      });
      fireEvent.click(screen.getByRole("button", { name: /record expense/i }));

      await waitFor(() =>
        expect(window.alert).toHaveBeenCalledWith(
          "The cash handed is less than the bill.",
        ),
      );
      expect(mockAddExpense).not.toHaveBeenCalled();
    });

    it("refuses to submit without a bill amount", async () => {
      await fillBill("");
      fireEvent.click(screen.getByRole("button", { name: /record expense/i }));

      await waitFor(() =>
        expect(window.alert).toHaveBeenCalledWith(
          "Please enter the bill amount.",
        ),
      );
      expect(mockAddExpense).not.toHaveBeenCalled();
    });
  });
});

describe("Expenses.lira310Waive (LIRA-310)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-310 follow-up — owner rule 2026-10-12 (binding): "Waive only when
   * money comes IN to the shop and the payer hands over a little less than
   * the total. Overpaying is never a waive — it is change or customer
   * credit." An expense is money going OUT (the shop pays a vendor), so the
   * Expenses page offers NO Waive — not even for a gap under the $5 cap.
   * (Replaces the earlier US6 "the vendor accepted less" Waive.)
   *
   * Renders the REAL MultiPaymentInput (only `useApi` is mocked, with a
   * stable module-level object — rule 25); payloads are read back through the
   * shared core schema (rule 24).
   *
   * Rule 17: rewritten before the page change; red run recorded in the
   * task report.
   */

  async function fillBill(value: string) {
    render(<Expenses />);
    await waitFor(() => expect(mockGetTodayExpenses).toHaveBeenCalledTimes(1));
    fireEvent.change(screen.getByLabelText(/description/i), {
      target: { value: "Printer ink" },
    });
    fireEvent.change(screen.getByLabelText(/bill amount/i), {
      target: { value },
    });
  }

  function submittedPayload() {
    return createExpenseSchema.parse(mockAddExpense.mock.calls[0][0]);
  }

  describe("LIRA-310 follow-up — Expenses: no Waive (the shop is paying)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockGetTodayExpenses.mockResolvedValue([]);
      mockAddExpense.mockResolvedValue({ success: true });
      window.alert = jest.fn();
    });

    it("bill $52, handed $50 → the Remaining row shows but there is NO Waive", async () => {
      await fillBill("52");
      fireEvent.change(screen.getByTestId(/^payment-amount-/), {
        target: { value: "50" },
      });
      expect(await screen.findByTestId("remaining-row")).toBeInTheDocument();
      expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
      // The bill is not lowered behind the cashier's back.
      expect(screen.getByLabelText(/bill amount/i)).toHaveValue("52");
    });

    it("cents: bill $18.75, handed $18.50 → no Waive", async () => {
      await fillBill("18.75");
      fireEvent.change(screen.getByTestId(/^payment-amount-/), {
        target: { value: "18.5" },
      });
      expect(await screen.findByTestId("remaining-row")).toBeInTheDocument();
      expect(screen.queryByTestId("waive-remaining")).not.toBeInTheDocument();
    });

    it("an exact payment still records the bill as typed", async () => {
      await fillBill("52");
      fireEvent.change(screen.getByTestId(/^payment-amount-/), {
        target: { value: "52" },
      });
      fireEvent.click(screen.getByRole("button", { name: /record expense/i }));
      await waitFor(() => expect(mockAddExpense).toHaveBeenCalled());
      const payload = submittedPayload();
      expect(payload.amount_usd).toBe(52);
      expect(payload.payments).toEqual([
        { method: "CASH", currencyCode: "USD", amount: 52 },
      ]);
    });
  });
});

describe("Expenses.splitModeDisabled (LIRA-185)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-185 fix batch, part C — Expenses split-payment lead (verified by the
   * Explore-agent audit, journal wf_a89a1432-255, verify:expenses):
   *
   * "Split-payment mode: form 'Total Amount' shows only line 1 while the
   * submitted expense sums all lines (and line 2's method is dropped)".
   *
   * The audit executed the REAL `MultiPaymentInput` with the Expenses page's
   * exact prop wiring (`totals={[{amount: paymentLines[0]?.amount, currency:
   * paymentLines[0]?.currencyCode}]}`) and found: in split mode, the widget's
   * own "Total Amount" summary reflects only line 1 (it treats every line past
   * the first as an OVERPAYMENT and even offers "change" back), while
   * `handleAddExpense` sums every line's amount into `amount_usd`/`amount_lbp`
   * — and uses ONLY `paymentLines[0].method` as `paid_by_method`, silently
   * dropping a second line's own method (e.g. WHISH gets booked as CASH).
   *
   * Root cause: unlike a sale/debt, an expense has no independently-known
   * "total owed" the way `MultiPaymentInput` requires for split mode to
   * reconcile correctly — the "total" IS whatever the operator types across
   * lines, which is exactly what `totals={[...line1]}` cannot express. Fixing
   * the math would mean teaching `createExpense` (and its schema/IPC/REST
   * surfaces) to post one leg per currency+method — out of scope for a
   * frontend-only fix. Per the ticket's preferred option, SPLIT MODE IS
   * DISABLED on the Expenses page instead (`MultiPaymentInput`'s new
   * `allowSplit={false}` prop hides the Split toggle), so the page can only
   * ever submit the one line it displays — the mismatch class is made
   * unreachable rather than patched around.
   *
   * Rule 17 — proven failing-first: before the fix, `MultiPaymentInput` always
   * renders its "Split" toggle button (`data-testid="split-toggle"`) because
   * the Expenses page passed no `allowSplit` prop at all (the prop did not
   * exist). The first test below fails on the pre-fix page because the button
   * is present.
   *
   * This renders the REAL `MultiPaymentInput` from `@liratek/ui` (only
   * `useApi` is mocked) — a stubbed MultiPaymentInput (as in
   * `Expenses.addErrorMessage.test.tsx`) would hide this entire bug class,
   * same trap rule 25 describes for `useApi` identity.
   */

  describe("Expenses — split payment mode is disabled (LIRA-185)", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockGetTodayExpenses.mockResolvedValue([]);
      mockAddExpense.mockResolvedValue({ success: true });
      window.alert = jest.fn();
    });

    it("renders no Split toggle — split mode can never be entered, so a second line's method can never be silently dropped", async () => {
      render(<Expenses />);
      await waitFor(() =>
        expect(mockGetTodayExpenses).toHaveBeenCalledTimes(1),
      );

      expect(
        await screen.findByTestId("multi-payment-input"),
      ).toBeInTheDocument();
      expect(screen.queryByTestId("split-toggle")).not.toBeInTheDocument();
    });

    it("a single-line WHISH expense still submits WHISH (not CASH) at the typed amount — unaffected by the split-disable", async () => {
      render(<Expenses />);
      await waitFor(() =>
        expect(mockGetTodayExpenses).toHaveBeenCalledTimes(1),
      );

      fireEvent.change(screen.getByLabelText(/description/i), {
        target: { value: "Delivery fee" },
      });
      // Owner decision 2026-10-07: the bill is its own field; the payment
      // line below is the cash handed.
      fireEvent.change(screen.getByLabelText(/bill amount/i), {
        target: { value: "25" },
      });

      const methodSelect = await screen.findByTestId(/^payment-method-/);
      fireEvent.change(methodSelect, { target: { value: "WHISH" } });
      const amountInput = screen.getByTestId(/^payment-amount-/);
      fireEvent.change(amountInput, { target: { value: "25" } });

      fireEvent.click(screen.getByRole("button", { name: /record expense/i }));

      await waitFor(() => expect(mockAddExpense).toHaveBeenCalled());
      // Rule 24 — read the payload through the shared core schema, so the
      // field names asserted are the schema's own.
      const payload = createExpenseSchema.parse(
        mockAddExpense.mock.calls[0][0],
      );
      expect(payload.paid_by_method).toBe("WHISH");
      expect(payload.amount_usd).toBe(25);
      expect(payload.payments).toEqual([
        { method: "WHISH", currencyCode: "USD", amount: 25 },
      ]);
    });
  });
});
