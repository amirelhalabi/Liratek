/** @jest-environment jsdom */

/**
 * HoldMoneyPickupSheet — kept change on a Hold Money pickup (owner decision
 * 2026-10-07: a pickup is a PAYOUT; held $50.12, hand $50 → $0.12 profit,
 * under $1 / 100,000 LBP, same currency; a payout never sends OUT legs).
 *
 * NOT proven failing-first: the sheet change landed before this file was
 * written (the repository half IS proven failing-first, in
 * HoldMoneyRepository.keptChange.test.ts). Reasoning for why it would have
 * failed pre-change: the old sheet passed no `payer`, wired `onReturnChange`
 * instead of `onKeptChange`, and its payload had no `kept_change_*` field.
 *
 * MultiPaymentInput is replaced by a stub that captures its props, so the
 * test drives exactly what the real component would report. Field names
 * asserted on the payload come from `holdMoneyCollectSchema` (rule 24).
 */

import { render, fireEvent, waitFor, act } from "@testing-library/react";
import { holdMoneyCollectSchema } from "@liratek/core";
import { HoldMoneyPickupSheet } from "../HoldMoneyPickupSheet";

type KeptCb =
  | ((
      k: { usd: number; lbp: number; exactUsd: number; exactLbp: number } | null,
    ) => void)
  | undefined;

interface CapturedProps {
  payer?: string;
  direction?: string;
  currency?: string;
  totalAmountCurrency?: string;
  onChange?: (lines: unknown[]) => void;
  onKeptChange?: KeptCb;
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
  default: { error: jest.fn(), info: jest.fn(), warn: jest.fn(), debug: jest.fn() },
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

describe("HoldMoneyPickupSheet — payout kept change", () => {
  it("declares payer='payout' and never wires change-back (OUT) legs", () => {
    renderSheet(50.12, 0);
    const p = mockCaptured.props!;
    expect(p.payer).toBe("payout");
    expect(p.onReturnChange).toBeUndefined();
    expect(typeof p.onKeptChange).toBe("function");
    expect(p.totalAmountCurrency).toBe("USD");
  });

  it("held $50.12, hands $50 → sends kept_change_usd 0.12 with a plain payout leg", async () => {
    const view = renderSheet(50.12, 0);
    act(() => {
      mockCaptured.props!.onChange!([
        { id: "1", method: "CASH", currencyCode: "USD", amount: 50 },
      ]);
      mockCaptured.props!.onKeptChange!({
        usd: 0.12,
        lbp: 0,
        exactUsd: 0.12,
        exactLbp: 0,
      });
    });
    fireEvent.click(view.getByTestId("hold-money-pickup-submit"));
    await waitFor(() => expect(mockCollect).toHaveBeenCalled());

    const payload = sentPayload();
    expect(payload.kept_change_usd).toBe(0.12);
    expect(payload.kept_change_lbp ?? 0).toBe(0);
    expect(payload.payments).toEqual([
      { method: "CASH", currency_code: "USD", amount: 50 },
    ]);
    expect(payload.payments!.some((l) => l.direction === "OUT")).toBe(false);
  });

  it("an LBP-only pickup keeps change in LBP (total currency follows the pickup)", async () => {
    const view = renderSheet(0, 1_050_000);
    expect(mockCaptured.props!.totalAmountCurrency).toBe("LBP");
    act(() => {
      mockCaptured.props!.onChange!([
        { id: "1", method: "CASH", currencyCode: "LBP", amount: 1_000_000 },
      ]);
      mockCaptured.props!.onKeptChange!({
        usd: 0,
        lbp: 50_000,
        exactUsd: 0,
        exactLbp: 50_000,
      });
    });
    fireEvent.click(view.getByTestId("hold-money-pickup-submit"));
    await waitFor(() => expect(mockCollect).toHaveBeenCalled());
    expect(sentPayload().kept_change_lbp).toBe(50_000);
  });

  // Two-currency pickups (owner decision 2026-10-07, second half): kept per
  // currency, NO cap. MultiPaymentInput's payout kept logic owes ONE
  // currency and is capped, so the sheet computes it from its own payout
  // lines vs the amounts being returned (holdPickupKeptPerCurrency, the
  // same helper the server verifies with). Written failing-first: the old
  // sheet sent no kept fields on a two-currency pickup.
  describe("two-currency pickup", () => {
    it("does not wire MultiPaymentInput's one-currency, capped onKeptChange", () => {
      renderSheet(50, 1_000_000);
      expect(mockCaptured.props!.onKeptChange).toBeUndefined();
    });

    it("owner example: held $50 + 1,000,000 LBP, hands $50 + 950,000 LBP → sends kept_change_lbp 50,000 and shows it", async () => {
      const view = renderSheet(50, 1_000_000);
      act(() => {
        mockCaptured.props!.onChange!([
          { id: "1", method: "CASH", currencyCode: "USD", amount: 50 },
          { id: "2", method: "CASH", currencyCode: "LBP", amount: 950_000 },
        ]);
      });
      expect(view.getByTestId("hold-pickup-kept-note").textContent).toMatch(
        /50,000 LBP/,
      );
      fireEvent.click(view.getByTestId("hold-money-pickup-submit"));
      await waitFor(() => expect(mockCollect).toHaveBeenCalled());
      const payload = sentPayload();
      expect(payload.kept_change_lbp).toBe(50_000);
      expect(payload.kept_change_usd ?? 0).toBe(0);
      expect(payload.usd_amount).toBe(50);
      expect(payload.lbp_amount).toBe(1_000_000);
      expect(payload.payments).toEqual([
        { method: "CASH", currency_code: "USD", amount: 50 },
        { method: "CASH", currency_code: "LBP", amount: 950_000 },
      ]);
    });

    it("keeps in both currencies at once, with no cap", async () => {
      const view = renderSheet(52.5, 1_250_000);
      act(() => {
        mockCaptured.props!.onChange!([
          { id: "1", method: "CASH", currencyCode: "USD", amount: 50 },
          { id: "2", method: "CASH", currencyCode: "LBP", amount: 1_000_000 },
        ]);
      });
      fireEvent.click(view.getByTestId("hold-money-pickup-submit"));
      await waitFor(() => expect(mockCollect).toHaveBeenCalled());
      const payload = sentPayload();
      expect(payload.kept_change_usd).toBe(2.5);
      expect(payload.kept_change_lbp).toBe(250_000);
    });

    it("a cross-currency payout (more USD than the USD portion) sends no kept — exact reconcile path", async () => {
      const view = renderSheet(50, 895_000);
      act(() => {
        mockCaptured.props!.onChange!([
          { id: "1", method: "CASH", currencyCode: "USD", amount: 60 },
        ]);
      });
      expect(view.queryByTestId("hold-pickup-kept-note")).toBeNull();
      fireEvent.click(view.getByTestId("hold-money-pickup-submit"));
      await waitFor(() => expect(mockCollect).toHaveBeenCalled());
      const payload = sentPayload();
      expect(payload.kept_change_usd).toBeUndefined();
      expect(payload.kept_change_lbp).toBeUndefined();
    });

    it("an exact two-currency payout sends no kept fields", async () => {
      const view = renderSheet(50, 1_000_000);
      act(() => {
        mockCaptured.props!.onChange!([
          { id: "1", method: "CASH", currencyCode: "USD", amount: 50 },
          { id: "2", method: "CASH", currencyCode: "LBP", amount: 1_000_000 },
        ]);
      });
      fireEvent.click(view.getByTestId("hold-money-pickup-submit"));
      await waitFor(() => expect(mockCollect).toHaveBeenCalled());
      const payload = sentPayload();
      expect(payload.kept_change_usd).toBeUndefined();
      expect(payload.kept_change_lbp).toBeUndefined();
    });

    it("ignores a stale one-currency kept figure once both currencies are returned", async () => {
      const view = renderSheet(50.12, 0);
      act(() => {
        mockCaptured.props!.onKeptChange!({ usd: 0.12, lbp: 0, exactUsd: 0.12, exactLbp: 0 });
      });
      // Not reachable from the UI clamp (max = remaining), so remount with a
      // two-currency hold instead and confirm nothing leaks across.
      view.unmount();
      mockCollect.mockClear();
      const v2 = renderSheet(50, 1_000_000);
      act(() => {
        mockCaptured.props!.onChange!([
          { id: "1", method: "CASH", currencyCode: "USD", amount: 50 },
          { id: "2", method: "CASH", currencyCode: "LBP", amount: 1_000_000 },
        ]);
      });
      fireEvent.click(v2.getByTestId("hold-money-pickup-submit"));
      await waitFor(() => expect(mockCollect).toHaveBeenCalled());
      expect(sentPayload().kept_change_usd).toBeUndefined();
    });
  });

  it("an exact pickup (nothing kept) sends no kept fields", async () => {
    const view = renderSheet(50, 0);
    act(() => {
      mockCaptured.props!.onChange!([
        { id: "1", method: "CASH", currencyCode: "USD", amount: 50 },
      ]);
      mockCaptured.props!.onKeptChange!(null);
    });
    fireEvent.click(view.getByTestId("hold-money-pickup-submit"));
    await waitFor(() => expect(mockCollect).toHaveBeenCalled());
    const payload = sentPayload();
    expect(payload.kept_change_usd).toBeUndefined();
    expect(payload.kept_change_lbp).toBeUndefined();
  });
});
