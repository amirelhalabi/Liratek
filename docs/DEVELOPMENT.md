# LiraTek Technical Documentation

Welcome to the technical guide for LiraTek. This document serves as the authoritative reference for development, architecture, and deployment.

---

## 🚀 Quick Start & Environment

### Prerequisites
- **Node.js**: v18.x or v20.x
- **Yarn**: v4.0.2 (`corepack enable`)
- **Git**
- **C++ Build Tools**: 
  - macOS: `xcode-select --install`
  - Windows: Visual Studio Build Tools ("Desktop development with C++")

### Setup & Development
```bash
# Install dependencies
yarn install

# Run in development mode (Vite + Electron)
npm run dev

# Run all tests
npm test

# Build for production
npm run build
```

---

## 🏗️ Architecture Overview

LiraTek is built using Electron with a strict separation between the backend (Main Process) and the UI (Renderer Process).

### Process Communication (IPC)
- **Main Process (Node.js)**: Manages SQLite database, file system, and system events. Defined in `electron/`.
- **Renderer Process (React)**: Modern UI with Tailwind CSS. Defined in `src/`.
- **IPC Bridge**: Secure communication via `preload.ts` using `contextBridge`.

### Key Directory Structure
```
electron/               # Main process logic
  ├── db/              # SQL schema and migration runner
  ├── handlers/         # IPC request management (13 modules)
  └── services/         # Core business logic (domain layer)
src/                   # Renderer process
  ├── features/          # Modular feature pages
  ├── shared/            # Reusable UI components and hooks
  └── contexts/          # Auth and Global state
packages/shared/       # Shared types, Zod schemas, and DTOs
```

---

## 🗄️ Database Schema

LiraTek uses **SQLite** for low-latency, localized data storage.

### Core Tables
- **`products`**: Inventory with barcode and IMEI tracking.
- **`sales` / `sale_items`**: Transaction records and snapshots.
- **`clients` / `debt_ledger`**: Customer profiling and dual-currency debt tracking.
- **`financial_services`**: OMT and Whish transaction logs.
- **`daily_closings`**: Multi-drawer (General, OMT, MTC, Alfa) end-of-day audits.
- **`activity_logs`**: Comprehensive JSON-based audit trail.

---

## 🛠️ Build & Release

### Build Commands
| Platform | Command | Output |
|----------|---------|--------|
| **Windows** | `npm run build:win:x64` | NSIS Installer (.exe) |
| **macOS (Intel)** | `npm run build:mac:x64` | DMG + ZIP |
| **macOS (ARM)** | `npm run build:mac:arm64` | DMG + ZIP |
| **All** | `npm run build:all` | All target installers |

### Icon Generation
If icons need refreshing, use **ImageMagick**:
```bash
magick convert build/icon.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico
```

---

## 🔒 Security & Patterns

### 1. Single Instance Lock
Ensures only one instance of LiraTek runs at a time to prevent database corruption. Implementation is in `electron/main.ts` via `app.requestSingleInstanceLock()`.

### 2. Transaction Management
Always use the `db.transaction()` wrapper for multi-table writes to ensure data integrity.

### 3. Role-Based Access
Operate under the principle of least privilege. IPC handlers for admin actions (like deleting records or changing settings) are gated with `requireRole(['admin'])`.

### 4. Session Encryption
User sessions are encrypted via Electron's `safeStorage` API, leveraging the native OS keychain (macOS Keychain or Windows DPAPI).
