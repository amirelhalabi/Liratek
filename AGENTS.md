# LiraTek POS — Codex Instructions

Read [`CLAUDE.md`](CLAUDE.md) before changing project code. Also read [`docs/fable-brain.md`](docs/fable-brain.md): `CLAUDE.md` pulls it in with an `@` import that Codex does not follow, and it holds the standing instructions on verification, known-vs-guessed claims and answer format. It contains the shared architecture, domain invariants, workflows, and quality requirements and is the source of truth for those rules. The nested `AGENTS.md` files add scope-specific guidance and take precedence when they are more specific.

## Project map

- `frontend/`: React renderer shared by desktop and web
- `electron-app/`: Electron main process, IPC, preload, and desktop packaging
- `backend/`: REST transport and tenant-scoped web API
- `packages/core/`: shared business logic, repositories, and SQLite migrations
- `packages/ui/`: shared UI and transport adapter contracts
- `docs/FEATURE_GUIDE.md`: canonical money-flow invariants
- `docs/OPERATIONS.md`: deployment and operational procedures

## Codex workflow

- Read the nearest `AGENTS.md` and relevant existing code/docs before editing.
- Use Yarn workspaces for project commands. Run commands directly in the current shell; do not use the Claude-specific Windows `cmd /c` instruction unless actually working in that environment.
- For a big cross-app user-facing feature, follow the Spec Kit process and ticket numbering documented in `CLAUDE.md`. Its vendored slash-command skills are Claude-specific; use the corresponding files under `.specify/` as the source material and do not edit vendored files.
- Use project skills in `.agents/skills/` for feature-module additions, migrations, money flows, and release notes when their descriptions match the task.
- After editing `packages/core/src/`, rebuild and sync the package as documented in `packages/core/CLAUDE.md`.
- For Electron E2E, follow the proven invocation and build sequence in `CLAUDE.md`; do not assume a zero exit code with no output means the run executed.
- Do not deploy or publish unless the user explicitly requested it.

