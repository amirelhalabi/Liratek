/** @jest-environment jsdom */
/**
 * The Custom Services partner-mode segmented control (owner decision
 * 2026-10-16): [ Customer | For Partner | Via Partner ]. Each segment is a
 * role="radio" with aria-checked, and the For/Via segments keep the testids
 * of the two checkboxes they replace so existing selectors keep matching.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { PartnerModeSwitch } from "../PartnerModeSwitch";

describe("PartnerModeSwitch", () => {
  it("renders a radiogroup with Customer / For Partner / Via Partner", () => {
    render(<PartnerModeSwitch value="none" onChange={jest.fn()} />);
    expect(screen.getByRole("radiogroup")).toBeInTheDocument();
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.textContent)).toEqual([
      "Customer",
      "For Partner",
      "Via Partner",
    ]);
    expect(screen.getByTestId("custom-service-partner-mode-none")).toBe(
      radios[0],
    );
    expect(screen.getByTestId("custom-service-for-partner-toggle")).toBe(
      radios[1],
    );
    expect(screen.getByTestId("custom-service-via-partner-toggle")).toBe(
      radios[2],
    );
  });

  it("marks only the active segment checked", () => {
    render(<PartnerModeSwitch value="VIA" onChange={jest.fn()} />);
    expect(
      screen.getByTestId("custom-service-via-partner-toggle"),
    ).toBeChecked();
    expect(
      screen.getByTestId("custom-service-for-partner-toggle"),
    ).not.toBeChecked();
    expect(
      screen.getByTestId("custom-service-partner-mode-none"),
    ).not.toBeChecked();
  });

  it("calls onChange with the clicked mode, and not for the active one", () => {
    const onChange = jest.fn();
    render(<PartnerModeSwitch value="none" onChange={onChange} />);
    fireEvent.click(screen.getByTestId("custom-service-for-partner-toggle"));
    expect(onChange).toHaveBeenLastCalledWith("FOR");
    fireEvent.click(screen.getByTestId("custom-service-via-partner-toggle"));
    expect(onChange).toHaveBeenLastCalledWith("VIA");
    onChange.mockClear();
    fireEvent.click(screen.getByTestId("custom-service-partner-mode-none"));
    expect(onChange).not.toHaveBeenCalled();
  });
});
