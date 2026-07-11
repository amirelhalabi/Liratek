/**
 * WP8 — Socket.io tenant scoping: REAL round-trip isolation proof.
 *
 * `wp8_socket_tenant.test.ts` unit-tests the pieces with mocked
 * socket/io objects: it proves `emitEvent()` CALLS `io.to('tenant:'+id).emit`
 * and never a global `io.emit`, and that `socketAuthMiddleware` calls
 * `socket.join('tenant:'+id)`. What those mocks can't see is the one
 * load-bearing assumption behind both: that joining a room inside the
 * `io.use()` handshake middleware actually gates delivery once the
 * connection is live.
 *
 * This suite closes that gap with a REAL `http.Server` + real
 * `socket.io` `Server` (our actual `setIO()`/`socketAuthMiddleware`, not a
 * mock) and two real `socket.io-client` connections carrying signed JWTs
 * for two different tenants:
 *
 *  1. Tenant A's client receives an event `emitEvent(tenantA, ...)` fires;
 *     tenant B's client, connected the whole time, receives NOTHING.
 *  2. The reverse: an event emitted for tenant B reaches only B.
 *  3. A connection with no token at all is rejected at the transport level
 *     (`connect_error`, not `connect`) — the handshake gate holds for a
 *     real WebSocket upgrade, not just the mocked `next()` callback.
 *
 * Everything (server, both clients) is spun up in `beforeAll` on an
 * ephemeral port and torn down in `afterAll` to avoid leaking open handles
 * into the rest of the Jest run.
 */

import { jest } from "@jest/globals";
import { createServer, type Server as HttpServer } from "http";
import type { AddressInfo } from "net";
import { Server as SocketIOServer, type DefaultEventsMap } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import jwt from "jsonwebtoken";

// Mock the logger re-exported from server.ts — importing the real server.ts
// would boot the HTTP listener + real DB (same reasoning as the other WP8
// socket suite / wp2 / wp5).
jest.mock("../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const JWT_TEST_SECRET = "wp8-rt-test-secret-0123456789-0123456789-0123456789";

// Must be set BEFORE the first @liratek/core import (transitively pulled in
// by middleware/auth.ts, imported by websocket/io.ts) — core's env.ts
// parses process.env at module load.
process.env.JWT_SECRET = JWT_TEST_SECRET;

function mintToken(tenantId: number, userId: number): string {
  return jwt.sign(
    {
      userId,
      role: "admin",
      tenantId,
      sessionToken: `session-${userId}`,
    },
    JWT_TEST_SECRET,
    { expiresIn: "1h" },
  );
}

function waitForEvent<T = unknown>(
  socket: ClientSocket,
  event: string,
  timeoutMs = 2000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeoutMs);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });
}

/** Give any (absent) cross-tenant delivery a chance to arrive before we
 * assert it didn't. */
function settle(ms = 150): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let httpServer: HttpServer;
let ioModule: typeof import("../websocket/io");
let port: number;

beforeAll(async () => {
  ioModule = await import("../websocket/io");

  httpServer = createServer();
  const io = new SocketIOServer<
    DefaultEventsMap,
    DefaultEventsMap,
    DefaultEventsMap,
    import("../websocket/io").SocketData
  >(httpServer, {});
  ioModule.setIO(io); // registers the REAL socketAuthMiddleware via io.use()

  await new Promise<void>((resolve) => {
    httpServer.listen(0, () => resolve());
  });
  port = (httpServer.address() as AddressInfo).port;
});

afterAll(async () => {
  ioModule.getIO()?.close();
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

function connect(token?: string): ClientSocket {
  return ioClient(`http://localhost:${port}`, {
    transports: ["websocket"],
    reconnection: false,
    auth: token ? { token } : {},
  });
}

describe("Socket.IO tenant isolation — real server + real clients", () => {
  const TENANT_A = 101;
  const TENANT_B = 102;
  let clientA: ClientSocket;
  let clientB: ClientSocket;

  beforeAll(async () => {
    clientA = connect(mintToken(TENANT_A, 1));
    clientB = connect(mintToken(TENANT_B, 2));

    await Promise.all([
      waitForEvent(clientA, "connect"),
      waitForEvent(clientB, "connect"),
    ]);
  });

  afterAll(() => {
    clientA.close();
    clientB.close();
  });

  it("delivers an event emitted for tenant A only to tenant A's socket", async () => {
    const receivedByB: unknown[] = [];
    clientB.on("sales:processed", (payload: unknown) =>
      receivedByB.push(payload),
    );

    const received = waitForEvent(clientA, "sales:processed");
    ioModule.emitEvent(TENANT_A, "sales:processed", { marker: "only-for-A" });

    await expect(received).resolves.toEqual({ marker: "only-for-A" });
    await settle();
    expect(receivedByB).toEqual([]);

    clientB.off("sales:processed");
  });

  it("delivers an event emitted for tenant B only to tenant B's socket (reverse check)", async () => {
    const receivedByA: unknown[] = [];
    clientA.on("sales:processed", (payload: unknown) =>
      receivedByA.push(payload),
    );

    const received = waitForEvent(clientB, "sales:processed");
    ioModule.emitEvent(TENANT_B, "sales:processed", { marker: "only-for-B" });

    await expect(received).resolves.toEqual({ marker: "only-for-B" });
    await settle();
    expect(receivedByA).toEqual([]);

    clientA.off("sales:processed");
  });

  it("rejects a connection with no token at the real transport level", async () => {
    const anon = connect(); // no auth token at all
    try {
      await expect(waitForEvent(anon, "connect_error")).resolves.toBeDefined();
    } finally {
      anon.close();
    }
  });
});
