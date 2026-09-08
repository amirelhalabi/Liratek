import {
  io,
  type Socket,
  type ManagerOptions,
  type SocketOptions,
} from "socket.io-client";
import { getBaseUrl } from "./httpClient";

let socket: Socket | null = null;

function getSocketUrl(): string {
  // One source of truth with the REST client: runtime global >
  // VITE_BACKEND_URL > the page s own origin > local dev. This previously read
  // only the global and otherwise hardcoded localhost:3000, so under
  // `yarn dev:web` (backend on 4300) or any single-origin deployment the socket
  // aimed somewhere the REST calls did not.
  return getBaseUrl();
}

export function connectSocket(token?: string): Socket {
  if (socket) return socket;

  // Transport order matters, and websocket-only was a real outage:
  //
  // The SPA is served by Vercel, which rewrites /socket.io to the backend.
  // Vercel proxies HTTP through a rewrite but does NOT forward the WebSocket
  // Upgrade handshake to an external origin — it answers 400. With
  // transports:["websocket"] the client tried only that, failed, and realtime
  // silently never connected (visible as a wss:// console error).
  //
  // Long-polling DOES work through the rewrite (verified 200), so listing it
  // first gets a working connection everywhere. socket.io then attempts an
  // upgrade to websocket on its own and simply stays on polling when that is
  // refused — so pointing the domain straight at the backend later gains the
  // websocket automatically, with no code change.
  //
  // Long-polling is still push, not our old polling: the request is held open
  // server-side until there is something to send.
  const opts: Partial<ManagerOptions & SocketOptions> = {
    transports: ["polling", "websocket"],
    // Do not ATTEMPT the upgrade.
    //
    // The engine.io handshake succeeds over polling, and the server then
    // advertises upgrades:["websocket"], so socket.io tries to upgrade on
    // every connection -- and Vercel refuses, logging a failed wss:// request
    // in the console each time. The connection itself is fine: the polling
    // transport carries on and is pinged every 25s. But a permanent console
    // error reads exactly like a real fault, and this one has already sent us
    // chasing it twice.
    //
    // websocket stays in the transports list deliberately, so it is used if
    // it is ever the FIRST transport that works. Flip this to true the day the
    // frontend talks to the backend directly rather than through Vercel's
    // rewrite -- see docs/DEPLOYMENT.md section 4b. Until then the attempt can
    // only fail.
    upgrade: false,
  };
  if (token) opts.auth = { token };

  socket = io(getSocketUrl(), opts);

  return socket;
}

export function disconnectSocket(): void {
  if (!socket) return;
  socket.disconnect();
  socket = null;
}

export function onSalesProcessed(handler: (payload: any) => void): () => void {
  const s = connectSocket();
  s.on("sales:processed", handler);
  return () => s.off("sales:processed", handler);
}
