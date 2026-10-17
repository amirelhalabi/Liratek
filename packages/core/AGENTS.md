# Shared Core — Codex Instructions

Read the root [`AGENTS.md`](../../AGENTS.md) and [`CLAUDE.md`](CLAUDE.md). The scoped guide describes repository and service patterns, exports, build, and package sync.

- Put all database access in repositories. Services own business rules and orchestration and receive repositories through constructors.
- Use parameterized SQL and module loggers. Keep domain predicates shared instead of copying SQL fragments between queries.
- For a migration, use the last entry in `src/db/migrations/index.ts` as the sole version source, implement rollback where supported, and mirror fresh-install schema changes in `electron-app/create_db.sql`.
- After core changes, build and sync `node_modules/@liratek/core` using the documented procedure before relying on Electron runtime behavior.

