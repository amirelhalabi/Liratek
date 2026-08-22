/** @jest-environment jsdom */

/**
 * Services page — LIRA-114 §4 (UI gating): the "For Partner" checkbox
 * (rendered when `provider !== partnerSystem`, ~index.tsx:1476) means the
 * shop disburses its OWN money on a SEND and the partner owes it back — no
 * walk-in customer is paying. Pre-fix, the payment section ignored
 * `forPartner` entirely:
 *
 * - `paymentMethods` was the UNFILTERED `allPaymentMethods` on every SEND,
 *   so "Customer Account (Debt)" was selectable even for a For-Partner
 *   disbursement. Picking it hard-rejects the whole submit server-side at
 *   `FinancialServiceRepository.ts:2116` (`assertNoCustomerAccountLeg` over
 *   `returnLegs`) — the operator got a failed submit for a choice the UI
 *   itself offered.
 * - `autoDebtRemainder` was `serviceType === "SEND" && senderName &&
 *   senderPhone` with no `forPartner` gate, so the sheet could add that
 *   same rejected CUSTOMER_ACCOUNT leg on its own, with no operator choice
 *   involved at all.
 * - The section label stayed "Payment" — wrong for a disbursement.
 * - On a For-Partner RECEIVE the section was shown as "Cashout" but the
 *   operator's choice was silently discarded (payload sends `payments: []`)
 *   with no error and no UI cue.
 *
 * This file guards the fix: for a For-Partner SEND the method list is
 * restricted to `drawerAffectingMethods` (the same list
 * `usePaymentMethods()` already computes with `affects_drawer === 1`,
 * mirroring the backend's `isDrawerAffectingMethod` predicate — rule 14,
 * no hand-rolled second filter), `autoDebtRemainder` is forced off, and the
 * label becomes "Paid from". For a For-Partner RECEIVE the whole payment
 * section is replaced by a `ForPartnerNotice`. For-Partner OFF is provably
 * unchanged.
 *
 * Every assertion below was proven failing-first (rule 17) against the
 * pre-fix `index.tsx` (git-stashed, re-run, restored) — see the task
 * report for the captured failure output.
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

// A single active partner: PartnerSelector's real "exactly one partner"
// branch (LIRA-118) auto-selects it the instant the "For Partner" checkbox
// mounts the selector — no dropdown interaction needed to get a
// `forPartnerId`. `system_association` is deliberately irrelevant here
// (the FOR-mode selector has no systemFilter), unlike the THROUGH-mode one
// guarded by Services.throughPartnerInvariant.test.tsx.
const SOLE_PARTNER = {
  id: 77,
  name: "Ziad Supplies",
  phone: null,
  notes: null,
  is_active: 1,
  system_association: "WHISH",
  created_at: "",
  updated_at: "",
};
const mockPartnersGetAll = jest.fn().mockResolvedValue([SOLE_PARTNER]);

const mockApi = {
  getOMTHistory: mockGetOMTHistory,
  getOMTAnalytics: mockGetOMTAnalytics,
  getSuppliers: mockGetSuppliers,
  getSupplierBalances: mockGetSupplierBalances,
  partners: { getAll: mockPartnersGetAll },
  addOMTTransaction: mockAddOMTTransaction,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  // Capture the exact contract the page feeds the payment section — the
  // same pattern Services.currencyToggle.test.tsx uses. `paymentMethods` is
  // reduced to just its `code`s for a readable assertion.
  MultiPaymentInput: ({
    paymentMethods,
    label,
    autoDebtRemainder,
  }: {
    paymentMethods?: { code: string }[];
    label?: string;
    autoDebtRemainder?: boolean;
  }) => (
    <div data-testid="multi-payment-props">
      {JSON.stringify({
        methodCodes: (paymentMethods ?? []).map((m) => m.code),
        label,
        autoDebtRemainder: !!autoDebtRemainder,
      })}
    </div>
  ),
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

// Real `methods` (unfiltered) includes CUSTOMER_ACCOUNT; `drawerAffectingMethods`
// mirrors the hook's real `affects_drawer === 1` filter (usePaymentMethods.ts:64)
// with CUSTOMER_ACCOUNT excluded — exactly the contract the fix depends on.
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [
      { code: "CASH", label: "Cash", affects_drawer: 1 },
      { code: "OMT", label: "OMT Wallet", affects_drawer: 1 },
      {
        code: "CUSTOMER_ACCOUNT",
        label: "Customer Account (Debt)",
        affects_drawer: 0,
      },
    ],
    drawerAffectingMethods: [
      { code: "CASH", label: "Cash", affects_drawer: 1 },
      { code: "OMT", label: "OMT Wallet", affects_drawer: 1 },
    ],
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000 }),
}));

// Base system OMT ⇒ partnerSystem (secondary) is WHISH — the "For Partner"
// toggle (FOR mode) renders on the OMT tab, which is this page's default.
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

// Interactive stub (unlike the sibling tests' `() => null`): this file
// needs to actually type into the sender-name/sender-phone fields, which
// are `ClientAutocompleteInput`s, not plain `<input>`s (mirrors the
// `DecimalInput` stub pattern above — id/value/onChange passthrough only).
jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: ({
    id,
    value,
    onChange,
    placeholder,
    className,
  }: {
    id?: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    className?: string;
  }) => (
    <input
      id={id}
      type="text"
      value={value}
      placeholder={placeholder}
      className={className}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

// NOT mocked here on purpose: @/features/partners/components/PartnerSelector
// (needed so checking "For Partner" really auto-selects SOLE_PARTNER and a
// real `forPartnerId` reaches the page) nor
// @/features/partners/components/ForPartnerToggle (the shared
// ForPartnerNotice under test must be the real component).

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

function readPaymentProps() {
  return JSON.parse(
    screen.getByTestId("multi-payment-props").textContent || "{}",
  );
}

async function checkForPartnerAndWaitForSelection() {
  fireEvent.click(screen.getByRole("checkbox", { name: /For Partner/i }));
  // PartnerSelector's single-partner effect auto-selects SOLE_PARTNER —
  // wait for its non-interactive "Partner: Ziad Supplies" line so
  // `forPartnerId` is committed before asserting anything downstream.
  await screen.findByText(/Partner: Ziad Supplies/);
}

describe("Services page — For-Partner payment-section gating (LIRA-114 §4)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
  });

  it("For Partner ON + SEND: offers only drawer-affecting methods (no Customer Account) and labels the section 'Paid from'", async () => {
    await renderPage();
    // Default state is already OMT + SEND.
    await checkForPartnerAndWaitForSelection();

    const props = readPaymentProps();
    expect(props.methodCodes).toEqual(["CASH", "OMT"]);
    expect(props.methodCodes).not.toContain("CUSTOMER_ACCOUNT");
    expect(props.label).toBe("Paid from");
  });

  it("For Partner ON + SEND: never auto-adds a Customer Account remainder leg, even with sender name+phone filled", async () => {
    await renderPage();
    await checkForPartnerAndWaitForSelection();

    // Fill sender name + phone — the exact condition that (pre-fix) made
    // `autoDebtRemainder` true unconditionally on any SEND.
    fireEvent.change(
      document.getElementById("service-sender-name") as HTMLInputElement,
      { target: { value: "Walk-in Wendy" } },
    );
    fireEvent.change(
      document.getElementById("service-sender-phone") as HTMLInputElement,
      { target: { value: "71234567" } },
    );

    expect(readPaymentProps().autoDebtRemainder).toBe(false);
  });

  it("For Partner ON + RECEIVE: the payment section is replaced by a notice, not silently discarded", async () => {
    await renderPage();
    switchTab("OMT", "RECEIVE");
    await checkForPartnerAndWaitForSelection();

    expect(screen.queryByTestId("multi-payment-props")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("services-for-partner-receive-no-payout-notice"),
    ).toBeInTheDocument();
  });

  it("For Partner ON + SEND: the payout notice names the real partner and states both sides, with the provider fee folded into the total", async () => {
    await renderPage();
    // Default OMT + SEND + INTRA. A $50 send falls in the INTRA $0-100 tier
    // ($1 fee), so with includingFees=false (the default) `sendPayoutTotal`
    // is amount + fee = $51 — this exercises the non-trivial branch of the
    // formula (not just the bare typed amount), and proves the notice
    // reads the SAME value the payment sheet reconciles against.
    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "50" } },
    );
    await checkForPartnerAndWaitForSelection();

    const notice = screen.getByTestId(
      "services-for-partner-send-payout-notice",
    );
    // The name resolves through a SEPARATE fetch from the one
    // `checkForPartnerAndWaitForSelection` already waited on (that one is
    // PartnerSelector's own internal `api.partners.getAll` call, which
    // drives `forPartnerId`; the name here comes from the page's OWN
    // `loadData()` → `activePartnersList` — a different promise off the
    // same mock). `waitFor` covers that independent resolution instead of
    // assuming it's already settled the instant the checkbox effect is.
    await waitFor(() => {
      expect(notice).toHaveTextContent("Ziad Supplies");
    });
    // Both sides of the disclosure (plan §5 — a one-sided notice is what
    // misled the owner into filing this ticket): the shop's own payout AND
    // that the partner owes it back.
    expect(notice).toHaveTextContent("You pay out");
    expect(notice).toHaveTextContent("owes you");
    // The formatted, fee-inclusive total ($50 + $1 INTRA fee).
    expect(notice).toHaveTextContent("$51.00");
  });

  it("For Partner OFF + SEND: unchanged — Customer Account still offered, section still labelled 'Payment'", async () => {
    await renderPage();
    // Default state: forPartner is off.

    const props = readPaymentProps();
    expect(props.methodCodes).toEqual(["CASH", "OMT", "CUSTOMER_ACCOUNT"]);
    expect(props.label).toBe("Payment");
  });

  it("For Partner OFF + SEND: neither For-Partner notice is rendered", async () => {
    await renderPage();

    expect(
      screen.queryByTestId("services-for-partner-send-payout-notice"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("services-for-partner-receive-no-payout-notice"),
    ).not.toBeInTheDocument();
  });
});
