/** @jest-environment jsdom */
/**
 * RTL unit tests for SaveAsClientCheckbox.
 *
 * Migrated from the Electron e2e spec
 * (frontend/tests/e2e-electron/components/SaveAsClientCheckbox.spec.ts).
 *
 * Captured behaviours:
 *   - renders the checkbox when not hidden                                 (e2e S17)
 *   - `hidden` returns null → element absent (client selected case)        (e2e S16)
 *   - toggling reflects the controlled `checked` prop                      (e2e S18/S19)
 *   - clicking fires onChange with the new boolean                         (e2e S18/S19)
 *
 * This is a pure controlled component — no window.api / IPC involved.
 */

import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { SaveAsClientCheckbox } from "../SaveAsClientCheckbox";
// jest-dom matchers are global (jest.setup.ts).

function checkbox(): HTMLInputElement {
  return screen.getByTestId("save-as-client-checkbox") as HTMLInputElement;
}

describe("SaveAsClientCheckbox", () => {
  it("renders the checkbox with its label", () => {
    render(<SaveAsClientCheckbox checked={false} onChange={jest.fn()} />);
    expect(checkbox()).toBeInTheDocument();
    expect(checkbox()).not.toBeChecked();
    expect(screen.getByText(/save as client/i)).toBeInTheDocument();
  });

  it("reflects the checked prop", () => {
    render(<SaveAsClientCheckbox checked onChange={jest.fn()} />);
    expect(checkbox()).toBeChecked();
  });

  it("S16: renders nothing when hidden (client already selected)", () => {
    render(
      <SaveAsClientCheckbox checked={false} onChange={jest.fn()} hidden />,
    );
    expect(
      screen.queryByTestId("save-as-client-checkbox"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/save as client/i)).not.toBeInTheDocument();
  });

  it("fires onChange(true) when checking an unchecked box", () => {
    const onChange = jest.fn();
    render(<SaveAsClientCheckbox checked={false} onChange={onChange} />);

    fireEvent.click(checkbox());

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("fires onChange(false) when unchecking a checked box", () => {
    const onChange = jest.fn();
    render(<SaveAsClientCheckbox checked onChange={onChange} />);

    fireEvent.click(checkbox());

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it("toggles its checked state when driven by a controlled parent", () => {
    function Wrapper() {
      const [checked, setChecked] = useState(false);
      return <SaveAsClientCheckbox checked={checked} onChange={setChecked} />;
    }
    render(<Wrapper />);

    expect(checkbox()).not.toBeChecked();
    fireEvent.click(checkbox());
    expect(checkbox()).toBeChecked();
    fireEvent.click(checkbox());
    expect(checkbox()).not.toBeChecked();
  });
});
