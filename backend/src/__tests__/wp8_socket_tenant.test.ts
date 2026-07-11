/**
 * WP8 — Socket.io tenant scoping.
 *
 * Today (pre-WP8) `emitEvent()` did an unauthenticated global `io.emit(...)`
 * and `io.on("connection")` did nothing but log — every tenant's realtime
 * events reached every connected browser on every subdomain. This suite
 * proves the fix at the pure-unit level (no real Socket.IO server, no HTTP
 * upgrade handshake — that plumbing is exercised manually/E2E, not here):
 *
 *  1. `verifyJwt` (extracted shared helper, `middleware/auth.ts`) accepts a
 *     well-formed v2 token and rejects a legacy/malformed one — the same
 *     logic `authenticateJWT` uses for HTTP, reused (not reinvented) by the
 *     socket handshake.
 *  2. `tenantRoom()` room-name derivation is the single source of truth for
 *     both the join side (handshake middleware) and the emit side.
 *  3. `emitEvent(tenantId, event, payload)` targets ONLY
 *     `io.to('tenant:'+tenantId)` and NEVER calls a global `io.emit(...)`.
 *  4. `socketAuthMiddleware` (the `io.use()` handshake gate):
 *     - rejects a connection with no token at all,
 *     - rejects a connection with an invalid/malformed token,
 *     - accepts a valid tenant token, stashes identity on `socket.data`, and
 *       joins the `tenant:<id>` room,
 *     - accepts a valid super_admin token (tenantId null) but joins NO room
 *       (plan §WP8 decision: platform admin sockets receive nothing
 *       tenant-scoped),
 *     - accepts the token from the `Authorization` header and from the
 *       `?token=` query string when `handshake.auth.token` is absent
 *       (fallback sources the frontend socket client may use instead).
 *
 * Real Socket.IO server + actual WebSocket handshake over the wire is NOT
 * covered here (would need a live HTTP server + socket.io-client round
 * trip) — out of scope for a backend unit suite; the mocked `socket`/`next`
 * pair below exercises the exact same code path `io.use()` invokes per
 * connection.
 */

import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";
import type {
  LiratekSocket,
  LiratekSocketServer,
  SocketData,
} from "../websocket/io";

// Mock the logger re-exported from server.ts — importing the real server.ts
// would boot the HTTP listener + real DB (same reasoning as wp2/wp5's mock).
jest.mock("../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const JWT_TEST_SECRET = "wp8-test-secret-0123456789-0123456789-0123456789";

// Must be set BEFORE the first @liratek/core import (transitively pulled in
// by middleware/auth.ts) — core's env.ts parses process.env at module load.
process.env.JWT_SECRET = JWT_TEST_SECRET;

let ioModule: typeof import("../websocket/io");
let authModule: typeof import("../middleware/auth");

beforeAll(async () => {
  ioModule = await import("../websocket/io");
  authModule = await import("../middleware/auth");
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MintOpts {
  userId: number;
  role: "super_admin" | "admin" | "staff";
  tenantId: number | null;
  sessionToken?: string | null;
  impersonatorId?: number;
}

function mintToken(opts: MintOpts): string {
  const payload: Record<string, unknown> = {
    userId: opts.userId,
    role: opts.role,
    tenantId: opts.tenantId,
  };
  if (opts.sessionToken !== null) {
    payload.sessionToken = opts.sessionToken ?? "session-abc-123";
  }
  if (opts.impersonatorId !== undefined) {
    payload.impersonatorId = opts.impersonatorId;
  }
  return jwt.sign(payload, JWT_TEST_SECRET, { expiresIn: "1h" });
}

/** Minimal structural mock of a socket.io Socket — cast through `unknown`. */
function makeMockSocket(handshakeOverrides: {
  authToken?: string;
  authorizationHeader?: string;
  queryToken?: string | string[];
}): { socket: LiratekSocket; join: jest.Mock } {
  const join = jest.fn();
  const raw = {
    id: "mock-socket-id",
    handshake: {
      auth: handshakeOverrides.authToken
        ? { token: handshakeOverrides.authToken }
        : {},
      headers: handshakeOverrides.authorizationHeader
        ? { authorization: handshakeOverrides.authorizationHeader }
        : {},
      query: handshakeOverrides.queryToken
        ? { token: handshakeOverrides.queryToken }
        : {},
    },
    data: {} as SocketData,
    join,
  };
  return { socket: raw as unknown as LiratekSocket, join };
}

/** Minimal structural mock of a socket.io Server — cast through `unknown`. */
function makeMockIoServer(): {
  io: LiratekSocketServer;
  to: jest.Mock;
  roomEmit: jest.Mock;
  globalEmit: jest.Mock;
  use: jest.Mock;
} {
  const roomEmit = jest.fn();
  const to = jest.fn(() => ({ emit: roomEmit }));
  const globalEmit = jest.fn();
  const use = jest.fn();
  const raw = { to, emit: globalEmit, use };
  return {
    io: raw as unknown as LiratekSocketServer,
    to,
    roomEmit,
    globalEmit,
    use,
  };
}

// ---------------------------------------------------------------------------
// 1. verifyJwt — shared verification helper
// ---------------------------------------------------------------------------

describe("verifyJwt (shared handshake + HTTP verification)", () => {
  it("accepts a well-formed v2 tenant token", () => {
    const token = mintToken({ userId: 10, role: "admin", tenantId: 3 });
    const payload = authModule.verifyJwt(token);
    expect(payload).not.toBeNull();
    expect(payload).toMatchObject({ userId: 10, role: "admin", tenantId: 3 });
  });

  it("accepts a well-formed v2 super_admin token (tenantId null)", () => {
    const token = mintToken({ userId: 1, role: "super_admin", tenantId: null });
    const payload = authModule.verifyJwt(token);
    expect(payload).not.toBeNull();
    expect(payload).toMatchObject({
      userId: 1,
      role: "super_admin",
      tenantId: null,
    });
  });

  it("rejects a legacy token signed without a sessionToken", () => {
    const token = mintToken({
      userId: 5,
      role: "admin",
      tenantId: 1,
      sessionToken: null,
    });
    expect(authModule.verifyJwt(token)).toBeNull();
  });

  it("rejects a token whose signature doesn't match the server secret", () => {
    const foreignToken = jwt.sign(
      { userId: 5, role: "admin", tenantId: 1, sessionToken: "x" },
      "a-completely-different-secret-0123456789",
      { expiresIn: "1h" },
    );
    expect(authModule.verifyJwt(foreignToken)).toBeNull();
  });

  it("rejects a garbage string", () => {
    expect(authModule.verifyJwt("not-a-jwt-at-all")).toBeNull();
  });

  it("rejects an expired token", () => {
    const expired = jwt.sign(
      { userId: 5, role: "admin", tenantId: 1, sessionToken: "x" },
      JWT_TEST_SECRET,
      { expiresIn: "-1h" },
    );
    expect(authModule.verifyJwt(expired)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 2. tenantRoom — room-name derivation
// ---------------------------------------------------------------------------

describe("tenantRoom", () => {
  it("derives 'tenant:<id>' consistently", () => {
    expect(ioModule.tenantRoom(1)).toBe("tenant:1");
    expect(ioModule.tenantRoom(42)).toBe("tenant:42");
  });
});

// ---------------------------------------------------------------------------
// 3. emitEvent — tenant-scoped target, never a global broadcast
// ---------------------------------------------------------------------------

describe("emitEvent", () => {
  it("emits to the tenant's room only, never globally", () => {
    const { io, to, roomEmit, globalEmit } = makeMockIoServer();
    ioModule.setIO(io);

    ioModule.emitEvent(7, "sales:processed", { id: 99 });

    expect(to).toHaveBeenCalledWith("tenant:7");
    expect(roomEmit).toHaveBeenCalledWith("sales:processed", { id: 99 });
    expect(globalEmit).not.toHaveBeenCalled();
  });

  it("targets a different room for a different tenant (no cross-tenant bleed)", () => {
    const { io, to, roomEmit } = makeMockIoServer();
    ioModule.setIO(io);

    ioModule.emitEvent(1, "sales:processed", { id: 1 });
    ioModule.emitEvent(2, "sales:processed", { id: 2 });

    expect(to).toHaveBeenNthCalledWith(1, "tenant:1");
    expect(to).toHaveBeenNthCalledWith(2, "tenant:2");
    expect(roomEmit).toHaveBeenNthCalledWith(1, "sales:processed", { id: 1 });
    expect(roomEmit).toHaveBeenNthCalledWith(2, "sales:processed", { id: 2 });
  });

  it("is a no-op when the IO server hasn't been registered yet", async () => {
    // Fresh module instance with a never-set ioInstance.
    jest.resetModules();
    const freshIo = await import("../websocket/io");
    expect(() =>
      freshIo.emitEvent(1, "sales:processed", { id: 1 }),
    ).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 4. socketAuthMiddleware — the io.use() handshake gate
// ---------------------------------------------------------------------------

describe("socketAuthMiddleware", () => {
  it("rejects a connection with no token anywhere in the handshake", () => {
    const { socket, join } = makeMockSocket({});
    const next = jest.fn();

    ioModule.socketAuthMiddleware(socket, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(join).not.toHaveBeenCalled();
  });

  it("rejects a connection with an invalid/malformed token", () => {
    const { socket, join } = makeMockSocket({ authToken: "garbage-token" });
    const next = jest.fn();

    ioModule.socketAuthMiddleware(socket, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0]?.[0]).toBeInstanceOf(Error);
    expect(join).not.toHaveBeenCalled();
  });

  it("accepts a valid tenant token: stashes identity and joins tenant:<id>", () => {
    const token = mintToken({ userId: 42, role: "admin", tenantId: 9 });
    const { socket, join } = makeMockSocket({ authToken: token });
    const next = jest.fn();

    ioModule.socketAuthMiddleware(socket, next);

    expect(next).toHaveBeenCalledWith(); // called with no error
    expect(socket.data.tenantId).toBe(9);
    expect(socket.data.userId).toBe(42);
    expect(socket.data.role).toBe("admin");
    expect(join).toHaveBeenCalledWith("tenant:9");
  });

  it("accepts a valid super_admin token (tenantId null) but joins NO room", () => {
    const token = mintToken({ userId: 1, role: "super_admin", tenantId: null });
    const { socket, join } = makeMockSocket({ authToken: token });
    const next = jest.fn();

    ioModule.socketAuthMiddleware(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data.tenantId).toBeNull();
    expect(join).not.toHaveBeenCalled();
  });

  it("falls back to the Authorization header when handshake.auth.token is absent", () => {
    const token = mintToken({ userId: 3, role: "staff", tenantId: 4 });
    const { socket, join } = makeMockSocket({
      authorizationHeader: `Bearer ${token}`,
    });
    const next = jest.fn();

    ioModule.socketAuthMiddleware(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data.tenantId).toBe(4);
    expect(join).toHaveBeenCalledWith("tenant:4");
  });

  it("falls back to the ?token= query string when auth and header are both absent", () => {
    const token = mintToken({ userId: 8, role: "admin", tenantId: 6 });
    const { socket, join } = makeMockSocket({ queryToken: token });
    const next = jest.fn();

    ioModule.socketAuthMiddleware(socket, next);

    expect(next).toHaveBeenCalledWith();
    expect(socket.data.tenantId).toBe(6);
    expect(join).toHaveBeenCalledWith("tenant:6");
  });

  it("stashes impersonatorId when present on the token", () => {
    const token = mintToken({
      userId: 3,
      role: "admin",
      tenantId: 4,
      impersonatorId: 1,
    });
    const { socket } = makeMockSocket({ authToken: token });
    const next = jest.fn();

    ioModule.socketAuthMiddleware(socket, next);

    expect(socket.data.impersonatorId).toBe(1);
  });
});
