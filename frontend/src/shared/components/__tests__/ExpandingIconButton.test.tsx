/** @jest-environment jsdom */
/**
 * An icon-only header button that widens on hover / keyboard focus to show
 * its label. The label stays in the DOM (so the accessible name, tests and
 * screen readers keep reading "History"); only its width is collapsed.
 * Written before the component (rule 17).
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { History } from "lucide-react";
import { ExpandingIconButton } from "../ExpandingIconButton";

describe("ExpandingIconButton", () => {
  it("is named by its label and shows it as a tooltip", () => {
    render(
      <ExpandingIconButton icon={History} label="History" onClick={() => {}} />,
    );
    const button = screen.getByRole("button", { name: "History" });
    expect(button).toHaveAttribute("title", "History");
    expect(button.querySelector("svg")).not.toBeNull();
  });

  it("keeps the label collapsed until hover or focus", () => {
    render(
      <ExpandingIconButton icon={History} label="History" onClick={() => {}} />,
    );
    const label = screen.getByText("History");
    expect(label.className).toMatch(/max-w-0/);
    expect(label.className).toMatch(/group-hover:max-w-/);
    expect(label.className).toMatch(/group-focus-visible:max-w-/);
  });

  it("calls onClick and forwards a test id", () => {
    const onClick = jest.fn();
    render(
      <ExpandingIconButton
        icon={History}
        label="History"
        onClick={onClick}
        data-testid="history-button"
      />,
    );
    fireEvent.click(screen.getByTestId("history-button"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("is 48px tall with a 20px icon, matching the provider tabs", () => {
    render(
      <ExpandingIconButton icon={History} label="History" onClick={() => {}} />,
    );
    const button = screen.getByRole("button", { name: "History" });
    expect(button).toHaveClass("h-12", "min-w-12");
    expect(button.querySelector("svg")).toHaveAttribute("width", "20");
  });
});
