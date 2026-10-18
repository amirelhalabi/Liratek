/** @jest-environment jsdom */

/**
 * HoldMoneyPickupSheet — customer adds change on a pickup (LIRA-336, T018).
 *
 * Held $197, the customer hands over $3 and the cashier gives back a round
 * $200. ONE-currency pickups get an optional "Customer gives change" section
 * (`counterFlow: { optional, allowAddedChange, totalAmount: 0, currency:
 * pickupCurrency }`) and `onAddedChange`; the sheet sends the customer's
 * non-zero lines as `customerPayments` plus `added_change_*` in the ONE
 * payload (rule 22). A two-currency pickup gets neither and sends neither
 * (the server refuses a claim there).
 *
 * Harness from HoldMoneyPickupSheet.roundUp.test.tsx (MultiPaymentInput
 * stubbed to capture its props). Payload parsed through
 * `holdMoneyCollectSchema` (rule 24).
 * Rule 17: run against the unwired sheet first — see the task report.
 */

import { render, fireEvent, waitFor, act } from "@testing-library/react";
import { holdMoneyCollectSchema } from "@liratek/core";
import { HoldMoneyPickupSheet } from "../HoldMoneyPickupSheet";

type Pair = { usd: number; lbp: number } | null;

interface CapturedCounterFlow {
  optional?: boolean;
  allowAddedChange?: boolean;
  totalAmount: number;
  currency: string;
  onChange: (lines: unknown[]) => void;
  onStateChange?: (state: Record<string, unknown>) => void;
}

interface CapturedProps {
  onChange?: (lines: unknown[]) => void;
  onAddedChange?: ((a: Pair) => void) | undefined;
  counterFlow?: CapturedCounterFlow;
}

const mockCaptured: { props: CapturedProps | null } = { props: null };
const mockCollect = jest.fn();

// Rule 25 — a STABLE useApi() reference.
const mockApi = {
  holdMoney: {
    collect: (...args: unknown[]) => mockCollect(...args),
  },
};

jest.mock("@liratek/ui", () => ({
  appEvents: { emit: jest.fn(), on: jest.fn(() => () => {}) },
  useApi: () => mockApi,
  DecimalInput: ({
    value,
    onChange,
    "data-testid": testId,
  }: {
    value: number;
    onChange: (n: number) => void;
    "data-testid"?: string;
  }) => (
    <input
      data-testid={testId}
      value={value === 0 ? "" : String(value)}
      onChange={(e) => onChange(parseFloat(e.target.value) || 0)}
    />
  ),
  MultiPaymentInput: (props: CapturedProps) => {
    mockCaptured.props = props;
    return <div data-testid="multi-payment-input" />;
  },
}));

jest.mock("@/hooks/usePaymentMethods", () => ({
  usePaymentMethods: () => ({ methods: [{ code: "CASH", label: "Cash" }] }),
}));

jest.mock("@/hooks/useSellRate", () => ({
  useSellRate: () => ({ buyRate: 89_500, sellRate: 90_000 }),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
}));

function renderSheet(remaining_usd: number, remaining_lbp: number) {
  return render(
    <HoldMoneyPickupSheet
      hold={{ id: 9, client_name: "Rami", remaining_usd, remaining_lbp }}
      onClose={jest.fn()}
      onCollected={jest.fn()}
    />,
  );
}

function sentPayload() {
  expect(mockCollect).toHaveBeenCalledTimes(1);
  return holdMoneyCollectSchema.parse(mockCollect.mock.calls[0][0]);
}

const props = () => mockCaptured.props!;

beforeEach(() => {
  mockCaptured.props = null;
  mockCollect.mockReset();
  mockCollect.mockResolvedValue({ success: true, id: 1 });
});

describe("HoldMoneyPickupSheet — customer adds change (LIRA-336)", () => {
  it("one-currency USD pickup: an optional 'Customer gives change' section in USD, plus onAddedChange", () => {
    renderSheet(197, 0);
    const cf = props().counterFlow;
    expect(cf).toBeDefined();
    expect(cf!.optional).toBe(true);
    expect(cf!.allowAddedChange).toBe(true);
    expect(cf!.totalAmount).toBe(0);
    expect(cf!.currency).toBe("USD");
    expect(typeof props().onAddedChange).toBe("function");
  });

  it("held $197, customer gives $3, $200 handed → customerPayments [$3] and added_change_usd 3", async () => {
    const view = renderSheet(197, 0);
    act(() => {
      props().counterFlow!.onChange([
        { id: "c1", method: "CASH", currencyCode: "USD", amount: 3 },
        { id: "c2", method: "CASH", currencyCode: "USD", amount: 0 },
      ]);
      props().onChange!([
        { id: "1", method: "CASH", currencyCode: "USD", amount: 200 },
      ]);
      props().onAddedChange!({ usd: 3, lbp: 0 });
    });
    fireEvent.click(view.getByTestId("hold-money-pickup-submit"));
    await waitFor(() => expect(mockCollect).toHaveBeenCalled());
    const payload = sentPayload();
    expect(payload.added_change_usd).toBe(3);
    expect(payload.added_change_lbp ?? 0).toBe(0);
    expect(payload.customerPayments).toEqual([
      { method: "CASH", currencyCode: "USD", amount: 3 },
    ]);
    expect(payload.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 200 },
    ]);
    expect(payload.rounding_given_usd).toBeUndefined();
  });

  it("LBP pickup: the section is in LBP and the claim goes in added_change_lbp", async () => {
    const view = renderSheet(0, 4_550_000);
    expect(props().counterFlow!.currency).toBe("LBP");
    act(() => {
      props().counterFlow!.onChange([
        { id: "c1", method: "CASH", currencyCode: "LBP", amount: 450_000 },
      ]);
      props().onChange!([
        { id: "1", method: "CASH", currencyCode: "LBP", amount: 5_000_000 },
      ]);
      props().onAddedChange!({ usd: 0, lbp: 450_000 });
    });
    fireEvent.click(view.getByTestId("hold-money-pickup-submit"));
    await waitFor(() => expect(mockCollect).toHaveBeenCalled());
    const payload = sentPayload();
    expect(payload.added_change_lbp).toBe(450_000);
    expect(payload.customerPayments).toEqual([
      { method: "CASH", currencyCode: "LBP", amount: 450_000 },
    ]);
  });

  it("section opened but left at 0 → no customerPayments and no claim", async () => {
    const view = renderSheet(197, 0);
    act(() => {
      props().counterFlow!.onChange([
        { id: "c1", method: "CASH", currencyCode: "USD", amount: 0 },
      ]);
      props().onChange!([
        { id: "1", method: "CASH", currencyCode: "USD", amount: 197 },
      ]);
      props().onAddedChange!(null);
    });
    fireEvent.click(view.getByTestId("hold-money-pickup-submit"));
    await waitFor(() => expect(mockCollect).toHaveBeenCalled());
    const raw = mockCollect.mock.calls[0][0] as Record<string, unknown>;
    expect(raw).not.toHaveProperty("customerPayments");
    const payload = sentPayload();
    expect(payload.added_change_usd).toBeUndefined();
    expect(payload.added_change_lbp).toBeUndefined();
  });

  it("the section reports overpaid (over the cap): Confirm is disabled and nothing is sent", () => {
    const view = renderSheet(197, 0);
    act(() => {
      props().counterFlow!.onChange([
        { id: "c1", method: "CASH", currencyCode: "USD", amount: 6 },
      ]);
      props().counterFlow!.onStateChange!({
        paid: 6,
        owedToAccount: 0,
        forgiven: 0,
        balanced: false,
        overpaid: true,
        needsClient: false,
        unaccounted: 0,
        addedChange: 0,
      });
      props().onChange!([
        { id: "1", method: "CASH", currencyCode: "USD", amount: 197 },
      ]);
      props().onAddedChange!(null);
    });
    const submit = view.getByTestId("hold-money-pickup-submit");
    expect(submit).toBeDisabled();
    fireEvent.click(submit);
    expect(mockCollect).not.toHaveBeenCalled();
  });

  // Written after the wiring — not proven failing-first (rule 17).
  it("a stale overpaid section is cleared when the box remounts (amount edited)", async () => {
    const view = renderSheet(197, 0);
    act(() => {
      props().counterFlow!.onChange([
        { id: "c1", method: "CASH", currencyCode: "USD", amount: 6 },
      ]);
      props().counterFlow!.onStateChange!({
        paid: 6,
        owedToAccount: 0,
        forgiven: 0,
        balanced: false,
        overpaid: true,
        needsClient: false,
        unaccounted: 0,
        addedChange: 0,
      });
      props().onChange!([
        { id: "1", method: "CASH", currencyCode: "USD", amount: 197 },
      ]);
    });
    expect(view.getByTestId("hold-money-pickup-submit")).toBeDisabled();
    fireEvent.change(view.getByTestId("hold-pickup-usd"), {
      target: { value: "150" },
    });
    act(() => {
      props().onChange!([
        { id: "1", method: "CASH", currencyCode: "USD", amount: 150 },
      ]);
    });
    await waitFor(() =>
      expect(view.getByTestId("hold-money-pickup-submit")).toBeEnabled(),
    );
    fireEvent.click(view.getByTestId("hold-money-pickup-submit"));
    await waitFor(() => expect(mockCollect).toHaveBeenCalled());
    const raw = mockCollect.mock.calls[0][0] as Record<string, unknown>;
    expect(raw).not.toHaveProperty("customerPayments");
    expect(raw).not.toHaveProperty("added_change_usd");
  });

  it("two-currency pickup: no section, no onAddedChange", () => {
    renderSheet(50, 1_000_000);
    expect(props().counterFlow).toBeUndefined();
    expect(props().onAddedChange).toBeUndefined();
  });

  it("a one-currency claim is not sent once the pickup becomes two-currency", async () => {
    const view = renderSheet(50, 1_000_000);
    fireEvent.change(view.getByTestId("hold-pickup-lbp"), {
      target: { value: "0" },
    });
    await waitFor(() => expect(props().counterFlow).toBeDefined());
    act(() => {
      props().counterFlow!.onChange([
        { id: "c1", method: "CASH", currencyCode: "USD", amount: 1 },
      ]);
      props().onAddedChange!({ usd: 1, lbp: 0 });
    });
    fireEvent.change(view.getByTestId("hold-pickup-lbp"), {
      target: { value: "1000000" },
    });
    await waitFor(() => expect(props().counterFlow).toBeUndefined());
    act(() => {
      props().onChange!([
        { id: "1", method: "CASH", currencyCode: "USD", amount: 50 },
        { id: "2", method: "CASH", currencyCode: "LBP", amount: 1_000_000 },
      ]);
    });
    fireEvent.click(view.getByTestId("hold-money-pickup-submit"));
    await waitFor(() => expect(mockCollect).toHaveBeenCalled());
    const raw = mockCollect.mock.calls[0][0] as Record<string, unknown>;
    expect(raw).not.toHaveProperty("customerPayments");
    const payload = sentPayload();
    expect(payload.added_change_usd).toBeUndefined();
    expect(payload.added_change_lbp).toBeUndefined();
  });
});
