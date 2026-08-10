/** @jest-environment jsdom */

/**
 * Services page — the precondition that makes the hardcoded
 * `partnerMode: "THROUGH"` correct (index.tsx ~line 1101, where the
 * payload is built).
 *
 * A "derive partnerMode from `provider === partner.system_association`"
 * change was proposed and correctly REJECTED: on this page the THROUGH-mode
 * partner selector only renders on the matching tab
 * (`provider === partnerSystem`, ~line 1450) and is itself filtered to
 * `partner.system_association === systemFilter`
 * (`PartnerSelector.tsx:47`, `allPartners.filter((p) => p.system_association
 * === systemFilter)`). A partner whose system_association disagrees with
 * the tab's provider is therefore UNSELECTABLE here — the mismatch case
 * cannot occur, so THROUGH is correct by construction and deriving it would
 * just recompute an already-guaranteed answer.
 *
 * That guarantee is invisible at the hardcode site — nothing there says it
 * depends on the selector staying filtered. This test guards the
 * precondition directly: given a partner list containing BOTH a
 * matching-system partner and a mismatched one (system_association
 * `"SYRIA"`, an unrelated value that exists only to prove filtering, per
 * `docs/plans/todo_plans/PARTNER_DISBURSEMENT_MATRIX.md`'s "hwelet souria"
 * case), the mismatched partner must never be OFFERED as a choice in the
 * THROUGH-mode selector while the matching partner(s) ARE offered.
 *
 * Every assertion below drives the real `PartnerSelector` and the real
 * `<select>` control it renders (only the underlying `Select` UI primitive
 * is stubbed to plain DOM `<select>`/`<option>` elements, exactly as the
 * sibling `Services.secondarySystemPartnerGate.test.tsx` does) — never an
 * options array or a prop in isolation. A props-level assertion is what let
 * LIRA-097 get closed as "already working" when the control was actually
 * unusable (reopened as LIRA-120); rendering the real filter logic and
 * querying the real DOM is what this ticket requires.
 *
 * Proven failing-first (rule 17): temporarily widening
 * `systemFilter={partnerSystem}` at index.tsx ~line 1457 to `undefined`
 * makes the mismatched "Syria Partner Gamma" option appear in the dropdown
 * and the first assertion below fails. Restored after confirming the
 * failure — see the task report for the transcript.
 */

import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
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

// Fixed for this file: base system OMT, so the shop's SECONDARY system
// (partnerSystem) is WHISH — the WHISH tab is where the THROUGH-mode,
// system-filtered PartnerSelector mounts.
const mockShopBase: { baseSystem: "OMT" | "WHISH"; partnerSystem: "OMT" | "WHISH" } = {
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
const WHISH_PARTNER_BETA = {
  id: 52,
  name: "Whish Partner Beta",
  phone: null,
  notes: null,
  is_active: 1,
  system_association: "WHISH",
  created_at: "",
  updated_at: "",
};
const SYRIA_PARTNER_MISMATCHED = {
  id: 53,
  name: "Syria Partner Gamma",
  phone: null,
  notes: null,
  is_active: 1,
  system_association: "SYRIA",
  created_at: "",
  updated_at: "",
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  // Stubbed for the same reason as the sibling gate test: this file is
  // about the PartnerSelector's filtering, not the payment sheet.
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

describe("Services page — THROUGH-mode partner selector is system-filtered (guards the hardcoded partnerMode)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    mockPartnersGetAll
      .mockReset()
      .mockResolvedValue([
        WHISH_PARTNER_ALPHA,
        WHISH_PARTNER_BETA,
        SYRIA_PARTNER_MISMATCHED,
      ]);
  });

  it("offers only the matching-system partners in the THROUGH-mode selector; the mismatched partner is not offered", async () => {
    await renderPage();
    // WHISH is the shop's secondary system here (partnerSystem) — this is
    // the tab where the system-filtered, required PartnerSelector mounts
    // and where the hardcoded `partnerMode: "THROUGH"` is sent.
    switchTab("WHISH", "SEND");

    const select = await screen.findByText("Select partner");
    const partnerSelect = select.closest("select") as HTMLSelectElement;
    expect(partnerSelect).not.toBeNull();

    // The matching-system partners ARE offered as real, selectable options.
    expect(
      within(partnerSelect).getByText("Whish Partner Alpha"),
    ).toBeInTheDocument();
    expect(
      within(partnerSelect).getByText("Whish Partner Beta"),
    ).toBeInTheDocument();

    // The mismatched partner (system_association "SYRIA") is NOT offered —
    // not in the selector, not anywhere else on the page (the "For Partner"
    // toggle is unchecked, so its own, unfiltered PartnerSelector isn't
    // mounted either).
    expect(
      within(partnerSelect).queryByText("Syria Partner Gamma"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Syria Partner Gamma")).not.toBeInTheDocument();

    // End-to-end: picking one of the actually-offered options and
    // submitting proves the payload can only ever carry a matching
    // partner — the hardcoded THROUGH is sent alongside a partnerId that
    // is, by construction, always system-matching.
    fireEvent.change(partnerSelect, {
      target: { value: String(WHISH_PARTNER_ALPHA.id) },
    });
    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "50" } },
    );
    fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));
    await waitFor(() =>
      expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1),
    );

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.partnerId).toBe(WHISH_PARTNER_ALPHA.id);
    expect(payload.partnerMode).toBe("THROUGH");
  });

  it("the unfiltered 'For Partner' selector (FOR mode, no system constraint) offers the mismatched partner too — the exclusion above is specifically the systemFilter, not a global rule", async () => {
    await renderPage();
    // OMT is the shop's own base system here — the "For Partner" checkbox
    // (FOR mode) is the affordance on this tab, and its PartnerSelector is
    // NOT given a systemFilter (index.tsx ~line 1488-1493): FOR mode has no
    // system-matching requirement, so every partner — including the
    // mismatched one — is a legitimate choice there.
    switchTab("OMT", "SEND");

    expect(screen.queryByText("Select partner")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("checkbox", { name: /For Partner/i }));

    const select = await screen.findByText("Select partner");
    const forPartnerSelect = select.closest("select") as HTMLSelectElement;

    expect(
      within(forPartnerSelect).getByText("Whish Partner Alpha"),
    ).toBeInTheDocument();
    expect(
      within(forPartnerSelect).getByText("Syria Partner Gamma"),
    ).toBeInTheDocument();
  });
});
