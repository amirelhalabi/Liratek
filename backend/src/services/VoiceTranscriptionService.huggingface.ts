import * as https from "https";

interface HuggingFaceConfig {
  apiKey: string;
  model: string;
}

type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "ready"
  | "listening";

export class VoiceTranscriptionService {
  private config: HuggingFaceConfig;
  private connectionState: ConnectionState = "disconnected";
  private audioBuffer: Buffer[] = [];
  private isProcessing = false;

  private listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  isConnected(): boolean {
    return (
      this.connectionState === "ready" || this.connectionState === "listening"
    );
  }

  getConnectionState(): ConnectionState {
    return this.connectionState;
  }

  constructor() {
    this.config = {
      apiKey: process.env.HUGGINGFACE_API_KEY || "",
      model: "openai/whisper-large-v3",
    };
  }

  async connect(): Promise<void> {
    if (
      this.connectionState === "ready" ||
      this.connectionState === "listening"
    ) {
      console.warn("[VoiceTranscription] Already connected");
      return;
    }

    if (this.connectionState === "connecting") {
      console.warn("[VoiceTranscription] Connection in progress");
      return;
    }

    if (!this.config.apiKey) {
      throw new Error("HUGGINGFACE_API_KEY is not configured");
    }

    this.connectionState = "connecting";
    this.audioBuffer = [];
    this.isProcessing = false;

    console.warn(
      "[VoiceTranscription] Connected to Hugging Face Inference API",
    );
    this.connectionState = "ready";
    this.emit("connected");

    return Promise.resolve();
  }

  async disconnect(): Promise<void> {
    if (this.connectionState !== "disconnected") {
      console.warn("[VoiceTranscription] Disconnecting...");
      this.connectionState = "disconnected";
      this.audioBuffer = [];
      this.emit("disconnected");
    }
  }

  async startListening(): Promise<void> {
    if (this.connectionState === "listening") {
      console.warn("[VoiceTranscription] Already listening");
      return;
    }

    if (this.connectionState !== "ready") {
      console.warn("[VoiceTranscription] Connecting before listening...");
      await this.connect();
    }

    this.connectionState = "listening";
    console.warn("[VoiceTranscription] Started listening");
  }

  async stopListening(): Promise<void> {
    if (this.connectionState !== "listening") {
      console.warn("[VoiceTranscription] Not currently listening");
      return;
    }

    this.connectionState = "ready";

    if (this.audioBuffer.length > 0) {
      await this.processAudioBuffer();
    }

    console.warn("[VoiceTranscription] Stopped listening");
  }

  async sendAudio(chunk: Buffer): Promise<void> {
    if (this.connectionState !== "listening") {
      throw new Error(
        `Cannot send audio: connection state is ${this.connectionState}`,
      );
    }

    this.audioBuffer.push(chunk);

    if (!this.isProcessing && this.audioBuffer.length >= 10) {
      await this.processAudioBuffer();
    }
  }

  private async processAudioBuffer(): Promise<void> {
    if (this.isProcessing || this.audioBuffer.length === 0) {
      return;
    }

    this.isProcessing = true;

    try {
      const audioData = Buffer.concat(this.audioBuffer);
      this.audioBuffer = [];

      const transcript = await this.transcribeWithHuggingFace(audioData);

      if (transcript) {
        this.emit("transcription", {
          text: transcript,
          language: "en",
          timestamp: new Date().toISOString(),
          confidence: 0.95,
          isFinal: true,
        });

        this.emit("sessionFinished", {
          transcript,
          success: true,
        });
      }
    } catch (error) {
      console.error("[VoiceTranscription] Transcription error:", error);
      this.emit("error", error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async transcribeWithHuggingFace(
    audioBuffer: Buffer,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const data = audioBuffer.toString("base64");

      const postData = JSON.stringify({
        inputs: data,
        parameters: {
          return_timestamps: false,
          language: "en",
        },
      });

      const options = {
        hostname: "api-inference.huggingface.co",
        port: 443,
        path: `/models/${this.config.model}`,
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(postData),
        },
      };

      const req = https.request(options, (res) => {
        let responseData = "";

        res.on("data", (chunk) => {
          responseData += chunk;
        });

        res.on("end", () => {
          try {
            const result = JSON.parse(responseData);

            if (result.error) {
              if (result.error.includes("loading")) {
                console.warn(
                  "[VoiceTranscription] Model is loading, please wait...",
                );
                resolve("");
                return;
              }
              reject(new Error(result.error));
              return;
            }

            const transcript = Array.isArray(result)
              ? result[0]?.text || ""
              : result.text || "";

            console.warn(
              "[VoiceTranscription] Transcription result:",
              transcript,
            );
            resolve(transcript);
          } catch (error) {
            console.error("[VoiceTranscription] Parse error:", error);
            reject(error);
          }
        });
      });

      req.on("error", (error) => {
        console.error("[VoiceTranscription] Request error:", error);
        reject(error);
      });

      req.write(postData);
      req.end();
    });
  }

  async commitAudio(): Promise<void> {
    if (this.audioBuffer.length > 0) {
      await this.processAudioBuffer();
    }
  }

  on(event: string, callback: (...args: unknown[]) => void): () => void {
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
