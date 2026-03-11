import WebSocket from "ws";

interface QwenASRConfig {
  apiKey: string;
  model: string;
  region: string;
  language: string;
}

interface QwenASREvent {
  event_id: string;
  type: string;
  [key: string]: any;
}

export class VoiceTranscriptionService {
  private ws: WebSocket | null = null;
  private config: QwenASRConfig;
  private isConnecting = false;

  private listeners: Record<string, Function[]> = {};

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
    this.ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        "OpenAI-Beta": "realtime=v1",
      },
    });

    this.ws.on("open", () => {
      this.isConnecting = false;
      this.emit("connected");
      this.sendSessionUpdate();
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
      this.emit("closed", { code, reason });
    });
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.sendSessionFinish();
      setTimeout(() => {
        if (this.ws?.readyState === WebSocket.OPEN) {
          this.ws.close(1000, "Client disconnecting");
        }
        this.ws = null;
      }, 1000);
    }
  }

  async startListening(): Promise<void> {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      await this.connect();
    }
  }

  async stopListening(): Promise<void> {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSessionFinish();
    }
  }

  async sendAudio(chunk: Buffer): Promise<void> {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    const base64Audio = chunk.toString("base64");

    const event: QwenASREvent = {
      event_id: `event_${Date.now()}`,
      type: "input_audio_buffer.append",
      audio: base64Audio,
    };

    this.ws.send(JSON.stringify(event));
  }

  async commitAudio(): Promise<void> {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      throw new Error("WebSocket not connected");
    }

    const event: QwenASREvent = {
      event_id: `event_${Date.now()}`,
      type: "input_audio_buffer.commit",
    };

    this.ws.send(JSON.stringify(event));
  }

  private sendSessionUpdate(): void {
    const event: QwenASREvent = {
      event_id: `event_${Date.now()}`,
      type: "session.update",
      session: {
        modalities: ["text"],
        input_audio_format: "pcm",
        sample_rate: 16000,
        input_audio_transcription: {
          language: this.config.language,
          corpus: {
            text: this.getContextText(),
          },
        },
        turn_detection: {
          type: "server_vad",
          threshold: 0.2,
          silence_duration_ms: 800,
        },
      },
    };

    this.ws?.send(JSON.stringify(event));
  }

  private sendSessionFinish(): void {
    const event: QwenASREvent = {
      event_id: `event_${Date.now()}`,
      type: "session.finish",
    };

    this.ws?.send(JSON.stringify(event));
  }

  private getContextText(): string {
    return `
      LiraTek POS System
      Modules: pos, recharge, omt_whish, debts
      Commands: check balance, send, receive, recharge, add product, remove product, complete sale, apply discount, add debt, record payment
      Common terms: liratek, omt, whish, recharge, debt, payment, product, service
    `;
  }

  private handleMessage(data: WebSocket.Data): void {
    try {
      const message = JSON.parse(data.toString());

      switch (message.type) {
        case "session.updated":
          this.emit("sessionUpdated", message);
          break;

        case "input_audio_buffer.committed":
          this.emit("audioCommitted", message);
          break;

        case "input_audio_buffer.speech_started":
          this.emit("speechStarted", message);
          break;

        case "input_audio_buffer.speech_stopped":
          this.emit("speechStopped", message);
          break;

        case "conversation.item.input_audio_transcription.completed":
          this.emit("transcription", {
            text: message.transcript,
            language: this.config.language,
            timestamp: new Date().toISOString(),
          });
          break;

        case "session.finished":
          this.emit("sessionFinished", message);
          if (message.transcript) {
            this.emit("transcription", {
              text: message.transcript,
              language: this.config.language,
              timestamp: new Date().toISOString(),
            });
          }
          break;

        case "error":
          this.emit(
            "error",
            new Error(message.error?.message || "Qwen-ASR error"),
          );
          break;
      }
    } catch (error) {
      this.emit("error", error);
    }
  }

  private buildWebSocketUrl(): string {
    const model = this.config.model;
    return `wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime?model=${model}`;
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

export const voiceTranscriptionService = new VoiceTranscriptionService();
