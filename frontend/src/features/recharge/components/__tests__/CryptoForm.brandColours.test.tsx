/** @jest-environment jsdom */

/**
 * CryptoForm — Binance colours come from `PROVIDER_BRANDS.BINANCE`.
 *
 * Binance's own buttons are yellow (#f0b90b) with near-black labels. The form
 * used Tailwind amber with white labels, hand-typed in several places. These
 * assertions read every expected class from `PROVIDER_BRANDS`, so a change to
 * the brand module flows through without editing this test.
 *
 * Rule 17: written before the fix and seen failing against the amber classes.
 */

import { render, screen } from "@testing-library/react";
import { CryptoForm } from "../CryptoForm";
import { PROVIDER_BRANDS } from "@/shared/brand/providerBrands";
import { PROVIDER_CONFIGS } from "../../types";

const BINANCE = PROVIDER_BRANDS.BINANCE;

const mockPaymentSheet = jest.fn((_props: unknown) => null);
const mockServiceTypeTabs = jest.fn((_props: unknown) => null);

// Rule 25: one stable object for every useApi() call.
const mockApi = { getClients: jest.fn().mockResolvedValue([]) };

jest.mock("@liratek/ui", () => ({
  ...jest.requireActual("@liratek/ui"),
  useApi: () => mockApi,
  ServiceTypeTabs: (props: unknown) => {
    mockServiceTypeTabs(props);
    return null;
  },
}));

jest.mock("@/features/sessions/context/SessionContext", () => ({
  useSession: () => ({ activeSession: null }),
}));

jest.mock("../PaymentSheet", () => ({
  PaymentSheet: (props: unknown) => {
    mockPaymentSheet(props);
    return null;
  },
}));

jest.mock("../HistoryModal", () => ({ HistoryModal: () => null }));

jest.mock("@/shared/components/TransactionTimeOverride", () => ({
  TransactionTimeOverride: () => null,
}));

jest.mock("@/shared/components/ClientAutocompleteInput", () => ({
  ClientAutocompleteInput: () => null,
}));

jest.mock("@/features/partners/components/ForPartnerToggle", () => ({
  ForPartnerToggle: () => null,
  ForPartnerNotice: () => null,
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn() },
}));

function noop() {}

function renderForm(cryptoType: "SEND" | "RECEIVE") {
  const config = PROVIDER_CONFIGS.find((c) => c.key === "BINANCE");
  if (!config) throw new Error("BINANCE provider config missing");
  return render(
    <CryptoForm
      activeConfig={config}
      cryptoType={cryptoType}
      setCryptoType={noop}
      cryptoAmount="100"
      setCryptoAmount={noop}
      cryptoClientName=""
      setCryptoClientName={noop}
      cryptoClientPhone=""
      setCryptoClientPhone={noop}
      cryptoClientId={null}
      setCryptoClientId={noop}
      cryptoDescription=""
      setCryptoDescription={noop}
      cryptoFee=""
      setCryptoFee={noop}
      feeIncluded={false}
      setFeeIncluded={noop}
      feeCollectedSeparately={false}
      setFeeCollectedSeparately={noop}
      onCustomerLinesChange={noop}
      onCustomerForgivenChange={noop}
      customerPaymentMethods={[]}
      handleCryptoSubmit={noop}
      isSubmitting={false}
      binanceTransactions={[]}
      loadCryptoData={noop}
      showHistory={false}
      setShowHistory={noop}
      paymentMethods={[]}
      onPaymentLinesChange={noop}
      exchangeRate={89500}
    />,
  );
}

function lastProps(mock: jest.Mock): Record<string, unknown> {
  const calls = mock.mock.calls;
  return calls[calls.length - 1][0] as Record<string, unknown>;
}

describe("CryptoForm — Binance brand colours", () => {
  beforeEach(() => {
    mockPaymentSheet.mockClear();
    mockServiceTypeTabs.mockClear();
  });

  it.each([
    ["SEND", "Proceed to Pay"],
    ["RECEIVE", "Confirm Cash Out"],
  ] as const)(
    "%s: the enabled proceed button carries every class of PROVIDER_BRANDS.BINANCE.button",
    (type, label) => {
      renderForm(type);
      const button = screen.getByRole("button", { name: label });
      expect(button).not.toBeDisabled();
      for (const cls of BINANCE.button.split(/\s+/)) {
        expect(button).toHaveClass(cls);
      }
      // No leftover white label on the yellow fill.
      expect(button).not.toHaveClass("text-white");
    },
  );

  it("passes the Binance button classes to the PaymentSheet confirm button", () => {
    renderForm("SEND");
    expect(lastProps(mockPaymentSheet).accentColor).toBe(BINANCE.button);
  });

  it("colours the Send / Cash Out tabs with the Binance hex and dark label", () => {
    renderForm("SEND");
    const props = lastProps(mockServiceTypeTabs);
    expect(props.customColor).toBe(BINANCE.hex);
    expect(props.customTextColor).toBe(BINANCE.onHex);
  });

  it("uses the Binance focus border on the amount input", () => {
    renderForm("SEND");
    const input = document.getElementById("crypto-amount");
    expect(input).not.toBeNull();
    expect(input).toHaveClass(BINANCE.focusBorder);
  });
});
