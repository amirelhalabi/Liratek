import type {
  Server as SocketIOServer,
  Socket,
  DefaultEventsMap,
  ExtendedError,
} from "socket.io";
import { verifyJwt } from "../middleware/auth.js";
import { logger } from "../server.js";

/**
 * Data stashed on every authenticated socket by `socketAuthMiddleware`
 * below. Mirrors the JWT v2 payload (`LiratekJwtPayload`,
 * `middleware/auth.ts`) minus `sessionToken` — sockets only ever receive
 * broadcast events, so they don't need it after the handshake.
 */
export interface SocketData {
  userId: number;
  role: "super_admin" | "admin" | "staff";
  /** null ONLY for super_admin (platform realm) — see socketAuthMiddleware. */
  tenantId: number | null;
  /** Present ONLY on impersonation tokens — the real super admin's user id. */
  impersonatorId?: number;
}

export type LiratekSocketServer = SocketIOServer<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketData
>;

export type LiratekSocket = Socket<
  DefaultEventsMap,
  DefaultEventsMap,
  DefaultEventsMap,
  SocketData
>;

let ioInstance: LiratekSocketServer | null = null;

/** Per-tenant broadcast room name — the ONLY place this naming is derived. */
export function tenantRoom(tenantId: number): string {
  return `tenant:${tenantId}`;
}

/**
 * Extract the bearer token from a socket handshake.
 *
 * Preferred: `socket.handshake.auth.token` — matches how the frontend
 * client connects (`io(url, { auth: { token } })`, see
 * `frontend/src/api/socket.ts`). Fallback, for any client that instead
 * sends it the HTTP way: an `Authorization: Bearer <token>` header, or a
 * `?token=` query string param.
 */
function extractHandshakeToken(socket: LiratekSocket): string | null {
  const auth = socket.handshake.auth as Record<string, unknown> | undefined;
  const authToken = auth?.token;
  if (typeof authToken === "string" && authToken.length > 0) {
    return authToken;
  }

  const authHeader = socket.handshake.headers.authorization;
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7);
  }

  const queryToken = socket.handshake.query?.token;
  if (typeof queryToken === "string" && queryToken.length > 0) {
    return queryToken;
  }
  if (
    Array.isArray(queryToken) &&
    typeof queryToken[0] === "string" &&
    queryToken[0].length > 0
  ) {
    return queryToken[0];
  }

  return null;
}

/**
 * Socket.IO handshake auth (multi-tenant plan §WP8 — see
 * `docs/plans/todo_plans/MULTI_TENANT_IMPLEMENTATION_PLAN.md`).
 *
 * Verifies the JWT the same way the HTTP path does (`verifyJwt`,
 * `middleware/auth.ts` — same secret, same v2 payload shape) and rejects
 * the connection outright (`next(new Error(...))`) if the token is
 * missing, malformed, expired, or badly signed. No anonymous or
 * unauthenticated socket is ever admitted.
 *
 * Deliberately does NOT call `authService.validateSession()` — a socket
 * only ever RECEIVES broadcast events (no data-mutating action flows
 * through it), so the lighter signature+shape check is judged sufficient
 * for v1. This means a session revoked mid-connection is not immediately
 * evicted from its tenant room; documented as a known v1 gap, not an
 * oversight (follow-up: disconnect on session invalidation).
 *
 * On success, stashes the decoded identity on `socket.data` and joins the
 * socket to its tenant's room (`tenant:<tenantId>`) so `emitEvent()` can
 * target it. Super-admin sockets (`tenantId === null`, platform realm) are
 * accepted but joined to NO room — the admin control-plane UI doesn't
 * consume realtime events, so a platform admin's socket simply receives
 * nothing tenant-scoped by design.
 */
export function socketAuthMiddleware(
  socket: LiratekSocket,
  next: (err?: ExtendedError) => void,
): void {
  const token = extractHandshakeToken(socket);
  if (!token) {
    logger.warn({ socketId: socket.id }, "Socket rejected: no token");
    next(new Error("Authentication required"));
    return;
  }

  const payload = verifyJwt(token);
  if (!payload) {
    logger.warn({ socketId: socket.id }, "Socket rejected: invalid token");
    next(new Error("Invalid or expired token"));
    return;
  }

  socket.data.userId = payload.userId;
  socket.data.role = payload.role;
  socket.data.tenantId = payload.tenantId;
  if (payload.impersonatorId !== undefined) {
    socket.data.impersonatorId = payload.impersonatorId;
  }

  if (payload.tenantId !== null) {
    socket.join(tenantRoom(payload.tenantId));
  }

  logger.info(
    { socketId: socket.id, tenantId: payload.tenantId, userId: payload.userId },
    "Socket authenticated",
  );
  next();
}

export function setIO(io: LiratekSocketServer): void {
  ioInstance = io;
  io.use(socketAuthMiddleware);
}

export function getIO(): LiratekSocketServer | null {
  return ioInstance;
}

/**
 * Emit an event to every socket in `tenantId`'s room ONLY —
 * `io.to(tenantRoom(tenantId)).emit(...)`, never a global `io.emit(...)`.
 * Callers must resolve `tenantId` from the request's tenant context
 * (`getCurrentTenantId()`) at the call site, not from user input.
 */
export function emitEvent(
  tenantId: number,
  event: string,
  payload: unknown,
): void {
  if (!ioInstance) return;
  ioInstance.to(tenantRoom(tenantId)).emit(event, payload);
}
