/**
 * A websocket handshake must refuse a token whose session is over.
 *
 * Every HTTP request runs `authenticateJWT`, which looks the session row up
 * (`AuthService.validateSession`) and refuses a logged-out, revoked,
 * deactivated or suspended-shop session. The Socket.IO handshake only checks
 * the JWT signature (`verifyJwt`), so a token from a session that has ended
 * can still open new sockets, join `tenant:<id>` and receive the shop's
 * live events until the JWT itself expires (7 days by default).
 *
 * Security audit run-1, fingerprint
 * websocket:handshake-signature-only-no-session-validation.
 *
 * Mock socket/next pair from wp8_socket_tenant.test.ts. The handshake may
 * become async once it checks the session, so `runHandshake` waits for
 * `next` instead of assuming it is called synchronously.
 */

import { jest } from "@jest/globals";
import jwt from "jsonwebtoken";
import type { LiratekSocket, SocketData } from "../websocket/io";

jest.mock("../server.js", () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

const JWT_TEST_SECRET = "socket-revoked-secret-0123456789-0123456789-0123";
process.env.JWT_SECRET = JWT_TEST_SECRET;

// The session row is gone: logout, revoke, deactivation or suspension all
// make validateSession answer null.
const validateSession = jest.fn(async () => null);

jest.mock("@liratek/core", () => {
  const actual =
    jest.requireActual<typeof import("@liratek/core")>("@liratek/core");
  return {
    ...actual,
    getAuthService: () => ({ validateSession }),
  };
});

let ioModule: typeof import("../websocket/io");

beforeAll(async () => {
  ioModule = await import("../websocket/io");
});

function tokenForEndedSession(): string {
  return jwt.sign(
    { userId: 7, role: "staff", tenantId: 3, sessionToken: "logged-out-session" },
    JWT_TEST_SECRET,
    { expiresIn: "7d" },
  );
}

function makeSocket(token: string): { socket: LiratekSocket; join: jest.Mock } {
  const join = jest.fn();
  const raw = {
    id: "mock-socket-id",
    handshake: { auth: { token }, headers: {}, query: {} },
    data: {} as SocketData,
    join,
  };
  return { socket: raw as unknown as LiratekSocket, join };
}

function runHandshake(socket: LiratekSocket): Promise<Error | undefined> {
  return new Promise((resolve) => {
    ioModule.socketAuthMiddleware(socket, (err?: Error) => resolve(err));
  });
}

describe("socketAuthMiddleware — ended sessions are refused", () => {
  beforeEach(() => validateSession.mockClear());

  it("a validly signed token whose session no longer exists is rejected", async () => {
    const { socket, join } = makeSocket(tokenForEndedSession());

    const err = await runHandshake(socket);

    expect(err).toBeInstanceOf(Error);
    expect(join).not.toHaveBeenCalled();
  });
});
