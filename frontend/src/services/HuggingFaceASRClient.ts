import { InferenceClient } from "@huggingface/inference";
import { voiceBotLogger } from "@/utils/voiceBotLogger";

interface HuggingFaceConfig {
  apiKey: string;
  model: string;
}

export interface TranscriptionResult {
  text: string;
  language?: string;
  timestamp?: string;
  confidence?: number;
  isFinal?: boolean;
}

export class HuggingFaceASRClient {
  private client: InferenceClient | null = null;
  private config: HuggingFaceConfig;
  private audioChunks: Blob[] = [];
  private mediaRecorder: MediaRecorder | null = null;
  private audioStream: MediaStream | null = null;
  private isListening = false;

  private listeners: Record<string, ((...args: unknown[]) => void)[]> = {};

  constructor(config: Partial<HuggingFaceConfig> = {}) {
    this.config = {
      apiKey: config.apiKey || import.meta.env.VITE_HUGGINGFACE_API_KEY || "",
      model: config.model || "openai/whisper-large-v3",
    };

    if (this.config.apiKey) {
      this.client = new InferenceClient(this.config.apiKey);
    }
  }

  isConnected(): boolean {
    return !!this.client;
  }

  async connect(): Promise<void> {
    if (!this.config.apiKey) {
      throw new Error("HUGGINGFACE_API_KEY is not configured");
    }

    if (!this.client) {
      this.client = new InferenceClient(this.config.apiKey);
    }

    voiceBotLogger.info("Connected to Hugging Face API");
    this.emit("connected");
    return Promise.resolve();
  }

  async disconnect(): Promise<void> {
    try {
      // Stop media recorder if active
      if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
        this.mediaRecorder.stop();
      }

      // Clean up media stream to prevent memory leaks
      if (this.audioStream) {
        this.audioStream.getTracks().forEach((track) => track.stop());
        this.audioStream = null;
      }

      this.client = null;
      this.audioChunks = [];
      this.mediaRecorder = null;
      this.isListening = false;
      this.emit("disconnected");
    } catch (error) {
      voiceBotLogger.error("Failed to disconnect", error);
      throw error;
    }
  }

  async startListening(): Promise<void> {
    if (this.isListening) {
      voiceBotLogger.warn("Already listening");
      return;
    }

    let stream: MediaStream | null = null;

    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });

      // Store stream reference for cleanup
      this.audioStream = stream;

      // Use audio/webm format with higher bitrate for better quality
      const options: MediaRecorderOptions = {};

      // Try to set higher bitrate for better quality
      if (MediaRecorder.isTypeSupported("audio/webm;codecs=opus")) {
        options.mimeType = "audio/webm;codecs=opus";
        options.audioBitsPerSecond = 128000;
      } else if (MediaRecorder.isTypeSupported("audio/webm")) {
        options.mimeType = "audio/webm";
        options.audioBitsPerSecond = 128000;
      }

      voiceBotLogger.debug("MediaRecorder configuration", options);

      this.mediaRecorder = new MediaRecorder(stream, options);
      this.audioChunks = [];

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          voiceBotLogger.debug(
            `Audio chunk received: ${(event.data.size / 1024).toFixed(2)} KB`,
          );
          this.audioChunks.push(event.data);
        }
      };

      this.mediaRecorder.onstop = async () => {
        const totalSize = this.audioChunks.reduce(
          (acc, chunk) => acc + chunk.size,
          0,
        );
        voiceBotLogger.debug(
          `Recording stopped: ${this.audioChunks.length} chunks, ${(totalSize / 1024).toFixed(2)} KB`,
        );

        // Set isListening to false BEFORE processing
        this.isListening = false;

        try {
          await this.processAudio();
        } finally {
          // Clear audio chunks after processing
          this.audioChunks = [];
          // Clean up stream
          if (this.audioStream) {
            this.audioStream.getTracks().forEach((track) => track.stop());
            this.audioStream = null;
          }
          this.emit("stopped");
        }
      };

      // Start recording without timeslice - collects all audio in one blob
      this.mediaRecorder.start();
      this.isListening = true;
      voiceBotLogger.info("Recording started");
      this.emit("started");
    } catch (error) {
      // Clean up stream on error
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      voiceBotLogger.error("Failed to start listening", error);
      this.emit("error", error);
      throw error;
    }
  }

  async stopListening(): Promise<void> {
    if (!this.isListening) {
      voiceBotLogger.warn("Not currently listening");
      return;
    }

    try {
      if (this.mediaRecorder && this.mediaRecorder.state === "recording") {
        voiceBotLogger.info("Stopping recording...");
        this.mediaRecorder.stop();
      }
    } catch (error) {
      voiceBotLogger.error("Failed to stop", error);
      this.emit("error", error);
      throw error;
    }
  }

  private async processAudio(): Promise<string> {
    if (!this.client || this.audioChunks.length === 0) {
      voiceBotLogger.warn("No audio data to process");
      return "";
    }

    try {
      voiceBotLogger.debug("Processing audio...");

      // Get the MIME type from the first audio chunk and normalize it
      let mimeType = this.audioChunks[0]?.type || "audio/webm";

      // Normalize MIME type: remove codec parameters
      mimeType = mimeType.split(";")[0].trim();

      const audioBlob = new Blob(this.audioChunks, { type: mimeType });

      voiceBotLogger.debug(
        `Sending audio to API (${(audioBlob.size / 1024).toFixed(2)} KB)`,
      );

      const startTime = Date.now();
      const output = await this.client.automaticSpeechRecognition({
        data: audioBlob,
        model: this.config.model,
        provider: "hf-inference",
      });

      const translationTime = Date.now() - startTime;
      voiceBotLogger.debug(`Translation completed in ${translationTime}ms`);

      const transcript = output.text || "";

      if (transcript) {
        voiceBotLogger.info(`Transcribed: "${transcript}"`);
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
      } else {
        voiceBotLogger.warn("No speech detected in audio");
      }

      return transcript;
    } catch (error) {
      voiceBotLogger.error("Transcription failed", error);
      this.emit("error", error);
      return "";
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

  emit(event: string, ...args: unknown[]): void {
    const callbacks = this.listeners[event] || [];
    callbacks.forEach((cb) => cb(...args));
  }
}

export const huggingFaceASRClient = new HuggingFaceASRClient();
