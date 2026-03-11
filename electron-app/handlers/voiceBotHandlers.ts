import { ipcMain, BrowserWindow } from "electron";
import { getVoiceBotService } from "@liratek/core";
import WebSocket from "ws";

let qwenWs: WebSocket | null = null;
let activeTranscriptionWindow: BrowserWindow | null = null;

export function registerVoiceBotHandlers() {
  const voiceBotService = getVoiceBotService();
  // Parse voice command text
  ipcMain.handle(
    "voicebot:parse",
    async (_event, text: string, currentModule: string) => {
      try {
        const command = voiceBotService.parseCommand(text, currentModule);

        if (!command) {
          return {
            success: false,
            error: "No matching command found. Please try a different phrase.",
          };
        }

        // Validate command
        const validation = voiceBotService.validateCommand(command);
        if (!validation.valid) {
          return {
            success: false,
            error: `Missing required information: ${validation.missing?.join(", ")}`,
            command,
          };
        }

        return {
          success: true,
          command,
        };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  // Execute voice command
  ipcMain.handle("voicebot:execute", async (_event, command: any) => {
    try {
      switch (command.module) {
        case "omt_whish":
          return executeOmtWhish(command);
        case "recharge":
          return executeRecharge(command);
        case "pos":
          return executePos(command);
        case "debts":
          return executeDebts(command);
        default:
          return {
            success: false,
            error: `Unknown module: ${command.module}`,
          };
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  registerQwenASRHandlers();
}

/**
 * Execute OMT/WHISH command
 */
async function executeOmtWhish(command: any): Promise<{
  success: boolean;
  message?: string;
  error?: string;
  entities?: any;
}> {
  const { action, entities } = command;

  if (action === "check_balance") {
    return {
      success: true,
      message: "Balance check not yet implemented via voice",
    };
  }

  if (action === "send") {
    // For SEND: need amount and receiver phone
    if (!entities?.amount || !entities?.receiverPhone) {
      return {
        success: false,
        error: "Missing amount or receiver phone number",
      };
    }

    return {
      success: true,
      message: `Ready to send $${entities.amount} to ${entities.receiverName || entities.receiverPhone}`,
      entities,
    };
  }

  if (action === "receive") {
    // For RECEIVE: need amount and sender phone
    if (!entities?.amount || !entities?.senderPhone) {
      return {
        success: false,
        error: "Missing amount or sender phone number",
      };
    }

    return {
      success: true,
      message: `Ready to receive $${entities.amount} from ${entities.senderName || entities.senderPhone}`,
      entities,
    };
  }

  return {
    success: false,
    error: `Unknown action: ${action}`,
  };
}

/**
 * Execute Recharge command
 */
async function executeRecharge(command: any): Promise<{
  success: boolean;
  message?: string;
  error?: string;
  entities?: any;
}> {
  const { entities } = command;

  if (!entities?.phone || !entities?.amount) {
    return {
      success: false,
      error: "Missing phone number or amount",
    };
  }

  return {
    success: true,
    message: `Ready to recharge $${entities.amount} for ${entities.phone}`,
    entities,
  };
}

/**
 * Execute POS command
 */
async function executePos(command: any): Promise<{
  success: boolean;
  message?: string;
  error?: string;
  entities?: any;
}> {
  const { action, entities } = command;

  switch (action) {
    case "add_product":
      if (!entities?.product) {
        return { success: false, error: "Missing product name" };
      }
      return {
        success: true,
        message: `Adding ${entities.quantity || 1}x ${entities.product}`,
        entities,
      };

    case "remove_product":
      if (!entities?.product) {
        return { success: false, error: "Missing product name" };
      }
      return {
        success: true,
        message: `Removing ${entities.product}`,
        entities,
      };

    case "complete_sale":
      return {
        success: true,
        message: "Completing sale",
      };

    case "apply_discount":
      if (!entities?.amount) {
        return { success: false, error: "Missing discount amount" };
      }
      return {
        success: true,
        message: `Applying $${entities.amount} discount`,
        entities,
      };

    default:
      return { success: false, error: `Unknown action: ${action}` };
  }
}

function registerQwenASRHandlers() {
  ipcMain.handle("voicebot:qwen:connect", async (_event, windowId: number) => {
    try {
      activeTranscriptionWindow = BrowserWindow.fromId(windowId);

      if (qwenWs && qwenWs.readyState === WebSocket.OPEN) {
        return { success: true, message: "Already connected" };
      }

      const apiKey = process.env.DASHSCOPE_API_KEY;
      if (!apiKey) {
        throw new Error("DASHSCOPE_API_KEY not configured");
      }

      const url = `wss://dashscope-intl.aliyuncs.com/api/v1/services/aigc/multimodal-asr/service?api-key=${apiKey}&model=qwen3-asr-flash-realtime&region=singapore`;

      qwenWs = new WebSocket(url);

      qwenWs.on("open", () => {
        console.log("[VoiceBot] Qwen-ASR connected");
        qwenWs?.send(
          JSON.stringify({
            type: "start_listening",
            language: process.env.QWEN_ASR_LANGUAGE || "en",
          }),
        );
      });

      qwenWs.on("message", (data: WebSocket.Data) => {
        handleQwenMessage(data);
      });

      qwenWs.on("error", (error) => {
        console.error("[VoiceBot] Qwen-ASR error:", error);
        broadcastTranscriptionError(error.message);
      });

      qwenWs.on("close", (code, reason) => {
        console.log("[VoiceBot] Qwen-ASR closed:", code, reason?.toString());
        qwenWs = null;
      });

      return { success: true, message: "Connected to Qwen-ASR" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle("voicebot:qwen:disconnect", async () => {
    try {
      if (qwenWs) {
        qwenWs.close(1000, "Client disconnecting");
        qwenWs = null;
      }
      return { success: true, message: "Disconnected" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  ipcMain.handle(
    "voicebot:qwen:send-audio",
    async (_event, audioData: string, format: string = "base64") => {
      try {
        if (!qwenWs || qwenWs.readyState !== WebSocket.OPEN) {
          throw new Error("Not connected to Qwen-ASR");
        }

        qwenWs.send(
          JSON.stringify({
            type: "audio_data",
            audio_data: audioData,
            format: "pcm",
            sample_rate: 16000,
            channels: 1,
            bit_depth: 16,
          }),
        );

        return { success: true };
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  );

  ipcMain.handle("voicebot:qwen:stop", async () => {
    try {
      if (!qwenWs || qwenWs.readyState !== WebSocket.OPEN) {
        throw new Error("Not connected to Qwen-ASR");
      }

      qwenWs.send(
        JSON.stringify({
          type: "stop_listening",
        }),
      );

      return { success: true, message: "Listening stopped" };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function handleQwenMessage(data: WebSocket.Data) {
  try {
    const message = JSON.parse(data.toString());

    if (message.type === "transcription_result" && activeTranscriptionWindow) {
      activeTranscriptionWindow.webContents.send("voicebot:transcription", {
        text: message.text,
        confidence: message.confidence || 0.95,
        isFinal: message.is_final || false,
      });
    } else if (message.type === "error") {
      broadcastTranscriptionError(message.message);
    }
  } catch (error) {
    console.error("[VoiceBot] Failed to parse Qwen message:", error);
  }
}

function broadcastTranscriptionError(errorMessage: string) {
  if (activeTranscriptionWindow) {
    activeTranscriptionWindow.webContents.send("voicebot:transcription-error", {
      error: errorMessage,
    });
  }
}

/**
 * Execute Debts command
 */
async function executeDebts(command: any): Promise<{
  success: boolean;
  message?: string;
  error?: string;
  entities?: any;
}> {
  const { action, entities } = command;

  if (action === "add_debt") {
    if (!entities?.name || !entities?.amount) {
      return {
        success: false,
        error: "Missing name or amount",
      };
    }
    return {
      success: true,
      message: `Adding debt of $${entities.amount} for ${entities.name}${entities.phone ? ` (${entities.phone})` : ""}`,
      entities,
    };
  }

  if (action === "record_payment") {
    if (!entities?.name || !entities?.amount) {
      return {
        success: false,
        error: "Missing name or amount",
      };
    }
    return {
      success: true,
      message: `Recording payment of $${entities.amount} from ${entities.name}`,
      entities,
    };
  }

  return { success: false, error: `Unknown action: ${action}` };
}
