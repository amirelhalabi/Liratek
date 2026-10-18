/** @jest-environment jsdom */

/**
 * HoldMoneyPickupSheet — payout round-up on a Hold Money pickup (LIRA-334,
 * T028). Handing out a little MORE than is returned (held $50.90, hands $51)
 * is a round-up the shop books as change rounding. ONE-currency pickups
 * only: MultiPaymentInput reports it via `onRoundUpChange` (capped, in the
 * pickup's currency) and the sheet sends `rounding_given_*` in the ONE
 * payload. A two-currency pickup never wires or sends it (the server
 * refuses a claim there).
 *
 * Harness from HoldMoneyPickupSheet.keptChange.test.tsx (MultiPaymentInput
 * stubbed to capture its props). Payload parsed through
 * `holdMoneyCollectSchema` (rule 24).
 * Rule 17: run against the unwired sheet first — see the task report.
 */

import { render, fireEvent, waitFor, act } from "@testing-library/react";
import { holdMoneyCollectSchema } from "@liratek/core";
import { HoldMoneyPickupSheet } from "../HoldMoneyPickupSheet";

type KeptCb =
  | ((
      k: {
        usd: number;
        lbp: number;
        exactUsd: number;
        exactLbp: number;
      } | null,
    ) => void)
  | undefined;

interface CapturedProps {
  payer?: string;
  direction?: string;
  currency?: string;
  totalAmountCurrency?: string;
  onChange?: (lines: unknown[]) => void;
  onKeptChange?: KeptCb;
  onRoundUpChange?:
    | ((r: { usd: number; lbp: number } | null) => void)
    | undefined;
  onReturnChange?: unknown;
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
  // Parse through the schema — what the server would actually keep.
  return holdMoneyCollectSchema.parse(mockCollect.mock.calls[0][0]);
}

beforeEach(() => {
  mockCaptured.props = null;
  mockCollect.mockReset();
  mockCollect.mockResolvedValue({ success: true, id: 1 });
});

describe("HoldMoneyPickupSheet — payout round-up (LIRA-334)", () => {
  it("one-currency: held $50.90, hands $51 → sends rounding_given_usd 0.1 and no kept change", async () => {
    const view = renderSheet(50.9, 0);
    expect(typeof mockCaptured.props!.onRoundUpChange).toBe("function");
    act(() => {
      mockCaptured.props!.onChange!([
        { id: "1", method: "CASH", currencyCode: "USD", amount: 51 },
      ]);
      mockCaptured.props!.onKeptChange?.(null);
      mockCaptured.props!.onRoundUpChange?.({ usd: 0.1, lbp: 0 });
    });
    fireEvent.click(view.getByTestId("hold-money-pickup-submit"));
    await waitFor(() => expect(mockCollect).toHaveBeenCalled());
    const payload = sentPayload();
    expect(payload.rounding_given_usd).toBe(0.1);
    expect(payload.rounding_given_lbp ?? 0).toBe(0);
    expect(payload.kept_change_usd).toBeUndefined();
    expect(payload.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 51 },
    ]);
  });

  it("LBP one-currency: 1,000,000 handed on 995,000 → rounding_given_lbp 5,000", async () => {
    const view = renderSheet(0, 995_000);
    act(() => {
      mockCaptured.props!.onChange!([
        { id: "1", method: "CASH", currencyCode: "LBP", amount: 1_000_000 },
      ]);
      mockCaptured.props!.onRoundUpChange?.({ usd: 0, lbp: 5_000 });
    });
    fireEvent.click(view.getByTestId("hold-money-pickup-submit"));
    await waitFor(() => expect(mockCollect).toHaveBeenCalled());
    expect(sentPayload().rounding_given_lbp).toBe(5_000);
  });

  it("exact pickup: no rounding_given_* is sent", async () => {
    const view = renderSheet(50, 0);
    act(() => {
      mockCaptured.props!.onChange!([
        { id: "1", method: "CASH", currencyCode: "USD", amount: 50 },
      ]);
      mockCaptured.props!.onRoundUpChange?.(null);
    });
    fireEvent.click(view.getByTestId("hold-money-pickup-submit"));
    await waitFor(() => expect(mockCollect).toHaveBeenCalled());
    const payload = sentPayload();
    expect(payload.rounding_given_usd).toBeUndefined();
    expect(payload.rounding_given_lbp).toBeUndefined();
  });

  it("two-currency pickup: never wires onRoundUpChange", () => {
    renderSheet(50, 1_000_000);
    expect(mockCaptured.props!.onRoundUpChange).toBeUndefined();
  });

  it("a one-currency round-up is not sent once the pickup becomes two-currency", async () => {
    const view = renderSheet(50, 1_000_000);
    // Return only the USD part first → a one-currency pickup.
    fireEvent.change(view.getByTestId("hold-pickup-lbp"), {
      target: { value: "0" },
    });
    await waitFor(() =>
      expect(typeof mockCaptured.props!.onRoundUpChange).toBe("function"),
    );
    act(() => {
      mockCaptured.props!.onRoundUpChange!({ usd: 0.5, lbp: 0 });
    });
    // Then both currencies again.
    fireEvent.change(view.getByTestId("hold-pickup-lbp"), {
      target: { value: "1000000" },
    });
    await waitFor(() =>
      expect(mockCaptured.props!.onRoundUpChange).toBeUndefined(),
    );
    act(() => {
      mockCaptured.props!.onChange!([
        { id: "1", method: "CASH", currencyCode: "USD", amount: 50 },
        { id: "2", method: "CASH", currencyCode: "LBP", amount: 1_000_000 },
      ]);
    });
    fireEvent.click(view.getByTestId("hold-money-pickup-submit"));
    await waitFor(() => expect(mockCollect).toHaveBeenCalled());
    const payload = sentPayload();
    expect(payload.rounding_given_usd).toBeUndefined();
    expect(payload.rounding_given_lbp).toBeUndefined();
  });
});
