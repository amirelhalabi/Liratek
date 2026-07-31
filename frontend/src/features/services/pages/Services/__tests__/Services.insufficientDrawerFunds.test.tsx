/** @jest-environment jsdom */

/**
 * Services page — RECEIVE insufficient-funds recovery (Primary Cash Drawer
 * plan §8.5, owner decision #11): "Block, and show an inline button 'move
 * remaining from General' with a USD/LBP currency toggle; after the transfer
 * the transaction proceeds."
 *
 * The handover (§4.1 of the OMT float-model handover, echoed in the task
 * brief) warns that 42/84 desktop e2e specs build IPC payloads by hand and
 * never touch the UI — this is exactly the seam that misses. This file
 * MOUNTS the real page (same approach as Services.legsGate.test.tsx /
 * Services.tenderRate.test.tsx) and drives it through a blocked RECEIVE:
 *
 *   1. Submit is rejected with the structured `INSUFFICIENT_DRAWER_FUNDS`
 *      envelope (`addOMTTransaction` resolves `{ success:false, code, error,
 *      details }` — mirroring what `FinancialService.addTransaction` now
 *      returns over the wire, per `FinancialService.errorEnvelope.test.ts`).
 *   2. The shortfall panel renders with the right drawer/currency/amount.
 *   3. Clicking "Move & Retry" calls `transferBetweenDrawers` with the
 *      correct fromDrawer/toDrawer/amounts.
 *   4. The ORIGINAL payload is resubmitted BYTE-IDENTICALLY — the
 *      implementation deliberately snapshots the payload (`payload,
 *      linkTotal` captured in `insufficientFundsError` state) rather than
 *      recomputing it from live form state on retry, and that snapshot
 *      property is exactly what this test pins (index.tsx's own comment:
 *      "the exact same payload can be retried, unmodified").
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Services from "../index";

const mockAddOMTTransaction = jest.fn();
const mockTransferBetweenDrawers = jest.fn();
const mockGetOMTHistory = jest.fn().mockResolvedValue([]);
const mockGetOMTAnalytics = jest.fn().mockResolvedValue({
  today: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
  month: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
  byProvider: [],
});
const mockGetSuppliers = jest.fn().mockResolvedValue([]);
const mockGetSupplierBalances = jest.fn().mockResolvedValue([]);
const mockPartnersGetAll = jest.fn().mockResolvedValue([]);

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => ({
    getOMTHistory: mockGetOMTHistory,
    getOMTAnalytics: mockGetOMTAnalytics,
    getSuppliers: mockGetSuppliers,
    getSupplierBalances: mockGetSupplierBalances,
    partners: { getAll: mockPartnersGetAll },
    addOMTTransaction: mockAddOMTTransaction,
    transferBetweenDrawers: mockTransferBetweenDrawers,
  }),
  // No payment-line injection needed for this flow (a CASH RECEIVE with no
  // split legs falls back to the repository's single-currency no-legs path)
  // — the stub only needs to exist so the page can mount.
  MultiPaymentInput: ({
    onChange,
    onExchangeRateChange,
  }: {
    onChange: (lines: unknown[]) => void;
    onExchangeRateChange?: (rate: number) => void;
  }) => (
    <div data-testid="stub-multi-payment-input">
      <button
        data-testid="mpi-noop"
        onClick={() => {
          onChange([]);
          onExchangeRateChange?.(89000);
        }}
      />
    </div>
  ),
  // Extends the legsGate/tenderRate stub with `data-testid` passthrough —
  // the shortfall panel's transfer-amount field needs to be queryable.
  DecimalInput: ({
    id,
    value,
    onChange,
    placeholder,
    className,
    "data-testid": dataTestId,
  }: {
    id?: string;
    value: number;
    onChange: (n: number) => void;
    placeholder?: string;
    className?: string;
    "data-testid"?: string;
  }) => (
    <input
      id={id}
      data-testid={dataTestId}
      type="text"
      inputMode="decimal"
      value={value === 0 ? "" : String(value)}
      placeholder={placeholder}
      className={className}
      onChange={(e) =>
        onChange(parseFloat(e.target.value.replace(/,/g, "")) || 0)
      }
    />
  ),
  Select: ({
    value,
    onChange,
    options,
  }: {
    value: string;
    onChange: (v: string) => void;
    options: { value: string; label: string }[];
  }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  DataTable: () => <div data-testid="data-table" />,
  TopUpModal: () => null,
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [
      { code: "CASH", label: "Cash" },
      { code: "OMT", label: "OMT Wallet" },
    ],
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000 }),
}));

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: "OMT",
    partnerSystem: "WHISH",
    loading: false,
  }),
}));

jest.mock("@/shared/hooks/useModalFocusFix", () => ({
  useModalFocusFix: () => {},
}));

jest.mock("@/shared/hooks/useSaveAsClient", () => ({
  useSaveAsClient: () => ({
    saveAsClient: false,
    setSaveAsClient: jest.fn(),
    showCheckbox: false,
    trySaveAsClient: jest.fn().mockResolvedValue({ clientId: null }),
    resetSaveAsClient: jest.fn(),
  }),
}));

jest.mock("@/shared/components/SaveAsClientCheckbox", () => ({
  SaveAsClientCheckbox: () => null,
}));

jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));

jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: () => null,
}));

jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
}));

jest.mock("../../../components/StatsCards", () => ({
  StatsCards: () => <div data-testid="stats-cards" />,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

async function renderPage() {
  render(<Services />);
  await waitFor(() => expect(mockGetOMTHistory).toHaveBeenCalled());
}

/** Switch the provider/serviceType toggle to OMT RECEIVE (default mount
 * state is OMT SEND). The toggle button carries no test id/aria-label — its
 * accessible name is built from an icon + two adjoining <span>s whose exact
 * whitespace is a JSX-compiler implementation detail, so this matches on
 * raw textContent instead of a brittle exact-name string. */
function clickOmtReceiveToggle() {
  const toggle = screen
    .getAllByRole("button")
    .find(
      (btn) =>
        btn.textContent?.includes("OMT") && btn.textContent?.includes("↓"),
    );
  if (!toggle) {
    throw new Error("OMT RECEIVE toggle button not found");
  }
  fireEvent.click(toggle);
}

function setAmount(value: string) {
  fireEvent.change(
    document.getElementById("service-amount") as HTMLInputElement,
    { target: { value } },
  );
}

describe("Services page — RECEIVE insufficient-funds recovery (owner decision #11)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockReset();
    mockTransferBetweenDrawers.mockReset();
  });

  it("renders the shortfall panel on a blocked RECEIVE, then moves funds and resubmits the ORIGINAL payload byte-identically", async () => {
    // First submit: blocked. $40 short in OMT_System/USD (mirrors
    // FinancialServiceRepository.insufficientDrawerFunds.test.ts CASE 1's
    // shape — required $100, available $65 fee-inclusive, short $35 there;
    // here we pick a clean $40 shortfall purely for a readable panel
    // assertion, since this is a UI test, not a re-derivation of the
    // repository's own arithmetic).
    mockAddOMTTransaction.mockResolvedValueOnce({
      success: false,
      error: "Insufficient funds in OMT_System to complete this payout",
      code: "INSUFFICIENT_DRAWER_FUNDS",
      details: {
        drawer: "OMT_System",
        shortfall: { USD: 40 },
        available: { USD: 60 },
        required: { USD: 100 },
      },
    });
    // Second submit (post-transfer retry): succeeds.
    mockAddOMTTransaction.mockResolvedValueOnce({ success: true, id: 42 });
    mockTransferBetweenDrawers.mockResolvedValueOnce({ success: true });

    await renderPage();

    clickOmtReceiveToggle();
    setAmount("100");
    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));

    await waitFor(() =>
      expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1),
    );

    // ── Shortfall panel renders with the right drawer/currency/amount ──────
    const panel = await screen.findByTestId(
      "service-insufficient-funds-panel",
    );
    expect(panel.textContent).toContain("Insufficient funds in OMT_System");
    expect(panel.textContent).toContain("Short $40.00 USD");

    // The panel auto-fills the transfer amount to the shortfall (USD, since
    // details.shortfall.USD is set) — pins that the operator doesn't have to
    // type the number themselves.
    const transferInput = screen.getByTestId(
      "service-transfer-amount-input",
    ) as HTMLInputElement;
    expect(transferInput.value).toBe("40");

    // ── Move & Retry ────────────────────────────────────────────────────────
    fireEvent.click(screen.getByRole("button", { name: /Move & Retry/i }));

    await waitFor(() =>
      expect(mockTransferBetweenDrawers).toHaveBeenCalledTimes(1),
    );
    expect(mockTransferBetweenDrawers).toHaveBeenCalledWith({
      fromDrawer: "General",
      toDrawer: "OMT_System",
      amount_usd: 40,
      amount_lbp: 0,
      notes: "Cover OMT RECEIVE shortfall",
    });

    // ── The blocked transaction is retried automatically ───────────────────
    await waitFor(() =>
      expect(mockAddOMTTransaction).toHaveBeenCalledTimes(2),
    );

    const firstPayload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    const secondPayload = mockAddOMTTransaction.mock.calls[1][0] as Record<
      string,
      unknown
    >;
    // Byte-identical resubmission: the implementation snapshots `payload`
    // in `insufficientFundsError` state rather than rebuilding it from live
    // form state, so the retry is the literal SAME object graph — not just
    // an equivalent one a naive re-derivation from current fields could
    // accidentally produce (e.g. after the amount field was touched again).
    expect(secondPayload).toEqual(firstPayload);
    expect(secondPayload).toBe(firstPayload); // same object reference, not just deep-equal
    expect(secondPayload).toMatchObject({
      provider: "OMT",
      serviceType: "RECEIVE",
      amount: 100,
      cashoutMethod: "CASH",
    });

    // The panel is dismissed once the retried transaction succeeds.
    await waitFor(() =>
      expect(
        screen.queryByTestId("service-insufficient-funds-panel"),
      ).not.toBeInTheDocument(),
    );
  });
});
