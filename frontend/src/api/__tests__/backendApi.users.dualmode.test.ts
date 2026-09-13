/**
 * Dual-mode (IPC vs REST) routing test for `getNonAdminUsers`, alongside
 * `backendApi.sessions.dualmode.test.ts` (same invariant, different module):
 * - In Electron (window.api present): routes via window.api.auth.*, never fetch.
 * - In Web (no window.api): calls fetch against the matching REST route.
 *
 * Guards the fix for CLAUDE.md rule 19a: `getNonAdminUsers` used to be
 * `if (isElectron()) { return (window as any).api.auth.getNonAdminUsers(); }
 * else { ...fetch... }` — a raw `window.api.*` call plus a hand-rolled
 * transport gate, instead of going through `ipcOrHttp` like every other
 * dual-mode function in this file. That is exactly the pattern rule 19a
 * forbids, even though it happened to work on both transports. Proven
 * failing-first (rule 17) is not applicable in the usual sense here since the
 * old code was not actually broken in behavior — the guard instead pins the
 * OBSERVABLE contract (which branch is taken, and the raw-array unwrap) so a
 * future refactor can't silently reintroduce a raw `window.api` reference or
 * change a read to return the envelope instead of the raw array.
 */

// Named distinctly from the identical helper in backendApi.sessions.dualmode.test.ts
// and backendApi.lotoCheckpoints.dualmode.test.ts: none of these test files have a
// top-level import/export, so TypeScript treats each as a global script rather than
// a module, and a same-named top-level function collides across files as
// "Duplicate function implementation" under the project's full-program type-check.
function jsonResponseForUsers(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: async () => JSON.stringify(body),
  } as any;
}

describe("backendApi.getNonAdminUsers dual-mode routing", () => {
  beforeEach(() => {
    jest.resetModules();
    (globalThis as any).window = (globalThis as any).window || {};
  });

  afterEach(() => {
    delete (globalThis as any).window.api;
    delete (globalThis as any).fetch;
    jest.clearAllMocks();
  });

  const USERS = [
    { id: 2, username: "cashier1", role: "staff", is_active: 1 },
    { id: 3, username: "cashier2", role: "staff", is_active: 0 },
  ];

  it("in Electron mode: routes via window.api.auth.getNonAdminUsers (no fetch)", async () => {
    globalThis.fetch = jest.fn(async () => {
      throw new Error("fetch should not be called in Electron mode");
    }) as any;
    const getNonAdminUsers = jest.fn(async () => USERS);
    (globalThis as any).window.api = { auth: { getNonAdminUsers } };

    const apiMod = await import("../backendApi");
    const result = await apiMod.getNonAdminUsers();

    expect(getNonAdminUsers).toHaveBeenCalledTimes(1);
    expect(result).toEqual(USERS);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("in Web mode: fetches GET /api/users/non-admins and unwraps to the raw array (res.users), not the envelope", async () => {
    delete (globalThis as any).window.api;
    globalThis.fetch = jest.fn(async () =>
      jsonResponseForUsers(200, { success: true, users: USERS }),
    ) as any;

    const apiMod = await import("../backendApi");
    const result = await apiMod.getNonAdminUsers();

    expect(result).toEqual(USERS);
    const [url, options] = (globalThis.fetch as jest.Mock).mock.calls[0];
    expect(String(url)).toContain("/api/users/non-admins");
    expect(options?.method ?? "GET").toBe("GET");
  });

  it("in Web mode: an empty/missing users field resolves to [] rather than throwing", async () => {
    delete (globalThis as any).window.api;
    globalThis.fetch = jest.fn(async () =>
      jsonResponseForUsers(200, { success: true }),
    ) as any;

    const apiMod = await import("../backendApi");
    const result = await apiMod.getNonAdminUsers();

    expect(result).toEqual([]);
  });
});
