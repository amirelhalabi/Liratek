/** @jest-environment jsdom */

/**
 * Services page — secondary-system partner requirement (LIRA-127).
 *
 * The rule is: "a transaction on the system the shop does NOT own requires
 * a partner." The submit validation (index.tsx ~line 791) already reads
 * this correctly off `useShopBase().partnerSystem`. But the CONTROL that
 * lets the operator actually satisfy that requirement — the
 * `<PartnerSelector systemFilter=... required />` block (~line 1423) — was
 * gated on the literal `provider === "WHISH"` instead of
 * `provider === partnerSystem`. That literal happens to equal
 * `partnerSystem` for a shop whose BASE system is OMT (partnerSystem
 * WHISH), so the bug was invisible there. It breaks for a shop whose BASE
 * system is WHISH (partnerSystem OMT): the OMT tab's submit validation
 * demands a partner, but the selector that lets the operator pick one never
 * mounts — the form becomes permanently unsubmittable on that tab whenever
 * a THROUGH partner is required, with no dropdown for the operator to act
 * on. This is exactly the "control renders as unusable" class of bug
 * LIRA-097/120 taught us prop/options-array assertions miss, so every
 * assertion here drives the real tab button and the real partner
 * `<select>` — never inspects props or an options array in isolation.
 *
 * Proven failing-first (rule 17): the first `findByText("Select partner")`
 * inside the "base system WHISH" describe block times out and throws on
 * pre-fix code — the selector never mounts for the OMT tab while the
 * mount guard is the literal `provider === "WHISH"`. The "base system OMT"
 * describe block is the regression guard: the WHISH tab must keep
 * requiring (and letting the operator pick) a partner, and the OMT tab
 * must keep NOT requiring one, so the fix does not simply invert the bug.
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

const mockApi = {
  getOMTHistory: mockGetOMTHistory,
  getOMTAnalytics: mockGetOMTAnalytics,
  getSuppliers: mockGetSuppliers,
  getSupplierBalances: mockGetSupplierBalances,
  partners: { getAll: mockPartnersGetAll },
  addOMTTransaction: mockAddOMTTransaction,
};

// Mutable — flipped per describe block so the SAME mocked hook can stand in
// for a base-OMT shop (partnerSystem WHISH, the already-correct direction)
// and a base-WHISH shop (partnerSystem OMT, the currently-broken direction).
let mockShopBase: {
  baseSystem: "OMT" | "WHISH";
  partnerSystem: "OMT" | "WHISH";
} = {
  baseSystem: "OMT",
  partnerSystem: "WHISH",
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  // Fully stubbed — this ticket is about the PartnerSelector mount gate and
  // the tab switch, not the payment sheet, and a stub keeps the DOM free of
  // unrelated "OMT"/"WHISH" text the tab-finder helper below could match.
  MultiPaymentInput: () => <div data-testid="stub-multi-payment-input" />,
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
  useShopBase: () => ({ ...mockShopBase, loading: false }),
}));

// NOT mocked here on purpose: @/features/partners/components/PartnerSelector.
// Whether the REAL selector mounts and is operable IS the bug — a stub
// would hide exactly the defect this ticket fixes.

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

/** Drive the real partner <select> rendered by PartnerSelector. */
function selectPartner(partnerId: number) {
  const select = screen
    .getByText("Select partner")
    .closest("select") as HTMLSelectElement;
  fireEvent.change(select, { target: { value: String(partnerId) } });
}

describe("Services page — secondary-system partner requirement follows useShopBase (LIRA-127)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    mockPartnersGetAll.mockReset().mockResolvedValue([]);
  });

  describe("base system WHISH (secondary/partnerSystem = OMT) — currently-broken direction", () => {
    beforeEach(() => {
      mockShopBase = { baseSystem: "WHISH", partnerSystem: "OMT" };
      mockPartnersGetAll.mockResolvedValue([
        {
          id: 21,
          name: "Omt Partner A",
          phone: null,
          notes: null,
          is_active: 1,
          system_association: "OMT",
          created_at: "",
          updated_at: "",
        },
        {
          id: 22,
          name: "Omt Partner B",
          phone: null,
          notes: null,
          is_active: 1,
          system_association: "OMT",
          created_at: "",
          updated_at: "",
        },
      ]);
    });

    it("OMT tab (the shop's secondary system) requires and lets the operator pick a partner", async () => {
      await renderPage();
      // Default state already lands on OMT/SEND — drive the real tab
      // button explicitly rather than relying on incidental initial state.
      switchTab("OMT", "SEND");

      // Failing-first (rule 17): pre-fix, the mount guard is the literal
      // `provider === "WHISH"`, which never matches "OMT" — PartnerSelector
      // never mounts here and this `findByText` times out and throws.
      await screen.findByText("Select partner");
      expect(
        screen.getByText(/Partner required for OMT System transactions/i),
      ).toBeInTheDocument();

      fireEvent.change(
        document.getElementById("service-amount") as HTMLInputElement,
        { target: { value: "50" } },
      );

      // No partner picked yet — the (already-correct) submit validation at
      // ~line 791 must block. This selector is the only way to ever satisfy
      // it, so the two must agree on which tab they gate.
      fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));
      expect(mockAddOMTTransaction).not.toHaveBeenCalled();

      selectPartner(21);
      expect(
        screen.queryByText(/Partner required for OMT System transactions/i),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));
      await waitFor(() =>
        expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1),
      );

      const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(payload.provider).toBe("OMT");
      expect(payload.partnerId).toBe(21);
      expect(payload.partnerMode).toBe("THROUGH");
    });
  });

  describe("base system OMT (secondary/partnerSystem = WHISH) — regression guard, must not invert", () => {
    beforeEach(() => {
      mockShopBase = { baseSystem: "OMT", partnerSystem: "WHISH" };
      mockPartnersGetAll.mockResolvedValue([
        {
          id: 31,
          name: "Whish Partner A",
          phone: null,
          notes: null,
          is_active: 1,
          system_association: "WHISH",
          created_at: "",
          updated_at: "",
        },
        {
          id: 32,
          name: "Whish Partner B",
          phone: null,
          notes: null,
          is_active: 1,
          system_association: "WHISH",
          created_at: "",
          updated_at: "",
        },
      ]);
    });

    it("OMT tab (the shop's OWN base system) never requires a partner", async () => {
      await renderPage();
      switchTab("OMT", "SEND");

      expect(screen.queryByText("Select partner")).not.toBeInTheDocument();
      expect(
        screen.queryByText(/Partner required for/i),
      ).not.toBeInTheDocument();
    });

    it("WHISH tab (the shop's secondary system) requires and lets the operator pick a partner", async () => {
      await renderPage();
      switchTab("WHISH", "SEND");

      await screen.findByText("Select partner");
      expect(
        screen.getByText(/Partner required for WHISH System transactions/i),
      ).toBeInTheDocument();

      fireEvent.change(
        document.getElementById("service-amount") as HTMLInputElement,
        { target: { value: "50" } },
      );

      selectPartner(31);
      expect(
        screen.queryByText(/Partner required for WHISH System transactions/i),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));
      await waitFor(() =>
        expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1),
      );

      const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
        string,
        unknown
      >;
      expect(payload.provider).toBe("WHISH");
      expect(payload.partnerId).toBe(31);
      expect(payload.partnerMode).toBe("THROUGH");
    });
  });
});
