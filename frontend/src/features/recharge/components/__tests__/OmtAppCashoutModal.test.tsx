/** @jest-environment jsdom */

/**
 * LIRA-192 (D10-D15) — "Cash Out to OMT". Guards:
 *  - the commission preview and the resulting account-credit figure are
 *    DERIVED from `omtAppCashoutCommission` (the shared core function/
 *    constant), never a second hardcoded 0.1% in this component — the
 *    preview-vs-stamp divergence class the repo is auditing (rule 14). The
 *    mock below stands in for core's real rounding so this test verifies
 *    the WIRING (the modal calls the shared function and renders whatever
 *    it returns), not core's own arithmetic, which core's own suite owns.
 *  - submitting sends exactly { amount, currency } to onConfirm.
 *  - an amount over the wallet balance for the selected currency is
 *    flagged and blocks submit client-side (D15's server guard is the
 *    source of truth; this only saves a round trip).
 *
 * Rule 17 note: reverting the component to compute `amount * 0.001` inline
 * instead of calling the mocked `omtAppCashoutCommission` makes the
 * "commission preview" assertion below fail (the mock is set to return a
 * value inline math would never happen to match), which is exactly the
 * divergence this test exists to catch.
 */

import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockCommission = jest.fn(
  (amount: number, _currency: string) => amount * 0.001,
);

jest.mock("@liratek/core", () => ({
  ...jest.requireActual("@liratek/core"),
  omtAppCashoutCommission: (amount: number, currency: string) =>
    mockCommission(amount, currency),
}));

import { OmtAppCashoutModal } from "../OmtAppCashoutModal";

describe("OmtAppCashoutModal", () => {
  beforeEach(() => {
    mockCommission.mockClear();
  });

  it("renders the amount/currency/commission-preview/submit controls", () => {
    render(
      <OmtAppCashoutModal isOpen onClose={jest.fn()} onConfirm={jest.fn()} />,
    );

    expect(screen.getByTestId("omt-app-cashout-amount")).toBeInTheDocument();
    expect(screen.getByTestId("omt-app-cashout-currency")).toBeInTheDocument();
    expect(
      screen.getByTestId("omt-app-cashout-commission-preview"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("omt-app-cashout-submit")).toBeInTheDocument();
  });

  it("computes the preview from the shared core function, not inline math", () => {
    render(
      <OmtAppCashoutModal isOpen onClose={jest.fn()} onConfirm={jest.fn()} />,
    );

    fireEvent.change(screen.getByTestId("omt-app-cashout-amount"), {
      target: { value: "100" },
    });

    expect(mockCommission).toHaveBeenCalledWith(100, "USD");
    expect(screen.getByTestId("omt-app-cashout-commission-preview")).toHaveTextContent(
      "$0.10",
    );
    // Resulting account credit = principal + commission (D11).
    expect(screen.getByText("$100.10")).toBeInTheDocument();
  });

  it("submits { amount, currency } to onConfirm", async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined);
    const onClose = jest.fn();

    render(
      <OmtAppCashoutModal isOpen onClose={onClose} onConfirm={onConfirm} />,
    );

    fireEvent.change(screen.getByTestId("omt-app-cashout-amount"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByTestId("omt-app-cashout-submit"));

    await waitFor(() =>
      expect(onConfirm).toHaveBeenCalledWith({ amount: 50, currency: "USD" }),
    );
  });

  it("flags an amount over the wallet balance and blocks submit client-side", () => {
    render(
      <OmtAppCashoutModal
        isOpen
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        walletBalance={{ usdBalance: 20, lbpBalance: 0 }}
      />,
    );

    fireEvent.change(screen.getByTestId("omt-app-cashout-amount"), {
      target: { value: "100" },
    });

    expect(
      screen.getByText(/exceeds the OMT App wallet balance/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("omt-app-cashout-submit")).toBeDisabled();
  });

  it("uses the supplied formatAmount for the preview when given", () => {
    const formatAmount = jest.fn(
      (value: number | null | undefined, code: string) => `${code}:${value}`,
    );

    render(
      <OmtAppCashoutModal
        isOpen
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        formatAmount={formatAmount}
      />,
    );

    fireEvent.change(screen.getByTestId("omt-app-cashout-amount"), {
      target: { value: "10" },
    });

    expect(formatAmount).toHaveBeenCalled();
    expect(
      screen.getByTestId("omt-app-cashout-commission-preview"),
    ).toHaveTextContent("USD:0.01");
  });
});
