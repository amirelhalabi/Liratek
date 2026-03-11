/**
 * Hugging Face Whisper API Test
 *
 * Tests the Hugging Face Inference API with Whisper model
 * Run with: ts-node test-huggingface-connection.ts
 */

import { InferenceClient } from "@huggingface/inference";
import * as fs from "fs";
import * as path from "path";

const API_KEY = process.env.HUGGINGFACE_API_KEY;
const MODEL = process.env.HUGGINGFACE_MODEL || "openai/whisper-large-v3";

if (!API_KEY) {
  console.error(
    "❌ Error: HUGGINGFACE_API_KEY environment variable is not set",
  );
  console.error("Please set it in your .env file:");
  console.error("  HUGGINGFACE_API_KEY=hf_xxx");
  console.error("");
  console.error(
    "Get your API key from: https://huggingface.co/settings/tokens",
  );
  process.exit(1);
}

console.log("🎤 Hugging Face Whisper API Test");
console.log("================================");
console.log(`Model: ${MODEL}`);
console.log(`API Key: ${API_KEY.substring(0, 10)}...`);
console.log("");

// Test with a simple audio file if available, otherwise just test API connectivity
const client = new InferenceClient(API_KEY);

async function testAPI() {
  try {
    console.log("📡 Testing API connectivity...");

    // Try to find a test audio file
    const testAudioPath = path.join(__dirname, "test-audio.wav");
    let audioData: ArrayBuffer;

    if (fs.existsSync(testAudioPath)) {
      console.log(`🎵 Using test audio file: ${testAudioPath}`);
      const buffer = fs.readFileSync(testAudioPath);
      audioData = buffer.buffer.slice(
        buffer.byteOffset,
        buffer.byteOffset + buffer.byteLength,
      );
    } else {
      console.log("⚠️  No test audio file found, creating minimal audio data");
      // Create minimal audio data (silence)
      audioData = new ArrayBuffer(3200);
    }

    console.log("📤 Sending audio for transcription...");

    const output = await client.automaticSpeechRecognition({
      data: audioData,
      model: MODEL,
    });

    console.log("");
    console.log("📥 Response received:");
    console.log(JSON.stringify(output, null, 2));
    console.log("");

    if (output.text) {
      console.log("✅ Test successful!");
      console.log("");
      console.log("🎉 Your Hugging Face API key is working!");
      console.log("");
      console.log("Transcription:", output.text);
      console.log("");
      console.log("Next steps:");
      console.log("  1. API key is already configured in .env files");
      console.log("  2. Restart your application");
      console.log("  3. Test voice commands in the app");
    } else {
      console.log("⚠️  No transcription returned (this is normal for silence)");
      console.log("");
      console.log("✅ API connection successful!");
      console.log("");
      console.log("Next steps:");
      console.log("  1. API key is already configured in .env files");
      console.log("  2. Restart your application");
      console.log("  3. Test voice commands in the app");
    }
  } catch (error: any) {
    console.error("");
    console.error("❌ Test failed:", error.message);
    console.error("");

    if (error.message?.includes("loading")) {
      console.log("⏳ Model is loading (this is normal for first request)");
      console.log("   Please wait 20-30 seconds and try again");
      console.log("");
      console.log("✅ API connection successful!");
      console.log("   The model is warming up. Try again in a moment.");
    } else if (
      error.message?.includes("Authorization") ||
      error.message?.includes("401")
    ) {
      console.error("🔑 Authorization failed!");
      console.error("");
      console.error("API Key Issues:");
      console.error(
        "   1. Check that your API key is correct (starts with 'hf_')",
      );
      console.error("   2. Ensure no extra spaces in .env file");
      console.error("   3. Verify the token has 'Read' permissions");
      console.error("   4. Try regenerating the token");
      console.error("");
      console.error("Get a new token: https://huggingface.co/settings/tokens");
      process.exit(1);
    } else if (
      error.message?.includes("network") ||
      error.message?.includes("fetch")
    ) {
      console.error("🌐 Network error!");
      console.error("");
      console.error("Check your internet connection and firewall settings");
      process.exit(1);
    } else {
      console.error("💡 Error details:", error);
      process.exit(1);
    }
  }
}

testAPI().catch(console.error);
