/** @jest-environment jsdom */

/**
 * OMT App / Whish App RECEIVE — the "− Less | + Extra" line on the payout,
 * with the REAL payment sheet (LIRA-382). Table-driven, the same cases as
 * every other payout screen; the shop owes $100. The payload is parsed
 * through `createFinancialServiceSchema` before its fields are read
 * (rule 24). Rule 17: run against the box without the line first — see the
 * task report.
 */

import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { createFinancialServiceSchema } from "@liratek/core";
import {
  setPayoutLine,
  payoutLegAmounts,
  type PayoutLineSide,
} from "@/shared/testing/payoutExtraLess";
import { OmtWhishAppTransferForm } from "../OmtWhishAppTransferForm";

const mockAddOMTTransaction = jest
  .fn()
  .mockResolvedValue({ success: true, id: 1 });
// Stable reference (rule 25).
const mockApi = { addOMTTransaction: mockAddOMTTransaction };

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
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
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({
    activeSession: null,
    linkTransaction: jest.fn(),
    addToCart: jest.fn(),
  }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ sellRate: 89500, buyRate: 89000 }),
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({
    methods: [{ code: "CASH", label: "Cash" }],
    drawerAffectingMethods: [{ code: "CASH", label: "Cash" }],
  }),
}));

jest.mock("../../utils/ensureClient", () => ({
  ensureRechargeClient: jest.fn().mockResolvedValue({ ok: true, id: null }),
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

jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: () => null,
}));

jest.mock("../HistoryModal", () => ({
  HistoryModal: () => null,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

const formatAmount = (val: number, currency: string) =>
  currency === "USD"
    ? `$${val.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`
    : `${val.toLocaleString()} ${currency}`;

function renderForm() {
  return render(
    <OmtWhishAppTransferForm
      activeProvider="WHISH_APP"
      transactions={[]}
      loadFinancialData={jest.fn()}
      formatAmount={formatAmount}
    />,
  );
}

async function openReceive(amount: string) {
  renderForm();
  fireEvent.click(screen.getByRole("button", { name: /Receive/i }));
  fireEvent.change(
    document.getElementById("transfer-amount") as HTMLInputElement,
    { target: { value: amount } },
  );
  fireEvent.click(screen.getByRole("button", { name: /Proceed to Pay/i }));
  await screen.findByTestId("payout-extra-less");
}

type Parsed = ReturnType<typeof createFinancialServiceSchema.parse>;
const CASES: {
  name: string;
  side: PayoutLineSide;
  typed: string;
  leg: number;
  check: (p: Parsed) => void;
}[] = [
  {
    name: "+ Extra 0.10 on $100 → pays $100.10, rounding_given_usd 0.1",
    side: "extra",
    typed: "0.10",
    leg: 100.1,
    check: (p) => {
      expect(p.rounding_given_usd).toBe(0.1);
      expect(p.kept_change_usd).toBeUndefined();
    },
  },
  {
    name: "− Less 0.50 on $100 → pays $99.50, kept_change_usd 0.5",
    side: "less",
    typed: "0.50",
    leg: 99.5,
    check: (p) => {
      expect(p.kept_change_usd).toBe(0.5);
      expect(p.rounding_given_usd).toBeUndefined();
    },
  },
];

describe("OmtWhishAppTransferForm — RECEIVE payout '− Less | + Extra' line (LIRA-382)", () => {
  beforeEach(() => mockAddOMTTransaction.mockClear());

  it.each(CASES)("$name", async (c) => {
    await openReceive("100");
    setPayoutLine(c.side, c.typed);
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(payoutLegAmounts()).toEqual([c.leg]);
    const pay = screen.getByRole("button", { name: /^Pay / });
    await waitFor(() => expect(pay).toBeEnabled());
    fireEvent.click(pay);
    await waitFor(() => expect(mockAddOMTTransaction).toHaveBeenCalledTimes(1));
    const p = createFinancialServiceSchema.parse(
      mockAddOMTTransaction.mock.calls[0][0],
    );
    expect(p.serviceType).toBe("RECEIVE");
    expect(p.payments).toEqual([
      expect.objectContaining({ currencyCode: "USD", amount: c.leg }),
    ]);
    c.check(p);
  });
});
