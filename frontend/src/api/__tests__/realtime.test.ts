/**
 * Realtime invalidation client (api/realtime.ts).
 *
 * The socket transport is mocked so these test the dispatch policy — who gets
 * notified, when, and what happens on reconnect — rather than socket.io.
 */

const socketHandlers = new Map<string, (payload: unknown) => void>();
const connectSocket = jest.fn(() => ({
  on: (event: string, handler: (payload: unknown) => void) => {
    socketHandlers.set(event, handler);
  },
  off: jest.fn(),
}));

let electron = false;
let token: string | null = "jwt-token";

jest.mock("../socket", () => ({ connectSocket }));
jest.mock("../backendApi", () => ({ isElectron: () => electron }));
jest.mock("../httpClient", () => ({ getToken: () => token }));

import { subscribeToInvalidation, resetRealtimeForTests } from "../realtime";

/** Fire what the backend would emit. */
function emit(entity: string, action = "create") {
  const h = socketHandlers.get("data:invalidate");
  if (!h) throw new Error("nothing subscribed to data:invalidate");
  h({ entity, action, at: new Date().toISOString() });
}

describe("subscribeToInvalidation", () => {
  beforeEach(() => {
    resetRealtimeForTests();
    socketHandlers.clear();
    connectSocket.mockClear();
    electron = false;
    token = "jwt-token";
  });

  it("notifies a subscriber when its entity changes", () => {
    const onSessions = jest.fn();
    subscribeToInvalidation("sessions", onSessions);

    emit("sessions");

    expect(onSessions).toHaveBeenCalledTimes(1);
    expect(onSessions.mock.calls[0][0]).toMatchObject({
      entity: "sessions",
      action: "create",
    });
  });

  it("does not notify a subscriber for an unrelated entity", () => {
    const onSessions = jest.fn();
    subscribeToInvalidation("sessions", onSessions);

    emit("suppliers");

    expect(onSessions).not.toHaveBeenCalled();
  });

  it('delivers every event to a "*" subscriber', () => {
    const onAny = jest.fn();
    subscribeToInvalidation("*", onAny);

    emit("sessions");
    emit("suppliers");

    expect(onAny).toHaveBeenCalledTimes(2);
  });

  it("stops notifying after unsubscribe", () => {
    const onSessions = jest.fn();
    const off = subscribeToInvalidation("sessions", onSessions);

    emit("sessions");
    off();
    emit("sessions");

    expect(onSessions).toHaveBeenCalledTimes(1);
  });

  it("notifies EVERY subscriber on reconnect — the gap is when events were missed", () => {
    const onSessions = jest.fn();
    const onSuppliers = jest.fn();
    subscribeToInvalidation("sessions", onSessions);
    subscribeToInvalidation("suppliers", onSuppliers);

    const onConnect = socketHandlers.get("connect");
    expect(onConnect).toBeDefined();
    onConnect!(undefined);

    // Both fire because a dropped socket could have hidden a change to either.
    expect(onSessions).toHaveBeenCalledTimes(1);
    expect(onSuppliers).toHaveBeenCalledTimes(1);
    expect(onSessions.mock.calls[0][0]).toMatchObject({ action: "reconnect" });
  });

  it("one throwing subscriber does not stop the others", () => {
    const bad = jest.fn(() => {
      throw new Error("handler exploded");
    });
    const good = jest.fn();
    subscribeToInvalidation("sessions", bad);
    subscribeToInvalidation("sessions", good);

    expect(() => emit("sessions")).not.toThrow();
    expect(good).toHaveBeenCalledTimes(1);
  });

  it("is a no-op on desktop — there is no socket server to talk to", () => {
    electron = true;
    const onSessions = jest.fn();
    const off = subscribeToInvalidation("sessions", onSessions);

    expect(connectSocket).not.toHaveBeenCalled();
    expect(typeof off).toBe("function");
    off(); // must not throw
  });

  it("does not connect before the user is authenticated", () => {
    token = null;
    subscribeToInvalidation("sessions", jest.fn());
    expect(connectSocket).not.toHaveBeenCalled();

    // ...and connects on a later subscribe, once a token exists.
    token = "jwt-token";
    subscribeToInvalidation("suppliers", jest.fn());
    expect(connectSocket).toHaveBeenCalledTimes(1);
  });

  it("connects once, however many subscribers there are", () => {
    subscribeToInvalidation("sessions", jest.fn());
    subscribeToInvalidation("suppliers", jest.fn());
    subscribeToInvalidation("*", jest.fn());
    expect(connectSocket).toHaveBeenCalledTimes(1);
  });

  it("passes the JWT to the socket handshake", () => {
    subscribeToInvalidation("sessions", jest.fn());
    expect(connectSocket).toHaveBeenCalledWith("jwt-token");
  });
});
