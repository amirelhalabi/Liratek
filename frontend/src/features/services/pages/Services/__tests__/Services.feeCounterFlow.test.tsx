/** @jest-environment jsdom */

/**
 * Services page — BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase C wiring.
 *
 * An OMT/WHISH system RECEIVE with a fee-on-top (`includingFees` false, fee
 * > 0), outside a session, now passes a `counterFlow` config to
 * MultiPaymentInput so the operator can choose how the customer pays the
 * fee back. This test drives the PAGE'S wiring only (not MultiPaymentInput's
 * own seeding behavior — that is covered by MultiPaymentInput.test.tsx): the
 * MultiPaymentInput stub below exposes a button that fires
 * `counterFlow.onChange` exactly as the real component's mount-seeding
 * effect would (one CASH line at the resolved fee), and the test asserts the
 * Services page turns that into `feePayments` on the IPC payload.
 *
 * Three assertions (rule 7 — mapped 1:1 to the task's three bullet points):
 *   (a) OMT RECEIVE $100, fee $5, fee-on-top, non-session →
 *       payload.feePayments === [{ method: CASH, currencyCode: USD, amount: 5 }]
 *   (b) same, but includingFees checked → NO feePayments key at all
 *   (c) same, but inside an active session → NO feePayments key at all
 *
 * Proven failing-first (rule 17): before this wiring existed, `apiPayload`
 * never carried a `feePayments` field under any condition — assertion (a)
 * fails on the pre-fix code (captured below via `git stash`).
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
// keystroke, silently wiping whatever the §10.3 hasClient tests below just
// typed into the receiver name/phone fields before the assertion ever runs.
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
  // `counterFlow` config — a button that fires ITS onChange with one CASH
  // line at the full totalAmount, mirroring the real component's
  // mount-seeding effect (covered in full by MultiPaymentInput.test.tsx).
  // Also surfaces `counterFlow.hasClient` as text so tests can assert on the
  // CUSTOMER_ACCOUNT gate (§10.3: must be name-AND-phone, not name-OR-phone)
  // without reaching into the real MultiPaymentInput/PaymentSheet internals.
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

// A working (non-null) stub — needed for the §10.3 hasClient tests below,
// which type into the receiver name/phone fields. Mirrors the real
// component's controlled-input contract (value/onChange(value: string)).
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
// mock behavior is safe for both usages. For the §6bis finding-1 "For
// Partner" test we need `forPartnerId` to become non-null (the real
// component's `autoSelectSingle` would do this against a single-partner
// list; here we just fire `onSelect` unconditionally on mount to drive a
// full submit and inspect the resulting payload).
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

describe("Services page — RECEIVE fee counter-flow wiring (BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §4 Phase C)", () => {
  beforeEach(() => {
    mockActiveSession = null;
    mockAddOMTTransaction.mockClear();
    mockAddToCart.mockClear();
  });

  it("OMT RECEIVE $100, fee $5, fee-on-top, non-session → feePayments carries the seeded CASH leg", async () => {
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

    // Simulate MultiPaymentInput's mount-seeding effect for the counter-flow
    // section (real behavior proven in MultiPaymentInput.test.tsx).
    fireEvent.click(screen.getByTestId("mpi-seed-counter-flow"));

    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload.feePayments).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 5 },
    ]);
  });

  it("includingFees checked → NO feePayments field (fee is netted into the payout, not collected separately)", async () => {
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
    fireEvent.click(screen.getByTestId("service-including-fees-toggle"));

    // The counter-flow section must not even render once includingFees is
    // checked — showFeeCounterFlow requires !includingFees.
    expect(
      screen.queryByTestId("mpi-seed-counter-flow"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    expect(payload).not.toHaveProperty("feePayments");
  });

  it("active session → NO feePayments field (session RECEIVE fee collection isn't wired yet, §2 bug 1)", async () => {
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

    // The fee UI (and so the counter-flow section) is hidden entirely inside
    // an active RECEIVE session.
    expect(
      screen.queryByTestId("mpi-seed-counter-flow"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));

    await waitFor(() => expect(mockAddToCart).toHaveBeenCalledTimes(1));

    const cartItem = mockAddToCart.mock.calls[0][0] as {
      formData: Record<string, unknown>;
    };
    expect(cartItem.formData).not.toHaveProperty("feePayments");
  });

  it('"For Partner" toggle ON → counter-flow section hidden and no feePayments sent (§6bis finding 1)', async () => {
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
    // "select a partner" validation (~line 793) does not stop us short of
    // the real bug surface: a FOR-partner RECEIVE reaching addOMTTransaction.
    fireEvent.click(screen.getByRole("checkbox", { name: /For Partner/i }));

    // §6bis finding 1: the toggle alone — before/regardless of which partner
    // ends up selected — must hide the fee counter-flow section, since a
    // FOR-partner RECEIVE has no walk-in fee to collect (PFT-3b no-booking
    // dispatch).
    expect(
      screen.queryByTestId("mpi-seed-counter-flow"),
    ).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));

    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));

    const payload = mockAddOMTTransaction.mock.calls[0][0] as Record<
      string,
      unknown
    >;
    // Confirms this really is the FOR-partner path (not an accidental no-op)
    // and that it carries no feePayments key at all — not an empty array,
    // absent entirely, matching the legacy no-legs contract the repository
    // expects for this dispatch.
    expect(payload.partnerMode).toBe("FOR");
    expect(payload.partnerId).toBe(1);
    expect(payload).not.toHaveProperty("feePayments");
  });

  // BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §10.3: the counter-flow's CUSTOMER_ACCOUNT
  // gate must use the canonical name-AND-phone rule (`canChargeToCustomerAccount`),
  // not the one-off name-OR-phone check it shipped with. Proven failing-first
  // (rule 17): reverting the fix's line to `!!receiverName || !!receiverPhone`
  // turns the first two assertions below green→red (they'd read "true" instead
  // of "false"), confirming the test exercises the exact regressed predicate.
  describe("counter-flow hasClient gate (§10.3 — name-AND-phone, not name-OR-phone)", () => {
    async function setUpReceiveWithFee() {
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
    }

    it("receiver name only (no phone) → hasClient is false", async () => {
      await setUpReceiveWithFee();

      fireEvent.change(
        document.getElementById("service-receiver-name") as HTMLInputElement,
        { target: { value: "Jane Doe" } },
      );

      expect(screen.getByTestId("counter-flow-has-client")).toHaveTextContent(
        "false",
      );
    });

    it("receiver phone only (no name) → hasClient is false", async () => {
      await setUpReceiveWithFee();

      fireEvent.change(
        document.getElementById(
          "service-receiver-phone",
        ) as HTMLInputElement,
        { target: { value: "70111222" } },
      );

      expect(screen.getByTestId("counter-flow-has-client")).toHaveTextContent(
        "false",
      );
    });

    it("receiver name AND phone → hasClient is true", async () => {
      await setUpReceiveWithFee();

      fireEvent.change(
        document.getElementById("service-receiver-name") as HTMLInputElement,
        { target: { value: "Jane Doe" } },
      );
      fireEvent.change(
        document.getElementById(
          "service-receiver-phone",
        ) as HTMLInputElement,
        { target: { value: "70111222" } },
      );

      expect(screen.getByTestId("counter-flow-has-client")).toHaveTextContent(
        "true",
      );
    });
  });
});
