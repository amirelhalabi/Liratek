/** @jest-environment jsdom */

/**
 * LIRA-331 T045 (research R9, rule 28d) — the OMT/Whish system page sends the
 * SAME payload whatever language the screen is in. Each case fills the real
 * page the same way twice, once in English and once in Arabic, and the two
 * captured calls must be deep-equal: the `addOMTTransaction` payload (with
 * its stored `note`) on a walk-in, the whole `addToCart` item (its stored
 * `label` and `formData`) inside a session. Every payload is also parsed
 * through the shared schema, so the matrix proves each sub-type is accepted.
 *
 * Matrix: OMT × every OMT service type × SEND/RECEIVE × USD/LBP (Western
 * Union is USD only), walk-in and session; OMT For Partner SEND/RECEIVE;
 * Whish as the shop's own system: SEND, RECEIVE with no fee, with the fee on
 * top and with the fee included; Whish carried through a partner: SEND and
 * RECEIVE. Each Whish case walk-in and in a session.
 *
 * Nothing is selected by visible text — only ids, test ids and option
 * values — so the Arabic run fails only if the payload differs.
 *
 * NOT failing-first (rule 17): it passes before the page is translated. It
 * guards the conversion against a translated label leaking into saved data.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
} from "@testing-library/react";
import {
  createFinancialServiceSchema,
  OMT_SERVICE_TYPES,
  type OmtServiceType,
} from "@liratek/core";
import { i18n, loadLanguage } from "@/i18n/setup";
import Services from "../index";

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
  partners: {
    getAll: jest
      .fn()
      .mockResolvedValue([
        { id: 7, name: "Partner Seven", system_association: "WHISH" },
      ]),
  },
  addOMTTransaction: mockAddOMTTransaction,
};

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  // Stable reference (rule 25).
  useApi: () => mockApi,
  MultiPaymentInput: (props: {
    onChange: (lines: unknown[]) => void;
    totals: { amount: number; currency: string }[];
    counterFlow?: {
      totalAmount: number;
      currency: string;
      onChange: (lines: unknown[]) => void;
    };
  }) => (
    <button
      data-testid="mpi-pay-exact"
      onClick={() => {
        props.onChange([
          {
            id: "L1",
            method: "CASH",
            currencyCode: props.totals[0].currency,
            amount: props.totals[0].amount,
          },
        ]);
        props.counterFlow?.onChange([
          {
            id: "F1",
            method: "CASH",
            currencyCode: props.counterFlow.currency,
            amount: props.counterFlow.totalAmount,
          },
        ]);
      }}
    />
  ),
  DecimalInput: ({
    id,
    value,
    onChange,
  }: {
    id?: string;
    value: number;
    onChange: (n: number) => void;
  }) => (
    <input
      id={id}
      type="text"
      value={value === 0 ? "" : String(value)}
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

const mockAddToCart = jest.fn();
const mockLinkTransaction = jest.fn();
const SESSION = {
  id: 3,
  customer_name: "Session Client",
  customer_phone: "71000000",
};
let mockActiveSession: typeof SESSION | null = null;
jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: mockActiveSession,
    linkTransaction: mockLinkTransaction,
    addToCart: mockAddToCart,
  }),
}));

const mockMethods = [
  { code: "CASH", label: "Cash" },
  { code: "OMT", label: "OMT Wallet" },
];
jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({ methods: mockMethods }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000 }),
}));

// The shop's base system: OMT-base makes Whish the partner (THROUGH)
// system, WHISH-base makes Whish the shop's own system.
let mockPartnerSystem: "OMT" | "WHISH" = "WHISH";
jest.mock("@/hooks/useShopBase", () => ({
  useShopBase: () => ({
    baseSystem: mockPartnerSystem === "WHISH" ? "OMT" : "WHISH",
    partnerSystem: mockPartnerSystem,
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
  }: {
    id?: string;
    value: string;
    onChange: (v: string) => void;
  }) => (
    <input id={id} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: ({
    onSelect,
    systemFilter,
  }: {
    onSelect: (id: number) => void;
    systemFilter?: string;
  }) => (
    <button
      data-testid={`partner-selector-${systemFilter ?? "any"}`}
      onClick={() => onSelect(7)}
    />
  ),
}));

jest.mock("@/features/partners/components/ForPartnerToggle", () => ({
  ForPartnerToggle: ({
    onChange,
    testId,
  }: {
    onChange: (v: boolean) => void;
    testId: string;
  }) => <button data-testid={testId} onClick={() => onChange(true)} />,
  ForPartnerNotice: ({
    children,
    testId,
  }: {
    children: React.ReactNode;
    testId: string;
  }) => <div data-testid={testId}>{children}</div>,
}));

jest.mock("../../../components/StatsCards", () => ({
  StatsCards: () => <div data-testid="stats-cards" />,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

type Mode = "walkIn" | "session" | "forPartner";

interface Case {
  name: string;
  provider: "OMT" | "WHISH";
  serviceType: "SEND" | "RECEIVE";
  currency: "USD" | "LBP";
  omtServiceType?: OmtServiceType;
  mode: Mode;
  whishFee?: number;
  includingFees?: boolean;
  /** Whish carried for a partner (OMT-base shop) instead of the shop's own. */
  whishThroughPartner?: boolean;
  /** Online Brokerage: the BINANCE fee charged to the customer. */
  binanceFee?: number;
}

function input(id: string): HTMLInputElement {
  const el = document.getElementById(id) as HTMLInputElement | null;
  if (!el) throw new Error(`missing #${id}`);
  return el;
}

async function fillAndSubmit(c: Case): Promise<unknown> {
  mockActiveSession = c.mode === "session" ? SESSION : null;
  mockPartnerSystem =
    c.provider === "WHISH" && !c.whishThroughPartner ? "OMT" : "WHISH";
  mockAddOMTTransaction.mockClear();
  mockAddToCart.mockClear();

  render(<Services />);
  await waitFor(() => expect(mockGetOMTHistory).toHaveBeenCalled());
  // The partner list decides whether the Whish tabs are enabled.
  await waitFor(() =>
    expect(
      screen.getByTestId(`services-tab-${c.provider}-${c.serviceType}`),
    ).not.toBeDisabled(),
  );
  fireEvent.click(
    screen.getByTestId(`services-tab-${c.provider}-${c.serviceType}`),
  );
  fireEvent.click(screen.getByTestId(`service-currency-${c.currency}`));

  if (c.provider === "OMT" && c.omtServiceType) {
    const typeSelect = Array.from(document.querySelectorAll("select")).find(
      (s) => Array.from(s.options).some((o) => o.value === "CASH_TO_BUSINESS"),
    ) as HTMLSelectElement;
    fireEvent.change(typeSelect, { target: { value: c.omtServiceType } });
  }
  if (c.provider === "WHISH" && c.whishThroughPartner) {
    fireEvent.click(screen.getByTestId("partner-selector-WHISH"));
  }
  if (c.mode === "forPartner") {
    fireEvent.click(screen.getByTestId("services-for-partner-toggle"));
    fireEvent.click(screen.getByTestId("partner-selector-any"));
  }

  fireEvent.change(input("service-amount"), {
    target: { value: c.currency === "LBP" ? "500000" : "100" },
  });
  if (c.binanceFee) {
    fireEvent.click(screen.getByTestId("service-binance-charge-toggle"));
    fireEvent.change(input("binance-supplier"), {
      target: { value: "Binance" },
    });
    fireEvent.change(input("binance-fee"), {
      target: { value: String(c.binanceFee) },
    });
  }
  if (c.whishFee) {
    fireEvent.change(input("service-whish-fee"), {
      target: { value: String(c.whishFee) },
    });
  }
  if (c.includingFees) {
    fireEvent.click(screen.getByTestId("service-including-fees-toggle"));
  }
  const party = c.serviceType === "SEND" ? "sender" : "receiver";
  fireEvent.change(input(`service-${party}-name`), {
    target: { value: "Ali Saad" },
  });
  fireEvent.change(input(`service-${party}-phone`), {
    target: { value: "70123456" },
  });
  fireEvent.change(input("service-reference"), { target: { value: "R-1" } });
  if (c.mode !== "forPartner") {
    fireEvent.click(screen.getByTestId("mpi-pay-exact"));
  }

  fireEvent.click(screen.getByTestId("services-submit"));
  if (c.mode === "session") {
    await waitFor(() => expect(mockAddToCart).toHaveBeenCalledTimes(1));
    const item = mockAddToCart.mock.calls[0][0] as { formData: unknown };
    createFinancialServiceSchema.parse(item.formData);
    cleanup();
    return item;
  }
  await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
  const payload = mockAddOMTTransaction.mock.calls[0][0];
  createFinancialServiceSchema.parse(payload);
  cleanup();
  return payload;
}

const OMT_CASES: Case[] = OMT_SERVICE_TYPES.flatMap((omtServiceType) =>
  (["SEND", "RECEIVE"] as const).flatMap((serviceType) =>
    (["USD", "LBP"] as const)
      .filter((cur) => !(cur === "LBP" && omtServiceType === "WESTERN_UNION"))
      .flatMap((currency) =>
        (["walkIn", "session"] as const).map(
          (mode): Case => ({
            name: `OMT ${omtServiceType} ${serviceType} ${currency} ${mode}`,
            provider: "OMT",
            serviceType,
            currency,
            omtServiceType,
            mode,
          }),
        ),
      ),
  ),
);

// Online Brokerage with the BINANCE fee charged to the customer: the fee is
// part of the payment total and travels as the transfer's fee.
const BROKERAGE_FEE_CASES: Case[] = (["walkIn", "session"] as const).map(
  (mode): Case => ({
    name: `OMT ONLINE_BROKERAGE SEND USD BINANCE fee charged ${mode}`,
    provider: "OMT",
    serviceType: "SEND",
    currency: "USD",
    omtServiceType: "ONLINE_BROKERAGE",
    mode,
    binanceFee: 0.37,
  }),
);

const PARTNER_CASES: Case[] = (["SEND", "RECEIVE"] as const).flatMap(
  (serviceType) =>
    (["USD", "LBP"] as const).map(
      (currency): Case => ({
        name: `OMT INTRA ${serviceType} ${currency} For Partner`,
        provider: "OMT",
        serviceType,
        currency,
        omtServiceType: "INTRA",
        mode: "forPartner",
      }),
    ),
);

const WHISH_CASES: Case[] = (["walkIn", "session"] as const).flatMap(
  (mode): Case[] => [
    {
      name: `Whish through a partner SEND USD ${mode}`,
      provider: "WHISH",
      serviceType: "SEND",
      currency: "USD",
      mode,
      whishThroughPartner: true,
    },
    {
      name: `Whish through a partner RECEIVE LBP ${mode}`,
      provider: "WHISH",
      serviceType: "RECEIVE",
      currency: "LBP",
      mode,
      whishThroughPartner: true,
    },
    {
      name: `Whish SEND USD ${mode}`,
      provider: "WHISH",
      serviceType: "SEND",
      currency: "USD",
      mode,
    },
    {
      name: `Whish RECEIVE LBP no fee ${mode}`,
      provider: "WHISH",
      serviceType: "RECEIVE",
      currency: "LBP",
      mode,
    },
    {
      name: `Whish RECEIVE USD fee on top ${mode}`,
      provider: "WHISH",
      serviceType: "RECEIVE",
      currency: "USD",
      mode,
      whishFee: 2,
    },
    {
      name: `Whish RECEIVE USD fee included ${mode}`,
      provider: "WHISH",
      serviceType: "RECEIVE",
      currency: "USD",
      mode,
      whishFee: 2,
      includingFees: true,
    },
  ],
);

beforeAll(async () => {
  await loadLanguage("ar");
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("OMT/Whish payloads are the same in English and Arabic (LIRA-331)", () => {
  it.each(
    [
      ...OMT_CASES,
      ...BROKERAGE_FEE_CASES,
      ...PARTNER_CASES,
      ...WHISH_CASES,
    ].map((c) => [c.name, c]),
  )("%s", async (_name, c) => {
    await i18n.changeLanguage("en");
    const en = await fillAndSubmit(c as Case);
    await i18n.changeLanguage("ar");
    const ar = await fillAndSubmit(c as Case);
    expect(ar).toEqual(en);
    if ((c as Case).binanceFee) {
      // The fee path really ran: it travels as the transfer's fee.
      const sent = ((en as { formData?: unknown }).formData ?? en) as {
        omtFee?: number;
        payFee?: boolean;
      };
      expect([sent.payFee, sent.omtFee]).toEqual([
        true,
        (c as Case).binanceFee,
      ]);
    }
  });
});

describe("OMT/Whish page language (LIRA-331)", () => {
  it("shows Arabic labels when the language is ar, English otherwise", async () => {
    mockActiveSession = null;
    mockPartnerSystem = "WHISH";
    render(<Services />);
    await waitFor(() => expect(mockGetOMTHistory).toHaveBeenCalled());
    expect(screen.getByTestId("services-submit")).toHaveTextContent(
      "Record Send",
    );
    cleanup();

    await i18n.changeLanguage("ar");
    render(<Services />);
    await waitFor(() => expect(mockGetOMTHistory).toHaveBeenCalled());
    expect(screen.getByTestId("services-submit")).toHaveTextContent(
      "تسجيل الإرسال",
    );
    expect(screen.getByRole("button", { name: "السجل" })).toBeInTheDocument();
  });
});
