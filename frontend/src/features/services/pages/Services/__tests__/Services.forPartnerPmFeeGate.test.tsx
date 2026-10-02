/** @jest-environment jsdom */

/**
 * Services page — LIRA-142: the "Payment Method Fee" input
 * (`index.tsx` ~:2499, `{pmFeeApplies && (...)}`) renders on ANY SEND paid
 * via a non-cash method, with no `forPartner` gate. The submit payload
 * already forces `paymentMethodFee: 0` for a For-Partner SEND (the PFT-3b
 * spread, `~:1173`) — an owner-approved contract this ticket does NOT touch
 * (do not start honouring the value). But pre-fix the box still rendered and
 * accepted operator input that was silently discarded on submit — the same
 * offered-but-discarded shape LIRA-114 §4 fixed for the payment-method
 * picker and the RECEIVE cashout selector
 * (`Services.forPartnerPaymentGate.test.tsx`).
 *
 * This file guards the fix at the interaction layer: for a For-Partner SEND
 * paid via a non-cash method, the PM-fee box must not render. For-Partner
 * OFF is provably unchanged (box still renders, same condition as today).
 *
 * Proven failing-first (rule 17): "For Partner ON + SEND + non-cash method:
 * hides the PM-fee box" was run against the pre-fix `index.tsx` (only
 * `pmFeeApplies && (...)`, no `forPartner` gate) and failed — the box
 * rendered — before the `!forPartner` gate was added. See the task report
 * for the captured failure output.
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

// A single active partner — same auto-select shortcut as
// Services.forPartnerPaymentGate.test.tsx (LIRA-118's "exactly one partner"
// branch), so checking "For Partner" commits a real `forPartnerId` with no
// dropdown interaction.
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
  // Unlike the sibling forPartnerPaymentGate stub (display-only), this one
  // exposes a button that fires the page's real `onChange(lines)` — needed
  // to drive `paidByMethod` to a non-cash method (default state is "CASH",
  // which never exercises `pmFeeApplies` at all) and so reach the box this
  // ticket gates.
  MultiPaymentInput: ({
    onChange,
  }: {
    onChange: (
      lines: { id: string; method: string; currencyCode: string; amount: number }[],
    ) => void;
  }) => (
    <div data-testid="stub-multi-payment-input">
      <button
        data-testid="mpi-pick-omt-wallet"
        onClick={() =>
          onChange([
            { id: "L1", method: "OMT", currencyCode: "USD", amount: 50 },
          ])
        }
      >
        Pay via OMT Wallet
      </button>
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
// toggle (FOR mode) renders on the OMT tab, the page's default.
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

async function checkForPartnerAndWaitForSelection() {
  fireEvent.click(screen.getByRole("checkbox", { name: /For Partner/i }));
  await screen.findByText(/Partner: Ziad Supplies/);
}

function payViaOmtWallet() {
  fireEvent.click(screen.getByTestId("mpi-pick-omt-wallet"));
}

describe("Services page — PM-fee box gated on For-Partner SEND (LIRA-142)", () => {
  it("For Partner OFF + SEND + non-cash method: PM-fee box renders (unchanged baseline)", async () => {
    await renderPage();
    // Default state: forPartner is off, default tab is OMT + SEND.
    payViaOmtWallet();

    expect(screen.getByLabelText("Payment Method Fee")).toBeInTheDocument();
  });

  it("For Partner ON + SEND + non-cash method: PM-fee box does NOT render", async () => {
    await renderPage();
    payViaOmtWallet();
    await checkForPartnerAndWaitForSelection();

    expect(
      screen.queryByLabelText("Payment Method Fee"),
    ).not.toBeInTheDocument();
  });
});
