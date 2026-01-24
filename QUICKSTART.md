# LiraTek Quick Start Guide

## 🚀 Running the Application

### Desktop Mode (Electron - Recommended)
```bash
npm run dev
```
This starts:
- Frontend dev server (Vite on port 5173)
- Electron desktop app (loads from Vite with hot reload)

### Browser Mode (Web Development)
```bash
npm run dev:web
```
This starts:
- Backend API server (port 3000)
- Frontend dev server (port 5173)
- Open http://localhost:5173 in browser

### Docker Mode (Production-like)
```bash
npm run dev:docker
```

---

## 📁 Project Structure

```
liratek/
├── electron-app/    # Desktop Electron wrapper
│   ├── main.ts      # Main process
│   ├── preload.ts   # IPC bridge
│   ├── services/    # Business logic
│   ├── handlers/    # IPC handlers
│   └── database/    # Repositories
├── frontend/        # React web app
│   └── src/         # React components
├── backend/         # REST API server (for browser mode)
│   └── src/         # Express routes & services
└── docs/            # Documentation
```

---

## 🔧 Development Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Desktop app (Electron + Vite) |
| `npm run dev:web` | Browser mode (Backend + Frontend) |
| `npm run dev:frontend` | Frontend only (port 5173) |
| `npm run dev:backend` | Backend API only (port 3000) |
| `npm run electron:build` | Build Electron app |
| `npm run build` | Build everything |
| `npm test` | Run tests |

---

## 🎯 What Mode to Use

**Use Desktop Mode (Electron) when:**
- Developing desktop features
- Need native OS integration
- Testing IPC handlers
- Daily development

**Use Browser Mode when:**
- Developing REST API
- Testing without Electron
- Cloud deployment testing
- Need backend-only features

---

## 🐛 Troubleshooting

**Electron won't start:**
```bash
cd electron-app
npm rebuild better-sqlite3 --runtime=electron --target=31.0.0
npm run build
```

**Frontend not loading:**
- Ensure frontend dev server is running (port 5173)
- Check `npm run dev:frontend` in separate terminal

**Database errors:**
- Database auto-creates in: `~/Library/Application Support/@liratek/electron-app/`
- Delete database to reset: `rm ~/Library/Application\ Support/@liratek/electron-app/*.db`

---

## 📚 Documentation

- [README.md](README.md) - Complete documentation
- [CURRENT_SPRINT.md](docs/CURRENT_SPRINT.md) - Current tasks
- [ELECTRON_INTEGRATION_GUIDE.md](docs/ELECTRON_INTEGRATION_GUIDE.md) - Electron details

---

**Default Login:**
- Username: `admin`
- Password: `admin123`
