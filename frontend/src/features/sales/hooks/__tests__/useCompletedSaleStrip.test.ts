/**
 * LIRA-333 T025 — when the POS "Sale completed — RCP-n · Send on WhatsApp ·
 * Print" strip shows (FR-001): it appears on a completed sale, stays until
 * the next sale starts (the cart gets its first item — which is also what
 * resuming a draft or opening checkout implies), and a later completed sale
 * replaces it. It never opens WhatsApp by itself (FR-004).
 */
import { act, renderHook } from "@testing-library/react";
import { useCompletedSaleStrip } from "../useCompletedSaleStrip";

describe("useCompletedSaleStrip", () => {
  it("is hidden until a sale completes", () => {
    const { result } = renderHook(() => useCompletedSaleStrip(0));
    expect(result.current.completedSaleId).toBeNull();
  });

  it("shows the completed sale and keeps it while the cart stays empty", () => {
    const hook = renderHook(({ n }) => useCompletedSaleStrip(n), {
      initialProps: { n: 2 },
    });
    // completion empties the cart in the same update as show()
    act(() => hook.result.current.show(42));
    hook.rerender({ n: 0 });
    expect(hook.result.current.completedSaleId).toBe(42);
    hook.rerender({ n: 0 });
    expect(hook.result.current.completedSaleId).toBe(42);
  });

  it("hides when the next sale starts (first item in the cart)", () => {
    const hook = renderHook(({ n }) => useCompletedSaleStrip(n), {
      initialProps: { n: 0 },
    });
    act(() => hook.result.current.show(42));
    hook.rerender({ n: 1 });
    expect(hook.result.current.completedSaleId).toBeNull();
  });

  it("a later completed sale replaces it", () => {
    const hook = renderHook(({ n }) => useCompletedSaleStrip(n), {
      initialProps: { n: 0 },
    });
    act(() => hook.result.current.show(42));
    act(() => hook.result.current.show(43));
    expect(hook.result.current.completedSaleId).toBe(43);
  });

  it("the close button hides it", () => {
    const hook = renderHook(() => useCompletedSaleStrip(0));
    act(() => hook.result.current.show(42));
    act(() => hook.result.current.hide());
    expect(hook.result.current.completedSaleId).toBeNull();
  });
});
