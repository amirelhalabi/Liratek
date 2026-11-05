/**
 * LIRA-371 — the shared "OMT Cash Drawer | General" control.
 */
import { render, screen, fireEvent } from "@testing-library/react";
import { CashDrawerChoice } from "../CashDrawerChoice";

describe("CashDrawerChoice", () => {
  it("labels the OMT drawer and says 'Goes to' on IN", () => {
    render(
      <CashDrawerChoice
        value="SYSTEM"
        onChange={() => {}}
        systemDrawer="OMT_System"
        direction="IN"
      />,
    );
    expect(screen.getByTestId("cash-drawer-choice")).toHaveTextContent(
      "Goes to",
    );
    expect(screen.getByTestId("cash-drawer-choice-system")).toHaveTextContent(
      "OMT Cash Drawer",
    );
    expect(screen.getByTestId("cash-drawer-choice-general")).toHaveTextContent(
      "General",
    );
    expect(screen.getByTestId("cash-drawer-choice-system")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("labels the Whish drawer and says 'Comes from' on OUT", () => {
    render(
      <CashDrawerChoice
        value="GENERAL"
        onChange={() => {}}
        systemDrawer="Whish_System"
        direction="OUT"
      />,
    );
    expect(screen.getByTestId("cash-drawer-choice")).toHaveTextContent(
      "Comes from",
    );
    expect(screen.getByTestId("cash-drawer-choice-system")).toHaveTextContent(
      "Whish Cash Drawer",
    );
    expect(screen.getByTestId("cash-drawer-choice-general")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("a click calls onChange with the picked drawer", () => {
    const onChange = jest.fn();
    render(
      <CashDrawerChoice
        value="SYSTEM"
        onChange={onChange}
        systemDrawer="OMT_System"
        direction="IN"
      />,
    );
    fireEvent.click(screen.getByTestId("cash-drawer-choice-general"));
    expect(onChange).toHaveBeenCalledWith("GENERAL");
    fireEvent.click(screen.getByTestId("cash-drawer-choice-system"));
    expect(onChange).toHaveBeenCalledWith("SYSTEM");
  });
});
