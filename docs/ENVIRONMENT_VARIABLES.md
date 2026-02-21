# Environment Variables Guide

## Overview

LiraTek is a **monorepo** with multiple runnable projects. Each project has its own environment configuration tailored to its runtime needs.

---

## 🎯 Multi-Project Structure

```
liratek/
├── backend/              # Express REST API server
│   ├── .env.example      # Template with all options
│   ├── .env.dev          # Development defaults ✅ SAFE TO COMMIT
│   ├── .env.prod         # Production template ✅ SAFE TO COMMIT
│   └── .env              # Your local config (gitignored)
│
├── frontend/             # React web application (Vite)
│   ├── .env.example      # Template with all options
│   ├── .env.dev          # Development defaults ✅ SAFE TO COMMIT
│   ├── .env.prod         # Production template ✅ SAFE TO COMMIT
│   └── .env              # Your local config (gitignored)
│
├── electron-app/         # Desktop application (Electron)
│   ├── .env.example      # Template with all options
│   ├── .env.dev          # Development defaults ✅ SAFE TO COMMIT
│   ├── .env.prod         # Production template ✅ SAFE TO COMMIT
│   └── .env              # Your local config (gitignored)
│
└── packages/
    ├── core/             # Shared business logic (NO ENV NEEDED)
    └── ui/               # Shared UI components (NO ENV NEEDED)
```

### File Purposes

| File           | Purpose                                  | Committed? | Contains Secrets? |
| -------------- | ---------------------------------------- | ---------- | ----------------- |
| `.env.example` | Documentation of all available variables | ✅ Yes     | ❌ No             |
| `.env.dev`     | Safe development defaults                | ✅ Yes     | ❌ No             |
| `.env.prod`    | Production template (placeholders)       | ✅ Yes     | ❌ No             |
| `.env`         | Your actual config                       | ❌ No      | ⚠️ Maybe          |

---

## 🚀 Quick Start

### First Time Setup

```bash
# Setup all projects at once
cd backend && npm run env:setup
cd ../frontend && npm run env:setup
cd ../electron-app && npm run env:setup
```

This creates `.env` files from `.env.dev` if they don't exist.

### Switching Environments

```bash
# Switch to development
npm run env:dev

# Switch to production
npm run env:prod
```

### Manual Setup

```bash
# Copy the development defaults
cp backend/.env.dev backend/.env
cp frontend/.env.dev frontend/.env
cp electron-app/.env.dev electron-app/.env

# Or copy the examples and fill in values
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
cp electron-app/.env.example electron-app/.env
```

---

## 📋 Environment Variables by Project

### Backend (`backend/`)

The Express API server requires these variables:

| Variable         | Type                                              | Default                 | Required       | Description                    |
| ---------------- | ------------------------------------------------- | ----------------------- | -------------- | ------------------------------ |
| `NODE_ENV`       | `development` \| `production` \| `test`           | `development`           | No             | Runtime environment            |
| `PORT`           | `number`                                          | `3000`                  | No             | HTTP server port               |
| `HOST`           | `string`                                          | `0.0.0.0`               | No             | HTTP server host               |
| `CORS_ORIGIN`    | `string`                                          | `http://localhost:5173` | No             | Allowed CORS origin            |
| `JWT_SECRET`     | `string`                                          | -                       | **Production** | JWT signing key (min 32 chars) |
| `JWT_EXPIRES_IN` | `string`                                          | `7d`                    | No             | JWT token expiry time          |
| `DATABASE_PATH`  | `string`                                          | Auto-detected           | No             | SQLite database path           |
| `DATABASE_KEY`   | `string`                                          | -                       | **Production** | SQLCipher encryption key       |
| `LOG_LEVEL`      | `trace` \| `debug` \| `info` \| `warn` \| `error` | Auto                    | No             | Logging verbosity              |
| `LOG_DIR`        | `string`                                          | -                       | No             | Log file directory             |

**Example `backend/.env`:**

```bash
NODE_ENV=development
PORT=3000
HOST=0.0.0.0
CORS_ORIGIN=http://localhost:5173
JWT_SECRET=dev-secret-key-min-32-characters-long-please
JWT_EXPIRES_IN=7d
DATABASE_PATH=/Users/you/Documents/LiraTek/liratek.db
LOG_LEVEL=debug
```

### Frontend (`frontend/`)

The React web app uses Vite environment variables:

| Variable        | Type                       | Default                 | Required | Description          |
| --------------- | -------------------------- | ----------------------- | -------- | -------------------- |
| `VITE_API_URL`  | `string`                   | `http://localhost:3000` | No       | Backend API URL      |
| `VITE_WS_URL`   | `string`                   | `ws://localhost:3000`   | No       | WebSocket server URL |
| `VITE_APP_MODE` | `standalone` \| `electron` | `standalone`            | No       | Runtime mode         |
| `VITE_DEBUG`    | `boolean`                  | `false`                 | No       | Enable debug logging |

**Example `frontend/.env`:**

```bash
VITE_API_URL=http://localhost:3000
VITE_WS_URL=ws://localhost:3000
VITE_APP_MODE=standalone
VITE_DEBUG=true
```

**Important:** Vite requires variables to start with `VITE_` to be exposed to the browser.

### Electron App (`electron-app/`)

The desktop application uses Electron-specific variables:

| Variable                | Type                                              | Default       | Required       | Description              |
| ----------------------- | ------------------------------------------------- | ------------- | -------------- | ------------------------ |
| `NODE_ENV`              | `development` \| `production`                     | `development` | No             | Runtime environment      |
| `ELECTRON_RENDERER_URL` | `string`                                          | -             | Dev only       | Vite dev server URL      |
| `DATABASE_PATH`         | `string`                                          | Auto-detected | No             | SQLite database path     |
| `DATABASE_KEY`          | `string`                                          | -             | **Production** | SQLCipher encryption key |
| `LOG_LEVEL`             | `trace` \| `debug` \| `info` \| `warn` \| `error` | Auto          | No             | Logging verbosity        |

**Example `electron-app/.env`:**

```bash
NODE_ENV=development
ELECTRON_RENDERER_URL=http://localhost:5173
DATABASE_PATH=/Users/you/Library/Application Support/liratek/phone_shop.db
LOG_LEVEL=debug
```

---

## 🔒 Security Best Practices

### What to Commit

✅ **DO commit:**

- `.env.example` - Full documentation
- `.env.dev` - Safe development defaults (no secrets!)
- `.env.prod` - Production template with placeholders

❌ **NEVER commit:**

- `.env` - Your actual configuration
- `.env.local` - Local overrides
- Any file with real secrets (API keys, passwords, etc.)

### Protecting Secrets

**1. Use Strong Secrets in Production**

```bash
# Generate secure JWT secret (32+ characters)
openssl rand -base64 32

# Generate SQLCipher key (32+ characters)
openssl rand -hex 32
```

**2. Use Environment-Specific Files**

```bash
# Development: .env.dev (safe defaults)
JWT_SECRET=dev-secret-key-min-32-characters-long

# Production: .env.prod (placeholders)
JWT_SECRET=REPLACE_WITH_SECURE_SECRET_MIN_32_CHARS
```

**3. Never Log Secrets**
The logger automatically redacts `DATABASE_KEY`, `JWT_SECRET`, and other sensitive fields.

### Production Checklist

Before deploying to production:

- [ ] Set `NODE_ENV=production`
- [ ] Generate strong `JWT_SECRET` (32+ chars)
- [ ] Generate strong `DATABASE_KEY` (32+ chars)
- [ ] Set `LOG_LEVEL=info` or `warn`
- [ ] Configure `LOG_DIR` for persistent logs
- [ ] Set proper `CORS_ORIGIN`
- [ ] Verify `.env` is in `.gitignore`

---

## 🛠️ Validation & Type Safety

### Backend & Electron (Node.js)

Environment variables are validated using **Zod** in `packages/core/src/config/env.ts`:

```typescript
import { env, JWT_SECRET, PORT } from "@liratek/core";

// Type-safe access
const port: number = PORT; // Always a number, validated
const secret: string | undefined = JWT_SECRET; // May be undefined

// Environment checks
if (env.isDevelopment) {
  console.log("Running in development mode");
}
```

**Validation happens at startup:**

```bash
# Invalid PORT
PORT=abc npm start
# Error: Expected number, received nan

# Missing JWT_SECRET in production
NODE_ENV=production npm start
# Error: JWT_SECRET is required in production
```

### Frontend (Vite)

Vite environment variables are accessed via `import.meta.env`:

```typescript
import env from "./config/env";

// Type-safe access
const apiUrl: string = env.apiUrl; // http://localhost:3000
const debug: boolean = env.debug; // true in dev

// Environment checks
if (env.isDev) {
  console.log("Development mode");
}
```

---

## 🏗️ Advanced Configuration

### Database Path Resolution

The database path is resolved in this order:

1. **`DATABASE_PATH` environment variable** (highest priority)
2. **`db-path.txt` file** in project root
3. **Platform defaults:**
   - macOS: `~/Library/Application Support/liratek/phone_shop.db`
   - Windows: `%APPDATA%/liratek/phone_shop.db`
   - Linux: `~/.local/share/liratek/phone_shop.db`

> **Migration script**: `scripts/migrate.ts` uses a separate env var `LIRATEK_DB_PATH` (falls back to `db-path.txt` then platform default). Set this when running migrations from the CLI:
>
> ```bash
> LIRATEK_DB_PATH=/path/to/phone_shop.db yarn migrate up
> ```

### WhatsApp Cloud API

WhatsApp credentials are stored in the **database** (`system_settings` table), not in environment variables. Configure them via Settings > Integrations in the app UI:

| Setting Key                  | Description                             |
| ---------------------------- | --------------------------------------- |
| `whatsapp_api_key`           | Meta Cloud API access token             |
| `whatsapp_phone_number_id`   | Sender Phone Number ID from Meta dashboard |

**Example:**

```bash
# Option 1: Environment variable
export DATABASE_PATH=/custom/path/to/db.sqlite

# Option 2: db-path.txt file
echo "/custom/path/to/db.sqlite" > db-path.txt

# Option 3: Use platform default (nothing to do)
```

### Log Level Auto-Detection

If `LOG_LEVEL` is not set, it auto-detects based on `NODE_ENV`:

| NODE_ENV      | Default LOG_LEVEL |
| ------------- | ----------------- |
| `development` | `debug`           |
| `production`  | `info`            |
| `test`        | `warn`            |

### Multiple Environments

You can create custom environment files:

```bash
# Create staging environment
cp backend/.env.prod backend/.env.staging
# Edit backend/.env.staging...

# Load staging config
cp backend/.env.staging backend/.env
npm start
```

---

## 🐛 Troubleshooting

### Variables Not Loading

**Problem:** Environment variables aren't being read

**Solutions:**

```bash
# 1. Verify .env exists
ls -la backend/.env

# 2. Verify file format (no spaces around =)
# ❌ Wrong:
PORT = 3000
# ✅ Correct:
PORT=3000

# 3. Restart the application
# Changes to .env require restart
```

### Production Validation Errors

**Problem:** `"JWT_SECRET is required in production"`

**Solution:**

```bash
# Set a strong secret (32+ characters)
JWT_SECRET=$(openssl rand -base64 32)
echo "JWT_SECRET=$JWT_SECRET" >> backend/.env
```

**Problem:** `"DATABASE_KEY is required in production"`

**Solution:**

```bash
# Generate strong encryption key
DATABASE_KEY=$(openssl rand -hex 32)
echo "DATABASE_KEY=$DATABASE_KEY" >> backend/.env
```

### CORS Errors in Frontend

**Problem:** `"Access-Control-Allow-Origin" error`

**Solution:**

```bash
# Update backend CORS_ORIGIN to match frontend URL
# backend/.env
CORS_ORIGIN=http://localhost:5173

# Or for production
CORS_ORIGIN=https://your-domain.com
```

### Vite Variables Not Available

**Problem:** `import.meta.env.API_URL` is undefined

**Solution:**

```bash
# Vite requires VITE_ prefix
# ❌ Wrong:
API_URL=http://localhost:3000

# ✅ Correct:
VITE_API_URL=http://localhost:3000
```

---

## 📚 Related Documentation

- [Logging Guide](./LOGGING.md) - Structured logging configuration
- [Module Management](./MODULE_MANAGEMENT.md) - Adding/removing modules
- [README.md](../README.md) - Project overview and setup

---

## 🎓 Examples

### Development Setup

```bash
# Terminal 1: Backend
cd backend
npm run env:dev
npm run dev

# Terminal 2: Frontend
cd frontend
npm run env:dev
npm run dev

# Terminal 3: Electron (optional)
cd electron-app
npm run env:dev
npm run dev
```

### Production Deployment

```bash
# 1. Setup production environment
cp backend/.env.prod backend/.env
cp frontend/.env.prod frontend/.env

# 2. Fill in secrets
nano backend/.env
# Set JWT_SECRET, DATABASE_KEY, etc.

# 3. Build
npm run build

# 4. Start
npm start
```

### Docker Deployment

```bash
# Use .env.prod as template
docker run -d \
  -e NODE_ENV=production \
  -e JWT_SECRET="your-secret-here" \
  -e DATABASE_KEY="your-key-here" \
  -e PORT=3000 \
  liratek-backend
```

---

## 🔐 JWT Secret Security

JWT tokens are used for authentication in both Backend and Electron. The system enforces security:

- **No fallback secrets** — if `JWT_SECRET` is missing in production, the server refuses to start
- **Minimum 32 characters** — enforced by Zod validation
- **Auth middleware returns 500** — if JWT_SECRET is somehow unset at runtime

### Generate a Secure Secret

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# or
openssl rand -base64 32
```

---

## 🔧 Centralized Config (Zod)

All environment variables are validated at startup via `packages/core/src/config/env.ts`:

- **Type-safe** — TypeScript autocomplete for all variables
- **Fail-fast** — invalid/missing required vars crash immediately with clear error
- **Defaults documented** — sensible defaults for development
- **Transform/coerce** — e.g., `PORT` string is coerced to number

### Convenience Exports

```typescript
import {
  env,
  isDevelopment,
  isProduction,
  isTest,
  PORT,
  JWT_SECRET,
} from "@liratek/core";
```

---

**Last Updated:** 2026-02-15
