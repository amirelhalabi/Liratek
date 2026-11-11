/**
 * Loto — 2 per-ticket test files merged into one suite
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

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { lotoSellSchema } from "@liratek/core";
import { type PaymentLine } from "@liratek/ui";
import { LotoPage } from "../index";

const mockLotoSettingsGet = jest.fn();

const mockLotoReport = jest.fn();

const mockSell = jest.fn();

const mockFetchClientVouchers = jest.fn();

const TYPED_RATE = 87000;

// Rule 25: ONE stable object, never a fresh literal per useApi() call.
const mockApi = {
  loto: {
    settings: { get: mockLotoSettingsGet },
    report: mockLotoReport,
    sell: mockSell,
  },
};

const LINES: PaymentLine[] = [
  {
    id: "l1",
    method: "GIFT_CARD",
    currencyCode: "LBP",
    amount: 300000,
    voucherCode: "GC-ABC",
  },
  { id: "l2", method: "CASH", currencyCode: "USD", amount: 3 },
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
            onClick={() => (p.onChange as (l: PaymentLine[]) => void)(LINES)}
          >
            stub-pay
          </button>
          {/* The cashier hand-types a rate in the payment input. */}
          <button
            type="button"
            onClick={() =>
              (p.onExchangeRateChange as ((r: number) => void) | undefined)?.(
                TYPED_RATE,
              )
            }
          >
            stub-type-rate
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
  useSession: () => ({ activeSession: null, addToCart: jest.fn() }),
}));

jest.mock("@/shared/hooks/useAutoPrintReceipt", () => ({
  useAutoPrintReceipt: () => jest.fn(),
}));

// What ensureRechargeClient resolves to: a picked client keeps its id; a
// walk-in gets none (a name with no phone never creates a client record,
// and creating one can fail).
jest.mock("@/features/recharge/utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn(async (a: { clientId: number | null }) => ({
    ok: true,
    id: a.clientId,
  })),
}));

jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));

// Client picker stub: a text input (the typed name) plus a button that
// "picks" a saved client the way the real dropdown does.
jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: (p: {
    value: string;
    onChange: (v: string) => void;
    onClientSelect: (c: {
      id: number;
      full_name: string;
      phone_number: string;
    }) => void;
  }) => (
    <>
      <input
        aria-label="client-name"
        value={p.value}
        onChange={(e) => p.onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() =>
          p.onClientSelect({
            id: 7,
            full_name: "Ali",
            phone_number: "70123456",
          })
        }
      >
        pick-client
      </button>
    </>
  ),
}));

jest.mock("@/features/partners/components/ForPartnerToggle", () => ({
  ForPartnerToggle: () => null,
  ForPartnerNotice: () => null,
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

async function sell(): Promise<Record<string, unknown>> {
  fireEvent.change(screen.getByLabelText("sale-amount"), {
    target: { value: "570000" },
  });
  fireEvent.click(screen.getByText("stub-pay"));
  const sellButtons = screen.getAllByRole("button", { name: /sell ticket/i });
  fireEvent.click(sellButtons[sellButtons.length - 1]);
  await waitFor(() => expect(mockSell).toHaveBeenCalledTimes(1));
  return mockSell.mock.calls[0][0] as Record<string, unknown>;
}

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockLotoSettingsGet as unknown as jest.Mock).mockReset();
  (mockLotoReport as unknown as jest.Mock).mockReset();
  (mockSell as unknown as jest.Mock).mockReset();
  (mockFetchClientVouchers as unknown as jest.Mock).mockReset();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("Loto.lira366TypedNote (LIRA-366)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-366 T051 — the Loto sell form has the optional Note box. What the
   * cashier types travels as `typedNote` in the ONE sell payload (rule 22) —
   * the same object a session basket stores and replays; a blank box sends
   * nothing. Field names are read off `lotoSellSchema.parse` (rule 24).
   *
   * Harness copied from Loto.transactionDetailsPayload.test.tsx.
   * Rule 17: run against the unchanged page first and seen failing.
   */

  /**
   * LIRA-329 T029 — the Loto page sends the customer's name and phone in its
   * ONE sell payload (rule 22), so the ticket's transaction can carry them:
   *  - a typed name travels even when no client record was made for it (a
   *    name with no phone never creates one) — it used to be dropped;
   *  - the phone travels too (typed, or the picked client's).
   * Field names are read off `lotoSellSchema.parse` (rule 24), and every key
   * the page sends must survive the parse (rule 23).
   *
   * Harness copied from index.sellPayload.test.tsx.
   */

  function parseKeepingEveryKey(raw: Record<string, unknown>) {
    const parsed = lotoSellSchema.parse(raw);
    const sent = Object.keys(raw).filter((k) => raw[k] !== undefined);
    expect(Object.keys(parsed)).toEqual(expect.arrayContaining(sent));
    return parsed;
  }

  describe("LIRA-366 — Loto sell payload carries the typed note", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockLotoSettingsGet.mockResolvedValue({ success: false });
      mockLotoReport.mockResolvedValue({ success: false });
      mockSell.mockResolvedValue({ success: true, ticket: { id: 1 } });
      mockFetchClientVouchers.mockResolvedValue([]);
    });

    it("the typed note travels as typedNote", async () => {
      render(<LotoPage />);
      fireEvent.change(screen.getByTestId("payment-note"), {
        target: { value: "rest on Monday" },
      });
      const parsed = parseKeepingEveryKey(await sell());
      expect(parsed.typedNote).toBe("rest on Monday");
    });

    it("blank note: no typedNote", async () => {
      render(<LotoPage />);
      const parsed = parseKeepingEveryKey(await sell());
      expect(parsed.typedNote).toBeUndefined();
    });
  });
});

describe("Loto.transactionDetailsPayload (LIRA-329)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * LIRA-329 T029 — the Loto page sends the customer's name and phone in its
   * ONE sell payload (rule 22), so the ticket's transaction can carry them:
   *  - a typed name travels even when no client record was made for it (a
   *    name with no phone never creates one) — it used to be dropped;
   *  - the phone travels too (typed, or the picked client's).
   * Field names are read off `lotoSellSchema.parse` (rule 24), and every key
   * the page sends must survive the parse (rule 23).
   *
   * Harness copied from index.sellPayload.test.tsx.
   */

  function parseKeepingEveryKey(raw: Record<string, unknown>) {
    const parsed = lotoSellSchema.parse(raw);
    const sent = Object.keys(raw).filter((k) => raw[k] !== undefined);
    expect(Object.keys(parsed)).toEqual(expect.arrayContaining(sent));
    return parsed;
  }

  describe("LIRA-329 — Loto sell payload carries the customer's name and phone", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockLotoSettingsGet.mockResolvedValue({ success: false });
      mockLotoReport.mockResolvedValue({ success: false });
      mockSell.mockResolvedValue({ success: true, ticket: { id: 1 } });
      mockFetchClientVouchers.mockResolvedValue([]);
    });

    it("a typed name with no client record still travels", async () => {
      render(<LotoPage />);
      fireEvent.change(screen.getByLabelText("client-name"), {
        target: { value: "Walk In" },
      });
      const parsed = parseKeepingEveryKey(await sell());
      expect(parsed.clientId ?? null).toBeNull();
      expect(parsed.clientName).toBe("Walk In");
      expect(parsed.clientPhone).toBeUndefined();
    });

    it("a typed name and phone travel even when no client id came back", async () => {
      render(<LotoPage />);
      fireEvent.change(screen.getByLabelText("client-name"), {
        target: { value: "Walk In" },
      });
      fireEvent.change(screen.getByPlaceholderText("Phone"), {
        target: { value: "71222333" },
      });
      const parsed = parseKeepingEveryKey(await sell());
      expect(parsed.clientId ?? null).toBeNull();
      expect(parsed.clientName).toBe("Walk In");
      expect(parsed.clientPhone).toBe("71222333");
    });

    it("a picked client sends its id, name and phone", async () => {
      render(<LotoPage />);
      fireEvent.click(screen.getByText("pick-client"));
      const parsed = parseKeepingEveryKey(await sell());
      expect(parsed.clientId).toBe(7);
      expect(parsed.clientName).toBe("Ali");
      expect(parsed.clientPhone).toBe("70123456");
    });
  });
});
