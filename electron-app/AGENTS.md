# Electron App — Codex Instructions

Read the root [`AGENTS.md`](../AGENTS.md) and [`CLAUDE.md`](CLAUDE.md). The latter contains the detailed IPC patterns and checks for this directory.

- Renderer code has no Node, filesystem, or database access. Expose capabilities through `preload.ts` and `window.api.*`.
- Keep handlers thin: validate write payloads with the existing Zod helpers, enforce roles, call core services, and return the established result envelope.
- Keep preload types complete for every payload field sent by the frontend and register new handlers in `main.ts`.
- Keep `create_db.sql` aligned with migrations when schema changes are made; see the root migration rules.

