# Documentation Archive

This folder contains historical documentation that has been superseded or consolidated into the main README.md.

## Archived Files

### BACKEND_DIFFERENCES.md

**Date Archived:** January 25, 2026  
**Reason:** Historical comparison between electron-app and backend implementations. Most differences eliminated by T-25 (@liratek/core consolidation).  
**Superseded By:** README.md Architecture section now explains the unified @liratek/core approach.

### ELECTRON_INTEGRATION_GUIDE.md

**Date Archived:** January 25, 2026  
**Reason:** Implementation guide for adding Electron features.  
**Superseded By:** README.md Architecture and Getting Started sections contain essential information.

### QUICKSTART.md

**Date Archived:** January 25, 2026  
**Reason:** Quick start guide.  
**Superseded By:** README.md Getting Started section with improved structure and commands.

### RELEASE_NOTES_v1.0.0.md

**Date Archived:** January 25, 2026  
**Reason:** Historical release notes for v1.0.0.  
**Status:** Kept for historical reference.

### T-25-CI-ISSUE.md

**Date Archived:** January 25, 2026  
**Reason:** Documents the CI build issue that was resolved with commit 5733f88.  
**Status:** Kept for historical reference and debugging lessons learned.

### PHASE_1_2_COMPLETION_SUMMARY.md

**Date Archived:** February 15, 2026  
**Reason:** Summary of completed Phase 1 (Critical) and Phase 2 (High Priority) technical improvements. All 15 tasks done.

### REPOSITORY_CONSOLIDATION.md

**Date Archived:** February 15, 2026  
**Reason:** Completed implementation record — 18 duplicate repositories consolidated into `@liratek/core`.

### SELECT_STAR_REFACTORING.md

**Date Archived:** February 15, 2026  
**Reason:** Completed implementation record — all `SELECT *` replaced with explicit column lists via abstract `getColumns()`.

### TRANSACTION_MANAGEMENT.md

**Date Archived:** February 15, 2026  
**Reason:** Completed implementation record — database transactions added to all critical multi-step operations.

### TYPE_SAFETY_IMPROVEMENTS.md

**Date Archived:** February 15, 2026  
**Reason:** Completed implementation record — `unknown` types eliminated, redundant service wrappers removed.

### LOGGING_STANDARDIZATION.md

**Date Archived:** February 15, 2026  
**Reason:** Completed implementation record — 61+ `console.*` calls replaced with Pino. Consolidated into `LOGGING.md`.

### ENVIRONMENT_VARIABLE_MANAGEMENT.md

**Date Archived:** February 15, 2026  
**Reason:** Completed implementation record — env vars centralized via Zod. Merged into `ENVIRONMENT_VARIABLES.md`.

### JWT_SECRET_MANAGEMENT.md

**Date Archived:** February 15, 2026  
**Reason:** Completed implementation record — insecure JWT fallbacks removed. Merged into `ENVIRONMENT_VARIABLES.md`.

---

## Current Documentation

For up-to-date documentation, see:

- **[README.md](../../README.md)** - Comprehensive project documentation
- **[CURRENT_SPRINT.md](../CURRENT_SPRINT.md)** - Active sprint tasks and roadmap
- **[Marketing](../marketing/)** - Marketing materials
- **[Templates](../templates/)** - Business document templates
