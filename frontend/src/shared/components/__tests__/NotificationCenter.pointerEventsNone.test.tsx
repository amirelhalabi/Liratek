/** @jest-environment jsdom */
/**
 * NotificationCenter — LIRA-249 guard.
 *
 * Bug: toasts render bottom-right (`fixed bottom-4 right-4`), directly on
 * top of the payment panel's primary "Pay" button on several pages
 * (Recharge/OMT/Whish, POS checkout). A toast is visible for 3-5s and, being
 * a real interactive element positioned on top, intercepts clicks intended
 * for whatever is underneath it.
 *
 * Fix under test (LIRA-249): make the toast container and each toast
 * `pointer-events: none`, and only the toast's own dismiss (X) button
 * `pointer-events: auto`. This is the least disruptive of the three options
 * the ticket allows (reposition top-right / offset when a side panel is
 * open / pointer-events-none-except-close) because it needs NO per-page
 * awareness of what's underneath (no panel-open state to thread through
 * every host page) and keeps the familiar bottom-right position — a click
 * on a covered button passes straight through the toast to that button,
 * while the toast's own close (X) control stays clickable.
 *
 * Follows Select.modalStacking.test.tsx / NotificationCenter.e2eOverride.
 * test.tsx's pattern: imports the real `@liratek/ui` component (not a mock)
 * via the jest moduleNameMapper alias and drives it through its real public
 * surface (`appEvents.emit("notification:show", ...)`).
 */
import { act, render, screen } from "@testing-library/react";
import { NotificationCenter, appEvents } from "@liratek/ui";

describe("NotificationCenter — pointer-events (LIRA-249)", () => {
  afterEach(() => {
    // Nothing to clean up beyond unmount (handled by RTL), but keep parity
    // with the other NotificationCenter test files' afterEach shape.
  });

  it("the toast container never blocks clicks on whatever is underneath it", () => {
    const { container } = render(<NotificationCenter />);

    act(() => {
      appEvents.emit("notification:show", "Saved successfully", "success");
    });

    const toastText = screen.getByText("Saved successfully");
    const toastRoot = toastText.closest('[role="alert"]') as HTMLElement;
    expect(toastRoot).toBeInTheDocument();

    // The outer fixed-position wrapper must not intercept clicks in the
    // (mostly empty) space it occupies around/behind toasts.
    const outerWrapper = container.firstElementChild as HTMLElement;
    expect(outerWrapper.className).toMatch(/pointer-events-none/);

    // Each individual toast must also let clicks pass through to whatever
    // is rendered underneath it (e.g. a Pay button it happens to overlap).
    expect(toastRoot.className).toMatch(/pointer-events-none/);
  });

  it("the toast's own close (X) button stays clickable", () => {
    render(<NotificationCenter />);

    act(() => {
      appEvents.emit("notification:show", "Something failed", "error");
    });

    const toastText = screen.getByText("Something failed");
    const toastRoot = toastText.closest('[role="alert"]') as HTMLElement;
    const closeButton = toastRoot.querySelector("button") as HTMLElement;
    expect(closeButton).toBeInTheDocument();
    expect(closeButton.className).toMatch(/pointer-events-auto/);
  });
});
