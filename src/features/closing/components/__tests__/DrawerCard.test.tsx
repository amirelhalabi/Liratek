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
      />
    );

    expect(screen.getByText("General")).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("USD"), { target: { value: "1" } });
    expect(onAmountChange).toHaveBeenCalledWith("General", "USD", "1");
  });
});
