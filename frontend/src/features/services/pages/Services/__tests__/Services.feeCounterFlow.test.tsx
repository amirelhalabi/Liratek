/** @jest-environment jsdom */

/**
 * Services page — OMT system RECEIVE fee handling.
 *
 * D1 (owner decision, OWNER_NOTES_2026-09-21.md §2b, 2026-09-23): "OMT system
 * RECEIVE — no fee is taken from the customer; the fee is always shown (so
 * the shop sees how it was calculated and what the commission is) but never
 * affects the drawer." Concretely: the fee is informational only — no
 * fee-on-top / fee-included choice, no drawer leg, no counter-flow fee
 * collection.
 *
 * This SUPERSEDES the file's original scope, which drove the on-top/deducted
 * fee-collection mechanism for an OMT RECEIVE (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md
 * §4 Phase C). That mechanism still exists, but D1 moves it to WHISH system
 * RECEIVE instead — see Services.whishReceiveFee.test.tsx for its coverage
 * (including the §10.3 hasClient gate tests that used to live here).
 *
 * Actually run 2026-09-23: with the D1 gates in Services/index.tsx
 * temporarily reverted (showFeeCounterFlow/feeCounterFlowActive's
 * `provider === "WHISH"` clauses removed, the "Including Fees Checkbox"
 * render gate restored to `provider !== "WHISH"`, and the `includingFees`
 * payload override dropped back to the bare state value), `npx jest
 * Services.feeCounterFlow.test.tsx` FAILED the first test — "OMT RECEIVE
 * $100 with a fee typed..." — with `expect(element).not.toBeInTheDocument()`
 * finding `<button data-testid="mpi-seed-counter-flow" />` still rendered
 * (the counter-flow section had reopened for OMT). The other 3 tests still
 * passed even on the reverted code (they exercise session/for-partner paths
 * that were already gated `!activeSession`/`!forPartner` before D1). Reverting
 * the revert and re-running: 4/4 GREEN.
 */

import { useEffect } from "react";
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
const mockAddToCart = jest.fn();

// Stable reference — must NOT be a fresh object literal per call. The real
// useApi() is referentially stable across renders; the page's `loadData`
// useCallback depends on `api` (~line 547), and its enclosing effect
// (~line 549) resets sender/receiver name+phone to "" whenever `serviceType`/
// `activeSession`/`loadData` change identity. A fresh `useApi()` object each
// render would make `loadData` (and so that effect) re-fire on every
// keystroke, silently wiping whatever the tests below just typed into the
// receiver name/phone fields before the assertion ever runs.
const mockApi = {
  getOMTHistory: mockGetOMTHistory,
  getOMTAnalytics: mockGetOMTAnalytics,
  getSuppliers: mockGetSuppliers,
  getSupplierBalances: mockGetSupplierBalances,
  partners: { getAll: mockPartnersGetAll },
  addOMTTransaction: mockAddOMTTransaction,
};

// Mutable — flipped per-test so the SAME mocked module can represent both
// the non-session and active-session cases (jest.mock factories read this
// at render time via the useSession() call, not at module-eval time).
let mockActiveSession: {
  id: number;
  customer_name?: string;
  customer_phone?: string;
} | null = null;

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  // Stub exposing exactly the callback surface the page wires: the main
  // onChange/onReturnChange (unused here) plus — when the page supplies a
  // `counterFlow` config — a button that fires ITS onChange, mirroring the
  // real component's mount-seeding effect (covered in full by
  // MultiPaymentInput.test.tsx). For an OMT RECEIVE, D1 means `counterFlow`
  // is never passed at all — so this button never renders, and the "not in
  // the document" assertions below are the actual test.
  MultiPaymentInput: ({
    counterFlow,
  }: {
    onChange: (lines: unknown[]) => void;
    counterFlow?: {
      totalAmount: number;
      currency: string;
      onChange: (lines: unknown[]) => void;
      hasClient?: boolean;
    };
  }) => (
    <div data-testid="stub-multi-payment-input">
      {counterFlow && (
        <>
          <span data-testid="counter-flow-has-client">
            {String(counterFlow.hasClient)}
          </span>
          <button
            data-testid="mpi-seed-counter-flow"
            onClick={() =>
              counterFlow.onChange([
                {
                  id: "FEE1",
                  method: "CASH",
                  currencyCode: counterFlow.currency,
                  amount: counterFlow.totalAmount,
                },
              ])
            }
          />
        </>
      )}
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
    activeSession: mockActiveSession,
    linkTransaction: jest.fn(),
    addToCart: mockAddToCart,
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

// A working (non-null) stub — needed for tests that type into the receiver
// name/phone fields. Mirrors the real component's controlled-input contract
// (value/onChange(value: string)).
jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: ({
    id,
    value,
    onChange,
    placeholder,
  }: {
    id?: string;
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
  }) => (
    <input
      id={id}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  ),
}));

// The THROUGH-mode selector (`systemFilter="WHISH"`, ~line 1412) never
// mounts in this test file — provider stays "OMT" throughout — so a single
// mock behavior is safe for both usages. For the "For Partner" test we need
// `forPartnerId` to become non-null (the real component's `autoSelectSingle`
// would do this against a single-partner list; here we just fire `onSelect`
// unconditionally on mount to drive a full submit and inspect the resulting
// payload).
jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: ({
    onSelect,
  }: {
    selectedPartnerId: number | null;
    onSelect: (id: number) => void;
    required?: boolean;
    autoSelectSingle?: boolean;
    systemFilter?: string;
  }) => {
    useEffect(() => {
      onSelect(1);
    }, [onSelect]);
    return null;
  },
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

/** Switch the page from the default OMT SEND to OMT RECEIVE. */
function switchToOmtReceive() {
  const omtReceiveButton = screen
    .getAllByRole("button")
    .find(
      (b) =>
        (b.textContent ?? "").includes("OMT") &&
        (b.textContent ?? "").includes("↓"),
    );
  expect(omtReceiveButton).toBeDefined();
  fireEvent.click(omtReceiveButton!);
}

describe("Services page — OMT system RECEIVE fee is informational only (D1, 2026-09-23)", () => {
  beforeEach(() => {
    mockActiveSession = null;
    mockAddOMTTransaction.mockClear();
    mockAddToCart.mockClear();
  });

  it("OMT RECEIVE $100 with a fee typed: no counter-flow section, no Including-Fees toggle, payload carries omtFee but never feePayments/includingFees:true", async () => {
    await renderPage();
    switchToOmtReceive();

    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );
    fireEvent.change(
      document.getElementById("service-omt-fee") as HTMLInputElement,
      { target: { value: "5" } },
    );

    // Neither fee-collection affordance exists for OMT RECEIVE any more.
    expect(
      screen.queryByTestId("mpi-seed-counter-flow"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("service-including-fees-toggle"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.omtFee).toBe(5);
    expect(payload.includingFees).toBe(false);
    expect(payload).not.toHaveProperty("feePayments");
  });

  it("OMT RECEIVE with the fee left EMPTY (CASH_TO_BUSINESS, no tier auto-lookup) still submits — closes owner note #6", async () => {
    // Owner note #6, verbatim: "omt receive 40$, cash to business no fee. i
    // can see omt fee is required for this service type." CASH_TO_BUSINESS
    // has no entry in lookupOmtFee's tier tables (INTRA/WESTERN_UNION only),
    // so leaving the fee input untouched resolves omtFee to `undefined` —
    // exactly the "no fee entered, no fee known" case the note complains
    // about. This must not block submission.
    await renderPage();
    switchToOmtReceive();

    // The mocked <Select> (the "OMT Service" dropdown) is the only <select>
    // on the page — MultiPaymentInput/payment-method pickers are stubbed out
    // above, so there's no ambiguity to disambiguate by id/label.
    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "CASH_TO_BUSINESS" },
    });
    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "40" } },
    );
    // service-omt-fee is deliberately left untouched (empty).

    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty("omtFee");
    expect(payload.includingFees).toBe(false);
    expect(payload).not.toHaveProperty("feePayments");
    expect(payload.amount).toBe(40);
  });

  it("active session: cart formData carries no feePayments and includingFees:false", async () => {
    mockActiveSession = {
      id: 1,
      customer_name: "Jane Doe",
      customer_phone: "70111222",
    };
    await renderPage();
    switchToOmtReceive();

    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );
    fireEvent.change(
      document.getElementById("service-omt-fee") as HTMLInputElement,
      { target: { value: "5" } },
    );

    expect(
      screen.queryByTestId("mpi-seed-counter-flow"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));

    await waitFor(() => expect(mockAddToCart).toHaveBeenCalledTimes(1));

    const cartItem = mockAddToCart.mock.calls[0][0] as {
      formData: Record<string, unknown>;
    };
    expect(cartItem.formData).not.toHaveProperty("feePayments");
    expect(cartItem.formData.includingFees).toBe(false);
    expect(cartItem.formData.omtFee).toBe(5);
  });

  it('"For Partner" toggle ON: still no feePayments/includingFees:true', async () => {
    await renderPage();
    switchToOmtReceive();

    fireEvent.change(
      document.getElementById("service-amount") as HTMLInputElement,
      { target: { value: "100" } },
    );
    fireEvent.change(
      document.getElementById("service-omt-fee") as HTMLInputElement,
      { target: { value: "5" } },
    );

    // Turn "For Partner" on — the stubbed PartnerSelector fires onSelect(1)
    // on mount, so `forPartnerId` becomes non-null and the submit-blocking
    // "select a partner" validation does not stop us short of the real bug
    // surface: a FOR-partner OMT RECEIVE reaching addOMTTransaction.
    fireEvent.click(screen.getByRole("checkbox", { name: /For Partner/i }));

    expect(
      screen.queryByTestId("mpi-seed-counter-flow"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // Confirms this really is the FOR-partner path (not an accidental no-op).
    expect(payload.partnerMode).toBe("FOR");
    expect(payload.partnerId).toBe(1);
    expect(payload).not.toHaveProperty("feePayments");
    expect(payload.includingFees).toBe(false);
  });
});
