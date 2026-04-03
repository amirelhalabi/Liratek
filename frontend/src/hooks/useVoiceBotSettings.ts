import { useState, useEffect, useCallback } from "react";
import type { VoiceBotConfig } from "@/constants/voiceBot";
import { DEFAULT_VOICEBOT_CONFIG, STORAGE_KEYS } from "@/constants/voiceBot";

export function useVoiceBotSettings() {
  const [config, setConfig] = useState<VoiceBotConfig>(DEFAULT_VOICEBOT_CONFIG);
  const [isLoaded, setIsLoaded] = useState(false);

  // Load settings from localStorage on mount
  useEffect(() => {
    try {
      const enabled = localStorage.getItem(STORAGE_KEYS.ENABLED);

      setConfig({
        enabled:
          enabled !== null
            ? enabled === "true"
            : DEFAULT_VOICEBOT_CONFIG.enabled,
      });
    } catch (error) {
      console.error("Failed to load voice bot settings:", error);
      setConfig(DEFAULT_VOICEBOT_CONFIG);
    } finally {
      setIsLoaded(true);
    }
  }, []);

  // Listen for settings changes from ShopConfig
  useEffect(() => {
    const handleSettingsChange = () => {
      try {
        const enabled = localStorage.getItem(STORAGE_KEYS.ENABLED);
        setConfig({
          enabled:
            enabled !== null
              ? enabled === "true"
              : DEFAULT_VOICEBOT_CONFIG.enabled,
        });
      } catch (error) {
        console.error("Failed to reload voice bot settings:", error);
      }
    };

    window.addEventListener("voicebot-settings-changed", handleSettingsChange);
    return () =>
      window.removeEventListener(
        "voicebot-settings-changed",
        handleSettingsChange,
      );
  }, []);

  // Save enabled setting
  const setEnabled = useCallback((enabled: boolean) => {
    try {
      localStorage.setItem(STORAGE_KEYS.ENABLED, String(enabled));
      setConfig((prev) => ({ ...prev, enabled }));
    } catch (error) {
      console.error("Failed to save voice bot enabled setting:", error);
    }
  }, []);

  // Update config
  const updateConfig = useCallback((updates: Partial<VoiceBotConfig>) => {
    try {
      setConfig((prev) => {
        const newConfig = { ...prev, ...updates };
        localStorage.setItem(STORAGE_KEYS.CONFIG, JSON.stringify(newConfig));
        return newConfig;
      });
    } catch (error) {
      console.error("Failed to update voice bot config:", error);
    }
  }, []);

  return {
    config,
    isLoaded,
    setEnabled,
    updateConfig,
  };
}
