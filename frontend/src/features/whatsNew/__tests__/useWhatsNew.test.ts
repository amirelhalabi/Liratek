/**
 * useWhatsNew — written FIRST (rule 17): the hook does not exist yet, so
 * this fails red before frontend/src/features/whatsNew/useWhatsNew.ts is
 * written.
 *
 * Storage key: liratek.whatsNew.lastSeenVersion. Every read/write must be
 * wrapped in try/catch (private mode / blocked storage must never crash the
 * app) — the last two tests are the load-bearing ones.
 */
import { renderHook, act } from "@testing-library/react";
import { useWhatsNew } from "../useWhatsNew";

// Inlined (not a shared outer variable) to avoid a TDZ ReferenceError: this
// factory runs eagerly at require-time (once hoisted above the imports by
// ts-jest), before any outer `const` in this file would be initialized.
jest.mock("../releaseNotes.generated.json", () => [
  { version: "2.0.0", body: "## New\n- a new thing" },
  { version: "1.0.0", body: "## Old\n- an old thing" },
]);

const STORAGE_KEY = "liratek.whatsNew.lastSeenVersion";

describe("useWhatsNew", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("shows automatically when lastSeen is absent", () => {
    const { result } = renderHook(() => useWhatsNew());
    expect(result.current.isOpen).toBe(true);
    expect(result.current.latest?.version).toBe("2.0.0");
  });

  it("shows automatically when lastSeen is older than latest", () => {
    localStorage.setItem(STORAGE_KEY, "1.0.0");
    const { result } = renderHook(() => useWhatsNew());
    expect(result.current.isOpen).toBe(true);
  });

  it("hides when lastSeen equals latest", () => {
    localStorage.setItem(STORAGE_KEY, "2.0.0");
    const { result } = renderHook(() => useWhatsNew());
    expect(result.current.isOpen).toBe(false);
  });

  it("hides when lastSeen is newer than latest", () => {
    localStorage.setItem(STORAGE_KEY, "9.9.9");
    const { result } = renderHook(() => useWhatsNew());
    expect(result.current.isOpen).toBe(false);
  });

  it("dismiss ('Got it') closes the modal and persists the latest version", () => {
    const { result } = renderHook(() => useWhatsNew());
    expect(result.current.isOpen).toBe(true);

    act(() => {
      result.current.dismiss();
    });

    expect(result.current.isOpen).toBe(false);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("2.0.0");
  });

  it("open() reopens the modal manually (e.g. from the sidebar version label)", () => {
    localStorage.setItem(STORAGE_KEY, "2.0.0"); // already seen -> closed initially
    const { result } = renderHook(() => useWhatsNew());
    expect(result.current.isOpen).toBe(false);

    act(() => {
      result.current.open();
    });

    expect(result.current.isOpen).toBe(true);
  });

  it("a localStorage READ throw does not crash, and falls back to showing once per session", () => {
    const getSpy = jest
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("blocked (private mode)");
      });

    let result!: ReturnType<typeof renderHook<ReturnType<typeof useWhatsNew>, unknown>>["result"];
    expect(() => {
      ({ result } = renderHook(() => useWhatsNew()));
    }).not.toThrow();

    expect(result.current.isOpen).toBe(true);

    getSpy.mockRestore();
  });

  it("a localStorage WRITE throw on dismiss does not crash", () => {
    const setSpy = jest
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("blocked (quota)");
      });

    const { result } = renderHook(() => useWhatsNew());

    expect(() => {
      act(() => {
        result.current.dismiss();
      });
    }).not.toThrow();

    expect(result.current.isOpen).toBe(false);

    setSpy.mockRestore();
  });
});
