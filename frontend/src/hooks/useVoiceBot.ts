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

const isSpeechSupported =
  typeof window !== "undefined" &&
  ("webkitSpeechRecognition" in window || "SpeechRecognition" in window);

export function useVoiceBot(): UseVoiceBotReturn {
  const { activeModule } = useActiveModule();
  const [listening, setListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const recognitionRef = useRef<any>(null);

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

    try {
      await connectToQwenASR(setTranscript, wsRef);
      await audioCaptureService.startRecording();
      setListening(true);
      setError(null);
      setResult(null);
      setTranscript("");

      audioCaptureService.onChunk(async (chunk: Uint8Array) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const base64Audio = Buffer.from(chunk).toString("base64");
          wsRef.current.send(
            JSON.stringify({
              type: "audio_data",
              audio_data: base64Audio,
            }),
          );
        }
      });

      audioCaptureService.onStatus((status) => {
        if (status === "error") {
          setError("Audio capture error. Please check microphone permissions.");
          setListening(false);
        } else if (status === "recording") {
          setAudioLevel(1);
        } else if (status === "stopped") {
          setAudioLevel(0);
        }
      });
    } catch (qwenError) {
      console.warn(
        "[VoiceBot] Qwen-ASR failed, falling back to Web Speech API:",
        qwenError,
      );

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

  const stopListening = useCallback(async () => {
    if (wsRef.current) {
      wsRef.current.send(JSON.stringify({ type: "stop_listening" }));
      wsRef.current.close();
      wsRef.current = null;
    }

    await audioCaptureService.stopRecording();
    setListening(false);
    setAudioLevel(0);
  }, []);

  const reset = useCallback(() => {
    setTranscript("");
    setError(null);
    setResult(null);
  }, []);

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

async function connectToQwenASR(
  setTranscript: (text: string) => void,
  wsRef: React.MutableRefObject<WebSocket | null>,
): Promise<void> {
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
