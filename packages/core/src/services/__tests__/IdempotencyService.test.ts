import { IdempotencyService, IDEMPOTENCY_RETENTION_MS } from "../IdempotencyService.js";
import { runWithTenant } from "../../db/tenantContext.js";

/** In-memory stand-in for the repository: atomically() just runs fn. */
function fakeRepo() {
  const rows = new Map<string, { json: string; at: string }>();
  const id = (s: { userId: number; route: string; key: string }) => `${s.userId}|${s.route}|${s.key}`;
  return {
    rows,
    findResponse: (s: { userId: number; route: string; key: string }) => rows.get(id(s))?.json ?? null,
    saveResponse: (s: { userId: number; route: string; key: string }, json: string, at: string) => {
      rows.set(id(s), { json, at });
    },
    atomically: <T>(fn: () => T) => fn(),
    deleteOlderThan: (before: string) => {
      let n = 0;
      for (const [k, v] of rows) if (v.at < before) { rows.delete(k); n++; }
      return n;
    },
  };
}

const SCOPE = { userId: 7, route: "POST /api/services/transactions", key: "phone-tap-0001" };

describe("IdempotencyService", () => {
  it("books once and replays the stored reply", () => {
    const svc = new IdempotencyService(fakeRepo());
    const book = jest.fn().mockReturnValueOnce({ success: true, id: 1 }).mockReturnValueOnce({ success: true, id: 2 });
    const first = svc.run(SCOPE, "2026-10-10T10:00:00.000Z", book);
    const second = svc.run(SCOPE, "2026-10-10T10:00:01.000Z", book);
    expect(book).toHaveBeenCalledTimes(1);
    expect(first).toEqual({ replayed: false, result: { success: true, id: 1 } });
    expect(second).toEqual({ replayed: true, result: { success: true, id: 1 } });
  });

  it("does not store a refusal", () => {
    const repo = fakeRepo();
    const svc = new IdempotencyService(repo);
    svc.run(SCOPE, "2026-10-10T10:00:00.000Z", () => ({ success: false, error: "short" }));
    expect(repo.rows.size).toBe(0);
  });

  it("validates keys: 8-128 letters, digits or dashes", () => {
    const svc = new IdempotencyService(fakeRepo());
    expect(svc.isValidKey("0b2c4e6a-1111-4222-8333-944455556666")).toBe(true);
    expect(svc.isValidKey("short")).toBe(false);
    expect(svc.isValidKey("has space here")).toBe(false);
    expect(svc.isValidKey("x".repeat(129))).toBe(false);
  });

  it("sweeps replies older than 24 hours", () => {
    const repo = fakeRepo();
    const svc = new IdempotencyService(repo);
    svc.run({ ...SCOPE, key: "old-key-0001" }, "2026-10-09T09:00:00.000Z", () => ({ success: true }));
    svc.run({ ...SCOPE, key: "new-key-0001" }, "2026-10-10T09:30:00.000Z", () => ({ success: true }));
    expect(IDEMPOTENCY_RETENTION_MS).toBe(24 * 60 * 60 * 1000);
    expect(svc.sweep("2026-10-10T10:00:00.000Z")).toBe(1);
    expect(repo.rows.size).toBe(1);
  });
});

/**
 * LIRA-401 — the async variant for routes whose booking awaits (session and
 * recharge-basket checkout, session close/link). A SQLite transaction cannot
 * span an `await`, so two taps that arrive while the first is still booking
 * are held by an in-process "in flight" slot instead. Written FIRST, before
 * `runAsync` existed (rule 17).
 */
describe("IdempotencyService.runAsync (LIRA-401)", () => {
  const NOW = "2026-11-18T10:00:00.000Z";

  /** A booking that resolves only when the test says so. */
  function deferredBook<T>(value: T) {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const book = jest.fn(async () => {
      await gate;
      return value;
    });
    return { book, release };
  }

  it("two taps in flight at once book ONCE; the second gets the first reply", async () => {
    const svc = new IdempotencyService(fakeRepo());
    const { book, release } = deferredBook({ success: true, id: 41 });
    const [a, b] = await runWithTenant(1, async () => {
      const first = svc.runAsync(SCOPE, NOW, book);
      const second = svc.runAsync(SCOPE, NOW, book);
      release();
      return Promise.all([first, second]);
    });
    expect(book).toHaveBeenCalledTimes(1);
    expect(a).toEqual({ replayed: false, result: { success: true, id: 41 } });
    expect(b).toEqual({ replayed: true, result: { success: true, id: 41 } });
  });

  it("a later retry replays the stored reply without booking", async () => {
    const svc = new IdempotencyService(fakeRepo());
    const book = jest.fn(async () => ({ success: true, id: 42 }));
    await runWithTenant(1, () => svc.runAsync(SCOPE, NOW, book));
    const again = await runWithTenant(1, () => svc.runAsync(SCOPE, NOW, book));
    expect(book).toHaveBeenCalledTimes(1);
    expect(again).toEqual({ replayed: true, result: { success: true, id: 42 } });
  });

  it("a refusal is not remembered: the waiting tap runs fresh", async () => {
    const repo = fakeRepo();
    const svc = new IdempotencyService(repo);
    const book = jest
      .fn<Promise<{ success: boolean; error?: string }>, []>()
      .mockResolvedValueOnce({ success: false, error: "short" })
      .mockResolvedValueOnce({ success: true });
    const [a, b] = await runWithTenant(1, () =>
      Promise.all([svc.runAsync(SCOPE, NOW, book), svc.runAsync(SCOPE, NOW, book)]),
    );
    expect(book).toHaveBeenCalledTimes(2);
    expect(a.result.success).toBe(false);
    expect(b).toEqual({ replayed: false, result: { success: true } });
  });

  it("the same key in two shops is two submissions", async () => {
    const svc = new IdempotencyService(fakeRepo());
    const { book, release } = deferredBook({ success: true });
    const both = Promise.all([
      runWithTenant(1, () => svc.runAsync(SCOPE, NOW, book)),
      runWithTenant(2, () => svc.runAsync(SCOPE, NOW, book)),
    ]);
    release();
    await both;
    expect(book).toHaveBeenCalledTimes(2);
  });

  it("a booking that throws frees the slot and rethrows", async () => {
    const svc = new IdempotencyService(fakeRepo());
    const boom = jest.fn(async () => {
      throw new Error("db down");
    });
    await expect(runWithTenant(1, () => svc.runAsync(SCOPE, NOW, boom))).rejects.toThrow("db down");
    const ok = jest.fn(async () => ({ success: true }));
    await runWithTenant(1, () => svc.runAsync(SCOPE, NOW, ok));
    expect(ok).toHaveBeenCalledTimes(1);
  });
});
