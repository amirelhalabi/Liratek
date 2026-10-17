# GitHub Workflows — Codex Instructions

Read the root [`AGENTS.md`](../AGENTS.md) and [`CLAUDE.md`](CLAUDE.md) for project CI and release conventions.

- Preserve existing workflow structure, required secrets, concurrency controls, and Node/Yarn setup.
- Keep releases as drafts until artifacts have uploaded and passed the established checks.
- Never place credentials in workflow files; use the repository's configured secrets.
- Do not trigger a release or deployment unless explicitly requested.

