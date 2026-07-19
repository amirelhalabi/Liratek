/** @jest-environment jsdom */
/**
 * ForPartnerToggle / ForPartnerNotice (CQ-6) — unit coverage for the shared
 * "For Partner" checkbox + PartnerSelector wiring that replaces the 7
 * hand-rolled copies (CheckoutModal, TelecomForm, FinancialForm,
 * OmtWhishAppTransferForm, CryptoForm, KatchForm, Loto).
 *
 * PartnerSelector is mocked (as every form test that renders these blocks
 * already does — see FinancialForm.legsCarrier.test.tsx et al.) so this test
 * exercises ForPartnerToggle's OWN wiring in isolation: it never calls
 * `useApi()`/`window.api` itself, so nothing else needs mocking.
 *
 * Rule 17 (failing-first): commenting out the `onChange(next)` call inside
 * ForPartnerToggle's internal checkbox handler makes the first test below
 * go red (the shared onChange spy is never called) — see the sabotage note
 * in the CQ-6 task report. Reverted after confirming the failure.
 */

import { render, screen, fireEvent } from "@testing-library/react";
import {
  ForPartnerToggle,
  ForPartnerNotice,
} from "../ForPartnerToggle";

const mockPartnerSelector = jest.fn(
  (props: {
    selectedPartnerId: number | null;
    onSelect: (id: number | null) => void;
  }) => (
    <button
      data-testid="stub-partner-selector"
      onClick={() => props.onSelect(42)}
    >
      partner-selector (selected={String(props.selectedPartnerId)})
    </button>
  ),
);

jest.mock("@/features/partners/components/PartnerSelector", () => ({
  PartnerSelector: (props: unknown) => mockPartnerSelector(props as never),
}));

describe("ForPartnerToggle", () => {
  beforeEach(() => {
    mockPartnerSelector.mockClear();
  });

  it("renders the checkbox with the given testId/label and fires onChange(true) when checked", () => {
    const onChange = jest.fn();
    const onPartnerChange = jest.fn();
    render(
      <ForPartnerToggle
        testId="my-for-partner-toggle"
        checked={false}
        onChange={onChange}
        selectedPartnerId={null}
        onPartnerChange={onPartnerChange}
      />,
    );

    const checkbox = screen.getByTestId("my-for-partner-toggle");
    expect(checkbox).toBeInTheDocument();
    expect(screen.getByText("For Partner")).toBeInTheDocument();

    fireEvent.click(checkbox);

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith(true);
    // Turning ON must NOT clear the partner selection.
    expect(onPartnerChange).not.toHaveBeenCalled();
  });

  it("clears the partner selection (onPartnerChange(null)) when unchecked", () => {
    const onChange = jest.fn();
    const onPartnerChange = jest.fn();
    render(
      <ForPartnerToggle
        testId="my-for-partner-toggle"
        checked={true}
        onChange={onChange}
        selectedPartnerId={7}
        onPartnerChange={onPartnerChange}
      />,
    );

    fireEvent.click(screen.getByTestId("my-for-partner-toggle"));

    expect(onChange).toHaveBeenCalledWith(false);
    expect(onPartnerChange).toHaveBeenCalledWith(null);
  });

  it("renders PartnerSelector ONLY when checked, and forwards selection callbacks", () => {
    const onPartnerChange = jest.fn();
    const { rerender } = render(
      <ForPartnerToggle
        testId="toggle"
        checked={false}
        onChange={jest.fn()}
        selectedPartnerId={null}
        onPartnerChange={onPartnerChange}
      />,
    );
    expect(screen.queryByTestId("stub-partner-selector")).not.toBeInTheDocument();

    rerender(
      <ForPartnerToggle
        testId="toggle"
        checked={true}
        onChange={jest.fn()}
        selectedPartnerId={null}
        onPartnerChange={onPartnerChange}
      />,
    );
    const selector = screen.getByTestId("stub-partner-selector");
    expect(selector).toBeInTheDocument();

    fireEvent.click(selector);
    expect(onPartnerChange).toHaveBeenCalledWith(42);
  });

  it("forwards autoSelectSingle/systemFilter to PartnerSelector only when provided", () => {
    render(
      <ForPartnerToggle
        testId="toggle"
        checked={true}
        onChange={jest.fn()}
        selectedPartnerId={null}
        onPartnerChange={jest.fn()}
        autoSelectSingle
        systemFilter="LOTO"
      />,
    );
    expect(mockPartnerSelector).toHaveBeenCalledWith(
      expect.objectContaining({ autoSelectSingle: true, systemFilter: "LOTO" }),
    );
  });

  it("applies className overrides for checkbox/label/text/selector", () => {
    render(
      <ForPartnerToggle
        testId="toggle"
        checked={true}
        onChange={jest.fn()}
        selectedPartnerId={null}
        onPartnerChange={jest.fn()}
        checkboxClassName="custom-checkbox"
        labelClassName="custom-label"
        textClassName="custom-text"
        selectorClassName="custom-selector"
      />,
    );
    expect(screen.getByTestId("toggle")).toHaveClass("custom-checkbox");
    expect(screen.getByText("For Partner")).toHaveClass("custom-text");
    expect(mockPartnerSelector).toHaveBeenCalledWith(
      expect.objectContaining({ className: "custom-selector" }),
    );
  });
});

describe("ForPartnerNotice", () => {
  it("renders its testId and children with the default styling", () => {
    render(
      <ForPartnerNotice testId="my-notice">
        No payment is collected for a partner sale.
      </ForPartnerNotice>,
    );
    const notice = screen.getByTestId("my-notice");
    expect(notice).toBeInTheDocument();
    expect(notice).toHaveTextContent(
      "No payment is collected for a partner sale.",
    );
    expect(notice.className).toContain("text-orange-200");
  });

  it("accepts a className override (e.g. a violet accent for CheckoutModal)", () => {
    render(
      <ForPartnerNotice testId="my-notice" className="text-violet-200">
        Violet notice
      </ForPartnerNotice>,
    );
    expect(screen.getByTestId("my-notice")).toHaveClass("text-violet-200");
  });
});
