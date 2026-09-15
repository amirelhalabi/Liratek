/** @jest-environment jsdom */

/**
 * LIRA-190/D4 — the OMT App top-up modal gets a funding-source CHOICE that
 * iPick/Katsh never needed: "On OMT credit" (default) vs "Transfer from
 * drawer" (the pre-existing path). Canonical implementation lives at
 * packages/ui/src/components/ui/TopUpModal.tsx; jest.config maps
 * "@liratek/ui" to that package's source (same convention as
 * CounterpartySettleModal's own tests), so this test imports it from there
 * rather than duplicating it under packages/ui (which has no jest of its
 * own — frontend's `roots` never scans it).
 *
 * What's guarded:
 *  - the choice defaults to "On OMT credit" and submitting in that state
 *    calls onConfirmSupplier (the credit path), never onConfirm (the
 *    transfer path) — proving the D4 default.
 *  - switching to "Transfer from drawer" and submitting calls onConfirm
 *    with the selected source drawer, never onConfirmSupplier — proving the
 *    alternative still reaches the pre-existing topUpApp path.
 *  - iPick/Katsh render NO funding choice at all (they only ever had the
 *    credit path) — a regression guard that this change didn't leak into
 *    the two providers that never asked for a toggle.
 *
 * Rule 17 note for whoever proves this failing-first: reverting
 * TopUpModal's `isSupplierCredit` to its pre-fix form
 * (`(provider === "iPick" || provider === "Katsh") && !!onConfirmSupplier`)
 * makes the "defaults to credit" test below fail, because OMT App would
 * fall through to the transfer branch (onConfirm) even with nothing
 * clicked.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { TopUpModal } from "@liratek/ui";

const ALL_DRAWERS = [
  { name: "General", usdBalance: 500, lbpBalance: 0 },
  { name: "OMT_App", usdBalance: 20, lbpBalance: 0 },
];

describe("TopUpModal — OMT App funding choice (D4)", () => {
  it("defaults to 'On OMT credit' and submits via onConfirmSupplier", async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined);
    const onConfirmSupplier = jest.fn().mockResolvedValue(undefined);

    render(
      <TopUpModal
        isOpen
        onClose={jest.fn()}
        onConfirm={onConfirm}
        onConfirmSupplier={onConfirmSupplier}
        provider="OMT_APP"
        allDrawers={ALL_DRAWERS}
        destinationDrawer="OMT_App"
        defaultSourceDrawer="General"
      />,
    );

    const creditToggle = screen.getByTestId("topup-funding-credit");
    const transferToggle = screen.getByTestId("topup-funding-transfer");
    expect(creditToggle).toBeInTheDocument();
    expect(transferToggle).toBeInTheDocument();

    // No source-drawer selector while the (default) credit mode is active.
    expect(screen.queryByText("From Drawer")).not.toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "100" },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    expect(onConfirmSupplier).toHaveBeenCalledWith({
      amount: 100,
      currency: "USD",
    });
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("'Transfer from drawer' submits via onConfirm, not onConfirmSupplier", async () => {
    const onConfirm = jest.fn().mockResolvedValue(undefined);
    const onConfirmSupplier = jest.fn().mockResolvedValue(undefined);

    render(
      <TopUpModal
        isOpen
        onClose={jest.fn()}
        onConfirm={onConfirm}
        onConfirmSupplier={onConfirmSupplier}
        provider="OMT_APP"
        allDrawers={ALL_DRAWERS}
        destinationDrawer="OMT_App"
        defaultSourceDrawer="General"
      />,
    );

    fireEvent.click(screen.getByTestId("topup-funding-transfer"));

    // Source-drawer selector reappears once "Transfer from drawer" is picked.
    expect(screen.getByText("From Drawer")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("0.00"), {
      target: { value: "50" },
    });
    fireEvent.click(screen.getByRole("button", { name: /confirm/i }));

    expect(onConfirm).toHaveBeenCalledWith({
      amount: 50,
      currency: "USD",
      sourceDrawer: "General",
    });
    expect(onConfirmSupplier).not.toHaveBeenCalled();
  });

  it("renders no funding choice for iPick/Katsh (credit is their only path)", () => {
    render(
      <TopUpModal
        isOpen
        onClose={jest.fn()}
        onConfirm={jest.fn()}
        onConfirmSupplier={jest.fn()}
        provider="iPick"
        allDrawers={ALL_DRAWERS}
        destinationDrawer="iPick"
        defaultSourceDrawer="General"
      />,
    );

    expect(screen.queryByTestId("topup-funding-credit")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("topup-funding-transfer"),
    ).not.toBeInTheDocument();
  });
});
