import { io, type Socket } from "socket.io-client";
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

  const opts: any = {
    transports: ["websocket"],
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
