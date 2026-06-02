/** @jest-environment jsdom */
import { render, screen, fireEvent } from "@testing-library/react";
import { DateRangeFilter } from "../DateRangeFilter";
// @testing-library/jest-dom matchers are loaded globally (jest.setup.ts) — no import needed.

/**
 * DateRangeFilter is a pure controlled component: two `type="date"` inputs
 * (From / To) that report changes via onFromChange / onToChange. The original
 * e2e specs (S34–S39) exercised page-level filtering driven by these inputs;
 * here we assert the component's own contract — render, reflect controlled
 * values, and emit the correct callbacks on change — which is what any parent
 * page relies on to perform its filtering.
 */
describe("DateRangeFilter", () => {
  function setup(overrides: Partial<{ from: string; to: string }> = {}) {
    const onFromChange = jest.fn();
    const onToChange = jest.fn();
    render(
      <DateRangeFilter
        from={overrides.from ?? ""}
        to={overrides.to ?? ""}
        onFromChange={onFromChange}
        onToChange={onToChange}
      />,
    );
    return {
      onFromChange,
      onToChange,
      fromInput: screen.getByTestId("date-range-from") as HTMLInputElement,
      toInput: screen.getByTestId("date-range-to") as HTMLInputElement,
    };
  }

  it("renders both From and To date inputs with labels", () => {
    const { fromInput, toInput } = setup();

    expect(screen.getByText("From:")).toBeInTheDocument();
    expect(screen.getByText("To:")).toBeInTheDocument();
    expect(fromInput).toBeInTheDocument();
    expect(toInput).toBeInTheDocument();
    expect(fromInput).toHaveAttribute("type", "date");
    expect(toInput).toHaveAttribute("type", "date");
  });

  it("reflects the controlled from/to values", () => {
    const { fromInput, toInput } = setup({
      from: "2026-01-01",
      to: "2026-01-31",
    });

    expect(fromInput.value).toBe("2026-01-01");
    expect(toInput.value).toBe("2026-01-31");
  });

  it("calls onFromChange with the new value when From changes (S35)", () => {
    const { fromInput, onFromChange, onToChange } = setup();

    fireEvent.change(fromInput, { target: { value: "2026-06-03" } });

    expect(onFromChange).toHaveBeenCalledTimes(1);
    expect(onFromChange).toHaveBeenCalledWith("2026-06-03");
    expect(onToChange).not.toHaveBeenCalled();
  });

  it("calls onToChange with the new value when To changes (S36)", () => {
    const { toInput, onFromChange, onToChange } = setup();

    fireEvent.change(toInput, { target: { value: "2026-06-01" } });

    expect(onToChange).toHaveBeenCalledTimes(1);
    expect(onToChange).toHaveBeenCalledWith("2026-06-01");
    expect(onFromChange).not.toHaveBeenCalled();
  });

  it("emits an empty string when a date input is cleared (S38 — clear filters)", () => {
    const { fromInput, toInput, onFromChange, onToChange } = setup({
      from: "2026-06-03",
      to: "2026-06-03",
    });

    fireEvent.change(fromInput, { target: { value: "" } });
    fireEvent.change(toInput, { target: { value: "" } });

    expect(onFromChange).toHaveBeenLastCalledWith("");
    expect(onToChange).toHaveBeenLastCalledWith("");
  });

  it("applies a custom className to the wrapper", () => {
    const onFromChange = jest.fn();
    const onToChange = jest.fn();
    const { container } = render(
      <DateRangeFilter
        from=""
        to=""
        onFromChange={onFromChange}
        onToChange={onToChange}
        className="custom-range"
      />,
    );

    expect(container.firstChild).toHaveClass("custom-range");
  });
});
