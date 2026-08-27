/** @jest-environment jsdom */
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
import { act, render, screen } from "@testing-library/react";
import { NotificationCenter, appEvents } from "@liratek/ui";

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
