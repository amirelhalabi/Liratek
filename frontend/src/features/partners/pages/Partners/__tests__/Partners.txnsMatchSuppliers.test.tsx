/** @jest-environment jsdom */

/**
 * Owner 2026-11-07 — the Partners Transactions window matches the Suppliers
 * one: the same From / To filter with Today / Yesterday / This month, a
 * Status column (Paid / Partial · amount / Unpaid / Voided, from core's
 * `settle_status`), a Fee column when a row has a fee, and the column order
 * Type, Direction, Amount, Fee, Status, Notes, Date. Payments keeps no
 * Status / Fee but gets the same date filter.
 *
 * Rule 17: run before the page change (failure recorded in the report).
 * Rule 25: `useApi()` mock returns a STABLE object.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import Partners from "../index";
import { openPartnerTable } from "@/features/partners/testing/partnerTableModals";

const mockGetAllBalances = jest.fn();
const mockGetLedger = jest.fn();
const mockPartnersApi = {
  partners: {
    getAllBalances: mockGetAllBalances,
    getLedger: mockGetLedger,
    recordTransaction: jest.fn(),
    settle: jest.fn(),
    writeOff: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    deactivate: jest.fn(),
    activate: jest.fn(),
    getBalance: jest.fn(),
  },
};

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return { ...actual, useApi: () => mockPartnersApi };
});

jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: { id: 1, username: "admin", role: "admin" } }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

const PARTNER = {
  id: 1,
  name: "Acme Partner",
  phone: null,
  notes: null,
  is_active: 1,
  system_association: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  usd: 0,
  lbp: 0,
  usdt: 0,
};

function entry(
  id: number,
  transaction_type: string,
  notes: string,
  settlement_method: string | null = null,
) {
  return {
    id,
    partner_id: 1,
    transaction_type,
    reference_table: null,
    reference_id: null,
    amount: 10 + id,
    currency: "USD",
    direction: "DEBIT",
    notes,
    user_id: 1,
    settlement_method,
    created_at: `2026-10-0${id} 10:00:00`,
    fs_provider: null,
    fs_service_type: null,
    fs_amount: null,
    fs_currency: null,
    fs_fee: null,
    fs_customer: null,
    fs_reference_number: null,
    fs_phone_number: null,
  };
}

const PAYMENTS = [
  entry(3, "SETTLEMENT", "split settle", "SPLIT"),
  entry(4, "DISCOUNT", "forgiven bit"),
  entry(5, "ADJUSTMENT", "paper entry"),
];

function statement(entries: unknown[]) {
  return {
    partner: PARTNER,
    balance: { usd: 0, lbp: 0, usdt: 0 },
    breakdown: null,
    entries,
  };
}

jest.mock("@/shared/utils/localDay", () => {
  const actual = jest.requireActual("@/shared/utils/localDay");
  return {
    ...actual,
    localDay: () => "2026-11-07",
    localMonth: () => "2026-11",
  };
});

function withStatus(
  base: ReturnType<typeof entry>,
  settle_status: string | null,
  settle_paid: number | null,
  extra: Record<string, unknown> = {},
) {
  return { ...base, settle_status, settle_paid, ...extra };
}

const STATUS_TXNS = [
  withStatus(entry(1, "FOR_OMT_SEND", "paid row"), "PAID", 11, {
    fs_fee: 2,
    fs_currency: "USD",
  }),
  withStatus(entry(2, "FOR_OMT_SEND", "partial row"), "PARTIAL", 50),
  withStatus(entry(6, "FOR_OMT_SEND", "unpaid row"), "UNPAID", 0),
  withStatus(entry(7, "FOR_OMT_SEND", "voided row"), "VOIDED", 0),
  withStatus(entry(8, "THROUGH_BINANCE_SEND", "usdt row"), null, null),
];

async function openPartner() {
  render(<Partners />);
  const card = await screen.findByText("Acme Partner");
  await act(async () => {
    fireEvent.click(card);
  });
}

function headers(dialog: HTMLElement): string[] {
  return Array.from(dialog.querySelectorAll("thead th"))
    .map((th) => th.textContent?.trim() ?? "")
    .filter(Boolean);
}

function rowOf(dialog: HTMLElement, note: string): HTMLElement {
  return within(dialog).getByText(note).closest("tr") as HTMLElement;
}

describe("Partners Transactions window — matches Suppliers", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllBalances.mockResolvedValue([PARTNER]);
    mockGetLedger.mockImplementation(
      async (_id: number, filters?: { group?: string }) =>
        statement(filters?.group === "payments" ? PAYMENTS : STATUS_TXNS),
    );
  });

  it("columns: Type, Direction, Amount, Fee, Status, Notes, Date", async () => {
    await openPartner();
    const dialog = await openPartnerTable("transactions");
    await within(dialog).findByText("paid row");
    expect(headers(dialog)).toEqual([
      "Type",
      "Direction",
      "Amount",
      "Fee",
      "Status",
      "Notes",
      "Date",
    ]);
  });

  it("Status per row, like Suppliers; the fee shows in its own column", async () => {
    await openPartner();
    const dialog = await openPartnerTable("transactions");
    await within(dialog).findByText("paid row");
    expect(rowOf(dialog, "paid row")).toHaveTextContent("Paid");
    expect(rowOf(dialog, "paid row")).toHaveTextContent("$2.00");
    expect(rowOf(dialog, "partial row")).toHaveTextContent("Partial · $50.00");
    expect(rowOf(dialog, "unpaid row")).toHaveTextContent("Unpaid");
    expect(rowOf(dialog, "voided row")).toHaveTextContent("Voided");
    expect(rowOf(dialog, "usdt row")).not.toHaveTextContent(
      /Paid|Partial|Unpaid|Voided/,
    );
  });

  it("Today reads the window for today's shop day", async () => {
    await openPartner();
    const dialog = await openPartnerTable("transactions");
    await within(dialog).findByText("paid row");
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Today" }));
    });
    expect(mockGetLedger).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({
        group: "transactions",
        startDate: "2026-11-07",
        endDate: "2026-11-07",
      }),
    );
  });

  it("Payments: same date filter, no Status or Fee column", async () => {
    await openPartner();
    const dialog = await openPartnerTable("payments");
    await within(dialog).findByText("split settle");
    expect(
      within(dialog).getByRole("button", { name: "This month" }),
    ).toBeInTheDocument();
    expect(headers(dialog)).not.toContain("Status");
    expect(headers(dialog)).not.toContain("Fee");
  });
});
