/** @jest-environment jsdom */

/**
 * Owner 2026-11-07 (CornerTag) — the partner page shows a History list
 * under the balances, like the Suppliers Purchase History: EVERY ledger row
 * (transactions, payments, discounts, adjustments) in one list, newest
 * first, with the balance after each row (core's `balance_after`, same sign
 * and colour as the balance cards). The two windows stay.
 *
 * Rule 25: `useApi()` mock returns a STABLE object.
 */

import { act, fireEvent, render, screen, within } from "@testing-library/react";
import Partners from "../index";

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
  name: "Karim",
  phone: null,
  notes: null,
  is_active: 1,
  system_association: null,
  created_at: "2026-08-01T00:00:00Z",
  updated_at: "2026-08-01T00:00:00Z",
  usd: 245,
  lbp: 0,
  usdt: 0,
};

function row(
  id: number,
  transaction_type: string,
  direction: "DEBIT" | "CREDIT",
  amount: number,
  balance_after: number,
  notes: string,
) {
  return {
    id,
    partner_id: 1,
    transaction_type,
    reference_table: null,
    reference_id: null,
    amount,
    currency: "USD",
    direction,
    notes,
    user_id: 1,
    settlement_method: null,
    created_at: `2026-10-2${id} 10:00:00`,
    fs_provider: null,
    fs_service_type: null,
    fs_amount: null,
    fs_currency: null,
    fs_fee: null,
    fs_customer: null,
    fs_reference_number: null,
    fs_phone_number: null,
    balance_after,
  };
}

// Newest first, as core returns it.
const HISTORY = [
  row(5, "FOR_OMT_SEND", "DEBIT", 100, 245, "send to Saida"),
  row(4, "DISCOUNT", "CREDIT", 5, 145, "settle discount"),
  row(3, "SETTLEMENT", "CREDIT", 350, 150, "cash settle"),
  row(2, "FOR_OMT_SEND", "DEBIT", 200, 500, "send to Tyre"),
  row(1, "FOR_OMT_SEND", "DEBIT", 300, 300, "send to Beirut"),
];

async function openPartner() {
  render(<Partners />);
  const card = await screen.findByText("Karim");
  await act(async () => {
    fireEvent.click(card);
  });
}

describe("Partner page — History list", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetAllBalances.mockResolvedValue([PARTNER]);
    mockGetLedger.mockImplementation(
      async (_id: number, filters?: { group?: string }) => ({
        partner: PARTNER,
        balance: { usd: 245, lbp: 0, usdt: 0 },
        breakdown: null,
        entries: filters?.group ? [] : HISTORY,
      }),
    );
  });

  it("reads every row (no group) and shows them with a Balance column", async () => {
    await openPartner();
    const list = await screen.findByTestId("partner-history");
    await within(list).findByText("cash settle");

    expect(mockGetLedger).toHaveBeenCalledWith(1);
    const heads = Array.from(list.querySelectorAll("thead th"))
      .map((th) => th.textContent?.trim() ?? "")
      .filter(Boolean);
    expect(heads).toEqual([
      "Type",
      "Direction",
      "Amount",
      "Balance",
      "Notes",
      "Date",
    ]);

    const notes = Array.from(list.querySelectorAll("tbody tr")).map(
      (tr) => tr.textContent ?? "",
    );
    expect(notes).toHaveLength(5);
    expect(notes[0]).toContain("send to Saida");
    expect(notes[0]).toContain("$245.00");
    expect(notes[1]).toContain("settle discount");
    expect(notes[1]).toContain("$145.00");
    expect(notes[2]).toContain("cash settle");
    expect(notes[2]).toContain("$150.00");
    expect(notes[4]).toContain("$300.00");
  });

  it("the windows keep their own lists", async () => {
    await openPartner();
    await screen.findByTestId("partner-history");
    expect(screen.getByTestId("partner-open-transactions")).toBeInTheDocument();
    expect(screen.getByTestId("partner-open-payments")).toBeInTheDocument();
  });
});
