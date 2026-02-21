/**
 * WhatsApp IPC Handlers
 *
 * Thin wrapper over WhatsAppService for IPC communication.
 */

import { ipcMain } from "electron";
import { getWhatsAppService, logger } from "@liratek/core";

export function registerWhatsAppHandlers(): void {
  const whatsappService = getWhatsAppService();

  // Send a test message
  ipcMain.handle(
    "whatsapp:send-test",
    async (_event, data: { recipientPhone: string; shopName: string }) => {
      logger.info(
        { recipientPhone: data.recipientPhone },
        "Sending WhatsApp test message",
      );
      const result = await whatsappService.sendTestMessage(
        data.recipientPhone,
        data.shopName,
      );
      if (!result.success) {
        logger.warn({ error: result.error }, "WhatsApp test message failed");
      } else {
        logger.info(
          { messageId: result.messageId },
          "WhatsApp test message sent",
        );
      }
      return result;
    },
  );

  // Send a custom message
  ipcMain.handle(
    "whatsapp:send-message",
    async (_event, data: { recipientPhone: string; message: string }) => {
      logger.info(
        { recipientPhone: data.recipientPhone },
        "Sending WhatsApp message",
      );
      return whatsappService.sendMessage(data.recipientPhone, data.message);
    },
  );
}
