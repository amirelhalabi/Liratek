/**
 * NotificationCenter — 2 per-ticket test files merged into one suite
 * (2026-11-11, owner decision: one module boot instead of 2).
 *
 * Each former file is one describe block below, named after it; its own
 * header comment (including its rule-17 failing-first history) is kept at the
 * top of its block, and its test bodies are unchanged. Every former file
 * declared exactly the same jest.mock set and shared mock setup, which is
 * kept once at the top. Each block starts with resetBetweenFiles(), which
 * puts the shared mocks back to how a fresh file would see them, so no block
 * depends on state left by the block above it.
 */

import { act, render, screen } from "@testing-library/react";
import { NotificationCenter, appEvents } from "@liratek/ui";

function resetBetweenFiles() {
  jest.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  jest.useRealTimers();
}

describe("NotificationCenter.e2eOverride", () => {
  beforeAll(resetBetweenFiles);

  /**
   * NotificationCenter — proves the e2e-only `window.__e2eNotificationDurationMs`
   * override (packages/ui/src/components/ui/NotificationCenter.tsx,
   * window-globals.d.ts) actually collapses the auto-dismiss timer, and that
   * leaving it unset preserves the normal type defaults (3s error / 5s
   * everything else).
   *
   * This is the COMPONENT-level half of proving the e2e harness's suite-wide
   * notification override (fixtures.ts's `E2E_NOTIFICATION_DURATION_MS`)
   * actually works. The harness-level half — that the flag itself survives a
   * `page.reload()` inside a real Electron window — is
   * harness-notification-override.spec.ts; this file proves the OTHER end of
   * that contract: once the flag is set on `window`, the component really
   * honors it instead of the flag being read and ignored.
   *
   * Follows Select.modalStacking.test.tsx's pattern: imports the real
   * `@liratek/ui` component (not a mock) via the jest moduleNameMapper alias
   * (`^@liratek/ui$` → packages/ui/src/index.ts) and drives it through its real
   * public surface — the same `appEvents.emit("notification:show", ...)` call
   * every real caller (e.g. a toast-on-save handler) uses — never internal
   * React state.
   */

  describe("NotificationCenter — __e2eNotificationDurationMs override", () => {
    beforeEach(() => jest.useFakeTimers());

    afterEach(() => {
      jest.useRealTimers();
      delete window.__e2eNotificationDurationMs;
    });

    it("default (no override): a toast outlives 1s and is gone by the 5s type default", () => {
      render(<NotificationCenter />);

      act(() => {
        appEvents.emit("notification:show", "Default timing toast", "success");
      });
      expect(screen.getByText("Default timing toast")).toBeInTheDocument();

      // Well inside the 5s default for a non-error type — must still be up.
      act(() => {
        jest.advanceTimersByTime(1000);
      });
      expect(screen.getByText("Default timing toast")).toBeInTheDocument();

      // Past the 5s default — auto-dismissed.
      act(() => {
        jest.advanceTimersByTime(4000);
      });
      expect(
        screen.queryByText("Default timing toast"),
      ).not.toBeInTheDocument();
    });

    it("__e2eNotificationDurationMs = 2: the toast is gone right after a ~10ms advance", () => {
      window.__e2eNotificationDurationMs = 2;
      render(<NotificationCenter />);

      act(() => {
        appEvents.emit("notification:show", "e2e override toast", "success");
      });
      expect(screen.getByText("e2e override toast")).toBeInTheDocument();

      // 10ms >> the 2ms override, but nowhere near the 5s type default — only
      // the override being HONORED (not merely present-and-ignored) explains
      // dismissal this fast.
      act(() => {
        jest.advanceTimersByTime(10);
      });
      expect(screen.queryByText("e2e override toast")).not.toBeInTheDocument();
    });
  });
});

describe("NotificationCenter.pointerEventsNone (LIRA-249)", () => {
  beforeAll(resetBetweenFiles);

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
});
