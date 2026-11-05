/** @jest-environment jsdom */
/**
 * LIRA-372 — the ONE Discount line on every settle screen: one field per
 * currency it is given, the label "Discount", the "Capped to max" note when a
 * typed value is above the room (min($5 / 450,000 LBP, owed)), and an
 * optional reason field.
 */
import { render, fireEvent, screen } from "@testing-library/react";
import { SettleDiscountLine } from "@liratek/ui";

describe("SettleDiscountLine (LIRA-372)", () => {
  it("shows one field per currency, the label and the reason", () => {
    const onReason = jest.fn();
    render(
      <SettleDiscountLine
        currencies={["USD", "LBP"]}
        values={{}}
        onChange={() => {}}
        room={{ USD: 5, LBP: 450_000 }}
        reason={{ value: "", onChange: onReason }}
      />,
    );
    expect(screen.getByTestId("settle-discount-line")).toBeTruthy();
    expect(screen.getByTestId("settle-discount-usd")).toBeTruthy();
    expect(screen.getByTestId("settle-discount-lbp")).toBeTruthy();
    expect(screen.getByText("Discount")).toBeTruthy();
    fireEvent.change(screen.getByTestId("settle-discount-reason"), {
      target: { value: "rounded" },
    });
    expect(onReason).toHaveBeenCalledWith("rounded");
  });

  it("shows only the currencies it is given", () => {
    render(
      <SettleDiscountLine
        currencies={["LBP"]}
        values={{}}
        onChange={() => {}}
        room={{ LBP: 450_000 }}
      />,
    );
    expect(screen.queryByTestId("settle-discount-usd")).toBeNull();
    expect(screen.getByTestId("settle-discount-lbp")).toBeTruthy();
  });

  it("passes the typed text up and shows the cap note at 6", () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <SettleDiscountLine
        currencies={["USD"]}
        values={{ USD: "" }}
        onChange={onChange}
        room={{ USD: 5 }}
      />,
    );
    fireEvent.change(screen.getByTestId("settle-discount-usd"), {
      target: { value: "6" },
    });
    expect(onChange).toHaveBeenCalledWith("USD", "6");
    rerender(
      <SettleDiscountLine
        currencies={["USD"]}
        values={{ USD: "6" }}
        onChange={onChange}
        room={{ USD: 5 }}
      />,
    );
    expect(screen.getByTestId("discount-cap-note").textContent).toBe(
      "Capped to max ($5.00)",
    );
  });

  it("shows no cap note inside the room, and refuses letters", () => {
    const onChange = jest.fn();
    render(
      <SettleDiscountLine
        currencies={["USD"]}
        values={{ USD: "2.5" }}
        onChange={onChange}
        room={{ USD: 5 }}
      />,
    );
    expect(screen.queryByTestId("discount-cap-note")).toBeNull();
    fireEvent.change(screen.getByTestId("settle-discount-usd"), {
      target: { value: "2.5x" },
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});
