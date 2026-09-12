import express from "express";
import { getWhatsAppService } from "@liratek/core";
import { authenticateJWT } from "../middleware/auth.js";
import { logger } from "../server.js";

const router = express.Router();

// All WhatsApp routes require a signed-in tenant user — WhatsAppService reads
// tenant-scoped settings (whatsapp_api_key / whatsapp_phone_number_id), so
// authenticateJWT is mandatory to establish tenant context regardless.
//
// No requireRole beyond that: the IPC twins (electron-app/handlers/
// whatsappHandlers.ts, `whatsapp:send-test` / `whatsapp:send-message`) impose
// no role check of their own — any live desktop session can call them. Both
// tenant roles already use this feature (Settings > Integrations, admin-only
// UI, calls send-test; ClientForm, admin+staff, calls send-message), so
// mirroring the handler here means staying open to any authenticated role
// rather than inventing a restriction the desktop side never had (rule 19).
router.use(authenticateJWT);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

// POST /api/whatsapp/send-test
//
// Mirrors `whatsapp:send-test` exactly: same service, same two args
// (recipientPhone, shopName — see backendApi.ts sendWhatsAppTestMessage),
// same envelope. `sendTestMessage` (WhatsAppService) already returns
// { success, messageId?, error? } without throwing on a HANDLED failure
// (missing credentials, a Meta API rejection, a network error) — that result
// is forwarded as-is with the default HTTP 200 (rule 19c), never remapped to
// a 4xx/5xx. requestJson (frontend/src/api/httpClient.ts) THROWS on any
// non-2xx, which would route a legitimate "API key not configured" message
// into IntegrationsConfig's generic catch block instead of the real error
// text the user needs to fix their settings.
router.post("/send-test", async (req, res): Promise<void> => {
  const { recipientPhone, shopName } = (req.body ?? {}) as {
    recipientPhone?: unknown;
    shopName?: unknown;
  };

  if (!isNonEmptyString(recipientPhone) || !isNonEmptyString(shopName)) {
    res.status(200).json({
      success: false,
      error: "recipientPhone and shopName are required",
    });
    return;
  }

  try {
    const result = await getWhatsAppService().sendTestMessage(
      recipientPhone,
      shopName,
    );
    if (!result.success) {
      logger.warn({ error: result.error }, "WhatsApp test message failed");
    } else {
      logger.info(
        { messageId: result.messageId },
        "WhatsApp test message sent",
      );
    }
    res.json(result);
  } catch (error) {
    // Defensive only: WhatsAppService.sendTemplate/sendMessage already catch
    // their own fetch/network errors internally and resolve to
    // { success: false, error }, never throw. A throw here means something
    // outside that contract broke — a real bug, not a handled API failure —
    // so this is the one path that legitimately answers a non-2xx status.
    logger.error({ error }, "WhatsApp send-test threw unexpectedly");
    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to send WhatsApp test message",
    });
  }
});

// POST /api/whatsapp/send-message
//
// Mirrors `whatsapp:send-message` exactly: same service, same two args
// (recipientPhone, message — see backendApi.ts sendWhatsAppMessage), same
// envelope. See the send-test handler above for why a handled failure is
// forwarded as HTTP 200.
router.post("/send-message", async (req, res): Promise<void> => {
  const { recipientPhone, message } = (req.body ?? {}) as {
    recipientPhone?: unknown;
    message?: unknown;
  };

  if (!isNonEmptyString(recipientPhone) || !isNonEmptyString(message)) {
    res.status(200).json({
      success: false,
      error: "recipientPhone and message are required",
    });
    return;
  }

  try {
    const result = await getWhatsAppService().sendMessage(
      recipientPhone,
      message,
    );
    if (!result.success) {
      logger.warn({ error: result.error }, "WhatsApp message failed");
    }
    res.json(result);
  } catch (error) {
    // See the send-test handler above — defensive only.
    logger.error({ error }, "WhatsApp send-message threw unexpectedly");
    res.status(500).json({
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to send WhatsApp message",
    });
  }
});

export default router;
