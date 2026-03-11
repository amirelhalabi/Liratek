import { Mic, MicOff, X, Send } from "lucide-react";
import { useVoiceBot } from "@/hooks/useVoiceBot";
import { useActiveModule } from "@/contexts/ActiveModuleContext";
import { useState, useEffect } from "react";

interface VoiceBotButtonProps {
  position?: "bottom-right" | "bottom-left" | "top-right" | "top-left";
}

// Suggestion hints per module
const MODULE_SUGGESTIONS: Record<string, string[]> = {
  omt_whish: [
    "Send $5 to Amir 81077357",
    "Receive $10 from John 81234567",
    "Check balance",
  ],
  recharge: ["Recharge 81077357 $5", "Recharge $10 for 81234567"],
  pos: [
    "Add iPhone 2",
    "Add 2 Coca Cola",
    "Remove iPhone",
    "Complete sale",
    "Discount $10",
  ],
  debts: ["Add debt for Amir 81077357 $50", "Record payment from Amir $30"],
};

export function VoiceBotButton({
  position = "bottom-right",
}: VoiceBotButtonProps) {
  const { activeModule } = useActiveModule();
  const {
    listening,
    transcript,
    error,
    result,
    startListening,
    stopListening,
    reset,
  } = useVoiceBot();
  const [showPanel, setShowPanel] = useState(false);
  const [inputValue, setInputValue] = useState("");
  const [isProcessing, setIsProcessing] = useState(false);

  const positionClasses = {
    "bottom-right": "bottom-6 right-6",
    "bottom-left": "bottom-6 left-6",
    "top-right": "top-6 right-6",
    "top-left": "top-6 left-6",
  };

  const suggestions = activeModule
    ? MODULE_SUGGESTIONS[activeModule] || []
    : [];

  // Auto-start listening when panel opens
  useEffect(() => {
    if (showPanel && !listening) {
      startListening();
    }
    return () => {
      if (listening) {
        stopListening();
      }
    };
  }, [showPanel]);

  // Update input value when transcript changes
  useEffect(() => {
    if (transcript) {
      setInputValue(transcript);
    }
  }, [transcript]);

  const handleSuggestionClick = (suggestion: string) => {
    setInputValue(suggestion);
    handleSubmitText(suggestion);
  };

  const handleSubmitText = async (directInput?: string) => {
    const textToProcess = directInput || inputValue;

    if (!textToProcess.trim() || !activeModule) {
      console.error("[VoiceBot] Missing input or module:", {
        textToProcess,
        activeModule,
      });
      return;
    }

    // Stop listening when submitting
    if (listening) {
      stopListening();
    }

    setIsProcessing(true);
    try {
      console.log(
        "[VoiceBot] Parsing command:",
        textToProcess,
        "for module:",
        activeModule,
      );

      // Parse command
      const parseResult = await window.api.voicebot.parse(
        textToProcess,
        activeModule,
      );

      console.log("[VoiceBot] Parse result:", parseResult);

      if (!parseResult.success) {
        console.error("[VoiceBot] Parse failed:", parseResult.error);
        reset();
        return;
      }

      // Execute command
      if (!parseResult.command) {
        console.error("[VoiceBot] No command in parse result");
        return;
      }

      console.log("[VoiceBot] Executing command:", parseResult.command);

      const executeResult = await window.api.voicebot.execute(
        parseResult.command,
      );

      console.log("[VoiceBot] Execute result:", executeResult);

      if (executeResult.success) {
        // Dispatch event for modules to listen to
        const event = new CustomEvent("voicebot:command", {
          detail: {
            command: parseResult.command,
            entities: executeResult.entities,
            message: executeResult.message,
          },
        });
        console.log("[VoiceBot] Dispatching event:", event);
        window.dispatchEvent(event);

        // Show success feedback and close
        setInputValue("");
        setShowPanel(false);
        reset();
      } else {
        console.error("[VoiceBot] Execute failed:", executeResult.error);
      }
    } catch (err) {
      console.error("[VoiceBot] Command error:", err);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleClose = () => {
    if (listening) {
      stopListening();
    }
    reset();
    setShowPanel(false);
    setInputValue("");
  };

  const handleOpenPanel = () => {
    setShowPanel(true);
    setInputValue("");
    reset();
  };

  return (
    <>
      {/* Voice Bot Button */}
      <button
        onClick={handleOpenPanel}
        disabled={listening}
        className={`fixed ${positionClasses[position]} z-50 p-4 rounded-full shadow-2xl transition-all duration-300 ${
          listening
            ? "bg-red-600 hover:bg-red-700 animate-pulse scale-110"
            : "bg-violet-600 hover:bg-violet-700 hover:scale-105"
        } text-white`}
        title="Voice commands"
      >
        {listening ? <MicOff size={24} /> : <Mic size={24} />}
      </button>

      {/* Voice Bot Panel - Always shows text input with live transcription */}
      {showPanel && (
        <div
          className={`fixed ${positionClasses[position]} z-40 mb-24 w-80 bg-slate-900 border border-slate-700 rounded-xl shadow-2xl overflow-hidden`}
        >
          {/* Header */}
          <div className="flex items-center justify-between p-3 bg-slate-800 border-b border-slate-700">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  listening ? "bg-red-500 animate-pulse" : "bg-slate-500"
                }`}
              />
              <span className="text-sm font-medium text-white">
                {listening ? "Listening... Speak now" : "Voice Command"}
              </span>
            </div>
            <button
              onClick={handleClose}
              className="p-1 text-slate-400 hover:text-white hover:bg-slate-700 rounded"
            >
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-3 max-h-96 overflow-y-auto">
            {/* Text Input with Live Transcription */}
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-violet-400 mb-2">
                <Mic size={16} className={listening ? "animate-pulse" : ""} />
                <p className="text-xs font-medium">
                  {listening ? "Speaking..." : "Command"}:
                </p>
              </div>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isProcessing) {
                      handleSubmitText();
                    }
                  }}
                  placeholder={
                    listening ? "Speak or type command..." : "Type command..."
                  }
                  className="flex-1 bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
                  disabled={isProcessing}
                />
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleSubmitText();
                  }}
                  disabled={isProcessing || !inputValue.trim()}
                  className="bg-violet-600 hover:bg-violet-700 disabled:bg-slate-700 text-white p-2 rounded-lg transition-colors"
                >
                  <Send size={18} />
                </button>
              </div>
              {listening && (
                <p className="text-xs text-slate-500">
                  🎤 Speak your command, then click Send or press Enter
                </p>
              )}
            </div>

            {/* Suggestion Hints */}
            {!result && !error && suggestions.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-slate-700">
                <p className="text-xs font-medium text-slate-400">
                  Suggestions:
                </p>
                {suggestions.map((suggestion, index) => (
                  <button
                    key={index}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSuggestionClick(suggestion);
                    }}
                    className="w-full text-left bg-violet-900/30 border border-violet-700 hover:bg-violet-800/40 rounded-lg p-2 transition-colors"
                  >
                    <p className="text-violet-200 text-xs italic">
                      "{suggestion}"
                    </p>
                  </button>
                ))}
              </div>
            )}

            {/* Result */}
            {result && (
              <div className="bg-emerald-900/30 border border-emerald-700 rounded-lg p-3">
                <p className="text-emerald-400 text-sm">{result}</p>
              </div>
            )}

            {/* Error */}
            {error && (
              <div className="bg-red-900/30 border border-red-700 rounded-lg p-3">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* Listening indicator when no transcript yet */}
            {listening && !transcript && !inputValue && (
              <div className="text-center py-4">
                <div className="inline-flex items-center gap-2 text-slate-400">
                  <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" />
                  <div
                    className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                    style={{ animationDelay: "0.1s" }}
                  />
                  <div
                    className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                    style={{ animationDelay: "0.2s" }}
                  />
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Listening for your voice...
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
