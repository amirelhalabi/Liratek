export interface QwenASRConfig {
  wsUrl: string;
  apiKey: string;
  model: string;
  region: string;
  language: string;
}

export class QwenASRClient {
  private ws: WebSocket | null = null;
  private config: QwenASRConfig;
  private isConnecting = false;

  private listeners: Record<string, Function[]> = {};

  constructor(config: Partial<QwenASRConfig> = {}) {
    this.config = {
      wsUrl: config.wsUrl || "ws://localhost:3000/api/voice/ws",
      apiKey: config.apiKey || "",
      model: config.model || "qwen3-asr-flash-realtime",
      region: config.region || "singapore",
      language: config.language || "en",
    };
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN || false;
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.isConnecting) return;

    this.isConnecting = true;

    this.ws = new WebSocket(this.config.wsUrl);

    this.ws.onopen = () => {
      this.isConnecting = false;
      this.emit("connected");
    };

    this.ws.onmessage = (event: MessageEvent) => {
      this.handleMessage(event.data);
    };

    this.ws.onerror = (error: Event) => {
      this.isConnecting = false;
      this.emit("error", error);
    };

    this.ws.onclose = (event: CloseEvent) => {
      this.isConnecting = false;
      this.emit("closed", { code: event.code, reason: event.reason });
    };
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close(1000, "Client disconnecting");
      this.ws = null;
    }
  }

  async startListening(): Promise<void> {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    this.ws?.send(JSON.stringify({ type: "start" }));
  }

  async stopListening(): Promise<void> {
    this.ws?.send(JSON.stringify({ type: "stop" }));
  }

  async sendAudio(chunk: Uint8Array): Promise<void> {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    const base64Audio = Buffer.from(chunk).toString("base64");
    this.ws.send(JSON.stringify({ type: "audio", audio: base64Audio }));
  }

  async commitAudio(): Promise<void> {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    this.ws.send(JSON.stringify({ type: "commit" }));
  }

  private handleMessage(data: string | ArrayBuffer): void {
    try {
      const message = JSON.parse(typeof data === "string" ? data : new TextDecoder().decode(data));

      switch (message.type) {
        case "started":
          this.emit("started", message);
          break;

        case "stopped":
          this.emit("stopped", message);
          break;

        case "audio_sent":
          this.emit("audioSent", message);
          break;

        case "committed":
          this.emit("committed", message);
          break;

        case "transcription":
          this.emit("transcription", {
            text: message.text,
            timestamp: message.timestamp,
          });
          break;

        case "session_finished":
          this.emit("sessionFinished", message);
          break;

        case "error":
          this.emit("error", new Error(message.error || "Qwen-ASR error"));
          break;
      }
    } catch (error) {
      this.emit("error", error);
    }
  }

  on(event: string, callback: Function): () => void {
    if (!this.listeners[event]) {
      this.listeners[event] = [];
    }
    this.listeners[event].push(callback);

    return () => {
      this.listeners[event] = this.listeners[event].filter(
        (cb) => cb !== callback,
      );
    };
  }

  private emit(event: string, ...args: any[]): void {
    const callbacks = this.listeners[event] || [];
    callbacks.forEach((cb) => cb(...args));
  }
}

export const qwenASRClient = new QwenASRClient();
