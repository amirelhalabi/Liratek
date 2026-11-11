/**
 * Services — 3 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 3).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { createFinancialServiceSchema } from "@liratek/core";
import Services from "../index";
import {
  setPayoutLine,
  payoutLegAmounts,
  type PayoutLineSide,
} from "@/shared/testing/payoutExtraLess";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });

const mockGetOMTHistory = jest.fn().mockResolvedValue([]);

const mockApi = {
  getOMTHistory: mockGetOMTHistory,
  getOMTAnalytics: jest.fn().mockResolvedValue({
    today: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
    month: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
    byProvider: [],
  }),
  getSuppliers: jest.fn().mockResolvedValue([]),
  getSupplierBalances: jest.fn().mockResolvedValue([]),
  partners: { getAll: jest.fn().mockResolvedValue([]) },
  addOMTTransaction: mockAddOMTTransaction,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  // Stable reference (rule 25). MultiPaymentInput is NOT stubbed.
  useApi: () => mockApi,
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
      { code: "WHISH", label: "Whish Wallet" },
      { code: "CUSTOMER_ACCOUNT", label: "Customer Account" },
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

// A plain input, so the sender name + phone can be filled as the cashier
// does (the e2e picks a saved client, which fills both).
jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: ({
    id,
    value,
    onChange,
  }: {
    id?: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
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

function resetBetweenFiles() {
  jest.clearAllMocks();
  (mockGetOMTHistory as unknown as jest.Mock).mockReset();
  (mockGetOMTHistory as unknown as jest.Mock).mockResolvedValue([]);
  (mockApi.getOMTAnalytics as unknown as jest.Mock).mockReset();
  (mockApi.getOMTAnalytics as unknown as jest.Mock).mockResolvedValue({
    today: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
    month: { commission: 0, pending_commission: 0, count: 0, byCurrency: [] },
    byProvider: [],
  });
  (mockApi.getSuppliers as unknown as jest.Mock).mockReset();
  (mockApi.getSuppliers as unknown as jest.Mock).mockResolvedValue([]);
  (mockApi.getSupplierBalances as unknown as jest.Mock).mockReset();
  (mockApi.getSupplierBalances as unknown as jest.Mock).mockResolvedValue([]);
  (mockApi.partners.getAll as unknown as jest.Mock).mockReset();
  (mockApi.partners.getAll as unknown as jest.Mock).mockResolvedValue([]);
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("Services.addedChangeRealBox (LIRA-336)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Services page — customer adds change with the REAL payment box (LIRA-336).
   * Owner example on an OMT system RECEIVE: $197 owed, the cashier opens
   * "+ Customer gives change", enters Cash USD 3; "Shop pays" follows to $200
   * and the payload carries customerPayments [Cash USD 3] + added_change_usd 3.
   *
   * The page tests (Services.addedChange.test.tsx) stub the box; this one runs
   * the real MultiPaymentInput, so it also guards against a render loop from
   * the page's counterFlow wiring (rule 25: a loop shows up as a hang / worker
   * OOM, not as a failure). Field names come from the shared schema (rule 24).
   * Rule 17: written after the page change — not proven failing-first.
   */

  function receiveButton(): HTMLElement {
    const b = screen
      .getAllByRole("button")
      .find(
        (el) =>
          (el.textContent ?? "").includes("OMT") &&
          (el.textContent ?? "").includes("↓"),
      );
    if (!b) throw new Error("no RECEIVE button");
    return b;
  }

  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    mockGetOMTHistory.mockClear();
  });

  describe("Services page — customer adds change, real payment box (LIRA-336)", () => {
    it("OMT RECEIVE $197 + customer Cash $3 → shop pays $200, customerPayments [Cash 3], added_change_usd 3", async () => {
      render(<Services />);
      await waitFor(() => expect(mockGetOMTHistory).toHaveBeenCalled());
      fireEvent.click(receiveButton());
      fireEvent.change(
        document.getElementById("service-amount") as HTMLInputElement,
        { target: { value: "197" } },
      );

      fireEvent.click(await screen.findByTestId("counter-flow-add-change"));
      const cfAmount = await waitFor(() => {
        const el = document.querySelector<HTMLInputElement>(
          '[data-testid^="counter-flow-amount-"]',
        );
        if (!el) throw new Error("customer section not open");
        return el;
      });
      fireEvent.change(cfAmount, { target: { value: "3" } });
      // Let the box settle (auto-sync of "Shop pays").
      await act(async () => {
        await new Promise((r) => setTimeout(r, 300));
      });

      fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));
      await waitFor(() =>
        expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1),
      );
      const p = createFinancialServiceSchema.parse(
        mockAddOMTTransaction.mock.calls[0][0],
      );
      expect(p.serviceType).toBe("RECEIVE");
      expect(p.amount).toBe(197);
      expect(p.customerPayments).toEqual([
        { method: "CASH", currencyCode: "USD", amount: 3 },
      ]);
      expect(p.added_change_usd).toBe(3);
      expect(p.payments).toEqual([
        expect.objectContaining({
          method: "CASH",
          currencyCode: "USD",
          amount: 200,
        }),
      ]);
      expect(p.rounding_given_usd).toBeUndefined();
      expect(p.kept_change_usd).toBeUndefined();
    });
  });
});

describe("Services.payoutExtraLess (LIRA-382)", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Services page (OMT / Whish system RECEIVE) — the "− Less | + Extra" line
   * on the payout, with the REAL payment box (LIRA-382). Table-driven, the same
   * cases as every other payout screen: the cashier types in the line, the
   * payment line follows, and the ONE payload carries the existing
   * `rounding_given_*` / `kept_change_*` fields, read off the payload after
   * `createFinancialServiceSchema` parses it (rule 24). Stable `useApi` mock
   * (rule 25). Rule 17: run against the box without the line first — see the
   * task report.
   */

  function receiveButton(): HTMLElement {
    const b = screen
      .getAllByRole("button")
      .find(
        (el) =>
          (el.textContent ?? "").includes("OMT") &&
          (el.textContent ?? "").includes("↓"),
      );
    if (!b) throw new Error("no RECEIVE button");
    return b;
  }

  type Parsed = ReturnType<typeof createFinancialServiceSchema.parse>;
  const CASES: {
    name: string;
    currency: "USD" | "LBP";
    owed: string;
    side: PayoutLineSide;
    typed: string;
    leg: number;
    check: (p: Parsed) => void;
  }[] = [
    {
      name: "+ Extra 0.10 on $102.90 → pays $103.00, rounding_given_usd 0.1",
      currency: "USD",
      owed: "102.90",
      side: "extra",
      typed: "0.10",
      leg: 103,
      check: (p) => {
        expect(p.rounding_given_usd).toBe(0.1);
        expect(p.rounding_given_lbp ?? 0).toBe(0);
        expect(p.kept_change_usd).toBeUndefined();
        expect(p.kept_change_lbp).toBeUndefined();
      },
    },
    {
      name: "− Less 5,000 on 1,345,000 LBP → pays 1,340,000, kept_change_lbp 5000",
      currency: "LBP",
      owed: "1345000",
      side: "less",
      typed: "5000",
      leg: 1_340_000,
      check: (p) => {
        expect(p.kept_change_lbp).toBe(5_000);
        expect(p.kept_change_usd ?? 0).toBe(0);
        expect(p.rounding_given_usd).toBeUndefined();
        expect(p.rounding_given_lbp).toBeUndefined();
      },
    },
  ];

  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    mockGetOMTHistory.mockClear();
  });

  describe("Services page — payout '− Less | + Extra' line, real box (LIRA-382)", () => {
    it.each(CASES)("OMT RECEIVE: $name", async (c) => {
      render(<Services />);
      await waitFor(() => expect(mockGetOMTHistory).toHaveBeenCalled());
      fireEvent.click(receiveButton());
      fireEvent.click(screen.getByTestId(`service-currency-${c.currency}`));
      fireEvent.change(
        document.getElementById("service-amount") as HTMLInputElement,
        { target: { value: c.owed } },
      );
      await screen.findByTestId("payout-extra-less");
      setPayoutLine(c.side, c.typed);
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });
      expect(payoutLegAmounts()).toEqual([c.leg]);

      fireEvent.click(screen.getByRole("button", { name: /Record Receive/i }));
      await waitFor(() =>
        expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1),
      );
      const p = createFinancialServiceSchema.parse(
        mockAddOMTTransaction.mock.calls[0][0],
      );
      expect(p.serviceType).toBe("RECEIVE");
      expect(p.payments).toEqual([
        expect.objectContaining({
          method: "CASH",
          currencyCode: c.currency,
          amount: c.leg,
        }),
      ]);
      c.check(p);
    });
  });
});

describe("Services.walletPmFeeRealBox", () => {
  beforeAll(resetBetweenFiles);

  /**
   * Shop-day bug 13 (re-opened 2026-10-17) — an OMT Intra $100 send paid from
   * the Whish wallet with the automatic 1% payment-method fee was refused:
   *   "expected $101.00 … got $102.00 (IN $102.00 …)"
   * The screen sent payments [WHISH 101, CUSTOMER_ACCOUNT 1] and NO
   * paymentMethodFee.
   *
   * Why `Services.walletPmFee.test.tsx` (d00a03ec) stayed green: it stubs the
   * payment box and leaves the sender empty, so the box's auto-debt remainder
   * (on only with a sender name + phone) never ran. Here the REAL
   * MultiPaymentInput renders and the sender is filled, as on the shop floor:
   * picking the wallet raises the total 101 → 102, and the box used to push
   * the $1 onto Customer Account instead of following the total; with two
   * lines the page dropped its single-line method fee from the payload.
   *
   * Variant table (rule 28d): service type × payment method × sender filled ×
   * "including fees". Every row submits exactly as the screen does and checks
   * the server's reconcile equation (FinancialServiceRepository SEND:
   * legs IN − OUT = amount + provider fee + payment-method fee). Field names
   * come from the shared schema (rule 24).
   */

  type OmtService = "INTRA" | "WESTERN_UNION";
  type Method = "CASH" | "WHISH" | "OMT";

  function byId<T extends HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`#${id} not rendered`);
    return el as T;
  }

  function change(el: HTMLElement, value: string): void {
    fireEvent.change(el, { target: { value } });
  }

  function omtServiceSelect(): HTMLSelectElement {
    const sel = Array.from(document.querySelectorAll("select")).find((s) =>
      Array.from(s.options).some((o) => o.value === "WESTERN_UNION"),
    );
    if (!sel) throw new Error("OMT service select not rendered");
    return sel;
  }

  function paymentMethodSelects(): HTMLSelectElement[] {
    return Array.from(
      document.querySelectorAll<HTMLSelectElement>(
        'select[data-testid^="payment-method-"]',
      ),
    );
  }

  async function sendAndCapture(opts: {
    service: OmtService;
    method: Method;
    withSender: boolean;
    includingFees: boolean;
  }) {
    render(<Services />);
    await waitFor(() => expect(mockGetOMTHistory).toHaveBeenCalled());

    change(omtServiceSelect(), opts.service);
    change(byId("service-amount"), "100");
    if (opts.withSender) {
      change(byId("service-sender-name"), "Nour Haddad");
      change(byId("service-sender-phone"), "70123456");
    }
    if (opts.includingFees) {
      fireEvent.click(screen.getByTestId("service-including-fees-toggle"));
    }
    await waitFor(() => expect(paymentMethodSelects()).toHaveLength(1));
    change(paymentMethodSelects()[0], opts.method);
    // Let the box settle (auto-sync, auto-debt, the delayed split reveal).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 700));
    });

    fireEvent.click(screen.getByRole("button", { name: /Record Send/i }));
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    return createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
  }

  beforeEach(() => {
    mockAddOMTTransaction.mockClear();
    mockGetOMTHistory.mockClear();
  });

  describe("Services page — OMT SEND with the real payment box (bug 13)", () => {
    it("Intra $100 from the Whish wallet, sender filled: one Whish $102 leg + the $1 method fee", async () => {
      const p = await sendAndCapture({
        service: "INTRA",
        method: "WHISH",
        withSender: true,
        includingFees: false,
      });
      expect(p.omtFee).toBe(1);
      expect(p.paymentMethodFee).toBe(1);
      expect(p.payments).toEqual([
        expect.objectContaining({ method: "WHISH", amount: 102 }),
      ]);
    });

    const services: OmtService[] = ["INTRA", "WESTERN_UNION"];
    const methods: Method[] = ["CASH", "WHISH", "OMT"];
    const rows = services.flatMap((service) =>
      methods.flatMap((method) =>
        [true, false].flatMap((withSender) =>
          [false, true].map((includingFees) => ({
            service,
            method,
            withSender,
            includingFees,
          })),
        ),
      ),
    );

    it.each(rows)(
      "$service paid by $method (sender filled: $withSender, including fees: $includingFees): legs match what the server expects",
      async (row) => {
        const p = await sendAndCapture(row);
        const legs = p.payments ?? [];
        const inTotal = legs
          .filter((l) => l.direction !== "OUT")
          .reduce((s, l) => s + l.amount, 0);
        const outTotal = legs
          .filter((l) => l.direction === "OUT")
          .reduce((s, l) => s + l.amount, 0);
        const expected = p.amount + (p.omtFee ?? 0) + (p.paymentMethodFee ?? 0);
        // Cent-exact, except one known pre-existing gap (noted, not fixed
        // here): wallet + "including fees" floors the sent amount to the cent
        // in the budget back-calculation (calcMaxSentAmountWithPmFee), so a
        // $100 budget books 1 cent short of the $100 leg (Western Union:
        // 85.14 + 10 + 0.85 = 99.99). The server accepts it (its tolerance is
        // $0.05), so 1 cent reaches the drawer unaccounted.
        const knownCentGap =
          row.method !== "CASH" && row.includingFees ? 0.01 : 0;
        expect(
          Math.abs(inTotal - outTotal - expected - knownCentGap),
        ).toBeLessThan(0.005);
        // Nothing is charged to the customer's account unasked.
        expect(legs.some((l) => l.method === "CUSTOMER_ACCOUNT")).toBe(false);
        // A wallet pays the method fee; cash never does.
        if (row.method === "CASH") expect(p.paymentMethodFee ?? 0).toBe(0);
        else expect(p.paymentMethodFee ?? 0).toBeGreaterThan(0);
      },
    );
  });
});
