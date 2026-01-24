import { io, type Socket } from 'socket.io-client';

let socket: Socket | null = null;

function getSocketUrl(): string {
  const fromGlobal = (globalThis as any).__LIRATEK_BACKEND_URL as string | undefined;
  return (fromGlobal || 'http://localhost:3000').replace(/\/$/, '');
}

export function connectSocket(token?: string): Socket {
  if (socket) return socket;

  const opts: any = {
    transports: ['websocket'],
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
  s.on('sales:processed', handler);
  return () => s.off('sales:processed', handler);
}
