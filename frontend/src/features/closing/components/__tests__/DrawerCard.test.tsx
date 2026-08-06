/** @jest-environment jsdom */

import { render, screen, fireEvent } from "@testing-library/react";
import { DrawerCard } from "../DrawerCard";

describe("DrawerCard", () => {
  it("renders drawer label and calls onAmountChange", () => {
    const onAmountChange = jest.fn();
    render(
      <DrawerCard
        drawer="General"
        currencies={[{ code: "USD", name: "US Dollar", is_active: 1 }]}
        getDisplayValue={() => ""}
        onAmountChange={onAmountChange}
      />,
    );

    expect(screen.getByText("General")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("USD"), { target: { value: "1" } });
    expect(onAmountChange).toHaveBeenCalledWith("General", "USD", "1");
  });

  // Carrier cards (MTC/Alfa) — the SIM's own validity row, plan Phase 3.
  it("renders the validity row, the phone number and the Credits label for a carrier line", () => {
    const onExpiryChange = jest.fn();
    render(
      <DrawerCard
        drawer="MTC"
        currencies={[{ code: "USD", name: "US Dollar", is_active: 1 }]}
        getDisplayValue={() => "40"}
        onAmountChange={jest.fn()}
        currencyLabels={{ USD: "Credits" }}
        carrierLine={{
          phoneNumber: "03111111",
          label: "Shop MTC",
          countedExpiresAt: "2026-09-10",
          expectedExpiresAt: "2026-08-31",
          onExpiryChange,
          onResetExpiry: jest.fn(),
        }}
      />,
    );

    // The USD row reads as credits, and the SIM number is in the header.
    expect(screen.getByLabelText("Credits")).toBeInTheDocument();
    expect(screen.getByText(/03111111/)).toBeInTheDocument();

    // Validity variance uses the shared day-count grammar.
    const validity = screen.getByLabelText("Validity");
    expect(validity).toHaveValue("2026-09-10");
    expect(screen.getByText("+10d")).toBeInTheDocument();
    expect(screen.getByText("Expected: 2026-08-31")).toBeInTheDocument();

    fireEvent.change(validity, { target: { value: "2026-09-11" } });
    expect(onExpiryChange).toHaveBeenCalledWith("2026-09-11");
  });

  it("shows no validity row when the card has no carrier line", () => {
    render(
      <DrawerCard
        drawer="General"
        currencies={[{ code: "USD", name: "US Dollar", is_active: 1 }]}
        getDisplayValue={() => ""}
        onAmountChange={jest.fn()}
      />,
    );
    expect(screen.queryByLabelText("Validity")).not.toBeInTheDocument();
  });
});
