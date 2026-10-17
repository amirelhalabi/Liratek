/**
 * WhatsApp Cloud API Service
 *
 * Sends messages via the Meta WhatsApp Cloud API.
 * Requires two settings stored in system_settings:
 *   - whatsapp_api_key: The access token from Meta Developer dashboard
 *   - whatsapp_phone_number_id: The Phone Number ID (sender) from Meta dashboard
 */

import { getSettingsRepository } from "../repositories/index.js";
import { toWhatsAppNumber } from "../utils/whatsappPhone.js";

export interface WhatsAppResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

export class WhatsAppService {
  private get accessToken(): string {
    const repo = getSettingsRepository();
    return repo.getSettingValue("whatsapp_api_key") || "";
  }

  private get phoneNumberId(): string {
    const repo = getSettingsRepository();
    return repo.getSettingValue("whatsapp_phone_number_id") || "";
  }

  /**
   * Send a text message via WhatsApp Cloud API
   */
  async sendMessage(
    recipientPhone: string,
    message: string,
  ): Promise<WhatsAppResult> {
    const token = this.accessToken;
    const phoneId = this.phoneNumberId;

    if (!token) {
      return {
        success: false,
        error:
          "WhatsApp API access token not configured. Set it in Settings > Integrations.",
      };
    }
    if (!phoneId) {
      return {
        success: false,
        error:
          "WhatsApp Phone Number ID not configured. Set it in Settings > Integrations.",
      };
    }

    // LIRA-333 (FR-015): the one shared phone rule; refuse before any call.
    const phone = toWhatsAppNumber(recipientPhone);
    if (!phone.ok) return { success: false, error: "Invalid phone number" };
    const formattedPhone = phone.digits;
    const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          recipient_type: "individual",
          to: formattedPhone,
          type: "text",
          text: { body: message },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMsg =
          data?.error?.message ||
          data?.error?.error_data?.details ||
          `HTTP ${response.status}`;
        return { success: false, error: errorMsg };
      }

      const messageId = data?.messages?.[0]?.id || undefined;
      return { success: true, messageId };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Network error: ${msg}` };
    }
  }

  /**
   * Send a template message via WhatsApp Cloud API.
   * Templates are required for business-initiated conversations
   * (i.e. when the recipient hasn't messaged you in the last 24 hours).
   */
  async sendTemplate(
    recipientPhone: string,
    templateName: string,
    languageCode: string = "en_US",
  ): Promise<WhatsAppResult> {
    const token = this.accessToken;
    const phoneId = this.phoneNumberId;

    if (!token) {
      return {
        success: false,
        error:
          "WhatsApp API access token not configured. Set it in Settings > Integrations.",
      };
    }
    if (!phoneId) {
      return {
        success: false,
        error:
          "WhatsApp Phone Number ID not configured. Set it in Settings > Integrations.",
      };
    }

    // LIRA-333 (FR-015): the one shared phone rule; refuse before any call.
    const phone = toWhatsAppNumber(recipientPhone);
    if (!phone.ok) return { success: false, error: "Invalid phone number" };
    const formattedPhone = phone.digits;
    const url = `https://graph.facebook.com/v21.0/${phoneId}/messages`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: formattedPhone,
          type: "template",
          template: {
            name: templateName,
            language: { code: languageCode },
          },
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMsg =
          data?.error?.message ||
          data?.error?.error_data?.details ||
          `HTTP ${response.status}`;
        return { success: false, error: errorMsg };
      }

      const messageId = data?.messages?.[0]?.id || undefined;
      return { success: true, messageId };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, error: `Network error: ${msg}` };
    }
  }

  /**
   * Send a test message using Meta's built-in "hello_world" template.
   * This template is pre-approved on all WhatsApp Business accounts,
   * so it works even when the recipient hasn't messaged you first.
   */
  async sendTestMessage(
    recipientPhone: string,
    _shopName: string,
  ): Promise<WhatsAppResult> {
    return this.sendTemplate(recipientPhone, "hello_world", "en_US");
  }
}

// Singleton
let instance: WhatsAppService | null = null;

export function getWhatsAppService(): WhatsAppService {
  if (!instance) instance = new WhatsAppService();
  return instance;
}

export function resetWhatsAppService(): void {
  instance = null;
}
