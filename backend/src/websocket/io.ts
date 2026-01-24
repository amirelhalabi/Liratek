import type { Server as SocketIOServer } from 'socket.io';

let ioInstance: SocketIOServer | null = null;

export function setIO(io: SocketIOServer): void {
  ioInstance = io;
}

export function getIO(): SocketIOServer | null {
  return ioInstance;
}

export function emitEvent(event: string, payload: unknown): void {
  if (!ioInstance) return;
  ioInstance.emit(event, payload);
}
