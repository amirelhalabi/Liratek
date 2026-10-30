/**
 * LIRA-331 (FR-017): a cashier may type Arabic-Indic digits into an amount
 * field. DecimalInput must hand the parent the same number as if Western
 * digits had been typed.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { DecimalInput } from "../DecimalInput";

describe("DecimalInput — Arabic-Indic digits", () => {
  it('typing "١٢٣٫٥" yields onChange(123.5)', () => {
    const onChange = jest.fn();
    render(<DecimalInput value={0} onChange={onChange} aria-label="amount" />);
    const input = screen.getByLabelText("amount");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "١٢٣٫٥" } });
    expect(onChange).toHaveBeenLastCalledWith(123.5, expect.any(String));
    expect(input).toHaveValue("123.5");
  });

  it("typing ١٢٣٫٥ one key at a time keeps the caret after each digit (123.5)", () => {
    const onChange = jest.fn();
    render(<DecimalInput value={0} onChange={onChange} aria-label="amount" />);
    const input = screen.getByLabelText("amount") as HTMLInputElement;
    fireEvent.focus(input);
    for (const ch of "١٢٣٫٥") {
      // Insert the key where the caret is, the way a real keyboard does.
      const pos = input.selectionStart ?? input.value.length;
      const next = input.value.slice(0, pos) + ch + input.value.slice(pos);
      input.setSelectionRange(pos, pos);
      fireEvent.change(input, { target: { value: next } });
    }
    expect(onChange).toHaveBeenLastCalledWith(123.5, expect.any(String));
    expect(input).toHaveValue("123.5");
  });

  it("drops the Arabic thousands separator", () => {
    const onChange = jest.fn();
    render(<DecimalInput value={0} onChange={onChange} aria-label="amount" />);
    const input = screen.getByLabelText("amount");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "١٬٢٣٤" } });
    expect(onChange).toHaveBeenLastCalledWith(1234, expect.any(String));
    expect(input).toHaveValue("1,234");
  });
});
