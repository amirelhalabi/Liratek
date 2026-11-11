/**
 * Partners — 2 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 2).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
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

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockGetAllBalances as unknown as jest.Mock).mockReset();
  (mockGetLedger as unknown as jest.Mock).mockReset();
  (
    mockPartnersApi.partners.recordTransaction as unknown as jest.Mock
  ).mockReset();
  (mockPartnersApi.partners.settle as unknown as jest.Mock).mockReset();
  (mockPartnersApi.partners.writeOff as unknown as jest.Mock).mockReset();
  (mockPartnersApi.partners.create as unknown as jest.Mock).mockReset();
  (mockPartnersApi.partners.update as unknown as jest.Mock).mockReset();
  (mockPartnersApi.partners.deactivate as unknown as jest.Mock).mockReset();
  (mockPartnersApi.partners.activate as unknown as jest.Mock).mockReset();
  (mockPartnersApi.partners.getBalance as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("Partners.historyList", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Owner 2026-11-07 (CornerTag) — the partner page shows a History list
   * under the balances, like the Suppliers Purchase History: EVERY ledger row
   * (transactions, payments, discounts, adjustments) in one list, newest
   * first, with the balance after each row (core's `balance_after`, same sign
   * and colour as the balance cards). The two windows stay.
   *
   * Rule 25: `useApi()` mock returns a STABLE object.
   */

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
      expect(
        screen.getByTestId("partner-open-transactions"),
      ).toBeInTheDocument();
      expect(screen.getByTestId("partner-open-payments")).toBeInTheDocument();
    });
  });
});

describe("Partners.tableModals (LIRA-340)", () => {
  beforeAll(resetBetweenFiles);

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

    it("header shows both counts from two group reads; the only inline table is History", async () => {
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
      // Owner 2026-11-07 (CornerTag): the History list (every row) is now on
      // the page; the Transactions / Payments tables still open in windows.
      const history = await screen.findByTestId("partner-history");
      const tables = screen.queryAllByRole("table");
      expect(tables).toHaveLength(1);
      expect(history).toContainElement(tables[0]);
    });

    it("Transactions window lists business rows and keeps the mode/provider/direction filters", async () => {
      await openPartner();
      const dialog = await openPartnerTable("transactions");
      expect(within(dialog).getByText("pos order")).toBeInTheDocument();
      expect(within(dialog).getByText("omt send")).toBeInTheDocument();
      expect(
        within(dialog).queryByText("split settle"),
      ).not.toBeInTheDocument();
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
});
