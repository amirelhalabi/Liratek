# LiraTek Build Guide

**Version:** 1.0.0  
**Last Updated:** December 18, 2025

This guide provides comprehensive instructions for building, testing, and distributing the LiraTek POS application across multiple platforms.

---

## Table of Contents

- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Development](#development)
- [Building for Production](#building-for-production)
- [Platform-Specific Builds](#platform-specific-builds)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Release Checklist](#release-checklist)

---

## Prerequisites

### Required Software

1. **Node.js** (v18.x or v20.x)
   ```bash
   node --version  # Should be v18.x or v20.x
   ```

2. **Yarn** (v4.0.2)
   ```bash
   # Yarn is managed via packageManager field in package.json
   corepack enable
   yarn --version  # Should be 4.0.2
   ```

3. **Git**
   ```bash
   git --version
   ```

### Platform-Specific Requirements

#### macOS
- **Xcode Command Line Tools**
  ```bash
  xcode-select --install
  ```

- **For Icon Generation (Optional):**
  ```bash
  brew install imagemagick
  ```

#### Windows
- **Visual Studio Build Tools** (for native module compilation)
  - Download from: https://visualstudio.microsoft.com/downloads/
  - Select "Desktop development with C++"

- **Python 3.x** (for node-gyp)
  ```powershell
  python --version
  ```

#### Linux
- **Build essentials**
  ```bash
  # Ubuntu/Debian
  sudo apt-get install build-essential

  # Fedora/RHEL
  sudo dnf install gcc-c++ make
  ```

---

## Quick Start

### 1. Clone the Repository
```bash
git clone <repository-url>
cd liratek
```

### 2. Install Dependencies
```bash
yarn install
```

### 3. Run Development Server
```bash
npm run dev
```

The application will start in development mode with hot-reload enabled.

---

## Development

### Development Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start development server with hot-reload |
| `npm start` | Alias for `npm run dev` |
| `npm run dev:vite` | Start Vite dev server only (frontend) |
| `npm run dev:electron` | Start Electron (backend) |
| `npm test` | Run all tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run typecheck` | Type-check TypeScript files |
| `npm run lint` | Lint code with ESLint |
| `npm run lint:fix` | Auto-fix linting issues |
| `npm run format` | Format code with Prettier |

### Project Structure

```
liratek/
├── src/                    # Frontend React application
│   ├── features/          # Feature modules
│   ├── shared/            # Shared components/utils
│   └── main.tsx           # Entry point
├── electron/              # Electron main process
│   ├── main.ts           # Main process entry
│   ├── preload.ts        # Preload script
│   ├── handlers/         # IPC handlers
│   ├── services/         # Business logic
│   └── database/         # Database layer
├── packages/shared/       # Shared types and utilities
├── build/                # Build resources (icons)
├── release/              # Build output
└── dist-electron/        # Compiled Electron code
```

---

## Building for Production

### Step 1: Clean Previous Builds
```bash
npm run clean
```

This removes:
- `dist/` - Frontend build output
- `dist-electron/` - Backend build output
- `coverage/` - Test coverage reports

### Step 2: Build Application Code
```bash
npm run build
```

This command:
1. Compiles TypeScript (workspace)
2. Builds React frontend with Vite
3. Compiles Electron main process
4. Copies database schema to `dist-electron/`
5. Copies `electron/package.json` for CommonJS support

**Output:**
- `dist/` - Production frontend assets
- `dist-electron/` - Compiled Electron code

---

## Platform-Specific Builds

### Windows x64

**Build Installer:**
```bash
npm run build:win:x64
```

**Output:**
- `release/LiraTek-1.0.0-x64.exe` - NSIS installer (~94 MB)

**Features:**
- One-click installation
- Per-user install (no admin rights required)
- Automatic icon and version strings
- Auto-unpacks native modules (better-sqlite3)

**CI/CD Build:**
```bash
npm run ci:build:win
```

---

### macOS ARM64 (Apple Silicon)

**Build Installers:**
```bash
npm run build:mac:arm64
```

**Output:**
- `release/LiraTek-1.0.0-arm64.dmg` - DMG installer (~120 MB)
- `release/LiraTek-1.0.0-arm64-mac.zip` - ZIP archive

**Features:**
- Native Apple Silicon performance
- Signed and notarized (requires certificate)
- macOS Gatekeeper compatible

---

### macOS Intel (x64)

**Build Installers:**
```bash
npm run build:mac:x64
```

**Output:**
- `release/LiraTek-1.0.0-x64.dmg` - DMG installer
- `release/LiraTek-1.0.0-x64-mac.zip` - ZIP archive

**Use Case:** For older Intel-based Macs

---

### macOS Universal Binary

**Build Universal Installers:**
```bash
npm run build:mac:universal
```

**Output:**
- `release/LiraTek-1.0.0-universal.dmg` - Universal DMG
- `release/LiraTek-1.0.0-universal-mac.zip` - Universal ZIP

**Features:**
- Single binary works on both Apple Silicon and Intel
- Larger file size (~200 MB)
- Best compatibility

---

### Build All Platforms

**Build for All Platforms:**
```bash
npm run build:all
```

This builds:
- Windows x64 (NSIS)
- macOS ARM64 (DMG + ZIP)
- macOS Intel (DMG + ZIP)

**Requirements:**
- Must run on macOS (for Mac builds)
- For Windows builds on Mac: Works via electron-builder
- Recommended: Use CI/CD for cross-platform builds

---

## Testing

### Run All Tests
```bash
npm test
```

### Run Tests in Watch Mode
```bash
npm run test:watch
```

### Run Tests with Coverage
```bash
npm run test:coverage
```

Coverage reports are generated in `coverage/` directory.

### Run Tests in CI Mode
```bash
npm run test:ci
```

This runs tests sequentially (no parallel execution) with colored output.

### Type Checking
```bash
npm run typecheck
```

Checks TypeScript types across the entire project.

---

## Icon Requirements

### Required Files

| Platform | File | Resolution | Format |
|----------|------|------------|--------|
| Windows | `build/icon.ico` | 256×256 | ICO (multi-resolution) |
| macOS | `build/icon.icns` | 1024×1024 | ICNS |
| Source | `build/icon.png` | 512×512+ | PNG |

### Generate Windows Icon

If `build/icon.ico` is missing, generate it from PNG:

```bash
# Using ImageMagick (macOS/Linux)
brew install imagemagick
magick convert build/icon.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico

# Verify
file build/icon.ico
ls -lh build/icon.ico
```

**Expected output:**
- File size: ~50-150 KB
- Type: MS Windows icon resource - 6 icons

---

## Version Management

### Current Version
Version is defined in `package.json`:
```json
{
  "version": "1.0.0"
}
```

### Update Version

Use npm's built-in version command:

```bash
# Patch release (1.0.0 -> 1.0.1)
npm version patch

# Minor release (1.0.0 -> 1.1.0)
npm version minor

# Major release (1.0.0 -> 2.0.0)
npm version major
```

This automatically:
1. Updates `package.json`
2. Creates a git commit
3. Creates a git tag

### Version in Built Apps

Electron-builder automatically reads the version from `package.json` and applies it to:
- Installer file names
- Application metadata
- About dialog
- Windows executable properties
- macOS Info.plist

---

## Troubleshooting

### Issue: `better-sqlite3` build errors

**Solution:**
```bash
# Rebuild native modules
npm run postinstall

# Or manually
./node_modules/.bin/electron-builder install-app-deps
```

---

### Issue: Windows build fails with "icon not found"

**Solution:**
```bash
# Generate the icon
magick convert build/icon.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico

# Verify it exists
ls -lh build/icon.ico
```

---

### Issue: macOS build fails with "notarization error"

**Cause:** macOS builds need to be signed and notarized for distribution.

**Workaround for development:**
1. Build without signing
2. Or: Right-click the app → Open (bypasses Gatekeeper)

**For production:**
- Get Apple Developer certificate
- Add signing configuration to `package.json`

---

### Issue: "Module not found" errors in production build

**Cause:** Missing files in electron-builder configuration.

**Solution:** Check `package.json` `build.files` section:
```json
{
  "build": {
    "files": [
      "dist/**",
      "dist-electron/**",
      "node_modules/**",
      "package.json"
    ]
  }
}
```

---

### Issue: Database not found in built app

**Cause:** `create_db.sql` not copied during build.

**Solution:** The build script automatically copies it:
```bash
npm run build
# Copies electron/db/create_db.sql to dist-electron/db/
```

---

### Issue: "Cannot find module 'electron'" in production

**Cause:** Electron is a dev dependency but needed at runtime.

**Fix:** This is normal - electron-builder bundles Electron into the app.

---

## Release Checklist

Before creating a release:

### Pre-Build Checks
- [ ] Run `npm run typecheck` - No TypeScript errors
- [ ] Run `npm test` - All tests pass
- [ ] Run `npm run lint` - No linting errors
- [ ] Update version in `package.json`
- [ ] Update `CHANGELOG.md` (if exists)
- [ ] Commit all changes

### Build Steps
- [ ] Run `npm run clean` - Clean previous builds
- [ ] Run `npm run build` - Build application code
- [ ] Run `npm run build:win:x64` - Build Windows installer
- [ ] Run `npm run build:mac:arm64` - Build macOS ARM64 installer
- [ ] Run `npm run build:mac:x64` - Build macOS Intel installer (optional)

### Verification
- [ ] Check `release/` folder contains:
  - [ ] `LiraTek-1.0.0-x64.exe` (~94 MB)
  - [ ] `LiraTek-1.0.0-arm64.dmg` (~120 MB)
  - [ ] `LiraTek-1.0.0-x64.dmg` (~120 MB) (if built)
- [ ] Test Windows installer on Windows 10/11
- [ ] Test macOS DMG on macOS 12+ (ARM)
- [ ] Test macOS DMG on macOS 12+ (Intel) (if built)
- [ ] Verify app starts and runs correctly
- [ ] Test database operations
- [ ] Test all major features

### Release
- [ ] Create git tag: `git tag v1.0.0`
- [ ] Push to remote: `git push origin v1.0.0`
- [ ] Upload installers to distribution server
- [ ] Create GitHub Release (if using GitHub)
- [ ] Update documentation with download links

---

## CI/CD Integration

### GitHub Actions

The project includes GitHub Actions workflows:

**`.github/workflows/build.yml`**
- Builds for Windows and macOS
- Runs on push to main branch
- Uploads build artifacts

**`.github/workflows/ci.yml`**
- Runs tests and linting
- Tests on multiple Node versions
- Tests on multiple platforms

### Running CI Builds Locally

**Windows CI build:**
```bash
npm run clean
npm run build
npm run ci:build:win
```

**macOS CI build:**
```bash
npm run clean
npm run build
npm run ci:build:mac
```

---

## Advanced Configuration

### Code Signing (Production)

**macOS Code Signing:**

Add to `package.json`:
```json
{
  "build": {
    "mac": {
      "identity": "Developer ID Application: Your Name (TEAM_ID)",
      "hardenedRuntime": true,
      "gatekeeperAssess": false,
      "entitlements": "build/entitlements.mac.plist",
      "entitlementsInherit": "build/entitlements.mac.plist"
    }
  }
}
```

**Windows Code Signing:**

Add to `package.json`:
```json
{
  "build": {
    "win": {
      "certificateFile": "path/to/cert.pfx",
      "certificatePassword": "${env.WINDOWS_CERT_PASSWORD}"
    }
  }
}
```

---

### Auto-Update Configuration

To enable auto-updates, configure the publish provider:

```json
{
  "build": {
    "publish": {
      "provider": "github",
      "owner": "your-username",
      "repo": "liratek"
    }
  }
}
```

Then add auto-updater code to `electron/main.ts`.

---

## Build Configuration Reference

### Key Files

| File | Purpose |
|------|---------|
| `package.json` | Main config, dependencies, build settings |
| `electron/package.json` | Forces CommonJS for Electron |
| `vite.config.ts` | Frontend build config |
| `electron/tsconfig.json` | Electron TypeScript config |
| `tsconfig.json` | Root TypeScript config |
| `.gitignore` | Ignored files (but tracks icons) |

### Build Settings

**Native Modules:**
```json
{
  "build": {
    "asar": true,
    "asarUnpack": ["node_modules/better-sqlite3/**/*"],
    "npmRebuild": true
  }
}
```

**File Inclusion:**
```json
{
  "build": {
    "files": [
      "dist/**",
      "dist-electron/**",
      "!dist-electron/**/*.test.js",
      "!dist-electron/**/__tests__/**",
      "node_modules/**",
      "package.json"
    ]
  }
}
```

---

## Performance Tips

### 1. Use Parallel Builds (CI/CD)
```yaml
# GitHub Actions example
strategy:
  matrix:
    os: [macos-latest, windows-latest]
```

### 2. Cache Dependencies
```bash
# Yarn Berry (v4) uses Zero-Installs
# Dependencies are cached in .yarn/cache
```

### 3. Skip Unnecessary Builds
```bash
# Only build for your development platform
npm run build:mac:arm64  # On Apple Silicon Mac
npm run build:win:x64    # On Windows
```

### 4. Use `--publish never` for Local Builds
```bash
yarn dlx electron-builder --mac --publish never
```

---

## Support

For issues or questions:
1. Check [Troubleshooting](#troubleshooting) section
2. Review `BUILD_VERSIONING_ANALYSIS.md` for detailed analysis
3. Check electron-builder docs: https://www.electron.build/

---

## Related Documentation

- **BUILD_VERSIONING_ANALYSIS.md** - Comprehensive analysis of all build files
- **ICON_GENERATION_GUIDE.md** - Icon generation instructions
- **POST_ANALYSIS_ACTIONS.md** - Pre-push checklist
- **README.md** - General project information

---

**Last Updated:** December 18, 2025  
**Maintained By:** LiraTek Team
