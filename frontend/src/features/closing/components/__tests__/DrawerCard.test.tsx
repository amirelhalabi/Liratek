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

  // Carrier cards (MTC/Alfa) — one row per active SIM line (LIRA-252 item A):
  // the drawer amount is no longer a free-typed field, it's the SUM of every
  // line's own Credits input.
  it("renders one Credits+Validity row per active line and sums them into the header total", () => {
    const onExpiryChange = jest.fn();
    const onCreditsChange = jest.fn();
    render(
      <DrawerCard
        drawer="MTC"
        currencies={[]}
        getDisplayValue={() => ""}
        onAmountChange={jest.fn()}
        carrierLines={[
          {
            lineId: 1,
            phoneNumber: "03111111",
            label: "Shop MTC",
            creditsValue: "40",
            onCreditsChange,
            expectedCredits: 40,
            countedExpiresAt: "2026-09-10",
            expectedExpiresAt: "2026-08-31",
            onExpiryChange,
            onResetExpiry: jest.fn(),
          },
          {
            lineId: 2,
            phoneNumber: "03222222",
            label: null,
            creditsValue: "10",
            onCreditsChange: jest.fn(),
            expectedCredits: 10,
            countedExpiresAt: "",
            expectedExpiresAt: null,
            onExpiryChange: jest.fn(),
            onResetExpiry: jest.fn(),
          },
        ]}
      />,
    );

    expect(screen.getByText(/03111111/)).toBeInTheDocument();
    expect(screen.getByText(/03222222/)).toBeInTheDocument();
    expect(screen.getAllByLabelText("Credits")).toHaveLength(2);
    expect(screen.getAllByLabelText("Validity")).toHaveLength(2);

    // Header total = 40 + 10 = 50.
    expect(screen.getByText("50.00")).toBeInTheDocument();

    // Validity variance (line 1) uses the shared day-count grammar.
    const validities = screen.getAllByLabelText("Validity");
    expect(validities[0]).toHaveValue("2026-09-10");
    expect(screen.getByText("+10d")).toBeInTheDocument();
    expect(screen.getByText("Expected: 2026-08-31")).toBeInTheDocument();

    fireEvent.change(validities[0], { target: { value: "2026-09-11" } });
    expect(onExpiryChange).toHaveBeenCalledWith("2026-09-11");

    const credits = screen.getAllByLabelText("Credits");
    fireEvent.change(credits[0], { target: { value: "45" } });
    expect(onCreditsChange).toHaveBeenCalledWith("45");
  });

  it("shows no validity row when the card has no carrier lines", () => {
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
