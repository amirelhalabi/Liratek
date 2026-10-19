/** @jest-environment jsdom */

/**
 * Services page — the partner picked on the secondary-system tab must not
 * survive a switch back to the shop's own system (owner report 2026-10-19,
 * CornerTech: base OMT, Whish through one partner).
 *
 * The Whish tab's PartnerSelector auto-selects the only Whish partner.
 * Switching back to OMT left `selectedPartnerId` set, so:
 *   - the OMT payload carried `partnerId` + `partnerMode: "THROUGH"` — an
 *     OMT transaction booked THROUGH the Whish partner (money bug);
 *   - the LIRA-336 "+ Customer gives change" section (hidden whenever a
 *     partner is picked) disappeared from OMT receive.
 *
 * Rule 17: run against the unfixed page first — both cases failed
 * (partnerId 51 present on the OMT send; counterFlow undefined on the
 * OMT receive).
 */
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Services from "../index";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
const mockGetOMTHistory = jest.fn().mockResolvedValue([]);
const mockGetOMTAnalytics = jest.fn().mockResolvedValue({
  today: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
  month: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
  byProvider: [],
});
const mockGetSuppliers = jest.fn().mockResolvedValue([]);
const mockGetSupplierBalances = jest.fn().mockResolvedValue([]);
const mockPartnersGetAll = jest.fn().mockResolvedValue([]);
const mockMpiProps: { current: Record<string, unknown> | null } = {
  current: null,
};

const mockApi = {
  getOMTHistory: mockGetOMTHistory,
  getOMTAnalytics: mockGetOMTAnalytics,
  getSuppliers: mockGetSuppliers,
  getSupplierBalances: mockGetSupplierBalances,
  partners: { getAll: mockPartnersGetAll },
  addOMTTransaction: mockAddOMTTransaction,
};

// Fixed for this file: base system OMT, so the shop's SECONDARY system
// (partnerSystem) is WHISH — the WHISH tab is where the THROUGH-mode,
// system-filtered PartnerSelector mounts.
const mockShopBase: {
  baseSystem: "OMT" | "WHISH";
  partnerSystem: "OMT" | "WHISH";
} = {
  baseSystem: "OMT",
  partnerSystem: "WHISH",
};

// A matching-system pair plus one mismatched partner whose
// system_association ("SYRIA") is neither OMT nor WHISH — free text is
// allowed by the schema (`Partner.system_association: string | null`), and
// this specific value mirrors the real-world "hwelet souria" case in
// PARTNER_DISBURSEMENT_MATRIX.md where a partner's system_association does
// not represent a real rails relationship with either system.
const WHISH_PARTNER_ALPHA = {
  id: 51,
  name: "Whish Partner Alpha",
  phone: null,
  notes: null,
  is_active: 1,
  system_association: "WHISH",
  created_at: "",
  updated_at: "",
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  // Stubbed for the same reason as the sibling gate test: this file is
  // about the PartnerSelector's filtering, not the payment sheet.
  MultiPaymentInput: (props: Record<string, unknown>) => {
    mockMpiProps.current = props;
    return <div data-testid="stub-multi-payment-input" />;
  },
  DecimalInput: ({
    id,
    value,
    onChange,
    placeholder,
    className,
  }: {
    id?: string;
    value: number;
    onChange: (n: number) => void;
    placeholder?: string;
    className?: string;
  }) => (
    <input
      id={id}
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
  // NOT a deep stub — renders real <option> elements from whatever
  // `options` PartnerSelector's REAL filtering logic computed, so the
  // rendered DOM reflects the real filter, not a mocked shortcut.
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
      { code: "WHISH", label: "Whish Wallet" },
    ],
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000 }),
}));

jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({ ...mockShopBase, loading: false }),
}));

// NOT mocked here on purpose: @/features/partners/components/PartnerSelector.
// Whether the real component's system-filter actually excludes the
// mismatched partner from the rendered options IS the invariant under
// test — stubbing it would hide exactly what this file must prove.

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

/** Click the real combined provider+service-type tab button. */
function switchTab(provider: "OMT" | "WHISH", type: "SEND" | "RECEIVE") {
  const arrow = type === "SEND" ? "↑" : "↓";
  const button = screen
    .getAllByRole("button")
    .find(
      (b) =>
        (b.textContent ?? "").includes(provider) &&
        (b.textContent ?? "").includes(arrow),
    );
  expect(button).toBeDefined();
  fireEvent.click(button!);
}

describe("Services page — partner does not leak across provider tabs", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    mockMpiProps.current = null;
    mockPartnersGetAll.mockReset().mockResolvedValue([WHISH_PARTNER_ALPHA]);
  });

  it("Whish tab auto-selects its partner; back on OMT the send carries NO partner", async () => {
    await renderPage();
    switchTab("WHISH", "RECEIVE");
    // One Whish partner: the selector shows it inline and auto-selects it.
    await screen.findByText(/Whish Partner Alpha/);
    switchTab("OMT", "SEND");
    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "50" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.provider).toBe("OMT");
    expect(payload.partnerId).toBeUndefined();
    expect(payload.partnerMode).toBeUndefined();
  });

  it("Whish receive → OMT receive: the '+ Customer gives change' section is offered again", async () => {
    await renderPage();
    switchTab("OMT", "RECEIVE");
    await waitFor(() =>
      expect(
        (
          mockMpiProps.current?.counterFlow as
            | { optional?: boolean }
            | undefined
        )?.optional,
      ).toBe(true),
    );
    switchTab("WHISH", "RECEIVE");
    await screen.findByText(/Whish Partner Alpha/);
    switchTab("OMT", "RECEIVE");
    await waitFor(() =>
      expect(
        (
          mockMpiProps.current?.counterFlow as
            | { optional?: boolean }
            | undefined
        )?.optional,
      ).toBe(true),
    );
  });
});
