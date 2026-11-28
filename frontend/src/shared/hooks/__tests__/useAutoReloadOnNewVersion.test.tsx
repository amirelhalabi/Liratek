/** @jest-environment jsdom */
/**
 * Web app: once a newer build is deployed, an open tab reloads itself so it
 * stops running old code (owner request 2026-11-28 — a till kept a page from
 * before a fix open for hours and booked a partner Only Days sale with the
 * old code). No prompt, and never while the cashier has something selected
 * or typed (owner rule 2026-11-28): with nothing in progress it reloads when
 * the tab is hidden, on a page change, or after a quiet spell.
 *
 * Rule 17: the first version (reload when hidden / page change / quiet) was
 * written before the hook existed and seen failing. The "work in progress
 * blocks it" cases were written after the hook already honoured that rule —
 * NOT proven failing-first.
 */
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import { render } from "@testing-library/react";
import {
  QUIET_CHECK_MS,
  QUIET_RELOAD_MS,
  VERSION_CHECK_INTERVAL_MS,
  useAutoReloadOnNewVersion,
} from "../useAutoReloadOnNewVersion";
import { usePendingWork } from "../../utils/pendingWork";

function setHidden(hidden: boolean) {
  Object.defineProperty(document, "hidden", {
    configurable: true,
    get: () => hidden,
  });
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
}

function fetchReturning(buildId: string | null) {
  return jest
    .fn()
    .mockResolvedValue(
      buildId === null
        ? { ok: false, json: async () => ({}) }
        : { ok: true, json: async () => ({ buildId }) },
    );
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("useAutoReloadOnNewVersion", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    setHidden(false);
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it("a newer build while the tab is hidden: reloads at once", async () => {
    setHidden(true);
    const reload = jest.fn();
    renderHook(() =>
      useAutoReloadOnNewVersion({
        currentBuildId: "old",
        fetchFn: fetchReturning("new"),
        reload,
      }),
    );
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a newer build while the cashier works: waits, then reloads on the next page change", async () => {
    const reload = jest.fn();
    renderHook(() =>
      useAutoReloadOnNewVersion({
        currentBuildId: "old",
        fetchFn: fetchReturning("new"),
        reload,
      }),
    );
    await flush();
    expect(reload).not.toHaveBeenCalled();

    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      jest.advanceTimersByTime(0);
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a newer build: reloads when the tab is left (hidden)", async () => {
    const reload = jest.fn();
    renderHook(() =>
      useAutoReloadOnNewVersion({
        currentBuildId: "old",
        fetchFn: fetchReturning("new"),
        reload,
      }),
    );
    await flush();
    act(() => {
      setHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a newer build: reloads after a quiet spell, not while the cashier keeps working", async () => {
    const reload = jest.fn();
    renderHook(() =>
      useAutoReloadOnNewVersion({
        currentBuildId: "old",
        fetchFn: fetchReturning("new"),
        reload,
      }),
    );
    await flush();
    act(() => {
      jest.advanceTimersByTime(QUIET_RELOAD_MS - QUIET_CHECK_MS);
      window.dispatchEvent(new KeyboardEvent("keydown"));
      jest.advanceTimersByTime(QUIET_RELOAD_MS - QUIET_CHECK_MS);
    });
    expect(reload).not.toHaveBeenCalled();
    act(() => {
      jest.advanceTimersByTime(QUIET_RELOAD_MS);
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("text typed in a field blocks every reload until the field is cleared", async () => {
    const reload = jest.fn();
    function Page() {
      useAutoReloadOnNewVersion({
        currentBuildId: "old",
        fetchFn: fetchReturning("new"),
        reload,
      });
      const [v, setV] = useState("");
      return (
        <input
          aria-label="amount"
          value={v}
          onChange={(e) => setV(e.target.value)}
        />
      );
    }
    const { getByLabelText } = render(<Page />);
    await flush();
    const input = getByLabelText("amount") as HTMLInputElement;
    act(() => {
      input.focus();
    });
    const { fireEvent } = await import("@testing-library/react");
    fireEvent.change(input, { target: { value: "250000" } });

    act(() => {
      setHidden(true);
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      jest.advanceTimersByTime(QUIET_RELOAD_MS * 4);
    });
    expect(reload).not.toHaveBeenCalled();

    // The sale is done and the field is empty again: the next moment reloads.
    fireEvent.change(input, { target: { value: "" } });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("a prefilled field the cashier did not change does not block", async () => {
    setHidden(true);
    const reload = jest.fn();
    function Page() {
      useAutoReloadOnNewVersion({
        currentBuildId: "old",
        fetchFn: fetchReturning("new"),
        reload,
      });
      return <input aria-label="rate" defaultValue="89500" />;
    }
    const { getByLabelText } = render(<Page />);
    act(() => {
      (getByLabelText("rate") as HTMLInputElement).focus();
    });
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("items picked in a basket (registered work) block the reload, also on a page change", async () => {
    const reload = jest.fn();
    function Shell({ items }: { items: number }) {
      useAutoReloadOnNewVersion({
        currentBuildId: "old",
        fetchFn: fetchReturning("new"),
        reload,
      });
      usePendingWork(items > 0);
      return null;
    }
    const { rerender } = render(<Shell items={2} />);
    await flush();
    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      jest.advanceTimersByTime(QUIET_RELOAD_MS * 4);
    });
    expect(reload).not.toHaveBeenCalled();

    rerender(<Shell items={0} />);
    act(() => {
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      jest.advanceTimersByTime(0);
    });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("the same build: never reloads, and checks again later", async () => {
    setHidden(true);
    const reload = jest.fn();
    const fetchFn = fetchReturning("same");
    renderHook(() =>
      useAutoReloadOnNewVersion({ currentBuildId: "same", fetchFn, reload }),
    );
    await flush();
    act(() => {
      jest.advanceTimersByTime(VERSION_CHECK_INTERVAL_MS);
    });
    await flush();
    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(reload).not.toHaveBeenCalled();
  });

  it("the version file cannot be read: never reloads", async () => {
    setHidden(true);
    const reload = jest.fn();
    renderHook(() =>
      useAutoReloadOnNewVersion({
        currentBuildId: "old",
        fetchFn: fetchReturning(null),
        reload,
      }),
    );
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });

  it("turned off (desktop app or local dev build): does not even check", async () => {
    const fetchFn = fetchReturning("new");
    const reload = jest.fn();
    renderHook(() =>
      useAutoReloadOnNewVersion({
        currentBuildId: "old",
        enabled: false,
        fetchFn,
        reload,
      }),
    );
    await flush();
    expect(fetchFn).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
});
