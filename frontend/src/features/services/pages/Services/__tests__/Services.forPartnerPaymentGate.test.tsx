/** @jest-environment jsdom */

/**
 * Services page — For-Partner payment-section gating.
 *
 * History: LIRA-114 §4 first gated this section (a For-Partner SEND offered
 * only drawer-affecting methods, relabelled "Paid from", and sent the
 * shop's disbursement as an OUT leg). LIRA-258 (owner decision D1,
 * 2026-10-06) REPLACED that contract: a For-Partner SEND on the shop's own
 * OMT/Whish system now books obligations only — the shop owes the provider
 * amount + fee, the partner owes the shop amount + fee, and NO drawer moves.
 * Core rejects any payment leg on that path ("A partner OMT/Whish SEND has
 * no payment legs — …") and any non-CASH `paidByMethod`
 * (`assertNoCounterPayment`).
 *
 * The old "Paid from" / drawer-only-methods / "You pay out" assertions were
 * REWRITTEN to the new contract (rule 24), not deleted: they now guard that
 * the picker is gone, that the note says what is actually booked, and that
 * the submit payload carries no legs and no stale paid-by method.
 *
 * Payload assertions go through `createFinancialServiceSchema` (rule 24) so
 * the field names come from the schema itself and Zod's key-stripping is
 * part of what is checked.
 *
 * `mockApi` is a module-level const, so `useApi()` returns a stable
 * reference across renders (rule 25).
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { createFinancialServiceSchema } from "@liratek/core";
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
// branch (LIRA-118) auto-selects it the instant a selector mounts — no
// dropdown interaction needed. `system_association: "WHISH"` also makes it
// selectable by the THROUGH-mode selector on the WHISH tab (OMT-base shop).
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
  // Displays the contract the page feeds the payment section AND exposes a
  // button that fires the page's real `onChange(lines)`, so a test can
  // leave `paidByMethod`/`paymentLines` on a non-cash method BEFORE
  // ticking For Partner (the stale-state case core rejects).
  MultiPaymentInput: ({
    paymentMethods,
    label,
    autoDebtRemainder,
    onChange,
  }: {
    paymentMethods?: { code: string }[];
    label?: string;
    autoDebtRemainder?: boolean;
    onChange: (
      lines: {
        id: string;
        method: string;
        currencyCode: string;
        amount: number;
      }[],
    ) => void;
  }) => (
    <div>
      <div data-testid="multi-payment-props">
        {JSON.stringify({
          methodCodes: (paymentMethods ?? []).map((m) => m.code),
          label,
          autoDebtRemainder: !!autoDebtRemainder,
        })}
      </div>
      <button
        data-testid="mpi-pick-omt-wallet"
        onClick={() =>
          onChange([
            { id: "L1", method: "OMT", currencyCode: "USD", amount: 51 },
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

// Default: base system OMT ⇒ partnerSystem (secondary) is WHISH — the "For
// Partner" toggle renders on the OMT tab. One test flips this to a
// WHISH-base shop (For Partner on the Whish tab). A stable object per
// configuration, so the hook's return identity does not churn per render.
const OMT_BASE = { baseSystem: "OMT", partnerSystem: "WHISH", loading: false };
const WHISH_BASE = {
  baseSystem: "WHISH",
  partnerSystem: "OMT",
  loading: false,
};
let mockShopBase: typeof OMT_BASE = OMT_BASE;
jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => mockShopBase,
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

// NOT mocked on purpose: PartnerSelector (so checking "For Partner" really
// auto-selects SOLE_PARTNER) and ForPartnerToggle (the real
// ForPartnerNotice is under test).

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

function typeAmount(value: string) {
  fireEvent.change(
    document.getElementById("service-amount") as HTMLInputElement,
    { target: { value } },
  );
}

async function checkForPartnerAndWaitForSelection() {
  fireEvent.click(screen.getByRole("checkbox", { name: /For Partner/i }));
  // PartnerSelector's single-partner effect auto-selects SOLE_PARTNER —
  // wait for its "Partner: Ziad Supplies" line so `forPartnerId` is
  // committed before asserting anything downstream.
  await screen.findByText(/Partner: Ziad Supplies/);
  // The "Partner: …" line renders one commit BEFORE the selector's effect
  // pushes the id into the page — wait for the page's own "select partner"
  // warning to clear so `forPartnerId` really is set.
  await waitFor(() =>
    expect(screen.queryByText(/Select partner/)).not.toBeInTheDocument(),
  );
}

/** Submit and return the payload as the core schema parses it. */
async function submitAndParse() {
  fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));
  await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
  const raw = mockAddOMTTransaction.mock.calls[0][0] as Record<string, unknown>;
  const parsed = createFinancialServiceSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `payload rejected by createFinancialServiceSchema: ${JSON.stringify(parsed.error.issues)}`,
    );
  }
  return { raw, parsed: parsed.data };
}

describe("Services page — For-Partner payment-section gating (LIRA-114 §4, LIRA-258)", () => {
  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    mockShopBase = OMT_BASE;
  });

  it("For Partner ON + OMT SEND: the paid-by picker is gone and an obligations-only note replaces it", async () => {
    await renderPage();
    // Default state is already OMT + SEND.
    await checkForPartnerAndWaitForSelection();

    // Was: "offers only drawer-affecting methods, labelled 'Paid from'".
    // There is no method to choose any more — no drawer moves.
    expect(screen.queryByTestId("multi-payment-props")).not.toBeInTheDocument();
    expect(screen.queryByText("Paid from")).not.toBeInTheDocument();
    expect(
      screen.getByTestId("services-for-partner-send-obligation-notice"),
    ).toBeInTheDocument();
  });

  it("For Partner ON + OMT SEND: the note names the partner, the amount + fee total, the OMT supplier page and that no cash leaves a drawer", async () => {
    await renderPage();
    // $50 INTRA falls in the $0-100 tier ($1 fee); includingFees=false by
    // default, so what the partner owes is amount + fee = $51.
    typeAmount("50");
    await checkForPartnerAndWaitForSelection();

    const notice = screen.getByTestId(
      "services-for-partner-send-obligation-notice",
    );
    // The name comes from the page's own loadData() → activePartnersList,
    // a separate promise from the selector's — wait for it.
    await waitFor(() => {
      expect(notice).toHaveTextContent("Ziad Supplies");
    });
    expect(notice).toHaveTextContent("owes you");
    expect(notice).toHaveTextContent("$51.00");
    expect(notice).toHaveTextContent("amount + fee");
    expect(notice).toHaveTextContent("OMT supplier page");
    expect(notice).toHaveTextContent("money you owe OMT");
    expect(notice).toHaveTextContent("No cash leaves a drawer");
    // The superseded "You pay out" disbursement wording must be gone.
    expect(notice).not.toHaveTextContent(/You pay out/i);
    expect(
      screen.queryByTestId("services-for-partner-send-payout-notice"),
    ).not.toBeInTheDocument();
  });

  it("For Partner ON + OMT SEND: submits payments: [] and paymentMethodFee 0 with no stale non-cash paid-by method, even after a wallet method was picked first", async () => {
    await renderPage();
    typeAmount("50");
    // Stale state: operator picks OMT wallet as the walk-in payment, THEN
    // ticks For Partner. Pre-LIRA-258 the method rode through as an OUT
    // leg; core now rejects both a leg and a non-CASH paidByMethod.
    fireEvent.click(screen.getByTestId("mpi-pick-omt-wallet"));
    await checkForPartnerAndWaitForSelection();

    const { raw, parsed } = await submitAndParse();
    expect(parsed.partnerMode).toBe("FOR");
    expect(parsed.partnerId).toBe(SOLE_PARTNER.id);
    expect(parsed.provider).toBe("OMT");
    expect(parsed.serviceType).toBe("SEND");
    expect(parsed.payments).toEqual([]);
    expect(parsed.paymentMethodFee).toBe(0);
    // Absent, or the harmless CASH default — never "OMT"/"CUSTOMER_ACCOUNT".
    expect([undefined, "CASH"]).toContain(parsed.paidByMethod);
    expect(raw).not.toHaveProperty("paymentMethodFeeRate");
  });

  it("For Partner ON + OMT SEND: sender name+phone filled still cannot produce a Customer Account leg", async () => {
    await renderPage();
    typeAmount("50");
    await checkForPartnerAndWaitForSelection();
    // Was: "never auto-adds a Customer Account remainder leg" (the
    // autoDebtRemainder prop). With the picker gone there is no sheet to
    // auto-add from; the guard is now the payload itself.
    fireEvent.change(
      document.getElementById("service-sender-name") as HTMLInputElement,
      { target: { value: "Walk-in Wendy" } },
    );
    fireEvent.change(
      document.getElementById("service-sender-phone") as HTMLInputElement,
      { target: { value: "71234567" } },
    );

    const { parsed } = await submitAndParse();
    expect(parsed.payments).toEqual([]);
    expect(parsed.paidByMethod).not.toBe("CUSTOMER_ACCOUNT");
  });

  it("For Partner ON + WHISH SEND (Whish-base shop): the note says Whish and the payload carries no legs", async () => {
    mockShopBase = WHISH_BASE;
    await renderPage();
    switchTab("WHISH", "SEND");
    typeAmount("40");
    await checkForPartnerAndWaitForSelection();

    const notice = screen.getByTestId(
      "services-for-partner-send-obligation-notice",
    );
    expect(notice).toHaveTextContent("Whish supplier page");
    expect(notice).toHaveTextContent("money you owe Whish");
    expect(notice).not.toHaveTextContent("OMT");

    const { parsed } = await submitAndParse();
    expect(parsed.provider).toBe("WHISH");
    expect(parsed.partnerMode).toBe("FOR");
    expect(parsed.payments).toEqual([]);
    expect(parsed.paymentMethodFee).toBe(0);
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

  it("For Partner OFF + SEND: unchanged — Customer Account still offered, section still labelled 'Payment'", async () => {
    await renderPage();
    // Default state: forPartner is off.

    const props = readPaymentProps();
    expect(props.methodCodes).toEqual(["CASH", "OMT", "CUSTOMER_ACCOUNT"]);
    expect(props.label).toBe("Payment");
  });

  it("For Partner OFF + SEND: no For-Partner notice is rendered", async () => {
    await renderPage();

    expect(
      screen.queryByTestId("services-for-partner-send-obligation-notice"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("services-for-partner-receive-no-payout-notice"),
    ).not.toBeInTheDocument();
  });

  it("THROUGH-partner mode (partner selected on the secondary-system tab): shows the amount/fee hint", async () => {
    await renderPage();
    // OMT-base shop ⇒ WHISH is the secondary system (THROUGH mode).
    switchTab("WHISH", "SEND");

    expect(
      await screen.findByTestId("services-through-partner-amount-hint"),
    ).toHaveTextContent(
      "Amount = what the partner tells you to collect · Fee = your shop fee",
    );
  });

  it("THROUGH hint is absent on the base-system tab", async () => {
    await renderPage();
    // Default OMT tab — base system, no THROUGH selector.
    expect(
      screen.queryByTestId("services-through-partner-amount-hint"),
    ).not.toBeInTheDocument();
  });
});
