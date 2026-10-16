/** @jest-environment jsdom */
/**
 * usePresence keeps a panel mounted for its exit animation after `open`
 * turns false, then unmounts it. Written before the hook (rule 17).
 */
import { renderHook, act } from "@testing-library/react";
import { usePresence, PRESENCE_EXIT_MS } from "../usePresence";

describe("usePresence", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it("mounts right away when opened", () => {
    const { result } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: true },
    });
    expect(result.current).toEqual({ mounted: true, closing: false });
  });

  it("stays mounted while closing, then unmounts", () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: true },
    });
    rerender({ open: false });
    expect(result.current).toEqual({ mounted: true, closing: true });
    act(() => {
      jest.advanceTimersByTime(PRESENCE_EXIT_MS);
    });
    expect(result.current).toEqual({ mounted: false, closing: false });
  });

  it("reopening during the exit cancels it", () => {
    const { result, rerender } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: true },
    });
    rerender({ open: false });
    rerender({ open: true });
    act(() => {
      jest.advanceTimersByTime(PRESENCE_EXIT_MS);
    });
    expect(result.current).toEqual({ mounted: true, closing: false });
  });

  it("never mounts when it starts closed", () => {
    const { result } = renderHook(({ open }) => usePresence(open), {
      initialProps: { open: false },
    });
    expect(result.current).toEqual({ mounted: false, closing: false });
  });
});
