/** @jest-environment jsdom */
/**
 * RTL unit tests for TransactionTimeOverride.
 *
 * Migrated from the Electron e2e spec (S21–S26) which exercised the widget
 * across Expenses, Recharge, POS checkout and Custom Services. The DB-coupled
 * assertions (record timestamps, history table) belong to the consuming
 * features' own tests — here we cover the component's own contract:
 *   - collapsed by default
 *   - toggle expands the date input
 *   - picking a past datetime emits an ISO string
 *   - future datetimes are rejected (no emit)
 *   - clearing the input emits undefined
 *   - the clear button resets to undefined and collapses
 *   - a preset value renders expanded
 *
 * jest-dom matchers are registered globally via jest.setup.ts.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import { TransactionTimeOverride } from "../TransactionTimeOverride";

/** Build a `datetime-local` string (YYYY-MM-DDTHH:mm) offset N days from now. */
function offsetLocalDatetime(offsetDays: number, hour = 10, minute = 0): string {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  const pad = (n: number) => n.toString().padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(hour)}:${pad(minute)}`
  );
}

describe("TransactionTimeOverride", () => {
  it("is collapsed by default — toggle visible, input not rendered", () => {
    render(<TransactionTimeOverride onChange={jest.fn()} />);

    expect(screen.getByTestId("txn-time-toggle")).toBeInTheDocument();
    expect(screen.getByText("Set custom time")).toBeInTheDocument();
    expect(screen.queryByTestId("txn-time-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("txn-time-clear")).not.toBeInTheDocument();
  });

  it("expands when the toggle is clicked, revealing the datetime input", () => {
    render(<TransactionTimeOverride onChange={jest.fn()} />);

    fireEvent.click(screen.getByTestId("txn-time-toggle"));

    expect(screen.getByTestId("txn-time-input")).toBeInTheDocument();
    expect(screen.getByTestId("txn-time-clear")).toBeInTheDocument();
    // The toggle button is replaced by the expanded controls.
    expect(screen.queryByTestId("txn-time-toggle")).not.toBeInTheDocument();
  });

  it("emits an ISO string when a past datetime is chosen", () => {
    const onChange = jest.fn();
    render(<TransactionTimeOverride onChange={onChange} />);

    fireEvent.click(screen.getByTestId("txn-time-toggle"));

    const past = offsetLocalDatetime(-1, 9, 15);
    fireEvent.change(screen.getByTestId("txn-time-input"), {
      target: { value: past },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0][0] as string;
    // Must be a valid ISO string round-tripping to the chosen local time.
    expect(new Date(emitted).toISOString()).toBe(emitted);
    expect(emitted).toBe(new Date(past).toISOString());
  });

  it("renders the chosen value back into the input after a change", () => {
    // value is controlled by the parent; simulate the parent storing the ISO.
    const past = offsetLocalDatetime(-2, 14, 30);
    const iso = new Date(past).toISOString();
    render(<TransactionTimeOverride value={iso} onChange={jest.fn()} />);

    // A preset value renders the widget already expanded.
    const input = screen.getByTestId("txn-time-input") as HTMLInputElement;
    expect(input.value).toBe(past);
  });

  it("does NOT emit when a future datetime is entered (runtime guard)", () => {
    const onChange = jest.fn();
    render(<TransactionTimeOverride onChange={onChange} />);

    fireEvent.click(screen.getByTestId("txn-time-toggle"));

    const future = offsetLocalDatetime(5);
    fireEvent.change(screen.getByTestId("txn-time-input"), {
      target: { value: future },
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it("caps the input via the max attribute at the current local time", () => {
    render(<TransactionTimeOverride onChange={jest.fn()} />);
    fireEvent.click(screen.getByTestId("txn-time-toggle"));

    const input = screen.getByTestId("txn-time-input") as HTMLInputElement;
    // max is present so the browser blocks future picks; format is YYYY-MM-DDTHH:mm.
    expect(input.max).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("emits undefined when a populated input is cleared to an empty value", () => {
    const onChange = jest.fn();
    // Start with a value so the input holds a real datetime; clearing it to
    // "" is then a genuine change event the handler maps to undefined.
    const iso = new Date(offsetLocalDatetime(-1, 9, 0)).toISOString();
    render(<TransactionTimeOverride value={iso} onChange={onChange} />);

    fireEvent.change(screen.getByTestId("txn-time-input"), {
      target: { value: "" },
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("clear button emits undefined and collapses back to the toggle", () => {
    const onChange = jest.fn();
    render(<TransactionTimeOverride onChange={onChange} />);

    fireEvent.click(screen.getByTestId("txn-time-toggle"));
    fireEvent.click(screen.getByTestId("txn-time-clear"));

    expect(onChange).toHaveBeenCalledWith(undefined);
    // Collapsed again: toggle is back, input is gone.
    expect(screen.getByTestId("txn-time-toggle")).toBeInTheDocument();
    expect(screen.queryByTestId("txn-time-input")).not.toBeInTheDocument();
  });

  it("renders expanded immediately when a value prop is supplied", () => {
    const iso = new Date(offsetLocalDatetime(-1, 8, 0)).toISOString();
    render(<TransactionTimeOverride value={iso} onChange={jest.fn()} />);

    // No need to click the toggle — the input is already present.
    expect(screen.getByTestId("txn-time-input")).toBeInTheDocument();
    expect(screen.queryByTestId("txn-time-toggle")).not.toBeInTheDocument();
  });
});
