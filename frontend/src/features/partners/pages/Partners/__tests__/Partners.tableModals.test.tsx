/** @jest-environment jsdom */

/**
 * LIRA-340 — the selected partner's ledger opens in two windows, like the
 * Suppliers page: "Transactions (N)" (business with/for the partner) and
 * "Payments (N)" (settlements, write-offs, manual credit/debt). Each window
 * reads the ledger with its own `group` (defined once in core); the inline
 * table is gone from the panel.
 *
 * Rule 17: written and run before the page change; the recorded failure is
 * in the LIRA-340 report. Rule 25: `useApi()` mock returns a STABLE object.
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

const TXNS = [
  entry(1, "FOR_POS", "pos order"),
  entry(2, "THROUGH_OMT_SEND", "omt send"),
];
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

async function openPartner() {
  render(<Partners />);
  const card = await screen.findByText("Acme Partner");
  await act(async () => {
    fireEvent.click(card);
  });
}

describe("LIRA-340 — Partners page: Transactions / Payments windows", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllBalances.mockResolvedValue([PARTNER]);
    mockGetLedger.mockImplementation(
      async (_id: number, filters?: { group?: string }) =>
        statement(filters?.group === "payments" ? PAYMENTS : TXNS),
    );
  });

  it("header shows both counts from two group reads, and no inline ledger table", async () => {
    await openPartner();
    expect(
      await screen.findByTestId("partner-open-transactions"),
    ).toHaveTextContent("(2)");
    expect(screen.getByTestId("partner-open-payments")).toHaveTextContent(
      "(3)",
    );
    const groups = mockGetLedger.mock.calls.map(
      (c) => (c[1] as { group?: string } | undefined)?.group,
    );
    expect(groups).toEqual(
      expect.arrayContaining(["transactions", "payments"]),
    );
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    expect(screen.queryByText("pos order")).not.toBeInTheDocument();
  });

  it("Transactions window lists business rows and keeps the mode/provider/direction filters", async () => {
    await openPartner();
    const dialog = await openPartnerTable("transactions");
    expect(within(dialog).getByText("pos order")).toBeInTheDocument();
    expect(within(dialog).getByText("omt send")).toBeInTheDocument();
    expect(within(dialog).queryByText("split settle")).not.toBeInTheDocument();
    expect(within(dialog).getByText("All modes")).toBeInTheDocument();
    expect(within(dialog).getByText("All providers")).toBeInTheDocument();
    expect(within(dialog).getByText("All directions")).toBeInTheDocument();
  });

  it("Payments window lists settlements/write-offs/adjustments with Split as method, dates only", async () => {
    await openPartner();
    const dialog = await openPartnerTable("payments");
    expect(within(dialog).getByText("split settle")).toBeInTheDocument();
    expect(within(dialog).getByText("forgiven bit")).toBeInTheDocument();
    expect(within(dialog).getByText("paper entry")).toBeInTheDocument();
    expect(within(dialog).getByText(/SPLIT/)).toBeInTheDocument();
    expect(within(dialog).queryByText("pos order")).not.toBeInTheDocument();
    expect(within(dialog).queryByText("All modes")).not.toBeInTheDocument();
    expect(dialog.querySelectorAll('input[type="date"]')).toHaveLength(2);
  });

  it("closes on Escape, on the X and on the backdrop", async () => {
    await openPartner();
    await openPartnerTable("payments");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    const d2 = await openPartnerTable("transactions");
    fireEvent.click(within(d2).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await openPartnerTable("payments");
    fireEvent.mouseDown(screen.getByTestId("partner-table-modal-backdrop"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("a failed read shows the error with Retry, which reloads", async () => {
    mockGetLedger.mockRejectedValue(new Error("boom"));
    await openPartner();
    const dialog = await openPartnerTable("payments");
    expect(
      within(dialog).getByText("Failed to load ledger."),
    ).toBeInTheDocument();
    mockGetLedger.mockImplementation(
      async (_id: number, filters?: { group?: string }) =>
        statement(filters?.group === "payments" ? PAYMENTS : TXNS),
    );
    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: /Retry/ }));
    });
    expect(
      await within(screen.getByRole("dialog")).findByText("split settle"),
    ).toBeInTheDocument();
  });
});
