/** @jest-environment jsdom */
/**
 * LIRA-366 (FR-002, SC-003) — a row whose transaction carries a typed note
 * (`details.note`, or Hold money's `details.notes`) shows a small note mark
 * in its Summary cell; the full note is the mark's tooltip. A row with no
 * note, a blank note, or absent/unparsable metadata shows no mark.
 *
 * Rule 17: seen failing before the mark existed.
 */
import { render, screen, waitFor } from "@testing-library/react";
import TransactionsViewer from "../TransactionsViewer";
import { getRecentTransactions } from "@/api/backendApi";

const mockUser = { id: 1, username: "tester", role: "staff" };
jest.mock("@/features/auth/context/AuthContext", () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock("@/api/backendApi", () => ({
  getRecentTransactions: jest.fn(),
  voidTransaction: jest.fn(),
  refundTransaction: jest.fn(),
  voidCheckoutGroup: jest.fn(),
  voidSessionBasket: jest.fn(),
  refundSessionBasket: jest.fn(),
  getSaleItems: jest.fn(),
  getProductUnitsForSaleItems: jest.fn().mockResolvedValue([]),
  getRefundBookedRate: jest.fn(),
}));

// rule 25: ONE identity for the whole file.
const mockApi = {
  getSessionItemRefundPreview: jest.fn(),
  refundSessionBasketItem: jest.fn(),
};
jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
}));

const mockMethods = {
  methods: [],
  drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
  allMethods: [{ code: "CASH", label: "Cash" }],
  loading: false,
  refresh: jest.fn(),
};
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => mockMethods,
}));

const mockShop = { name: "Test Shop", phone: "", location: "", logo: "" };
jest.mock("@/hooks/useShopName", () => ({
  useShopInfo: () => mockShop,
}));

const mockRate = { sellRate: 89500, buyRate: 89000, isLoading: false };
jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => mockRate,
}));

const mockGetRecentTransactions = getRecentTransactions as jest.MockedFunction<
  typeof getRecentTransactions
>;

const base = {
  type: "RECHARGE",
  status: "ACTIVE",
  source_table: "recharges",
  source_id: 77,
  user_id: 1,
  amount_usd: 20,
  amount_lbp: 0,
  exchange_rate: 89500,
  client_id: 3,
  reverses_id: null,
  device_id: null,
  created_at: "2026-11-01 09:30:00",
  username: "cashier",
  client_name: "Ali Saad",
  client_phone: "70123456",
  session_id: null,
  reversed_by_id: null,
  payments: [],
};

const row = (id: number, summary: string, metadata_json: string | null) => ({
  ...base,
  id,
  summary,
  metadata_json,
});

const details = (extra: Record<string, unknown>) =>
  JSON.stringify({ details: { v: 1, kind: "hold_money", ...extra } });

async function renderRows(rows: unknown[]) {
  mockGetRecentTransactions.mockResolvedValue(rows as never);
  render(
    <TransactionsViewer
      limit="50"
      selectedFilters={[]}
      search=""
      from=""
      to=""
    />,
  );
  await waitFor(() => screen.getByText("Noted row", { exact: false }));
}

const trOf = (summary: string) =>
  screen.getByText(summary, { exact: false }).closest("tr")!;

describe("LIRA-366 — note mark on the Transactions row", () => {
  it("shows the mark with the full note as its tooltip", async () => {
    await renderRows([
      row(1, "Noted row", details({ note: "  rest on Monday " })),
    ]);
    const mark = trOf("Noted row").querySelector(
      '[data-testid="row-note-mark"]',
    );
    expect(mark).not.toBeNull();
    expect(mark!.getAttribute("title")).toBe("rest on Monday");
    expect(mark!.textContent).toContain("rest on Monday");
  });

  it("Hold money's existing `notes` key also shows the mark", async () => {
    await renderRows([
      row(1, "Noted row", details({ note: "x" })),
      row(2, "Hold row", details({ notes: "for his son" })),
    ]);
    const mark = trOf("Hold row").querySelector(
      '[data-testid="row-note-mark"]',
    );
    expect(mark?.getAttribute("title")).toBe("for his son");
  });

  it("no note, blank note, bad or absent metadata → no mark", async () => {
    await renderRows([
      row(1, "Noted row", details({ note: "x" })),
      row(2, "Plain row", details({})),
      row(3, "Blank row", details({ note: "   " })),
      row(4, "Broken row", "{not json"),
      row(5, "Legacy row", null),
    ]);
    for (const s of ["Plain row", "Blank row", "Broken row", "Legacy row"]) {
      expect(
        trOf(s).querySelector('[data-testid="row-note-mark"]'),
      ).toBeNull();
    }
  });
});
