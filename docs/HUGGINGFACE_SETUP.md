# Hugging Face API Setup for Voice Recognition 🎤

## Why Hugging Face?

Since DashScope (Alibaba Cloud) is not available internationally, we're using **Hugging Face Inference API** which:

- ✅ Works globally (no region restrictions)
- ✅ Free tier available (500 requests/hour)
- ✅ Easy to set up (just an API key)
- ✅ Uses Whisper-large-v3 (excellent accuracy)
- ✅ No WebSocket complexity (simple HTTPS API)

## Setup Steps

### 1. Get Your Hugging Face API Key

1. Visit: https://huggingface.co/settings/tokens
2. Sign in or create a free account
3. Click "New token"
4. Give it a name (e.g., "LiraTek Voice Bot")
5. Select role: **Read** (no write permissions needed)
6. Click "Generate token"
7. **Copy the token** (starts with `hf_`)

### 2. Add to Environment Variables

**Backend `.env` file:**

```env
# Hugging Face Inference API
HUGGINGFACE_API_KEY=hf_xxxxxxxxxxxxxxxxxxxxxxxxxx

# Optional: Change model (default: openai/whisper-large-v3)
HUGGINGFACE_MODEL=openai/whisper-large-v3
```

**Electron-app `.env` file:**

```env
# Hugging Face Inference API
HUGGINGFACE_API_KEY=hf_xxxxxxxxxxxxxxxxxxxxxxxxxx
```

### 3. Restart Your Application

```bash
# Stop the app
# Then restart
yarn dev
```

## How It Works

The Hugging Face implementation:

1. Buffers audio chunks (10 chunks = ~1 second)
2. Sends batch to Whisper API for transcription
3. Receives text transcription
4. Emits transcription event to frontend
5. Processes voice commands

**Audio Format:** Same as before (PCM16, 16kHz, mono)

## Testing

### Quick Test

```bash
cd backend
export HUGGINGFACE_API_KEY=hf_xxx
npx ts-node test-huggingface-connection.ts
```

### In App

1. Start the app
2. Click "Start Listening"
3. Speak: "Check balance" or "Send $10 to Amir 81077357"
4. Wait ~1-2 seconds for transcription
5. Command should be recognized and executed

## Configuration Options

### Change Model

You can use different Whisper models:

```env
# Best accuracy (default)
HUGGINGFACE_MODEL=openai/whisper-large-v3

# Faster, smaller
HUGGINGFACE_MODEL=openai/whisper-medium

# English only, fastest
HUGGINGFACE_MODEL=openai/whisper-tiny.en
```

### Adjust Buffer Size

In `VoiceTranscriptionService.huggingface.ts`, modify:

```typescript
if (!this.isProcessing && this.audioBuffer.length >= 10) {
  // Change 10 to buffer more/fewer chunks
  await this.processAudioBuffer();
}
```

**More chunks** = Better accuracy, more latency
**Fewer chunks** = Faster response, lower accuracy

## API Limits

### Free Tier

- **500 requests/hour**
- ~8-10 hours of voice usage per day
- Perfect for development and testing

### Pro Tier ($9/month)

- **10,000 requests/hour**
- ~160 hours of voice usage per day
- Recommended for production

## Troubleshooting

### "Model is loading" Error

**Cause:** Hugging Face loads models on-demand

**Solution:** Wait 20-30 seconds and try again. The model will stay loaded for subsequent requests.

### "Invalid API key" Error

**Solution:**

1. Check API key format (should start with `hf_`)
2. Ensure no extra spaces in .env file
3. Regenerate token if needed

### Slow Response Time

**Causes:**

1. Model loading (first request)
2. Network latency to Hugging Face servers
3. Large audio buffer

**Solutions:**

- Wait for model to load (first request is slow)
- Reduce buffer size from 10 to 5 chunks
- Use `whisper-medium` or `whisper-tiny.en` for faster inference

### "Rate limit exceeded"

**Solution:**

- Wait a few minutes
- Upgrade to Pro tier ($9/month)
- Implement request queuing

## Comparison: DashScope vs Hugging Face

| Feature          | DashScope                 | Hugging Face          |
| ---------------- | ------------------------- | --------------------- |
| **Availability** | China/Asia only           | Global ✅             |
| **Setup**        | Complex (region-specific) | Simple (API key) ✅   |
| **Free Tier**    | 100 hours/month           | 500 requests/hour ✅  |
| **Latency**      | 50-150ms (streaming)      | 1-2s (batch)          |
| **Accuracy**     | Excellent                 | Excellent ✅          |
| **Protocol**     | WebSocket                 | HTTPS                 |
| **Models**       | Qwen3-ASR                 | Whisper (multiple) ✅ |

## Migration from DashScope

The code has been updated to use Hugging Face by default. Simply:

1. Replace `DASHSCOPE_API_KEY` with `HUGGINGFACE_API_KEY` in .env
2. Restart the application
3. Done!

No code changes needed in the frontend or handlers.

## Next Steps

1. ✅ Get Hugging Face API key
2. ✅ Add to .env files
3. ✅ Test with sample voice command
4. ✅ Adjust buffer size if needed
5. ✅ Monitor usage and upgrade if needed

## Support

- **Hugging Face Docs:** https://huggingface.co/docs/api-inference
- **Whisper Model:** https://huggingface.co/openai/whisper-large-v3
- **API Status:** https://status.huggingface.co

---

**Status:** Ready to use
**Last Updated:** March 11, 2026
