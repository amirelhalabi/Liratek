import { ipcMain, BrowserWindow } from "electron";
import { getVoiceBotService, type VoiceCommand } from "@liratek/core";
import WebSocket from "ws";
import type {
  ParseResult,
  ExecuteResult,
  OmtWhishExecuteResult,
  RechargeExecuteResult,
  PosExecuteResult,
  DebtsExecuteResult,
  NavigationExecuteResult,
} from "./voiceBotTypes.js";

const isDev = process.env.NODE_ENV === "development" || !process.env.NODE_ENV;

const voiceBotLogger = {
  info: (msg: string, data?: unknown) => {
    if (isDev) console.log(`[VoiceBot] ${msg}`, data || "");
  },
  warn: (msg: string, data?: unknown) => {
    if (isDev) console.warn(`[VoiceBot] ${msg}`, data || "");
  },
  error: (msg: string, err?: unknown) => {
    console.error(`[VoiceBot] ${msg}`, err || "");
  },
  debug: (msg: string, data?: unknown) => {
    if (isDev) console.log(`[VoiceBot] ${msg}`, data || "");
  },
};

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
  ipcMain.handle("voicebot:execute", async (_event, command: VoiceCommand) => {
    try {
      switch (command.module) {
        case "navigation":
          return executeNavigation(command);
        case "omt_whish":
          return executeOmtWhish(command);
        case "recharge":
          return executeRecharge(command);
        case "pos":
          return executePos(command);
        case "debts":
          return executeDebts(command);
        case "profits":
          return {
            success: true,
            message: "Profits filter applied",
            filters: command.entities,
          };
        case "expenses":
          return {
            success: true,
            message: "Expenses filter applied",
            filters: command.entities,
          };
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

  /**
   * Execute navigation command
   */
  async function executeNavigation(
    command: VoiceCommand,
  ): Promise<NavigationExecuteResult> {
    const { action, entities } = command;

    if (action === "navigate") {
      const filters: any = {};
      if (entities.fromDate) filters.fromDate = entities.fromDate;
      if (entities.toDate) filters.toDate = entities.toDate;
      if (entities.status) filters.status = entities.status;

      // Return route info for frontend to handle navigation
      return {
        success: true,
        message: `Navigating to ${entities.targetPage}`,
        route: entities.targetPage,
        filters,
      };
    }

    return {
      success: false,
      error: "Unknown navigation action",
    };
  }

  registerQwenASRHandlers();
}

/**
 * Execute OMT/WHISH command
 */
async function executeOmtWhish(
  command: VoiceCommand,
): Promise<OmtWhishExecuteResult> {
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
      entities: {
        amount: entities.amount,
        receiverPhone: entities.receiverPhone,
        receiverName: entities.receiverName,
      },
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
      entities: {
        amount: entities.amount,
        senderPhone: entities.senderPhone,
        senderName: entities.senderName,
      },
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
async function executeRecharge(
  command: VoiceCommand,
): Promise<RechargeExecuteResult> {
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
    entities: {
      phone: entities.phone,
      amount: entities.amount,
    },
  };
}

/**
 * Execute POS command
 */
async function executePos(command: VoiceCommand): Promise<PosExecuteResult> {
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
        return {
          success: true,
          message: "Already connected",
          readyState: qwenWs.readyState,
        };
      }

      const apiKey = process.env.DASHSCOPE_API_KEY;
      if (!apiKey) {
        throw new Error(
          "DASHSCOPE_API_KEY not configured. Please set it in your .env file.",
        );
      }

      const model = process.env.QWEN_ASR_MODEL || "qwen3-asr-flash-realtime";
      const url = `wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime?model=${model}`;

      console.log("[VoiceBot] Connecting to Qwen-ASR:", url);

      qwenWs = new WebSocket(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "OpenAI-Beta": "realtime=v1",
        },
      });

      return await new Promise((resolve, reject) => {
        const connectionTimeout = setTimeout(() => {
          qwenWs?.terminate();
          qwenWs = null;
          reject(new Error("Connection timeout after 10 seconds"));
        }, 10000);

        qwenWs?.once("open", () => {
          clearTimeout(connectionTimeout);
          console.log("[VoiceBot] Qwen-ASR connected");

          setTimeout(() => {
            sendSessionUpdate();
          }, 500);

          resolve({
            success: true,
            message: "Connected to Qwen-ASR",
            readyState: qwenWs?.readyState,
          });
        });

        qwenWs?.once("error", (error) => {
          clearTimeout(connectionTimeout);
          console.error("[VoiceBot] Connection error:", error.message);
          qwenWs = null;
          reject(error);
        });
      });
    } catch (error) {
      console.error("[VoiceBot] Connection error:", error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  function sendSessionUpdate() {
    if (!qwenWs || qwenWs.readyState !== WebSocket.OPEN) return;

    console.log("[VoiceBot] Sending session update");
    qwenWs.send(
      JSON.stringify({
        event_id: `event_${Date.now()}`,
        type: "session.update",
        session: {
          modalities: ["text"],
          input_audio_format: "pcm",
          sample_rate: 16000,
          input_audio_transcription: {
            language: process.env.QWEN_ASR_LANGUAGE || "en",
            corpus: {
              text: `
                LiraTek POS System
                Modules: pos, recharge, omt_whish, debts
                Commands: check balance, send, receive, recharge, add product, remove product, complete sale, apply discount, add debt, record payment
                Common terms: liratek, omt, whish, recharge, debt, payment, product, service, dollar, dollars
              `,
            },
          },
          turn_detection: {
            type: "server_vad",
            threshold: 0.2,
            silence_duration_ms: 800,
          },
        },
      }),
    );
  }

  ipcMain.handle("voicebot:qwen:disconnect", async () => {
    try {
      if (qwenWs) {
        console.log("[VoiceBot] Disconnecting from Qwen-ASR");

        qwenWs.send(
          JSON.stringify({
            event_id: `event_${Date.now()}`,
            type: "session.finish",
          }),
        );

        setTimeout(() => {
          if (qwenWs && qwenWs.readyState === WebSocket.OPEN) {
            qwenWs.close(1000, "Client disconnecting");
          }
          qwenWs = null;
          activeTranscriptionWindow = null;
        }, 1000);

        return { success: true, message: "Disconnecting" };
      }
      return { success: true, message: "Not connected" };
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
          return {
            success: false,
            error: "Not connected to Qwen-ASR. Please connect first.",
          };
        }

        qwenWs.send(
          JSON.stringify({
            event_id: `event_${Date.now()}`,
            type: "input_audio_buffer.append",
            audio: audioData,
          }),
        );

        return { success: true };
      } catch (error) {
        console.error("[VoiceBot] Send audio error:", error);
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
        return {
          success: false,
          error: "Not connected to Qwen-ASR",
        };
      }

      console.log("[VoiceBot] Stopping listening");
      qwenWs.send(
        JSON.stringify({
          event_id: `event_${Date.now()}`,
          type: "session.finish",
        }),
      );

      return { success: true, message: "Listening stopped" };
    } catch (error) {
      console.error("[VoiceBot] Stop error:", error);
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

    console.log("[VoiceBot] Received message:", message.type);

    switch (message.type) {
      case "session.created":
        console.log("[VoiceBot] Session created:", message.session?.id);
        if (activeTranscriptionWindow) {
          activeTranscriptionWindow.webContents.send(
            "voicebot:session-created",
            {
              sessionId: message.session?.id,
            },
          );
        }
        break;

      case "session.updated":
        console.log("[VoiceBot] Session updated");
        if (activeTranscriptionWindow) {
          activeTranscriptionWindow.webContents.send(
            "voicebot:session-updated",
            {
              success: true,
            },
          );
        }
        break;

      case "input_audio_buffer.committed":
        console.log("[VoiceBot] Audio committed");
        break;

      case "input_audio_buffer.speech_started":
        console.log("[VoiceBot] Speech started");
        if (activeTranscriptionWindow) {
          activeTranscriptionWindow.webContents.send(
            "voicebot:speech-started",
            {
              isListening: true,
            },
          );
        }
        break;

      case "input_audio_buffer.speech_stopped":
        console.log("[VoiceBot] Speech stopped");
        if (activeTranscriptionWindow) {
          activeTranscriptionWindow.webContents.send(
            "voicebot:speech-stopped",
            {
              isListening: false,
            },
          );
        }
        break;

      case "conversation.item.input_audio_transcription.completed":
        console.log("[VoiceBot] Transcription completed:", message.transcript);
        if (activeTranscriptionWindow) {
          activeTranscriptionWindow.webContents.send("voicebot:transcription", {
            text: message.transcript,
            language: message.language || "en",
            confidence: message.confidence || 0.95,
            isFinal: true,
            timestamp: new Date().toISOString(),
          });
        }
        break;

      case "session.finished":
        console.log("[VoiceBot] Session finished:", message.transcript || "");
        if (activeTranscriptionWindow) {
          activeTranscriptionWindow.webContents.send("voicebot:transcription", {
            text: message.transcript || "",
            language: message.language || "en",
            confidence: 0.95,
            isFinal: true,
            timestamp: new Date().toISOString(),
          });
          activeTranscriptionWindow.webContents.send(
            "voicebot:session-finished",
            {
              transcript: message.transcript || "",
              success: true,
            },
          );
        }
        break;

      case "error":
        console.error("[VoiceBot] ASR error:", message.error);
        broadcastTranscriptionError(
          message.error?.message || "Unknown ASR error",
        );
        break;

      default:
        console.log("[VoiceBot] Unhandled message type:", message.type);
    }
  } catch (error) {
    console.error("[VoiceBot] Failed to parse Qwen message:", error);
    broadcastTranscriptionError("Failed to process server response");
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
async function executeDebts(
  command: VoiceCommand,
): Promise<DebtsExecuteResult> {
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
