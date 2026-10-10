import { IdempotencyService, IDEMPOTENCY_RETENTION_MS } from "../IdempotencyService.js";

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
