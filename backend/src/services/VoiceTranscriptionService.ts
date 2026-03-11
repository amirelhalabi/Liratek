import WebSocket from "ws";

interface QwenASRConfig {
  apiKey: string;
  model: string;
  region: string;
  language: string;
}

export class VoiceTranscriptionService {
  private ws: WebSocket | null = null;
  private config: QwenASRConfig;
  private isConnecting = false;

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN || false;
  }

  constructor() {
    this.config = {
      apiKey: process.env.DASHSCOPE_API_KEY || "",
      model: process.env.QWEN_ASR_MODEL || "qwen3-asr-flash-realtime",
      region: process.env.QWEN_ASR_REGION || "singapore",
      language: process.env.QWEN_ASR_LANGUAGE || "en",
    };
  }

  async connect(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) return;
    if (this.isConnecting) return;

    this.isConnecting = true;

    const url = this.buildWebSocketUrl();
    this.ws = new WebSocket(url);

    this.ws.on("open", () => {
      this.isConnecting = false;
      this.emit("connected");
    });

    this.ws.on("message", (data: WebSocket.Data) => {
      this.handleMessage(data);
    });

    this.ws.on("error", (error: Error) => {
      this.isConnecting = false;
      this.emit("error", error);
    });

    this.ws.on("close", (code: number, reason: string) => {
      this.isConnecting = false;
      this.emit("closed", { code, reason: reason?.toString() });
    });
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close(1000, "Client disconnecting");
      this.ws = null;
    }
  }

  async sendAudio(chunk: Buffer): Promise<void> {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    const base64Audio = chunk.toString("base64");

    this.ws.send(
      JSON.stringify({
        type: "audio_data",
        audio_data: base64Audio,
        format: "pcm",
        sample_rate: 16000,
        channels: 1,
        bit_depth: 16,
      }),
    );
  }

  async startListening(): Promise<void> {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      await this.connect();
    }

    this.ws?.send(
      JSON.stringify({
        type: "start_listening",
        language: this.config.language,
        enable_intermediate_results: true,
        enable_punctuation: true,
      }),
    );
  }

  async stopListening(): Promise<void> {
    this.ws?.send(
      JSON.stringify({
        type: "stop_listening",
      }),
    );
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case "transcription_result":
          this.emit("transcription", {
            text: message.text,
            language: this.config.language,
            confidence: message.confidence || 0.95,
            timestamp: new Date().toISOString(),
          });
          break;

        case "session_started":
          this.emit("sessionStarted", message);
          break;

        case "session_stopped":
          this.emit("sessionStopped", message);
          break;

        case "error":
          this.emit("error", new Error(message.message));
          break;
      }
    } catch (error) {
      this.emit("error", error);
    }
  }

  private buildWebSocketUrl(): string {
    const params = new URLSearchParams({
      "api-key": this.config.apiKey,
      model: this.config.model,
      region: this.config.region,
    });

    return `wss://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-asr/service?${params.toString()}`;
  }

  private listeners: Record<string, Function[]> = {};

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

export const voiceTranscriptionService = new VoiceTranscriptionService();
