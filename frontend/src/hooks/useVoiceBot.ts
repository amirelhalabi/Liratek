import { useCallback, useState, useEffect } from "react";
import { useActiveModule } from "@/contexts/ActiveModuleContext";
import {
  huggingFaceASRClient,
  type TranscriptionResult,
} from "@/services/HuggingFaceASRClient";
import { voiceBotLogger } from "@/utils/voiceBotLogger";

interface UseVoiceBotReturn {
  listening: boolean;
  transcript: string;
  error: string | null;
  result: string | null;
  startListening: () => Promise<void>;
  stopListening: () => Promise<void>;
  reset: () => void;
  audioLevel: number;
}

/**
 * Custom hook for managing voice bot state and interactions
 * Properly manages event listeners to prevent leaks
 */
export function useVoiceBot(): UseVoiceBotReturn {
  const { activeModule } = useActiveModule();
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  // Register event listeners for this component instance
  useEffect(() => {
    voiceBotLogger.debug("Registering event listeners");

    const unsubscribeTranscription = huggingFaceASRClient.on(
      "transcription",
      (result: unknown) => {
        const transcriptionResult = result as TranscriptionResult;
        voiceBotLogger.debug("Received transcription", {
          text: transcriptionResult.text,
        });
        setTranscript(transcriptionResult.text);
      },
    );

    const unsubscribeError = huggingFaceASRClient.on("error", (err) => {
      voiceBotLogger.error("ASR error received", err);
      setError(err instanceof Error ? err.message : String(err));
      setListening(false);
    });

    const unsubscribeStarted = huggingFaceASRClient.on("started", () => {
      voiceBotLogger.debug("ASR started");
      setAudioLevel(1);
    });

    const unsubscribeStopped = huggingFaceASRClient.on("stopped", () => {
      voiceBotLogger.debug("ASR stopped");
      setAudioLevel(0);
    });

    // Cleanup: unsubscribe all listeners on unmount
    return () => {
      voiceBotLogger.debug("Cleaning up event listeners");
      unsubscribeTranscription();
      unsubscribeError();
      unsubscribeStarted();
      unsubscribeStopped();
    };
  }, []);

  // Cleanup: stop listening on unmount
  useEffect(() => {
    return () => {
      if (listening) {
        voiceBotLogger.debug("Stopping listening on unmount");
        stopListening();
      }
    };
  }, [listening]);

  const startListening = useCallback(async () => {
    voiceBotLogger.info("Starting voice listening");
    setError(null);
    setResult(null);
    setTranscript("");
    setListening(true);

    try {
      await huggingFaceASRClient.connect();
      await huggingFaceASRClient.startListening();
      voiceBotLogger.info("Voice listening started successfully");
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Failed to start voice recognition";
      voiceBotLogger.error("Failed to start listening", error);
      setError(errorMessage);
      setListening(false);
    }
  }, [activeModule]);

  const stopListening = useCallback(async () => {
    voiceBotLogger.debug("Stopping voice listening");
    setListening(false);
    setAudioLevel(0);

    try {
      await huggingFaceASRClient.stopListening();
      voiceBotLogger.debug("Voice listening stopped");
    } catch (error) {
      voiceBotLogger.error("Failed to stop listening", error);
      throw error;
    }
  }, []);

  const reset = useCallback(() => {
    voiceBotLogger.debug("Resetting voice bot state");
    setTranscript("");
    setError(null);
    setResult(null);
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
