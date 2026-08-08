/** @jest-environment jsdom */

/**
 * TicketHistoryModal — receipt-print gating (LIRA-100).
 *
 * Proves the Print button is wired to the SHARED `isReceiptableRow` gate
 * (CLAUDE.md rule 14 — never hand-roll the receiptability predicate), not a
 * hardcoded boolean: a receiptable row gets a Print button, a non-receiptable
 * row does not. `isReceiptableRow` itself is mocked so this test controls
 * receiptability directly rather than depending on real LOTO-type business
 * data (every real `loto_tickets` row is type "LOTO", which the real
 * predicate always treats as receiptable — see receiptGating.ts's
 * ALWAYS_RECEIPTABLE_TYPES). Mocking the gate is what makes both branches of
 * the conditional exercisable at all.
 *
 * Rule 17 (failing-first proof): before this test existed, the component's
 * print-button gate was temporarily bypassed (rendering the button
 * unconditionally instead of calling `isReceiptableRow`). With the bypass in
 * place, "hides the Print button on a non-receiptable row" FAILED (the button
 * rendered even though the mock returned false) while "shows the Print
 * button on a receiptable row" still passed — proving this test actually
 * catches a removed/broken gate. The bypass was then reverted; see the
 * task report for the exact before/after.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import { TicketHistoryModal, type LotoTicketRow } from "../TicketHistoryModal";

const mockGetByDateRange = jest.fn();
const mockIsReceiptableRow = jest.fn();

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    loto: { getByDateRange: mockGetByDateRange },
    // useShopInfo() (called unconditionally for the Print handler) fetches
    // shop settings on mount.
    getAllSettings: jest.fn().mockResolvedValue([]),
  }),
}));

jest.mock("@/features/audit/receiptGating", () => ({
  isReceiptableRow: (...args: unknown[]) => mockIsReceiptableRow(...args),
}));

jest.mock("@/api/backendApi", () => ({
  getTransactionBySource: jest.fn().mockResolvedValue(null),
}));

jest.mock("@/shared/utils/serviceReceipt", () => ({
  printServiceReceiptByTransaction: jest.fn().mockResolvedValue({ ok: true }),
}));

const ticket: LotoTicketRow = {
  id: 1,
  ticket_number: "T-1001",
  sale_amount: 500000,
  commission_amount: 22250,
  currency: "LBP",
  payment_method: "CASH",
  client_name: "Jane Doe",
  sale_date: "2026-08-01",
  created_at: "2026-08-01 10:00:00",
  is_refunded: 0,
  edited_by: null,
  edited_at: null,
};

describe("TicketHistoryModal — Print button gated by isReceiptableRow", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetByDateRange.mockResolvedValue({
      success: true,
      tickets: [ticket],
    });
  });

  it("shows the Print button on a receiptable row", async () => {
    mockIsReceiptableRow.mockReturnValue(true);

    render(<TicketHistoryModal onClose={jest.fn()} />);

    await waitFor(() => screen.getByText("Jane Doe"));
    const row = screen.getByText("Jane Doe").closest("tr");
    expect(row).not.toBeNull();
    expect(
      within(row as HTMLElement).getByTitle("Print receipt"),
    ).toBeInTheDocument();
  });

  it("hides the Print button on a non-receiptable row", async () => {
    mockIsReceiptableRow.mockReturnValue(false);

    render(<TicketHistoryModal onClose={jest.fn()} />);

    await waitFor(() => screen.getByText("Jane Doe"));
    const row = screen.getByText("Jane Doe").closest("tr");
    expect(row).not.toBeNull();
    expect(
      within(row as HTMLElement).queryByTitle("Print receipt"),
    ).not.toBeInTheDocument();
  });

  it("passes the LOTO type through to the shared gate (no hand-rolled predicate)", async () => {
    mockIsReceiptableRow.mockReturnValue(true);

    render(<TicketHistoryModal onClose={jest.fn()} />);

    await waitFor(() => screen.getByText("Jane Doe"));
    expect(mockIsReceiptableRow).toHaveBeenCalledWith(
      expect.objectContaining({ type: "LOTO" }),
    );
  });
});
