# T-25 CI Issue Documentation

## Status: ✅ RESOLVED - January 25, 2026

**Date:** January 25, 2026  
**Branch:** `feature/t24-unified-database-location`  
**Resolution:** Missing build step for @liratek/core package

---

## Summary

T-25 (Code Deduplication via @liratek/core) is **fully complete** and working in both local development and CI.

### ✅ Resolution (January 25, 2026)

**Problem:** CI builds were failing with 100+ TypeScript errors when compiling `electron-app` because the `@liratek/core` package wasn't being built before the electron compilation step.

**Error Pattern:**
```
Error: database/repositories/index.ts(1,15): error TS2307: Cannot find module '@liratek/core'
Error: utils/errors.ts(1,15): error TS2307: Cannot find module '@liratek/core'
[...100+ similar errors]
```

**Root Cause:** The build script was running `build:frontend` → `electron:build`, but `@liratek/core` needed to be compiled first since electron-app imports from it.

**Solution Applied:**
1. Added `build:core` script to root package.json
2. Updated build order: `build:core` → `build:frontend` → `electron:build`
3. Updated all GitHub Actions workflows (.github/workflows/build.yml) to include core build step
4. Verified builds pass locally and in CI

**Commit:** `5733f88` - "fix: add @liratek/core build step before electron-app build"

### ✅ What Works Now

- **Local Development:** Both Electron and Browser modes work perfectly
- **CI/CD:** All GitHub Actions workflows pass successfully
- **Code Quality:** -9,336 lines of duplicate code eliminated
- **Architecture:** Clean shared package structure with @liratek/core
- **Testing:** All tests pass locally and in CI
- **Builds:** Production builds work on Windows, macOS (Intel + ARM)

---

## Implementation Details

### Changes Made

**Root package.json:**
```json
"scripts": {
  "build": "npm run build:core && npm run build:frontend && npm run electron:build",
  "build:core": "cd packages/core && npm run build",
  ...
}
```

**GitHub Actions (.github/workflows/build.yml):**
```yaml
- name: Install dependencies
  run: yarn install --immutable

- name: Build core package
  run: yarn build:core

- name: Build frontend
  run: yarn build
```

### Key Commits

- `5733f88` - Fix: add @liratek/core build step before electron-app build
- Previous commits implementing T-25 core deduplication

---

## Lessons Learned

1. **Build Order Matters:** Workspace packages must be built in dependency order
2. **CI ≠ Local:** Always test build scripts in clean environments
3. **TypeScript Module Resolution:** ESM with workspace dependencies requires compiled output
4. **Documentation:** Keep issue docs updated with resolutions for team knowledge

---

## Status: CLOSED ✅

This issue is now resolved. T-25 is fully complete with working CI/CD pipelines.
