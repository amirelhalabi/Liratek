import { Mic, X, Send, Square, Sparkles, Bot, Info } from "lucide-react";
import { useVoiceBot } from "@/hooks/useVoiceBot";
import { useActiveModule } from "@/contexts/ActiveModuleContext";
import { useState, useEffect, useRef } from "react";
import { appEvents } from "@liratek/ui";
import { voiceBotLogger } from "@/utils/voiceBotLogger";
import { VoiceBotTips } from "./VoiceBotTips";
import { MODULE_SUGGESTIONS } from "@/constants/voiceBot";

export function VoiceBotButton() {
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
  const [currentSuggestionIndex, setCurrentSuggestionIndex] = useState(0);
  const [showTips, setShowTips] = useState(false);
  const tipsButtonRef = useRef<HTMLButtonElement>(null);

  const suggestions = activeModule
    ? MODULE_SUGGESTIONS[activeModule] || []
    : [];

  // Cleanup on unmount - don't auto-start
  useEffect(() => {
    return () => {
      if (listening) {
        stopListening();
      }
    };
  }, [listening, stopListening]);

  useEffect(() => {
    if (transcript) {
      voiceBotLogger.debug("Setting input from transcript", { transcript });
      setInputValue(transcript);
    }
  }, [transcript]);

  // Auto-rotate suggestions every 3 seconds
  useEffect(() => {
    if (suggestions.length > 1 && !listening && !inputValue) {
      const interval = setInterval(() => {
        setCurrentSuggestionIndex((prev) => (prev + 1) % suggestions.length);
      }, 3000);
      return () => clearInterval(interval);
    }
  }, [suggestions.length, listening, inputValue]);

  const handleSuggestionClick = (suggestion: string) => {
    setInputValue(suggestion);
    setTimeout(() => {
      handleSubmitText(suggestion);
    }, 50);
  };

  const handleExampleClick = (example: string) => {
    setInputValue(example);
    setShowTips(false);
  };

  const handleSubmitText = async (directInput?: string) => {
    const textToProcess = directInput || inputValue;

    if (!textToProcess.trim()) {
      voiceBotLogger.warn("Empty text submitted");
      return;
    }

    // Allow navigation commands from any page, only require module for actions
    const isNavigationCommand = textToProcess
      .toLowerCase()
      .match(
        /\b(go\s+to|goto|open|show|navigate\s+to|switch\s+to|change\s+to|take\s+me\s+to)\b/i,
      );

    voiceBotLogger.debug("Navigation command check", {
      isNavigationCommand,
      text: textToProcess,
    });

    if (!activeModule && !isNavigationCommand) {
      voiceBotLogger.error("No active module");
      appEvents.emit(
        "notification:show",
        "Please navigate to a module first (Services, Recharge, POS, or Debts) to use voice commands.",
        "warning",
      );
      return;
    }

    if (listening) {
      voiceBotLogger.debug("Stopping listening before submit");
      stopListening();
    }

    setIsProcessing(true);
    try {
      voiceBotLogger.debug("Parsing command", {
        text: textToProcess,
        module: activeModule || "",
      });
      const parseResult = await window.api.voicebot.parse(
        textToProcess,
        activeModule || "",
      );

      voiceBotLogger.debug("Parse result", parseResult);

      if (!parseResult.success) {
        voiceBotLogger.warn("Parse failed", parseResult.error);
        appEvents.emit(
          "notification:show",
          parseResult.error || "Failed to parse command",
          "warning",
        );
        return;
      }

      if (!parseResult.command) {
        voiceBotLogger.error("No command returned from parse");
        appEvents.emit(
          "notification:show",
          "No command detected. Please try again.",
          "error",
        );
        return;
      }

      voiceBotLogger.debug("Executing command", parseResult.command);
      const executeResult = await window.api.voicebot.execute(
        parseResult.command,
      );

      voiceBotLogger.debug("Execute result", executeResult);

      if (executeResult.success) {
        voiceBotLogger.info("Command executed successfully");

        // Handle navigation commands specially
        if (
          parseResult.command.module === "navigation" &&
          executeResult.route
        ) {
          window.location.hash = executeResult.route;
        } else {
          // Dispatch event for module-specific commands
          const event = new CustomEvent("voicebot:command", {
            detail: {
              command: parseResult.command,
              entities: executeResult.entities,
              message: executeResult.message,
            },
          });
          window.dispatchEvent(event);
        }

        setInputValue("");
        setShowPanel(false);
        reset();
      } else {
        voiceBotLogger.error("Execute failed", executeResult.error);
        appEvents.emit(
          "notification:show",
          executeResult.error || "Command execution failed",
          "error",
        );
      }
    } catch (err) {
      voiceBotLogger.error("Command failed", err);
      appEvents.emit(
        "notification:show",
        err instanceof Error ? err.message : "Command failed",
        "error",
      );
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
    if (showPanel) {
      handleClose();
    } else {
      setShowPanel(true);
      setInputValue("");
      reset();
    }
  };

  const handleStopListening = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await stopListening();
  };

  return (
    <>
      {/* Floating Action Button */}
      <button
        onClick={handleOpenPanel}
        className="fixed bottom-6 right-6 z-50 p-4 rounded-full shadow-2xl transition-all duration-300 bg-gradient-to-br from-violet-600 to-purple-700 hover:from-violet-700 hover:to-purple-800 hover:scale-105 text-white"
        title="Voice assistant"
      >
        <div className="relative">
          <Bot size={24} />
          <div className="absolute -top-1 -right-1">
            <Sparkles size={14} className="text-yellow-300" />
          </div>
        </div>
      </button>

      {/* Voice Bot Panel - ChatGPT Style */}
      {showPanel && (
        <div className="fixed bottom-6 right-6 z-40 mb-15 w-[22rem] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-2xl overflow-hidden transition-all duration-300">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 relative">
            <div className="flex items-center gap-2">
              <div className="relative">
                <div
                  className={`w-2 h-2 rounded-full ${
                    listening ? "bg-red-500" : "bg-slate-400"
                  }`}
                />
                {listening && (
                  <div className="absolute inset-0 w-2 h-2 bg-red-500 rounded-full animate-ping opacity-75" />
                )}
              </div>
              <span className="text-sm font-medium text-slate-700 dark:text-slate-200">
                {listening ? "Listening..." : "Voice Assistant"}
              </span>
            </div>
            <div className="flex items-center gap-1.5 relative z-10">
              {listening && (
                <button
                  onClick={handleStopListening}
                  className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all text-slate-600 dark:text-slate-400"
                  title="Stop recording"
                >
                  <Square size={14} className="fill-current" />
                </button>
              )}
              <button
                ref={tipsButtonRef}
                onClick={() => setShowTips(true)}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all text-slate-600 dark:text-slate-400"
                title="Voice commands help"
              >
                <Info size={16} />
              </button>
              {showTips && (
                <VoiceBotTips
                  isOpen={showTips}
                  onClose={() => setShowTips(false)}
                  onExampleClick={handleExampleClick}
                  anchorRef={tipsButtonRef}
                  activeModule={activeModule}
                />
              )}
              <button
                onClick={handleClose}
                className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-all text-slate-600 dark:text-slate-400"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Content Area */}
          <div className="flex flex-col h-[28rem]">
            {/* Scrollable Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 flex flex-col">
              {/* Welcome/Status Message */}
              {listening && !transcript && !inputValue && (
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center flex-shrink-0">
                    <Mic size={16} className="text-white animate-pulse" />
                  </div>
                  <div className="flex-1">
                    <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl rounded-tl-sm px-4 py-3 inline-block">
                      <p className="text-sm text-slate-700 dark:text-slate-300">
                        I'm listening... Go ahead and speak!
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Result Message */}
              {result && (
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-500 to-green-600 flex items-center justify-center flex-shrink-0">
                    <Sparkles size={16} className="text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="bg-slate-100 dark:bg-slate-800 rounded-2xl rounded-tl-sm px-4 py-3">
                      <p className="text-sm text-slate-700 dark:text-slate-300">
                        {result}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Error Message */}
              {error && (
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-red-500 to-rose-600 flex items-center justify-center flex-shrink-0">
                    <X size={16} className="text-white" />
                  </div>
                  <div className="flex-1">
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-2xl rounded-tl-sm px-4 py-3">
                      <p className="text-sm text-red-700 dark:text-red-400">
                        {error}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Single Suggestion with Carousel Animation - Bottom of Messages Area */}
              {!result && !error && suggestions.length > 0 && !listening && (
                <div className="mt-auto pt-3">
                  <div className="relative overflow-hidden">
                    <div
                      className="flex transition-transform duration-500 ease-in-out"
                      style={{
                        transform: `translateX(-${currentSuggestionIndex * 100}%)`,
                      }}
                    >
                      {suggestions.map((suggestion, index) => (
                        <button
                          key={index}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleSuggestionClick(suggestion);
                          }}
                          className="w-full flex-shrink-0 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 hover:border-violet-300 dark:hover:border-violet-600 rounded-lg p-2 transition-all group"
                        >
                          <p className="text-xs text-slate-700 dark:text-slate-300 group-hover:text-violet-600 dark:group-hover:text-violet-400 text-left">
                            {suggestion}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Fixed Input Area at Bottom */}
            <div className="border-t border-slate-200 dark:border-slate-700 p-4 bg-white dark:bg-slate-900">
              <div className="flex items-end gap-2">
                <div className="flex-1 relative">
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
                      listening ? "Speak now..." : "Type your command..."
                    }
                    className="w-full bg-slate-100 dark:bg-slate-800 border-0 rounded-2xl px-4 py-3 text-sm text-slate-800 dark:text-slate-200 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-violet-500 dark:focus:ring-violet-600 transition-all"
                    disabled={isProcessing || listening}
                  />
                </div>
                {/* Dynamic button: Mic → Stop → Send */}
                {listening ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleStopListening(e);
                    }}
                    className="p-3 bg-gradient-to-br from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white rounded-2xl transition-all shadow-lg hover:shadow-xl flex-shrink-0"
                    title="Stop recording"
                  >
                    <Square size={20} className="fill-white" />
                  </button>
                ) : inputValue.trim() ? (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      voiceBotLogger.debug("Send button clicked", {
                        inputValue,
                      });
                      handleSubmitText();
                    }}
                    disabled={isProcessing}
                    className="p-3 bg-gradient-to-br from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 disabled:from-slate-300 disabled:to-slate-400 text-white rounded-2xl transition-all shadow-lg hover:shadow-xl disabled:shadow-none flex-shrink-0"
                    title="Send command"
                  >
                    <Send size={20} />
                  </button>
                ) : (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      startListening();
                    }}
                    disabled={isProcessing}
                    className="p-3 bg-gradient-to-br from-violet-600 to-purple-600 hover:from-violet-700 hover:to-purple-700 disabled:from-slate-300 disabled:to-slate-400 text-white rounded-2xl transition-all shadow-lg hover:shadow-xl disabled:shadow-none flex-shrink-0"
                    title="Click to speak"
                  >
                    <Mic size={20} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
