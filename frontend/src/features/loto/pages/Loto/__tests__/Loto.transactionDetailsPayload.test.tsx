/** @jest-environment jsdom */

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

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { lotoSellSchema } from "@liratek/core";
import type { PaymentLine } from "@liratek/ui";
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
jest.mock("../../../components/SettlementVerification", () => ({
  SettlementVerification: () => null,
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
