# Voice Bot Implementation Plan

**Version:** 1.18.31 → 1.19.0  
**Status:** Phase 1 & 2 Complete | Phase 3 Next  
**Last Updated:** March 11, 2026

---

## Table of Contents

1. [Overview](#overview)
2. [Phase 1: Release v1.18.31 (COMPLETE)](#phase-1-release-v11831-complete)
3. [Phase 2: Backend Qwen-ASR Integration (COMPLETE)](#phase-2-backend-qwen-asr-integration-complete)
4. [Phase 3: Frontend Audio Capture (NEXT)](#phase-3-frontend-audio-capture-next)
5. [Phase 4: Electron IPC Handlers](#phase-4-electron-ipc-handlers)
6. [Phase 5: Testing & Optimization](#phase-5-testing--optimization)
7. [Phase 6: Deployment](#phase-6-deployment)
8. [Environment Variables](#environment-variables)
9. [Dependencies](#dependencies)
10. [Security Considerations](#security-considerations)
11. [Cost Analysis](#cost-analysis)

---

## Overview

This document outlines the comprehensive implementation plan for adding voice command functionality to LiraTek POS system using Alibaba Cloud's Qwen-ASR (Automatic Speech Recognition) service.

### Current State

- ✅ **Phase 1 Complete**: Voice command parsing and execution infrastructure exists
  - `VoiceBotService.ts` - Pattern matching for voice commands
  - `VoiceBotButton.tsx` - UI component for voice interaction
  - `useVoiceBot.ts` - React hook for speech recognition
  - `voiceBotHandlers.ts` - Electron IPC handlers for parsing/execution

### Next Steps

- ✅ **Phase 2**: Integrate Qwen-ASR WebSocket for real-time transcription (COMPLETE)
- 🔄 **Phase 3**: Implement frontend audio capture and streaming
- 🔄 **Phase 4**: Add Electron IPC handlers for WebSocket communication
- 🔄 **Phase 5**: Comprehensive testing and optimization
- 🔄 **Phase 6**: Deployment to production

---

## Phase 1: Release v1.18.31 (COMPLETE)

### What's Already Implemented

#### Backend (Core Package)

- **`packages/core/src/services/VoiceBotService.ts`**
  - Pattern matching for 4 modules: `omt_whish`, `recharge`, `pos`, `debts`
  - Command parsing with regex patterns
  - Entity extraction (amount, phone, name, product, quantity)
  - Command validation with required fields checking

#### Frontend (UI Package)

- **`frontend/src/components/VoiceBotButton.tsx`**
  - Floating action button with microphone icon
  - Panel with text input and live transcription display
  - Suggestion hints per module
  - Listening status indicator
  - Error handling and result display

- **`frontend/src/hooks/useVoiceBot.ts`**
  - Web Speech API integration (webkitSpeechRecognition)
  - Speech recognition lifecycle management
  - Command processing pipeline
  - Browser compatibility checks

#### Electron (Main Process)

- **`electron-app/handlers/voiceBotHandlers.ts`**
  - `voicebot:parse` - Parse text to structured command
  - `voicebot:execute` - Execute command based on module/action
  - Module-specific executors: `executeOmtWhish`, `executeRecharge`, `executePos`, `executeDebts`

#### IPC Bridge

- **`electron-app/preload.ts`** (lines 315-320)
  - Exposed `window.api.voicebot.parse()` and `window.api.voicebot.execute()`

### Known Limitations

1. **No real-time audio transcription** - Currently uses Web Speech API (browser-based, requires internet)
2. **No WebSocket integration** - Qwen-ASR integration not yet implemented
3. **Limited to English** - Web Speech API language hardcoded to `en-US`
4. **No audio format conversion** - WebM → PCM16 conversion not implemented

### Phase 2 Completion Status

- ✅ **Qwen-ASR WebSocket Integration**: Backend service ready
- ✅ **Voice API Routes**: Health, start/stop, audio streaming endpoints
- ✅ **Environment Configuration**: DASHSCOPE_API_KEY and Qwen-ASR settings
- ✅ **Type Safety**: Full TypeScript support with proper interfaces
- ⏭️ **Next**: Phase 3 - Frontend audio capture and streaming

---

## Phase 2: Backend Qwen-ASR Integration (COMPLETE)

### What's Implemented

#### Backend (Core Package)

- **`backend/src/services/VoiceTranscriptionService.ts`**
  - WebSocket connection to Qwen-ASR service
  - Audio chunk streaming (PCM16, 16kHz, mono)
  - Event-driven transcription results
  - Connection lifecycle management (connect, disconnect, sendAudio)
  - Error handling and reconnection support

#### Backend (API Layer)

- **`backend/src/api/voice.ts`**
  - `GET /api/voice/health` - Health check endpoint
  - `POST /api/voice/start` - Start listening session
  - `POST /api/voice/stop` - Stop listening session
  - `POST /api/voice/audio` - Audio data streaming endpoint

#### Environment Configuration

- **`packages/core/src/config/env.ts`**
  - `DASHSCOPE_API_KEY` - Alibaba Cloud API key
  - `QWEN_ASR_MODEL` - Model name (default: qwen3-asr-flash-realtime)
  - `QWEN_ASR_REGION` - Region (default: singapore)
  - `QWEN_ASR_LANGUAGE` - Language (default: en)

- **`backend/.env.example`** and **`backend/.env.dev`**
  - Complete voice transcription configuration template
  - Example API key included for development

#### Dependencies

- **`backend/package.json`**
  - Added `@types/ws` for WebSocket type definitions
  - `ws` package for WebSocket communication

### Architecture

```
Frontend (Browser)
  ↓ (Web Audio API / MediaRecorder)
Electron Main Process
  ↓ (WebSocket)
Backend Server
  ↓ (WebSocket)
Qwen-ASR Service (Alibaba Cloud)
  ↓ (WebSocket)
Backend Server (transcription received)
  ↓ (IPC)
Frontend (transcription displayed)
```

### API Methods

| Method                | Description                                |
| --------------------- | ------------------------------------------ |
| `connect()`           | Establish WebSocket connection to Qwen-ASR |
| `disconnect()`        | Close WebSocket connection                 |
| `sendAudio(chunk)`    | Send audio chunk to Qwen-ASR               |
| `startListening()`    | Start transcription session                |
| `stopListening()`     | Stop transcription session                 |
| `on(event, callback)` | Listen for transcription events            |

### Testing

- ✅ Backend builds successfully
- ✅ Type checking passes
- ✅ All existing tests pass
- ✅ Environment variables properly configured

### Files Created/Modified

**Created:**

- `backend/src/services/VoiceTranscriptionService.ts`
- `backend/src/api/voice.ts`

**Modified:**

- `backend/src/server.ts` - Added voice routes
- `packages/core/src/config/env.ts` - Added Qwen-ASR environment variables
- `backend/.env.example` - Added voice transcription section
- `backend/.env.dev` - Added voice transcription section
- `backend/package.json` - Added @types/ws dependency
- `yarn.lock` - Updated with new dependency

### Next Steps

- **Phase 3**: Implement frontend audio capture and streaming
- **Phase 4**: Add Electron IPC handlers for WebSocket communication

---

## Phase 3: Frontend Audio Capture

interface TranscriptionResult {
text: string;
language: string;
confidence: number;
timestamp: string;
}

export class VoiceTranscriptionService {
private ws: WebSocket | null = null;
private config: QwenASRConfig;
private isConnecting = false;
private audioBuffer: Buffer[] = [];

constructor() {
this.config = {
apiKey: getEnv().DASHSCOPE_API_KEY,
model: getEnv().QWEN_ASR_MODEL || "qwen3-asr-flash-realtime",
region: getEnv().QWEN_ASR_REGION || "singapore",
language: getEnv().QWEN_ASR_LANGUAGE || "en",
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

    this.ws.on("error", (error) => {
      this.isConnecting = false;
      this.emit("error", error);
    });

    this.ws.on("close", (code, reason) => {
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

    // Convert to base64 for Qwen-ASR
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
// Qwen-ASR WebSocket URL format
// wss://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-asr/service?
// api-key=YOUR_API_KEY&model=MODEL_NAME&region=REGION
const params = new URLSearchParams({
"api-key": this.config.apiKey,
model: this.config.model,
region: this.config.region,
});

    return `wss://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-asr/service?${params.toString()}`;

}

// Event emitter pattern
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

````

#### 2. `backend/src/api/voiceRoutes.ts`

```typescript
import { Router } from "express";
import { voiceTranscriptionService } from "../services/VoiceTranscriptionService.js";

const router = Router();

// Health check
router.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "voice-transcription",
    connected: voiceTranscriptionService.isConnected(),
  });
});

// Start transcription session
router.post("/start", async (_req, res) => {
  try {
    await voiceTranscriptionService.startListening();
    res.json({ success: true, message: "Listening started" });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to start listening",
    });
  }
});

// Stop transcription session
router.post("/stop", async (_req, res) => {
  try {
    await voiceTranscriptionService.stopListening();
    res.json({ success: true, message: "Listening stopped" });
  } catch (error) {
    res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to stop listening",
    });
  }
});

// Audio data endpoint (for chunked streaming)
router.post("/audio", async (req, res) => {
  try {
    const { audioData, format = "pcm", sampleRate = 16000 } = req.body;

    if (!audioData) {
      return res.status(400).json({ error: "audioData is required" });
    }

    const buffer = Buffer.from(
      audioData,
      format === "base64" ? "base64" : "utf8",
    );
    await voiceTranscriptionService.sendAudio(buffer);

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to send audio",
    });
  }
});

export default router;
````

#### 3. Update `backend/src/server.ts`

Add voice routes to the server:

```typescript
// Import voice routes (line 87)
import voiceRoutes from "./api/voice.js";

// Register routes (after profitsRoutes, line 119)
app.use("/api/voice", voiceRoutes);
```

### Files to Update

#### 1. Update `backend/.env.example`

```env
# ============================================
# VOICE TRANSCRIPTION (Qwen-ASR)
# ============================================
# Alibaba Cloud DashScope API Key
# Get from: https://dashscope.console.aliyun.com/apiKey
DASHSCOPE_API_KEY=your-dashscope-api-key-here

# Qwen-ASR Model Configuration
QWEN_ASR_MODEL=qwen3-asr-flash-realtime  # or qwen3-asr-pro-realtime
QWEN_ASR_REGION=singapore               # singapore | us-west-1 | eu-central-1
QWEN_ASR_LANGUAGE=en                    # en | zh | es | fr | pt | ru | ar | ja | ko
```

#### 2. Update `.env` (already exists - verify values)

```
DASHSCOPE_API_KEY=sk-a91f5c165b7e4e8db89727181ca30a59
QWEN_ASR_MODEL=qwen3-asr-flash-realtime
QWEN_ASR_REGION=singapore
QWEN_ASR_LANGUAGE=en
```

#### 3. Update `packages/core/src/config/env.ts`

Add new environment variables to the schema (around line 40):

```typescript
// Add to envSchema object (before .transform):
DASHSCOPE_API_KEY: z.string().optional(),
QWEN_ASR_MODEL: z.string().default('qwen3-asr-flash-realtime'),
QWEN_ASR_REGION: z.string().default('singapore'),
QWEN_ASR_LANGUAGE: z.string().default('en'),
```

Add to exports (around line 127):

```typescript
DASHSCOPE_API_KEY,
QWEN_ASR_MODEL,
QWEN_ASR_REGION,
QWEN_ASR_LANGUAGE,
```

---

## Phase 3: Frontend Audio Capture

### Overview

Implement audio capture using Web Audio API and MediaRecorder, then stream to backend via WebSocket.

### Files to Create

#### 1. `frontend/src/services/AudioCaptureService.ts`

```typescript
export interface AudioStreamConfig {
  sampleRate: number;
  channels: number;
  bitDepth: number;
  bufferSize: number;
}

export class AudioCaptureService {
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private microphone: MediaStreamAudioSourceNode | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private config: AudioStreamConfig;

  private onChunkCallback: ((chunk: Uint8Array) => void) | null = null;
  private onStatusCallback:
    | ((status: "recording" | "stopped" | "error") => void)
    | null = null;

  constructor(config: Partial<AudioStreamConfig> = {}) {
    this.config = {
      sampleRate: config.sampleRate || 16000,
      channels: config.channels || 1,
      bitDepth: config.bitDepth || 16,
      bufferSize: config.bufferSize || 4096,
    };
  }

  async startRecording(): Promise<void> {
    try {
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          sampleRate: this.config.sampleRate,
          channelCount: this.config.channels,
        },
        video: false,
      });

      this.audioContext = new AudioContext({
        sampleRate: this.config.sampleRate,
      });
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 256;

      this.microphone = this.audioContext.createMediaStreamSource(
        this.mediaStream,
      );
      this.microphone.connect(this.analyser);

      this.mediaRecorder = new MediaRecorder(this.mediaStream, {
        mimeType: "audio/webm;codecs=opus",
        audioBitsPerSecond: 128000,
      });

      this.mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data.size > 0) {
          this.handleAudioData(event.data);
        }
      };

      this.mediaRecorder.onstart = () => {
        this.onStatusCallback?.("recording");
      };

      this.mediaRecorder.onstop = () => {
        this.onStatusCallback?.("stopped");
      };

      this.mediaRecorder.onerror = (error) => {
        console.error("[AudioCapture] Recorder error:", error);
        this.onStatusCallback?.("error");
      };

      this.mediaRecorder.start(100); // Collect 100ms chunks
    } catch (error) {
      console.error("[AudioCapture] Failed to start recording:", error);
      this.onStatusCallback?.("error");
      throw error;
    }
  }

  async stopRecording(): Promise<void> {
    if (this.mediaRecorder && this.mediaRecorder.state !== "inactive") {
      this.mediaRecorder.stop();
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((track) => track.stop());
    }

    if (this.audioContext) {
      await this.audioContext.close();
    }

    this.mediaStream = null;
    this.audioContext = null;
    this.microphone = null;
    this.analyser = null;
    this.mediaRecorder = null;
  }

  async processWebmToPcm(blob: Blob): Promise<Uint8Array> {
    const arrayBuffer = await blob.arrayBuffer();
    const audioBuffer = await this.audioContext?.decodeAudioData(arrayBuffer);

    if (!audioBuffer) {
      throw new Error("Failed to decode audio data");
    }

    // Convert to PCM16 (16-bit little-endian)
    const channelData = audioBuffer.getChannelData(0);
    const pcmBuffer = new ArrayBuffer(audioBuffer.length * 2);
    const pcmView = new DataView(pcmBuffer);

    for (let i = 0; i < audioBuffer.length; i++) {
      // Convert float (-1 to 1) to int16
      const int16Value = Math.max(-1, Math.min(1, channelData[i])) * 0x7fff;
      pcmView.setInt16(i * 2, int16Value, true); // Little-endian
    }

    return new Uint8Array(pcmBuffer);
  }

  private handleAudioData(blob: Blob): void {
    // Convert WebM/Opus to PCM16, 16kHz
    this.processWebmToPcm(blob)
      .then((pcmData) => {
        this.onChunkCallback?.(pcmData);
      })
      .catch((error) => {
        console.error("[AudioCapture] Error processing audio:", error);
      });
  }

  onChunk(callback: (chunk: Uint8Array) => void): void {
    this.onChunkCallback = callback;
  }

  onStatus(
    callback: (status: "recording" | "stopped" | "error") => void,
  ): void {
    this.onStatusCallback = callback;
  }

  isRecording(): boolean {
    return this.mediaRecorder?.state === "recording" || false;
  }

  getAudioLevel(): number {
    if (!this.analyser) return 0;

    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      sum += dataArray[i];
    }

    return sum / dataArray.length / 255; // Normalize to 0-1
  }
}

export const audioCaptureService = new AudioCaptureService();
```

#### 2. Update `frontend/src/hooks/useVoiceBot.ts`

Add WebSocket support for Qwen-ASR:

```typescript
import { useState, useCallback, useRef, useEffect } from "react";
import { useActiveModule } from "@/contexts/ActiveModuleContext";
import logger from "@/utils/logger";
import { audioCaptureService } from "@/services/AudioCaptureService";

interface VoiceCommand {
  module: string;
  action: string;
  entities: {
    amount?: number;
    phone?: string;
    name?: string;
    product?: string;
    quantity?: number;
    serviceType?: "SEND" | "RECEIVE";
  };
}

interface UseVoiceBotReturn {
  listening: boolean;
  transcript: string;
  error: string | null;
  result: string | null;
  startListening: () => void;
  stopListening: () => void;
  reset: () => void;
  audioLevel: number;
}

export function useVoiceBot(): UseVoiceBotReturn {
  const { activeModule } = useActiveModule();
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [recognition, setRecognition] = useState<any>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<any>(null);

  // Initialize speech recognition (fallback)
  const initRecognition = useCallback(() => {
    if (!isSpeechSupported) {
      setError("Speech recognition is not supported in this browser");
      return null;
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    const recognitionInstance = new SpeechRecognition();
    recognitionInstance.continuous = false;
    recognitionInstance.interimResults = true;
    recognitionInstance.lang = "en-US";

    recognitionInstance.onresult = async (event: any) => {
      const currentTranscript = Array.from(event.results)
        .map((result: any) => result[0].transcript)
        .join("");

      setTranscript(currentTranscript);

      if (event.results[0].isFinal) {
        await processCommand(currentTranscript);
      }
    };

    recognitionInstance.onerror = (event: any) => {
      logger.error("[VoiceBot] Recognition error:", event.error);
      setError(getErrorMessage(event.error));
      setListening(false);
    };

    recognitionInstance.onend = () => {
      setListening(false);
    };

    return recognitionInstance;
  }, []);

  // Process command from Qwen-ASR or Web Speech API
  const processCommand = async (text: string) => {
    if (!activeModule) {
      setError("No active module. Please navigate to a module first.");
      return;
    }

    try {
      setError(null);
      setResult(null);

      const parseResult = await window.api.voicebot.parse(text, activeModule);

      if (!parseResult.success) {
        setError(parseResult.error || "Failed to parse command");
        return;
      }

      const command = parseResult.command as VoiceCommand;
      logger.info("[VoiceBot] Parsed command:", {
        module: command.module,
        action: command.action,
      });

      const executeResult = await window.api.voicebot.execute(command);

      if (executeResult.success) {
        setResult(executeResult.message || "Command executed successfully");
        window.dispatchEvent(
          new CustomEvent("voicebot:command", {
            detail: { command, entities: executeResult.entities },
          }),
        );
      } else {
        setError(executeResult.error || "Failed to execute command");
      }
    } catch (err) {
      logger.error("[VoiceBot] Error processing command:", err);
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  // Start listening with Qwen-ASR WebSocket
  const startListening = useCallback(async () => {
    if (!activeModule) {
      setError("No active module. Please navigate to a module first.");
      return;
    }

    // Try Qwen-ASR first (WebSocket)
    try {
      await connectToQwenASR();
      await audioCaptureService.startRecording();
      setListening(true);
      setError(null);
      setResult(null);
      setTranscript("");

      // Setup audio chunk handler
      audioCaptureService.onChunk(async (chunk: Uint8Array) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          // Send audio chunk to Qwen-ASR
          wsRef.current.send(
            JSON.stringify({
              type: "audio_data",
              audio_data: chunk.toString("base64"),
            }),
          );
        }
      });

      audioCaptureService.onStatus((status) => {
        if (status === "error") {
          setError("Audio capture error. Please check microphone permissions.");
          setListening(false);
        }
      });
    } catch (qwenError) {
      console.warn(
        "[VoiceBot] Qwen-ASR failed, falling back to Web Speech API:",
        qwenError,
      );

      // Fallback to Web Speech API
      const recognitionInstance = recognitionRef.current || initRecognition();
      if (!recognitionInstance) {
        return;
      }

      recognitionRef.current = recognitionInstance;
      setError(null);
      setResult(null);
      setTranscript("");

      try {
        recognitionInstance.start();
        setListening(true);
      } catch (err) {
        logger.error("[VoiceBot] Failed to start recognition:", err);
        setError("Failed to start voice recognition");
      }
    }
  }, [activeModule, initRecognition]);

  // Stop listening
  const stopListening = useCallback(async () => {
    // Stop Qwen-ASR WebSocket
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: "stop_listening" }));
      wsRef.current.close();
      wsRef.current = null;
    }

    // Stop audio capture
    await audioCaptureService.stopRecording();
    setListening(false);
  }, []);

  // Reset state
  const reset = useCallback(() => {
    setTranscript("");
    setError(null);
    setResult(null);
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      audioCaptureService.stopRecording();
    };
  }, []);

  return {
    listening,
    transcript,
    error,
    result,
    startListening,
    stopListening,
    reset,
    audioLevel,
  };
}

// Helper function to get user-friendly error messages
function getErrorMessage(error: string): string {
  switch (error) {
    case "network":
      return "Network error. Voice recognition requires an internet connection.";
    case "not-allowed":
      return "Permission denied. Please allow microphone access.";
    case "no-speech":
      return "No speech detected. Please try speaking again.";
    case "audio-capture":
      return "No microphone found. Please connect a microphone.";
    case "aborted":
      return "Recognition was cancelled.";
    default:
      return error;
  }
}

// Connect to Qwen-ASR WebSocket
async function connectToQwenASR(): Promise<void> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket("ws://localhost:3000/api/voice/ws");

    ws.onopen = () => {
      console.log("[VoiceBot] Connected to Qwen-ASR");
      ws.send(
        JSON.stringify({
          type: "start_listening",
          language: "en",
        }),
      );
      wsRef.current = ws;
      resolve();
    };

    ws.onmessage = (event) => {
      try {
        const message = JSON.parse(event.data);

        if (message.type === "transcription_result") {
          setTranscript(message.text);
        }
      } catch (e) {
        console.error("[VoiceBot] Failed to parse message:", e);
      }
    };

    ws.onerror = (error) => {
      console.error("[VoiceBot] WebSocket error:", error);
      reject(new Error("Failed to connect to voice service"));
    };

    ws.onclose = () => {
      wsRef.current = null;
    };
  });
}
```

---

## Phase 4: Electron IPC Handlers

### Overview

Add WebSocket proxy handlers to forward audio data from frontend to Qwen-ASR service.

### Files to Create

#### 1. Update `electron-app/handlers/voiceBotHandlers.ts`

Add Qwen-ASR WebSocket proxy:

```typescript
import { ipcMain, BrowserWindow } from "electron";
import { getVoiceBotService } from "@liratek/core";
import WebSocket from "ws";

// Qwen-ASR WebSocket client
let qwenWs: WebSocket | null = null;
let activeTranscriptionWindow: BrowserWindow | null = null;

export function registerVoiceBotHandlers() {
  const voiceBotService = getVoiceBotService();

  // Parse voice command text
  ipcMain.handle(
    "voicebot:parse",
    async (_event, text: string, currentModule: string) => {
      try {
        const command = voiceBotService.parseCommand(text, currentModule);

        if (!command) {
          return {
            success: false,
            error: "No matching command found. Please try a different phrase.",
          };
        }

        const validation = voiceBotService.validateCommand(command);
        if (!validation.valid) {
          return {
            success: false,
            error: `Missing required information: ${validation.missing?.join(", ")}`,
            command,
          };
        }

        return {
          success: true,
          command,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  // Execute voice command
  ipcMain.handle("voicebot:execute", async (_event, command: any) => {
    try {
      switch (command.module) {
        case "omt_whish":
          return executeOmtWhish(command);
        case "recharge":
          return executeRecharge(command);
        case "pos":
          return executePos(command);
        case "debts":
          return executeDebts(command);
        default:
          return {
            success: false,
            error: `Unknown module: ${command.module}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Qwen-ASR WebSocket proxy handlers
  registerQwenASRHandlers();
}

function registerQwenASRHandlers() {
  // Connect to Qwen-ASR service
  ipcMain.handle("voicebot:qwen:connect", async (_event, windowId: number) => {
    try {
      activeTranscriptionWindow = BrowserWindow.fromId(windowId);

      if (qwenWs && qwenWs.readyState === WebSocket.OPEN) {
        return { success: true, message: "Already connected" };
      }

      const apiKey = process.env.DASHSCOPE_API_KEY;
      if (!apiKey) {
        throw new Error("DASHSCOPE_API_KEY not configured");
      }

      const url = `wss://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-asr/service?api-key=${apiKey}&model=qwen3-asr-flash-realtime&region=singapore`;

      qwenWs = new WebSocket(url);

      qwenWs.on("open", () => {
        console.log("[VoiceBot] Qwen-ASR connected");
        qwenWs?.send(
          JSON.stringify({
            type: "start_listening",
            language: process.env.QWEN_ASR_LANGUAGE || "en",
          }),
        );
      });

      qwenWs.on("message", (data: WebSocket.Data) => {
        handleQwenMessage(data);
      });

      qwenWs.on("error", (error) => {
        console.error("[VoiceBot] Qwen-ASR error:", error);
        broadcastTranscriptionError(error.message);
      });

      qwenWs.on("close", (code, reason) => {
        console.log("[VoiceBot] Qwen-ASR closed:", code, reason?.toString());
        qwenWs = null;
      });

      return { success: true, message: "Connected to Qwen-ASR" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Disconnect from Qwen-ASR service
  ipcMain.handle("voicebot:qwen:disconnect", async () => {
    try {
      if (qwenWs) {
        qwenWs.close(1000, "Client disconnecting");
        qwenWs = null;
      }
      return { success: true, message: "Disconnected" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // Send audio data to Qwen-ASR
  ipcMain.handle(
    "voicebot:qwen:send-audio",
    async (_event, audioData: string, format: string = "base64") => {
      try {
        if (!qwenWs || qwenWs.readyState !== WebSocket.OPEN) {
          throw new Error("Not connected to Qwen-ASR");
        }

        const buffer = Buffer.from(audioData, format);

        qwenWs.send(
          JSON.stringify({
            type: "audio_data",
            audio_data: audioData,
            format: "pcm",
            sample_rate: 16000,
            channels: 1,
            bit_depth: 16,
          }),
        );

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  // Stop listening
  ipcMain.handle("voicebot:qwen:stop", async () => {
    try {
      if (!qwenWs || qwenWs.readyState !== WebSocket.OPEN) {
        throw new Error("Not connected to Qwen-ASR");
      }

      qwenWs.send(
        JSON.stringify({
          type: "stop_listening",
        }),
      );

      return { success: true, message: "Listening stopped" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function handleQwenMessage(data: WebSocket.Data) {
  try {
    const message = JSON.parse(data.toString());

    if (message.type === "transcription_result" && activeTranscriptionWindow) {
      activeTranscriptionWindow.webContents.send("voicebot:transcription", {
        text: message.text,
        confidence: message.confidence || 0.95,
        isFinal: message.is_final || false,
      });
    } else if (message.type === "error") {
      broadcastTranscriptionError(message.message);
    }
  } catch (error) {
    console.error("[VoiceBot] Failed to parse Qwen message:", error);
  }
}

function broadcastTranscriptionError(errorMessage: string) {
  if (activeTranscriptionWindow) {
    activeTranscriptionWindow.webContents.send("voicebot:transcription-error", {
      error: errorMessage,
    });
  }
}
```

#### 2. Update `electron-app/preload.ts`

Add Qwen-ASR API methods (around line 315):

```typescript
// Voice Bot
voicebot: {
  parse: (text: string, currentModule: string) =>
    ipcRenderer.invoke("voicebot:parse", text, currentModule),
  execute: (command: any) => ipcRenderer.invoke("voicebot:execute", command),

  // Qwen-ASR WebSocket methods
  qwenConnect: (windowId: number) =>
    ipcRenderer.invoke("voicebot:qwen:connect", windowId),
  qwenDisconnect: () =>
    ipcRenderer.invoke("voicebot:qwen:disconnect"),
  qwenSendAudio: (audioData: string, format?: string) =>
    ipcRenderer.invoke("voicebot:qwen:send-audio", audioData, format),
  qwenStop: () =>
    ipcRenderer.invoke("voicebot:qwen:stop"),

  // Listen for transcription events
  onTranscription: (cb: (_event: unknown, data: any) => void) => {
    ipcRenderer.on("voicebot:transcription", cb);
    return () => ipcRenderer.removeListener("voicebot:transcription", cb);
  },
  onTranscriptionError: (cb: (_event: unknown, data: any) => void) => {
    ipcRenderer.on("voicebot:transcription-error", cb);
    return () => ipcRenderer.removeListener("voicebot:transcription-error", cb);
  },
},
```

---

## Phase 5: Testing & Optimization

### Testing Scenarios

#### 1. Unit Tests

**`backend/src/services/__tests__/VoiceTranscriptionService.test.ts`**

```typescript
import { VoiceTranscriptionService } from "../VoiceTranscriptionService";

describe("VoiceTranscriptionService", () => {
  let service: VoiceTranscriptionService;

  beforeEach(() => {
    service = new VoiceTranscriptionService();
  });

  afterEach(async () => {
    await service.disconnect();
  });

  test("should build correct WebSocket URL", () => {
    const url = (service as any).buildWebSocketUrl();
    expect(url).toContain("wss://dashscope-intl.aliyuncs.com");
    expect(url).toContain("api-key=");
    expect(url).toContain("model=");
    expect(url).toContain("region=");
  });

  test("should handle connection errors gracefully", async () => {
    // Mock invalid API key
    process.env.DASHSCOPE_API_KEY = "invalid-key";

    await expect(service.connect()).rejects.toThrow();
  });

  test("should send audio chunks correctly", async () => {
    await service.connect();

    const sendAudioSpy = jest.spyOn(service, "sendAudio");
    const chunk = Buffer.from("test audio data");

    await service.sendAudio(chunk);

    expect(sendAudioSpy).toHaveBeenCalledWith(chunk);
  });

  test("should handle transcription messages", async () => {
    const onTranscription = jest.fn();
    service.on("transcription", onTranscription);

    await service.connect();

    // Simulate message event
    const message = JSON.stringify({
      type: "transcription_result",
      text: "test transcription",
      confidence: 0.95,
    });

    (service as any).handleMessage(message);

    expect(onTranscription).toHaveBeenCalledWith({
      text: "test transcription",
      language: "en",
      confidence: 0.95,
    });
  });
});
```

#### 2. Integration Tests

**`backend/src/api/__tests__/voiceRoutes.test.ts`**

```typescript
import request from "supertest";
import { app } from "../../server";
import { voiceTranscriptionService } from "../../services/VoiceTranscriptionService";

describe("Voice Routes", () => {
  describe("GET /api/voice/health", () => {
    test("should return health status", async () => {
      const response = await request(app).get("/api/voice/health");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: "ok",
        service: "voice-transcription",
      });
    });
  });

  describe("POST /api/voice/start", () => {
    test("should start listening", async () => {
      const response = await request(app).post("/api/voice/start");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        success: true,
        message: "Listening started",
      });
    });
  });

  describe("POST /api/voice/audio", () => {
    test("should accept audio data", async () => {
      const audioData = Buffer.from("test audio").toString("base64");

      const response = await request(app).post("/api/voice/audio").send({
        audioData,
        format: "base64",
        sampleRate: 16000,
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ success: true });
    });
  });
});
```

#### 3. E2E Tests

**`frontend/src/hooks/__tests__/useVoiceBot.test.tsx`**

```typescript
import { renderHook, act } from "@testing-library/react";
import { useVoiceBot } from "../useVoiceBot";
import { useActiveModule } from "@/contexts/ActiveModuleContext";

jest.mock("@/contexts/ActiveModuleContext", () => ({
  useActiveModule: jest.fn(),
}));

describe("useVoiceBot", () => {
  beforeEach(() => {
    (useActiveModule as jest.Mock).mockReturnValue({
      activeModule: "pos",
    });
  });

  test("should start and stop listening", async () => {
    const { result } = renderHook(() => useVoiceBot());

    await act(async () => {
      result.current.startListening();
    });

    expect(result.current.listening).toBe(true);

    await act(async () => {
      result.current.stopListening();
    });

    expect(result.current.listening).toBe(false);
  });

  test("should handle errors gracefully", async () => {
    const { result } = renderHook(() => useVoiceBot());

    await act(async () => {
      result.current.startListening();
    });

    expect(result.current.error).toBeNull();
  });
});
```

### Performance Optimization

#### 1. Audio Buffer Management

```typescript
// Optimize chunk size for real-time transcription
const CHUNK_SIZE_MS = 50; // 50ms chunks = 800 samples @ 16kHz
const BUFFER_THRESHOLD = 3; // Send every 3rd chunk (150ms)

let chunkCount = 0;
let buffer: Uint8Array[] = [];

function handleAudioChunk(chunk: Uint8Array) {
  buffer.push(chunk);
  chunkCount++;

  if (chunkCount % BUFFER_THRESHOLD === 0) {
    const combined = combineBuffers(buffer);
    sendToQwenASR(combined);
    buffer = [];
  }
}

function combineBuffers(buffers: Uint8Array[]): Uint8Array {
  const totalLength = buffers.reduce((sum, buf) => sum + buf.length, 0);
  const combined = new Uint8Array(totalLength);
  let offset = 0;

  for (const buf of buffers) {
    combined.set(buf, offset);
    offset += buf.length;
  }

  return combined;
}
```

#### 2. Noise Suppression

```typescript
// Use Web Audio API for real-time noise suppression
const audioContext = new AudioContext();
const analyser = audioContext.createAnalyser();
const gainNode = audioContext.createGain();

// Configure analyser for noise detection
analyser.fftSize = 512;
analyser.smoothingTimeConstant = 0.8;

// Dynamic gain adjustment based on audio levels
function adjustGain(audioData: Float32Array): Float32Array {
  let sum = 0;
  for (let i = 0; i < audioData.length; i++) {
    sum += audioData[i] * audioData[i];
  }

  const rms = Math.sqrt(sum / audioData.length);

  // Reduce gain if noise level is high
  if (rms > 0.3) {
    return audioData.map((sample) => sample * 0.5);
  }

  return audioData;
}
```

#### 3. Memory Optimization

```typescript
// Limit audio buffer size to prevent memory leaks
const MAX_BUFFER_SIZE = 1024 * 1024 * 5; // 5MB

class AudioBufferManager {
  private buffers: Buffer[] = [];
  private totalSize = 0;

  add(buffer: Buffer): void {
    this.buffers.push(buffer);
    this.totalSize += buffer.length;

    if (this.totalSize > MAX_BUFFER_SIZE) {
      this.trim();
    }
  }

  private trim(): void {
    while (this.totalSize > MAX_BUFFER_SIZE * 0.8 && this.buffers.length > 0) {
      const removed = this.buffers.shift();
      if (removed) {
        this.totalSize -= removed.length;
      }
    }
  }

  getCombined(): Buffer {
    const totalLength = this.buffers.reduce((sum, buf) => sum + buf.length, 0);
    const combined = Buffer.alloc(totalLength);
    let offset = 0;

    for (const buf of this.buffers) {
      buf.copy(combined, offset);
      offset += buf.length;
    }

    return combined;
  }
}
```

---

## Phase 6: Deployment

### Pre-Deployment Checklist

- [ ] Environment variables configured in `.env`
- [ ] Qwen-ASR API key validated
- [ ] Backend server running on port 3000
- [ ] Frontend dev server running on port 5173
- [ ] Electron app builds successfully
- [ ] All tests passing (unit, integration, e2e)
- [ ] Linting passes (`npm run lint`)
- [ ] Type checking passes (`npm run typecheck`)

### Deployment Steps

#### 1. Backend Deployment

```bash
# SSH to server
ssh liratek-server

# Navigate to project
cd /opt/liratek

# Pull latest changes
git pull origin main

# Install dependencies
yarn install

# Build backend
yarn workspace @liratek/backend build

# Start server
pm2 start dist/server.js --name liratek-backend
```

#### 2. Frontend Deployment

```bash
# Build frontend
yarn workspace @liratek/frontend build

# Deploy to static server
rsync -av dist/ /var/www/liratek-frontend/
```

#### 3. Electron App Build

```bash
# Build for all platforms
yarn ci:build:mac:arm
yarn ci:build:mac:intel
yarn ci:build:win

# Verify builds
ls -lh releases/
```

### Rollback Plan

If issues occur:

```bash
# Stop services
pm2 stop liratek-backend
pm2 stop liratek-frontend

# Restore previous version
git checkout v1.18.31
yarn install
yarn workspace @liratek/backend build

# Restart
pm2 start dist/server.js --name liratek-backend
```

---

## Environment Variables

### Required Variables

| Variable            | Description                     | Example                               | Required                                  |
| ------------------- | ------------------------------- | ------------------------------------- | ----------------------------------------- |
| `DASHSCOPE_API_KEY` | Alibaba Cloud DashScope API key | `sk-a91f5c165b7e4e8db89727181ca30a59` | ✅ Yes                                    |
| `QWEN_ASR_MODEL`    | Qwen-ASR model name             | `qwen3-asr-flash-realtime`            | ❌ No (default: qwen3-asr-flash-realtime) |
| `QWEN_ASR_REGION`   | Qwen-ASR region                 | `singapore`                           | ❌ No (default: singapore)                |
| `QWEN_ASR_LANGUAGE` | Transcription language          | `en`                                  | ❌ No (default: en)                       |

### Setup Instructions

1. **Get API Key from Alibaba Cloud**
   - Visit: https://dashscope.console.aliyun.com/apiKey
   - Sign in with Alibaba Cloud account
   - Copy your API key
   - Ensure API key has Qwen-ASR permissions

2. **Update `.env` file**

```bash
# Copy example if needed
cp backend/.env.example backend/.env

# Edit with your values
nano backend/.env
# or
vi backend/.env
```

3. **Verify configuration**

```bash
# Backend
cd backend
npm run env:dev

# Check environment
node -e "console.log(process.env.DASHSCOPE_API_KEY)"
```

---

## Dependencies

### Backend Dependencies

```bash
cd backend
yarn add ws @types/ws
```

**Package.json updates:**

```json
{
  "dependencies": {
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/ws": "^8.5.13"
  }
}
```

### Frontend Dependencies

No new dependencies required - uses built-in Web Audio API and WebSocket.

### Electron Dependencies

No new dependencies required - uses built-in WebSocket support.

---

## Security Considerations

### 1. API Key Protection

- ✅ API key stored in `.env` file (not committed to git)
- ✅ `.env` file added to `.gitignore`
- ✅ Environment variables validated at startup

**Never commit:**

```bash
# ❌ Bad - exposed API key
export DASHSCOPE_API_KEY=sk-a91f5c165b7e4e8db89727181ca30a59

# ✅ Good - load from .env
import { getEnv } from '@liratek/core';
const apiKey = getEnv().DASHSCOPE_API_KEY;
```

### 2. WebSocket Security

- Use WSS (WebSocket Secure) in production
- Validate incoming messages
- Implement rate limiting
- Add authentication tokens

```typescript
// Example: Add authentication to WebSocket
const ws = new WebSocket(url);
ws.on("open", () => {
  ws.send(
    JSON.stringify({
      type: "authenticate",
      token: process.env.VOICE_BOT_SECRET,
    }),
  );
});
```

### 3. Audio Data Privacy

- Audio data processed in-memory only
- No audio data stored on disk
- Transient WebSocket connections
- Clear buffers after processing

```typescript
// Clear audio buffer after sending
let audioBuffer: Buffer[] = [];

function sendAndClear(data: Buffer): void {
  sendToQwenASR(data);
  audioBuffer = []; // Clear immediately
}
```

### 4. Error Handling

- Never expose sensitive error details to frontend
- Log errors server-side only
- Return generic error messages to clients

```typescript
// ❌ Bad - exposes internal details
return { error: error.message };

// ✅ Good - generic message
return { error: "Failed to process audio" };
```

### 5. Rate Limiting

Add rate limiting to voice API endpoints:

```typescript
import { rateLimit } from "express-rate-limit";

const voiceLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 10, // 10 requests per minute
  message: "Too many voice requests. Please try again later.",
});

app.use("/api/voice", voiceLimiter);
```

---

## Cost Analysis

### Qwen-ASR Pricing (as of March 2026)

#### Alibaba Cloud DashScope Pricing

| Model                    | Price per 1M characters | Free tier       |
| ------------------------ | ----------------------- | --------------- |
| qwen3-asr-flash-realtime | $0.024 / 1M chars       | 100 hours/month |
| qwen3-asr-pro-realtime   | $0.048 / 1M chars       | 50 hours/month  |

#### Cost Estimation

**Assumptions:**

- Average transcription: 10 seconds = ~15 words = ~75 characters
- Daily active users: 50
- Average session: 5 minutes = 300 seconds = 450 words = ~2,250 characters
- Daily transcription volume: 50 users × 2,250 chars = 112,500 characters/day
- Monthly transcription volume: 112,500 × 30 = 3,375,000 characters/month

**Cost Calculation:**

```
Flash model (recommended):
- Monthly volume: 3,375,000 characters
- Free tier: 100 hours/month (≈ 5,400,000 characters @ 15 wpm)
- Cost: $0 (within free tier)

Pro model:
- Monthly volume: 3,375,000 characters
- Free tier: 50 hours/month (≈ 2,700,000 characters)
- Excess: 3,375,000 - 2,700,000 = 675,000 characters
- Cost: (675,000 / 1,000,000) × $0.048 = $0.0324/month
```

#### Cost Optimization Strategies

1. **Use Flash model** - 50% cheaper than Pro, sufficient for English
2. **Enable free tier** - 100 hours/month covers ~50 active users
3. **Cache common commands** - Reduce transcription for known phrases
4. **Use Web Speech API fallback** - Free for browser-based recognition

```typescript
// Fallback to Web Speech API for free transcription
async function transcribeWithFallback(audio: Blob): Promise<string> {
  try {
    // Try Qwen-ASR first
    return await transcribeWithQwen(audio);
  } catch (error) {
    // Fallback to Web Speech API (free)
    console.warn("Qwen-ASR failed, using Web Speech API");
    return await transcribeWithWebSpeech(audio);
  }
}
```

#### Monthly Cost Summary

| Scenario                    | Model | Users | Cost/month     |
| --------------------------- | ----- | ----- | -------------- |
| Low volume (<10 users)      | Flash | 10    | $0 (free tier) |
| Medium volume (10-50 users) | Flash | 50    | $0 (free tier) |
| High volume (50-100 users)  | Flash | 100   | $0.50-1.00     |
| High volume + Pro           | Pro   | 100   | $1.00-2.00     |

**Recommendation:** Start with Flash model in free tier. Upgrade to Pro only if accuracy requirements demand it.

---

## Implementation Timeline

### Phase 2: Backend Qwen-ASR Integration

- [ ] Create `VoiceTranscriptionService.ts` (2 hours)
- [ ] Create `voiceRoutes.ts` (1 hour)
- [ ] Update `server.ts` (30 minutes)
- [ ] Update `.env.example` (15 minutes)
- [ ] Update `env.ts` (30 minutes)
- **Total: 5 hours**

### Phase 3: Frontend Audio Capture

- [ ] Create `AudioCaptureService.ts` (3 hours)
- [ ] Update `useVoiceBot.ts` (2 hours)
- [ ] Update `VoiceBotButton.tsx` (1 hour)
- **Total: 6 hours**

### Phase 4: Electron IPC Handlers

- [ ] Update `voiceBotHandlers.ts` (2 hours)
- [ ] Update `preload.ts` (30 minutes)
- **Total: 2.5 hours**

### Phase 5: Testing & Optimization

- [ ] Unit tests (2 hours)
- [ ] Integration tests (2 hours)
- [ ] E2E tests (2 hours)
- [ ] Performance optimization (2 hours)
- **Total: 8 hours**

### Phase 6: Deployment

- [ ] Pre-deployment checklist (1 hour)
- [ ] Backend deployment (30 minutes)
- [ ] Frontend deployment (30 minutes)
- [ ] Electron build (1 hour)
- **Total: 3 hours**

### Estimated Total Time: **24.5 hours** (~3-4 days)

---

## Troubleshooting

### Common Issues

#### 1. WebSocket Connection Failed

**Error:** `WebSocket connection failed: Error in connection establishment`

**Solutions:**

- Verify API key is correct
- Check firewall allows outbound WSS connections
- Ensure Qwen-ASR service is available in your region
- Try different region (singapore → us-west-1)

#### 2. Audio Format Not Supported

**Error:** `Unsupported audio format`

**Solutions:**

- Convert WebM to PCM16, 16kHz before sending
- Use correct sample rate: 16000 Hz
- Use correct bit depth: 16-bit
- Use correct channels: 1 (mono)

```typescript
// Correct audio format conversion
async function convertToQwenFormat(blob: Blob): Promise<Uint8Array> {
  const arrayBuffer = await blob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  const channelData = audioBuffer.getChannelData(0);
  const pcmBuffer = new ArrayBuffer(audioBuffer.length * 2);
  const pcmView = new DataView(pcmBuffer);

  for (let i = 0; i < audioBuffer.length; i++) {
    const int16Value = Math.max(-1, Math.min(1, channelData[i])) * 0x7fff;
    pcmView.setInt16(i * 2, int16Value, true);
  }

  return new Uint8Array(pcmBuffer);
}
```

#### 3. Transcription Accuracy Low

**Solutions:**

- Use Pro model instead of Flash
- Improve microphone quality
- Reduce background noise
- Speak clearly and at normal pace
- Use language-specific models

#### 4. High Latency

**Solutions:**

- Reduce chunk size (50ms instead of 100ms)
- Send chunks more frequently
- Use WebSocket compression
- Optimize network connection

---

## References

- [Qwen-ASR Documentation](https://dashscope.aliyun.com/docs)
- [Alibaba Cloud Console](https://dashscope.console.aliyun.com)
- [WebSocket API](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [MediaRecorder API](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder)

---

**Document Version:** 1.0  
**Last Updated:** March 11, 2026  
**Author:** LiraTek Development Team
