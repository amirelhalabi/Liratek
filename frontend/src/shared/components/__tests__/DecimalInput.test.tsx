/** @jest-environment jsdom */
/**
 * RTL tests for DecimalInput (the shared decimal/amount field in @liratek/ui).
 *
 * The headline case is the regression that motivated the component: typing
 * "0.1" from scratch must work. The old number-controlled inputs round-tripped
 * each keystroke through parseFloat, so "0." collapsed to 0 and the decimal
 * point could never appear.
 */
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { DecimalInput } from "@liratek/ui";

/** Controlled harness — mirrors how call sites own the numeric value. */
function Harness({
  initial = 0,
  ...props
}: {
  initial?: number;
  allowNegative?: boolean;
  decimals?: number;
  zeroAsEmpty?: boolean;
}) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <DecimalInput
        value={value}
        onChange={setValue}
        aria-label="amount"
        {...props}
      />
      <output data-testid="value">{value}</output>
    </>
  );
}

function getInput() {
  return screen.getByLabelText("amount") as HTMLInputElement;
}

/** Simulate sequential typing by firing change with each cumulative string. */
function typeSequence(input: HTMLInputElement, steps: string[]) {
  fireEvent.focus(input);
  for (const next of steps) {
    fireEvent.change(input, { target: { value: next } });
  }
}

describe("DecimalInput — 0.1 regression", () => {
  it("lets you type '0.1' from scratch", () => {
    render(<Harness />);
    const input = getInput();

    typeSequence(input, ["0", "0.", "0.1"]);

    expect(input.value).toBe("0.1");
    expect(screen.getByTestId("value").textContent).toBe("0.1");
  });

  it("keeps the trailing dot visible mid-entry", () => {
    render(<Harness />);
    const input = getInput();

    typeSequence(input, ["5", "5."]);

    expect(input.value).toBe("5.");
    // Underlying numeric value is 5 while the dot is pending.
    expect(screen.getByTestId("value").textContent).toBe("5");
  });
});

describe("DecimalInput — formatting & constraints", () => {
  it("formats large numbers with commas", () => {
    render(<Harness />);
    const input = getInput();

    typeSequence(input, ["1234567"]);

    expect(input.value).toBe("1,234,567");
    expect(screen.getByTestId("value").textContent).toBe("1234567");
  });

  it("shows an empty field for zero by default (zeroAsEmpty)", () => {
    render(<Harness initial={0} />);
    expect(getInput().value).toBe("");
  });

  it("renders a non-zero initial value formatted when blurred", () => {
    render(<Harness initial={1234.5} />);
    expect(getInput().value).toBe("1,234.5");
  });

  it("rejects a minus sign unless allowNegative is set", () => {
    render(<Harness />);
    const input = getInput();
    typeSequence(input, ["-5"]);
    expect(screen.getByTestId("value").textContent).toBe("5");
  });

  it("accepts negatives when allowNegative is set", () => {
    render(<Harness allowNegative />);
    const input = getInput();
    typeSequence(input, ["-", "-5"]);
    expect(input.value).toBe("-5");
    expect(screen.getByTestId("value").textContent).toBe("-5");
  });

  it("caps fraction digits with the decimals prop", () => {
    render(<Harness decimals={2} />);
    const input = getInput();
    typeSequence(input, ["1", "1.", "1.2", "1.23", "1.234"]);
    expect(input.value).toBe("1.23");
    expect(screen.getByTestId("value").textContent).toBe("1.23");
  });
});
