/** @jest-environment jsdom */

/**
 * LIRA-312 (T011) — "Wrong number…" on a card sale, "Credits…" on a
 * credits entry or a wrong-number expense, and the record panel's payload.
 *
 * - "Wrong number…" shows on an ACTIVE iPick / Katsh / Whish App card sale
 *   (also inside a session basket — the sale itself is never reversed), and
 *   not on other rows or refunded / voided ones.
 * - The panel picks the card named in the sale and sends ONE payload that
 *   equals the schema's own parse (rule 24); the `useApi` mock is stable
 *   (rule 25).
 *
 * Rule 17 note: written after the UI, so NOT proven failing-first.
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { recordWrongNumberSchema } from "@liratek/core";
import { ActionsCell, type RowActionHandlers } from "../components/TransactionCells";
import { deriveRow } from "../rowDerived";
import type { TransactionRow } from "../hooks/useTransactionRows";
import {
  isWrongNumberEligible,
  wrongNumberRecordTarget,
  WRONG_NUMBER_EXPENSE_CATEGORY,
} from "../actionGating";
import { WrongNumberPanel } from "@/features/wrongNumbers/components/WrongNumberPanel";

const mockRecordWrongNumber = jest.fn();
const mockGetActiveMobileServiceItems = jest.fn();
const mockGetAllActiveCarrierLines = jest.fn();
const mockApi = {
  recordWrongNumber: mockRecordWrongNumber,
  getActiveMobileServiceItems: mockGetActiveMobileServiceItems,
  getAllActiveCarrierLines: mockGetAllActiveCarrierLines,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
}));

function saleRow(overrides: Partial<TransactionRow> = {}): TransactionRow {
  return {
    id: 40,
    type: "FINANCIAL_SERVICE",
    status: "ACTIVE",
    source_table: "financial_services",
    source_id: 7,
    user_id: 1,
    amount_usd: 0,
    amount_lbp: 800000,
    exchange_rate: 89000,
    client_id: null,
    reverses_id: null,
    summary: "iPick SEND: alfa: Alfa 7.58 (Prepaid)",
    metadata_json: JSON.stringify({ provider: "iPick", service_type: "SEND", cost: 770000, price: 800000 }),
    device_id: null,
    created_at: "2026-10-14T10:00:00Z",
    username: "cashier",
    client_name: null,
    session_id: null,
    ...overrides,
  };
}

function buildHandlers(): RowActionHandlers {
  return {
    onPrintReceipt: jest.fn(),
    onVoid: jest.fn(),
    onRefund: jest.fn(),
    onVoidCheckoutGroup: jest.fn(),
    onVoidSessionBasket: jest.fn(),
    onRefundSessionBasket: jest.fn(),
    onRefundSessionItem: jest.fn(),
    onUndoRefund: jest.fn(),
    onWrongNumber: jest.fn(),
  };
}

function renderCell(row: TransactionRow, handlers: RowActionHandlers, sessionId: number | null = null) {
  return render(
    <table>
      <tbody>
        <tr>
          <ActionsCell
            row={row}
            derived={deriveRow(row)}
            sessionId={sessionId}
            refundLookupRowId={null}
            handlers={handlers}
          />
        </tr>
      </tbody>
    </table>,
  );
}

describe("isWrongNumberEligible", () => {
  it.each(["iPick", "Katsh", "WHISH_APP"])("an active %s card sale is eligible", (provider) => {
    expect(
      isWrongNumberEligible(
        saleRow({ metadata_json: JSON.stringify({ provider, service_type: "SEND", cost: 770000 }) }),
      ),
    ).toBe(true);
  });

  it.each([
    ["another provider", saleRow({ metadata_json: JSON.stringify({ provider: "OMT" }) })],
    [
      "a Katsh bill payment",
      saleRow({ metadata_json: JSON.stringify({ provider: "Katsh", service_type: "BILL", cost: 500000 }) }),
    ],
    [
      "a Whish App wallet transfer (no catalog cost)",
      saleRow({ metadata_json: JSON.stringify({ provider: "WHISH_APP", service_type: "SEND", cost: 0 }) }),
    ],
    ["a voided sale", saleRow({ status: "VOIDED" })],
    ["a refunded sale", saleRow({ reversed_by_id: 99 })],
    ["a reversal row", saleRow({ reverses_id: 12 })],
    ["a recharge", saleRow({ type: "RECHARGE" })],
  ])("%s is not eligible", (_label, row) => {
    expect(isWrongNumberEligible(row)).toBe(false);
  });
});

describe("ActionsCell — Wrong number… (LIRA-312)", () => {
  it("offers 'Wrong number…' on an eligible sale and opens it with the sale", () => {
    const handlers = buildHandlers();
    renderCell(saleRow(), handlers);
    fireEvent.click(screen.getByRole("button", { name: "Wrong number…" }));
    expect(handlers.onWrongNumber).toHaveBeenCalledWith({
      kind: "sale",
      saleTransactionId: 40,
      provider: "iPick",
      saleText: "iPick SEND: alfa: Alfa 7.58 (Prepaid)",
    });
  });

  it("offers it on a session basket member too", () => {
    renderCell(saleRow({ session_id: 5 }), buildHandlers(), 5);
    expect(screen.getByRole("button", { name: "Wrong number…" })).toBeInTheDocument();
  });

  it("does not offer it on a refunded sale", () => {
    renderCell(saleRow({ reversed_by_id: 99 }), buildHandlers());
    expect(screen.queryByRole("button", { name: "Wrong number…" })).not.toBeInTheDocument();
  });

  it("offers 'Credits…' on a credits entry and on the wrong-number expense", () => {
    const credits = saleRow({
      id: 60,
      type: "WRONG_NUMBER_CREDITS",
      metadata_json: JSON.stringify({ wrong_number_card_id: 3 }),
    });
    expect(wrongNumberRecordTarget(credits)).toEqual({ kind: "record", recordId: 3 });
    const expense = saleRow({
      id: 61,
      type: "EXPENSE_IPICK",
      metadata_json: JSON.stringify({ category: WRONG_NUMBER_EXPENSE_CATEGORY }),
    });
    expect(wrongNumberRecordTarget(expense)).toEqual({ kind: "expense", expenseTransactionId: 61 });
    // A plain shop-use expense is not one.
    expect(
      wrongNumberRecordTarget(
        saleRow({ type: "EXPENSE_IPICK", metadata_json: JSON.stringify({ category: "Shop_Supply" }) }),
      ),
    ).toBeNull();

    const handlers = buildHandlers();
    renderCell(credits, handlers);
    fireEvent.click(screen.getByRole("button", { name: "Credits…" }));
    expect(handlers.onWrongNumber).toHaveBeenCalledWith({ kind: "record", recordId: 3 });
  });
});

describe("WrongNumberPanel (LIRA-312)", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetActiveMobileServiceItems.mockResolvedValue([
      { id: 1, provider: "iPick", category: "mtc", subcategory: "Prepaid", label: "MTC 4.5", cost_lbp: 466000, credits: 4.5 },
      { id: 2, provider: "iPick", category: "alfa", subcategory: "Prepaid", label: "Alfa 7.58", cost_lbp: 770000, credits: 7.58 },
      { id: 3, provider: "Katsh", category: "alfa", subcategory: "Prepaid", label: "Alfa 7.58", cost_lbp: 760000, credits: 7.58 },
      { id: 4, provider: "iPick", category: "Gaming", subcategory: "PUBG", label: "60 UC", cost_lbp: 90000, credits: null },
    ]);
    mockGetAllActiveCarrierLines.mockResolvedValue([
      { id: 9, carrier: "alfa", phone_number: "03222875", is_active: 1, is_primary: 1 },
      { id: 8, carrier: "mtc", phone_number: "71000111", is_active: 1, is_primary: 1 },
    ]);
    mockRecordWrongNumber.mockResolvedValue({
      success: true,
      data: { id: 5, expense_transaction_id: 6, status: "PARTLY_RECOVERED", remaining_loss_lbp: 102000 },
    });
  });

  it("defaults to the card named in the sale and lists only that provider's MTC/Alfa cards", async () => {
    render(
      <WrongNumberPanel
        provider="iPick"
        saleTransactionId={40}
        saleText="iPick SEND: alfa: Alfa 7.58 (Prepaid)"
        onDone={jest.fn()}
        onCancel={jest.fn()}
      />,
    );
    const select = (await screen.findByLabelText(/card that was sent/i)) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("2"));
    expect(Array.from(select.options).map((o) => o.value)).toEqual(["1", "2"]);
  });

  it("sends ONE payload equal to the schema's own parse", async () => {
    const onDone = jest.fn();
    render(
      <WrongNumberPanel
        provider="iPick"
        saleTransactionId={40}
        saleText="iPick SEND: alfa: Alfa 7.58 (Prepaid)"
        onDone={onDone}
        onCancel={jest.fn()}
      />,
    );
    const select = (await screen.findByLabelText(/card that was sent/i)) as HTMLSelectElement;
    await waitFor(() => expect(select.value).toBe("2"));
    fireEvent.change(screen.getByLabelText(/wrong number/i), { target: { value: "03 111 111" } });
    fireEvent.change(screen.getByLabelText(/right number/i), { target: { value: "03 222 333" } });
    fireEvent.click(screen.getByLabelText(/credits already came back/i));
    fireEvent.change(screen.getByLabelText(/credits that arrived/i), { target: { value: "6.68" } });
    await waitFor(() =>
      expect((screen.getByLabelText(/on shop line/i) as HTMLSelectElement).value).toBe("9"),
    );
    fireEvent.click(screen.getByRole("button", { name: /record wrong number/i }));

    await waitFor(() => expect(mockRecordWrongNumber).toHaveBeenCalledTimes(1));
    const payload = mockRecordWrongNumber.mock.calls[0][0];
    expect(recordWrongNumberSchema.parse(payload)).toEqual(payload);
    expect(payload).toMatchObject({
      provider: "iPick",
      mobile_service_item_id: 2,
      sale_transaction_id: 40,
      credits_received: { amount_usd: 6.68, carrier_line_id: 9 },
    });
    expect(onDone).toHaveBeenCalledWith(5);
  });

  it("a saved sale needs the right number before anything is sent", async () => {
    render(
      <WrongNumberPanel provider="iPick" saleTransactionId={40} saleText={null} onDone={jest.fn()} onCancel={jest.fn()} />,
    );
    await screen.findByLabelText(/card that was sent/i);
    fireEvent.change(screen.getByLabelText(/wrong number/i), { target: { value: "03111111" } });
    fireEvent.click(screen.getByRole("button", { name: /record wrong number/i }));
    expect(await screen.findByText("Enter the customer's right number.")).toBeInTheDocument();
    expect(mockRecordWrongNumber).not.toHaveBeenCalled();
  });
});
