/** @jest-environment jsdom */

/**
 * Loto — no "For Partner" during a customer session.
 *
 * Owner rule 2026-10-16: a customer session never has partner sales. While a
 * session is open the For Partner toggle is not offered, and one left ON when
 * the session starts is turned OFF (not merely hidden), so a ticket sold in
 * the session can never go out as a partner order.
 *
 * (Fixture scaffolding is shared with Loto.extraCharge.test.tsx.)
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { PaymentLine } from "@liratek/ui";
import { LotoPage } from "../index";

const mockLotoSettingsGet = jest.fn();
const mockLotoReport = jest.fn();
const mockSell = jest.fn();
const mockFetchClientVouchers = jest.fn();
const mockAddToCart = jest.fn();
const mockActiveSession: { current: { id: number } | null } = { current: null };

const SALE = 500_000;

// Rule 25: ONE stable object, never a fresh literal per useApi() call.
const mockApi = {
  loto: {
    settings: { get: mockLotoSettingsGet },
    report: mockLotoReport,
    sell: mockSell,
  },
};

const EXTRA = 10_000;
const LINES_510: PaymentLine[] = [
  { id: "l1", method: "CASH", currencyCode: "LBP", amount: SALE + EXTRA },
];

jest.mock("@liratek/ui", () => {
  const actual = jest.requireActual("@liratek/ui");
  return {
    ...actual,
    useApi: () => mockApi,
    appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
    DecimalInput: (p: { onChange: (n: number) => void }) => (
      <input
        aria-label="sale-amount"
        onChange={(e) => p.onChange(Number(e.target.value))}
      />
    ),
    MultiPaymentInput: (p: Record<string, unknown>) => {
      return (
        <>
          <button
            type="button"
            onClick={() =>
              (p.onChange as (l: PaymentLine[]) => void)(LINES_510)
            }
          >
            stub-pay
          </button>
          <button
            type="button"
            onClick={() =>
              (p.onExtraChange as ((d: number) => void) | undefined)?.(
                EXTRA + 0.4,
              )
            }
          >
            stub-extra
          </button>
        </>
      );
    },
  };
});

jest.mock("@/shared/utils/clientVouchers", () => ({
  fetchClientVouchers: (...a: unknown[]) => mockFetchClientVouchers(...a),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [],
    drawerAffectingMethods: [],
    allMethods: [],
    loading: false,
    refresh: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 90000, buyRate: 89000, isLoading: false }),
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: mockActiveSession.current,
    addToCart: mockAddToCart,
  }),
}));

jest.mock("@/shared/hooks/useAutoPrintReceipt", () => ({
  useAutoPrintReceipt: () => jest.fn(),
}));

jest.mock("@/features/recharge/utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn(async () => ({ ok: true, id: 7 })),
}));

jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));

jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: (p: {
    onClientSelect: (c: {
      id: number;
      full_name: string;
      phone_number: string;
    }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        p.onClientSelect({ id: 7, full_name: "Ali", phone_number: "70123456" })
      }
    >
      pick-client
    </button>
  ),
}));

// Interactive stubs (not the real components) so PartnerSelector's partner
// fetch stays out of the test; the page's own conditional rendering is what
// is exercised.
jest.mock("@/features/partners/components/ForPartnerToggle", () => ({
  ForPartnerToggle: (p: {
    checked: boolean;
    onChange: (v: boolean) => void;
    testId: string;
  }) => (
    <input
      type="checkbox"
      data-testid={p.testId}
      checked={p.checked}
      onChange={(e) => p.onChange(e.target.checked)}
    />
  ),
  ForPartnerNotice: (p: { testId: string; children: React.ReactNode }) => (
    <div data-testid={p.testId}>{p.children}</div>
  ),
}));

// Relative to THIS file (pages/Loto/__tests__/), not to index.tsx.
jest.mock("../../../components/StatsCards", () => ({
  StatsCards: () => null,
}));
jest.mock("../../../components/CheckpointHistory", () => ({
  CheckpointHistory: () => null,
}));
jest.mock("../../../components/TicketHistoryModal", () => ({
  TicketHistoryModal: () => null,
}));
jest.mock("../../../components/CheckpointScheduler", () => ({
  CheckpointScheduler: () => null,
}));
jest.mock("../../../components/SettlementVerification", () => ({
  SettlementVerification: () => null,
}));

const TOGGLE = "loto-for-partner-toggle";
const NOTICE = "loto-partner-no-payment-notice";

describe("LotoPage — no For Partner during a customer session", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockActiveSession.current = null;
    mockLotoSettingsGet.mockResolvedValue({ success: false });
    mockLotoReport.mockResolvedValue({ success: false });
    mockSell.mockResolvedValue({ success: true, ticket: { id: 1 } });
    mockFetchClientVouchers.mockResolvedValue([]);
  });

  it("guard: with no session the For Partner toggle is offered", () => {
    render(<LotoPage />);
    expect(screen.getByTestId(TOGGLE)).toBeInTheDocument();
  });

  it("session open: the For Partner toggle is not rendered", () => {
    mockActiveSession.current = { id: 1 };
    render(<LotoPage />);
    expect(screen.getByLabelText("sale-amount")).toBeInTheDocument();
    expect(screen.queryByTestId(TOGGLE)).not.toBeInTheDocument();
  });

  it("For Partner ON, then a session opens: it is turned OFF, and stays off when the session ends", async () => {
    const { rerender } = render(<LotoPage />);
    fireEvent.click(screen.getByTestId(TOGGLE));
    expect(screen.getByTestId(NOTICE)).toBeInTheDocument();

    mockActiveSession.current = { id: 1 };
    rerender(<LotoPage />);
    await waitFor(() =>
      expect(screen.queryByTestId(NOTICE)).not.toBeInTheDocument(),
    );
    expect(screen.queryByTestId(TOGGLE)).not.toBeInTheDocument();

    mockActiveSession.current = null;
    rerender(<LotoPage />);
    expect(screen.getByTestId(TOGGLE)).not.toBeChecked();
  });
});
