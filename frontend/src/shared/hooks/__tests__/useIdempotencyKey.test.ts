import { renderHook, act } from "@testing-library/react";
import {
  idempotencyOpts,
  newIdempotencyKey,
  useIdempotencyKey,
  useIdempotencyKeyWithReset,
} from "@/shared/hooks/useIdempotencyKey";

const SERVER_PATTERN = /^[A-Za-z0-9-]{8,128}$/;

describe("newIdempotencyKey", () => {
  it("matches the server pattern and the web-<time>-<rand>-<rand> shape", () => {
    const key = newIdempotencyKey();
    expect(key).toMatch(SERVER_PATTERN);
    expect(key).toMatch(/^web-[a-z0-9]+-[a-z0-9]+-[a-z0-9]+$/);
  });

  it("is unique across calls", () => {
    const keys = new Set(
      Array.from({ length: 200 }, () => newIdempotencyKey()),
    );
    expect(keys.size).toBe(200);
  });
});

describe("useIdempotencyKey", () => {
  it("is undefined while inactive", () => {
    const { result } = renderHook(() => useIdempotencyKey(false));
    expect(result.current).toBeUndefined();
  });

  it("keeps the same key across re-renders while active", () => {
    const { result, rerender } = renderHook(
      ({ active }) => useIdempotencyKey(active),
      { initialProps: { active: true } },
    );
    const first = result.current;
    expect(first).toMatch(SERVER_PATTERN);
    rerender({ active: true });
    rerender({ active: true });
    expect(result.current).toBe(first);
  });

  it("clears on close and issues a NEW key on re-open", () => {
    const { result, rerender } = renderHook(
      ({ active }) => useIdempotencyKey(active),
      { initialProps: { active: true } },
    );
    const first = result.current;
    rerender({ active: false });
    expect(result.current).toBeUndefined();
    rerender({ active: true });
    expect(result.current).toMatch(SERVER_PATTERN);
    expect(result.current).not.toBe(first);
  });
});

describe("useIdempotencyKeyWithReset", () => {
  it("reset() issues a new key while active stays true; re-renders keep it", () => {
    const { result, rerender } = renderHook(() =>
      useIdempotencyKeyWithReset(true),
    );
    const first = result.current.key;
    rerender();
    expect(result.current.key).toBe(first);
    act(() => result.current.reset());
    const second = result.current.key;
    expect(second).toMatch(SERVER_PATTERN);
    expect(second).not.toBe(first);
    rerender();
    expect(result.current.key).toBe(second);
  });
});

describe("idempotencyOpts", () => {
  it("omits the field without a key and carries it with one", () => {
    expect(idempotencyOpts(undefined)).toEqual({});
    expect(idempotencyOpts("web-abc-123-456")).toEqual({
      idempotencyKey: "web-abc-123-456",
    });
  });
});
