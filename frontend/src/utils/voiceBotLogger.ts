import logger from "./logger";

/**
 * Voice Bot specific logger with controlled log levels
 */
export const voiceBotLogger = {
  info: (message: string, data?: any) => {
    logger.info(`[VoiceBot] ${message}`, data);
  },

  warn: (message: string, data?: any) => {
    logger.warn(`[VoiceBot] ${message}`, data);
  },

  error: (message: string, error?: any) => {
    logger.error(`[VoiceBot] ${message}`, error);
  },

  debug: (message: string, data?: any) => {
    if (process.env.NODE_ENV === "development") {
      logger.debug(`[VoiceBot] ${message}`, data);
    }
  },
};
