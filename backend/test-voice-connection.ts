/**
 * Voice Bot Connection Test Utility
 *
 * This script tests the Qwen-ASR WebSocket connection
 * Run with: ts-node test-voice-connection.ts
 */

import WebSocket from "ws";
import * as fs from "fs";
import * as path from "path";

const API_KEY = process.env.DASHSCOPE_API_KEY;
const MODEL = process.env.QWEN_ASR_MODEL || "qwen3-asr-flash-realtime";
const LANGUAGE = process.env.QWEN_ASR_LANGUAGE || "en";

if (!API_KEY) {
  console.error("❌ Error: DASHSCOPE_API_KEY environment variable is not set");
  console.error("Please set it in your .env file:");
  console.error("  DASHSCOPE_API_KEY=sk-xxx");
  process.exit(1);
}

const URL = `wss://dashscope-intl.aliyuncs.com/api-ws/v1/realtime?model=${MODEL}`;

console.log("🎤 Qwen-ASR Connection Test");
console.log("==========================");
console.log(`Model: ${MODEL}`);
console.log(`Language: ${LANGUAGE}`);
console.log(`URL: ${URL}`);
console.log("");

const ws = new WebSocket(URL, {
  headers: {
    Authorization: `Bearer ${API_KEY}`,
    "OpenAI-Beta": "realtime=v1",
  },
});

ws.on("open", () => {
  console.log("✅ WebSocket connected");

  setTimeout(() => {
    console.log("📤 Sending session.update...");
    ws.send(
      JSON.stringify({
        event_id: "event_test_1",
        type: "session.update",
        session: {
          modalities: ["text"],
          input_audio_format: "pcm",
          sample_rate: 16000,
          input_audio_transcription: {
            language: LANGUAGE,
            corpus: {
              text: "LiraTek POS System, omt, whish, recharge, debt, payment",
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
  }, 500);
});

ws.on("message", (data) => {
  const message = JSON.parse(data.toString());
  console.log(`📥 Received: ${message.type}`);

  if (message.type === "session.created") {
    console.log(`   Session ID: ${message.session?.id}`);
  }

  if (message.type === "session.updated") {
    console.log("   Session configured successfully");
  }

  if (message.type === "error") {
    console.error(`   ❌ Error: ${message.error?.message}`);
  }
});

ws.on("error", (error) => {
  console.error(`❌ WebSocket error: ${error.message}`);

  if (error.message.includes("authentication")) {
    console.error("");
    console.error("🔑 Authentication failed!");
    console.error("Please check your DASHSCOPE_API_KEY:");
    console.error(
      "  1. Make sure it's copied correctly from https://dashscope.console.aliyun.com/apiKey",
    );
    console.error("  2. Ensure it's from the Singapore region (not Beijing)");
    console.error("  3. Check that it hasn't expired");
  }

  if (
    error.message.includes("ENOTFOUND") ||
    error.message.includes("ECONNREFUSED")
  ) {
    console.error("");
    console.error("🌐 Network connection failed!");
    console.error("Please check:");
    console.error("  1. Your internet connection");
    console.error("  2. Firewall/proxy settings");
    console.error("  3. Can you reach dashscope-intl.aliyuncs.com?");
  }

  process.exit(1);
});

ws.on("close", (code, reason) => {
  console.log(`🔌 Connection closed: ${code} ${reason ? `- ${reason}` : ""}`);

  if (code === 1000) {
    console.log("✅ Test completed successfully!");
  } else if (code !== 1000) {
    console.error(`❌ Abnormal close code: ${code}`);
    process.exit(1);
  }
});

setTimeout(() => {
  console.log("");
  console.log("📤 Sending session.finish...");
  ws.send(
    JSON.stringify({
      event_id: "event_test_finish",
      type: "session.finish",
    }),
  );

  setTimeout(() => {
    ws.close(1000, "Test completed");
  }, 1000);
}, 3000);
