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

export default router;
