import { useState, useCallback, useRef, useEffect } from "react";
import { useActiveModule } from "@/contexts/ActiveModuleContext";
import logger from "@/utils/logger";
import { audioCaptureService } from "@/services/AudioCaptureService";
import { qwenASRClient } from "@/services/QwenASRClient";

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

  const recognitionRef = useRef<any>(null);

  const initRecognition = useCallback(() => {
    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setError("Speech recognition is not supported in this browser");
      return null;
    }

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

      let errorMessage = "Speech recognition error: ";
      switch (event.error) {
        case "network":
          errorMessage +=
            "Network error. Voice recognition requires an internet connection. Please check your connection and try again.";
          break;
        case "not-allowed":
          errorMessage +=
            "Permission denied. Please allow microphone access in your browser settings.";
          break;
        case "no-speech":
          errorMessage += "No speech detected. Please try speaking again.";
          break;
        case "audio-capture":
          errorMessage +=
            "No microphone found. Please connect a microphone and try again.";
          break;
        case "aborted":
          errorMessage += "Recognition was cancelled.";
          break;
        default:
          errorMessage += event.error;
      }

      setError(errorMessage);
      setListening(false);
    };

    recognitionInstance.onend = () => {
      setListening(false);
    };

    return recognitionInstance;
  }, []);

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

  const startListening = useCallback(async () => {
    if (!activeModule) {
      setError("No active module. Please navigate to a module first.");
      return;
    }

    setError(null);
    setResult(null);
    setTranscript("");
    setListening(true);

    // Try Qwen-ASR first
    try {
      await qwenASRClient.connect();
      await qwenASRClient.startListening();

      audioCaptureService.onChunk(async (chunk: Uint8Array) => {
        try {
          await qwenASRClient.sendAudio(chunk);
        } catch (err) {
          console.error("[VoiceBot] Failed to send audio:", err);
        }
      });

      audioCaptureService.onStatus((status) => {
        if (status === "recording") {
          setAudioLevel(1);
        } else if (status === "stopped") {
          setAudioLevel(0);
        }
      });

      qwenASRClient.on("transcription", (result: any) => {
        setTranscript(result.text);
      });

      qwenASRClient.on("error", (err: Error) => {
        console.error("[VoiceBot] Qwen-ASR error:", err);
        setError(err.message);
        setListening(false);
      });

      await audioCaptureService.startRecording();
    } catch (qwenError) {
      console.warn(
        "[VoiceBot] Qwen-ASR failed, falling back to Web Speech API:",
        qwenError,
      );

      const recognitionInstance = recognitionRef.current || initRecognition();
      if (!recognitionInstance) {
        setListening(false);
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
        setListening(false);
      }
    }
  }, [activeModule, initRecognition]);

  const stopListening = useCallback(async () => {
    setListening(false);
    setAudioLevel(0);

    try {
      await qwenASRClient.stopListening();
      await qwenASRClient.disconnect();
    } catch (err) {
      console.error("[VoiceBot] Failed to stop Qwen-ASR:", err);
    }

    try {
      await audioCaptureService.stopRecording();
    } catch (err) {
      console.error("[VoiceBot] Failed to stop audio capture:", err);
    }
  }, []);

  const reset = useCallback(() => {
    setTranscript("");
    setError(null);
    setResult(null);
  }, []);

  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

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
