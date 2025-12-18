# Icon Generation Guide for LiraTek

## Current Status
- ✅ macOS icon exists: `build/icon.icns` (1 MB)
- ✅ Source PNG exists: `build/icon.png` (188 KB)
- ❌ Windows icon missing: `build/icon.ico` (only 48-byte backup exists)

## Critical Issue
The Windows build is currently working because electron-builder generates a temporary icon during build time, but **the source `build/icon.ico` file should exist in the repository** for:
1. Consistency across builds
2. Better quality control
3. Faster build times
4. Reproducible builds

---

## Solution 1: Using ImageMagick (Recommended)

### Install ImageMagick:
```bash
brew install imagemagick
```

### Generate Windows Icon:
```bash
# Generate multi-resolution .ico file (256, 128, 64, 48, 32, 16px)
magick convert build/icon.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico

# Verify the file
file build/icon.ico
ls -lh build/icon.ico
```

### Expected Output:
```
build/icon.ico: MS Windows icon resource - 6 icons, 256x256, 128x128, 64x64, 48x48, 32x32, 16x16
```

---

## Solution 2: Using Online Converter (Quick Fix)

1. **Upload:** Go to https://convertio.co/png-ico/ or https://icoconvert.com/
2. **Select:** Upload `build/icon.png`
3. **Configure:** 
   - Set size to "Custom"
   - Include sizes: 256x256, 128x128, 64x64, 48x48, 32x32, 16x16
4. **Download:** Save as `build/icon.ico`
5. **Verify:** File size should be ~50-150 KB

---

## Solution 3: Using Node Package (Automated)

### Install package:
```bash
npm install --save-dev png-to-ico
```

### Create script `scripts/generate-icons.js`:
```javascript
const pngToIco = require('png-to-ico');
const fs = require('fs');

pngToIco('build/icon.png')
  .then(buf => {
    fs.writeFileSync('build/icon.ico', buf);
    console.log('✅ Windows icon generated: build/icon.ico');
  })
  .catch(console.error);
```

### Run:
```bash
node scripts/generate-icons.js
```

---

## Solution 4: Using Electron-Builder Auto-Generation (Current Fallback)

Electron-builder can auto-generate icons from PNG, but it's better to have the source icon committed:

**package.json** (current setup):
```json
{
  "build": {
    "win": {
      "icon": "build/icon.ico"  // Falls back to icon.png if missing
    }
  }
}
```

**Warning:** This creates inconsistent builds and slower build times.

---

## After Generating the Icon

### 1. Verify Icon Quality:
```bash
# Check file size (should be 50-150 KB)
ls -lh build/icon.ico

# Check it's a valid ICO
file build/icon.ico
```

### 2. Test in Build:
```bash
npm run build
npm run ci:build:win
```

### 3. Commit to Git:
```bash
git add build/icon.ico
git commit -m "Add Windows icon file"
```

### 4. Update .gitignore:
Ensure icons are NOT ignored:
```gitignore
# .gitignore
build/*
!build/icon.ico
!build/icon.icns
!build/icon.png
```

---

## Recommended Action

**Run this after ImageMagick installs:**
```bash
# Wait for ImageMagick installation
brew install imagemagick

# Generate icon
magick convert build/icon.png -define icon:auto-resize=256,128,64,48,32,16 build/icon.ico

# Verify
ls -lh build/icon.ico

# Commit
git add build/icon.ico
git commit -m "Add Windows icon for builds"
```

---

## Icon Requirements Summary

| Platform | Format | File | Sizes | Status |
|----------|--------|------|-------|--------|
| Windows | ICO | `build/icon.ico` | 256,128,64,48,32,16 | ❌ **MISSING** |
| macOS | ICNS | `build/icon.icns` | Up to 1024x1024 | ✅ **EXISTS** |
| Source | PNG | `build/icon.png` | 512x512+ | ✅ **EXISTS** |

---

**Priority:** 🔴 **HIGH** - Should be fixed before next release
