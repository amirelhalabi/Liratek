# T-20 Phase 2: Cleanup Instructions

**Status**: Ready to delete old structure  
**Created**: Jan 24, 2026

## ✅ Completed Steps

1. ✅ All backend APIs created (19/19 modules)
2. ✅ All frontend components migrated and updated
3. ✅ Git backup created (commit: "feat(T-20): Complete Phase 1")
4. ✅ TypeScript compiles without errors

## 🗑️ Manual Deletion Required

Due to tool limitations, please manually delete the following:

### Folders to Delete (8):
```bash
rm -rf src/
rm -rf electron/
rm -rf public/
rm -rf __mocks__/
rm -rf packages/
rm -rf dist/ dist-electron/ build/  # if they exist
```

### Files to Delete (12):
```bash
rm -f index.html
rm -f vite.config.ts
rm -f tsconfig.json tsconfig.app.json tsconfig.node.json
rm -f jest.config.ts jest.setup.ts
rm -f tailwind.config.js postcss.config.js
rm -f eslint.config.js
rm -f apply-drawer-migration.js
rm -f agent-recent-chat.txt
```

### Folders to KEEP:
- ✅ `frontend/` - New frontend code
- ✅ `backend/` - New backend code
- ✅ `docs/` - Documentation
- ✅ `.github/` - CI/CD workflows
- ✅ `scripts/` - Build scripts
- ✅ `resources/` - App icons
- ✅ `docker-compose.yml`, `Dockerfile`, `nginx.conf` - Deployment configs
- ✅ `README.md` - Main documentation
- ✅ `package.json` - Workspace config (will be updated)

## 📝 After Deletion

1. Verify the workspace still works:
   ```bash
   cd frontend && npm install && npm run dev
   cd backend && npm install && npm run dev
   ```

2. Commit the cleanup:
   ```bash
   git add -A
   git commit -m "chore(T-20): Phase 2 - Remove old monolithic structure

   Deleted:
   - src/ (old frontend)
   - electron/ (old backend)
   - public/, __mocks__/, packages/
   - Old config files (vite, tsconfig, jest, etc.)

   New structure:
   - frontend/ - Standalone React app
   - backend/ - Standalone Node.js API server
   - Root package.json updated to workspace-only

   Related: T-20 Phase 2"
   ```

3. Update CURRENT_SPRINT.md to mark T-20 as complete

## 🔄 Rollback Plan

If anything goes wrong:
```bash
# Restore everything
git reset --hard HEAD~1

# Or restore specific folders
git checkout HEAD~1 -- src/
git checkout HEAD~1 -- electron/
```

## ⚠️ Space Savings

After deletion: ~1.5 GB will be freed

## 📋 Next Steps After Cleanup

1. Test Electron build: `npm run build`
2. Test Docker build: `docker compose up --build`
3. Update CI/CD if needed
4. Mark T-20 as complete in CURRENT_SPRINT.md
