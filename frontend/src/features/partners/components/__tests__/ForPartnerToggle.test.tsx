/** @jest-environment jsdom */
/**
 * ForPartnerToggle / ForPartnerNotice (CQ-6) — unit coverage for the shared
 * "For Partner" checkbox + PartnerSelector wiring that replaces the 7
 * hand-rolled copies (CheckoutModal, TelecomForm, FinancialForm,
 * OmtWhishAppTransferForm, CryptoForm, KatshForm, Loto).
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
import { ForPartnerToggle, ForPartnerNotice } from "../ForPartnerToggle";

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
    expect(
      screen.queryByTestId("stub-partner-selector"),
    ).not.toBeInTheDocument();

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

  it("forwards selectorClassName to PartnerSelector", () => {
    render(
      <ForPartnerToggle
        testId="toggle"
        checked={true}
        onChange={jest.fn()}
        selectedPartnerId={null}
        onPartnerChange={jest.fn()}
        selectorClassName="custom-selector"
      />,
    );
    expect(mockPartnerSelector).toHaveBeenCalledWith(
      expect.objectContaining({ className: "custom-selector" }),
    );
  });
});

/**
 * Owner decision 2026-10-16: the "For Partner" checkbox becomes a toggle
 * BUTTON that matches the toolbar controls next to it. It keeps
 * role="checkbox" + aria-checked so existing `toBeChecked()` / Playwright
 * `.check()` selectors keep working, and fills with `activeClassName` when on.
 */
describe("ForPartnerToggle — toggle button", () => {
  beforeEach(() => {
    mockPartnerSelector.mockClear();
  });

  it("renders a <button role=checkbox> named by its label, not an <input>", () => {
    render(
      <ForPartnerToggle
        testId="toggle"
        checked={false}
        onChange={jest.fn()}
        selectedPartnerId={null}
        onPartnerChange={jest.fn()}
      />,
    );
    const el = screen.getByTestId("toggle");
    expect(el.tagName).toBe("BUTTON");
    expect(el).toHaveAttribute("type", "button");
    expect(el).toHaveAttribute("role", "checkbox");
    expect(screen.getByRole("checkbox", { name: "For Partner" })).toBe(el);
    expect(document.querySelector('input[type="checkbox"]')).toBeNull();
  });

  it("reflects checked in aria-checked and flips on click", () => {
    const onChange = jest.fn();
    const onPartnerChange = jest.fn();
    const { rerender } = render(
      <ForPartnerToggle
        testId="toggle"
        checked={false}
        onChange={onChange}
        selectedPartnerId={null}
        onPartnerChange={onPartnerChange}
      />,
    );
    const el = screen.getByTestId("toggle");
    expect(el).toHaveAttribute("aria-checked", "false");
    expect(el).not.toBeChecked();
    fireEvent.click(el);
    expect(onChange).toHaveBeenLastCalledWith(true);

    rerender(
      <ForPartnerToggle
        testId="toggle"
        checked={true}
        onChange={onChange}
        selectedPartnerId={3}
        onPartnerChange={onPartnerChange}
      />,
    );
    expect(el).toHaveAttribute("aria-checked", "true");
    expect(el).toBeChecked();
    fireEvent.click(el);
    expect(onChange).toHaveBeenLastCalledWith(false);
    expect(onPartnerChange).toHaveBeenCalledWith(null);
  });

  it("uses activeClassName only while ON, and the neutral outline while OFF", () => {
    const { rerender } = render(
      <ForPartnerToggle
        testId="toggle"
        checked={false}
        onChange={jest.fn()}
        selectedPartnerId={null}
        onPartnerChange={jest.fn()}
        activeClassName="bg-brand-fill text-brand-label"
      />,
    );
    const el = screen.getByTestId("toggle");
    expect(el).not.toHaveClass("bg-brand-fill");
    expect(el).toHaveClass("bg-slate-800", "border-slate-700");

    rerender(
      <ForPartnerToggle
        testId="toggle"
        checked={true}
        onChange={jest.fn()}
        selectedPartnerId={null}
        onPartnerChange={jest.fn()}
        activeClassName="bg-brand-fill text-brand-label"
      />,
    );
    expect(el).toHaveClass("bg-brand-fill", "text-brand-label");
    // The slate classes are !important-overridden in index.css, so they
    // must never sit next to the brand fill.
    expect(el).not.toHaveClass("bg-slate-800");
    expect(el).not.toHaveClass("border-slate-700");
  });

  it("defaults the ON fill to orange when no activeClassName is given", () => {
    render(
      <ForPartnerToggle
        testId="toggle"
        checked={true}
        onChange={jest.fn()}
        selectedPartnerId={null}
        onPartnerChange={jest.fn()}
      />,
    );
    expect(screen.getByTestId("toggle")).toHaveClass("bg-orange-500");
  });
});

/**
 * Owner report 2026-10-16: the notice was pale orange text on a pale orange
 * tint in LIGHT mode — unreadable. The component now owns readable colours
 * for both themes (dark text on a light tint; the old pale text only under
 * `dark:`), picked by `tone`, so call sites stop hand-rolling them.
 */
describe("ForPartnerNotice", () => {
  /** A pale -100/-200/-300 text class WITHOUT the `dark:` prefix is the
   *  unreadable-in-light-mode bug. */
  const paleLightText = (cls: string) =>
    cls.split(/\s+/).filter((c) => /^text-\w+-(100|200|300)(\/\d+)?$/.test(c));

  it("renders its testId and children, readable in both themes by default (orange)", () => {
    render(
      <ForPartnerNotice testId="my-notice">
        Partner sale: nothing is collected now.
      </ForPartnerNotice>,
    );
    const notice = screen.getByTestId("my-notice");
    expect(notice).toHaveTextContent("Partner sale: nothing is collected now.");
    expect(notice).toHaveClass("text-orange-900", "dark:text-orange-200");
    expect(paleLightText(notice.className)).toEqual([]);
  });

  it.each(["violet", "teal", "rose", "sky", "orange"] as const)(
    "tone=%s keeps dark text in light mode and the pale text only under dark:",
    (tone) => {
      render(
        <ForPartnerNotice testId="my-notice" tone={tone}>
          x
        </ForPartnerNotice>,
      );
      const notice = screen.getByTestId("my-notice");
      expect(notice).toHaveClass(`text-${tone}-900`, `dark:text-${tone}-200`);
      expect(paleLightText(notice.className)).toEqual([]);
    },
  );

  it("adds a caller's layout className on top of the tone", () => {
    render(
      <ForPartnerNotice testId="my-notice" tone="violet" className="w-full">
        x
      </ForPartnerNotice>,
    );
    const notice = screen.getByTestId("my-notice");
    expect(notice).toHaveClass("w-full", "text-violet-900");
  });
});
