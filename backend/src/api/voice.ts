import { Router } from "express";
import { Server } from "http";
import { WebSocketServer, WebSocket } from "ws";
import { voiceTranscriptionService } from "../services/VoiceTranscriptionService.js";

const router = Router();
let wss: WebSocketServer | null = null;

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
    const { audioData, format = "base64" } = req.body;

    if (!audioData) {
      res.status(400).json({ error: "audioData is required" });
      return;
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

// Initialize WebSocket server for real-time streaming
export function initVoiceWebSocketServer(httpServer: Server): WebSocketServer {
  wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    if (request.url?.startsWith("/api/voice/ws")) {
      wss?.handleUpgrade(request, socket, head, (ws) => {
        wss?.emit("connection", ws, request);
      });
    }
  });

  wss.on("connection", (ws) => {
    console.warn("[VoiceBot] Client connected to voice WebSocket");

    let isListening = false;

    ws.on("message", async (data) => {
      try {
        const message = JSON.parse(data.toString());

        switch (message.type) {
          case "start":
            await voiceTranscriptionService.startListening();
            isListening = true;
            ws.send(JSON.stringify({ type: "started", success: true }));
            break;

          case "stop":
            await voiceTranscriptionService.stopListening();
            isListening = false;
            ws.send(JSON.stringify({ type: "stopped", success: true }));
            break;

          case "audio":
            if (isListening) {
              const buffer = Buffer.from(message.audio, "base64");
              await voiceTranscriptionService.sendAudio(buffer);
              ws.send(JSON.stringify({ type: "audio_sent", success: true }));
            }
            break;

          case "commit":
            if (isListening) {
              await voiceTranscriptionService.commitAudio();
              ws.send(JSON.stringify({ type: "committed", success: true }));
            }
            break;
        }
      } catch (error) {
        console.error("[VoiceBot] Error handling message:", error);
        ws.send(JSON.stringify({ type: "error", error: "Internal error" }));
      }
    });

    ws.on("close", () => {
      console.warn("[VoiceBot] Client disconnected from voice WebSocket");
      if (isListening) {
        voiceTranscriptionService.stopListening();
      }
    });

    // Listen for transcription events from Qwen-ASR
    const unsubscribe = voiceTranscriptionService.on(
      "transcription",
      (result: any) => {
        if ((ws as any).readyState === (WebSocket as any).OPEN) {
          ws.send(
            JSON.stringify({
              type: "transcription",
              text: result.text,
              timestamp: result.timestamp,
            }),
          );
        }
      },
    );

    // Listen for session finished events
    const unsubscribeFinished = voiceTranscriptionService.on(
      "sessionFinished",
      (result: any) => {
        if ((ws as any).readyState === (WebSocket as any).OPEN) {
          ws.send(
            JSON.stringify({
              type: "session_finished",
              transcript: result.transcript,
            }),
          );
        }
      },
    );

    ws.on("close", () => {
      unsubscribe();
      unsubscribeFinished();
    });
  });

  return wss;
}

export default router;
