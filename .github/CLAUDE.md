# .github — Claude Code Context

Loads automatically when working under `.github/`. Root context is `../CLAUDE.md`.

- **CI** (`ci.yml`): runs on PRs and pushes to `main` → install → lint → typecheck → backend-tests → core-tests (2 jest shards) → electron-handler-tests → frontend-tests (4 jest shards) → build. Core and frontend shards each carry a suite/test-count floor (old floor ÷ shards); the jest cache dir is restored per shard and saved on `main` pushes. Change the shard count in BOTH the matrix and `SHARD_TOTAL`.
- **Release** (`build.yml`): triggered by `v*` tags or manual → tests → draft release → build Windows → publish
- **Node version**: 20, **Yarn**: via corepack
- **Required secrets**: `UPDATE_TOKEN` (auto-update auth), `GH_TOKEN` (auto-provided)
- Always use `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` in env
- Always use draft releases; publish only after build artifacts are uploaded
- Use concurrency control: `group: ci-${{ github.ref }}` with `cancel-in-progress: true`

**Release flow:**

```bash
git tag v1.X.X
git push origin v1.X.X
# CI/CD handles the rest automatically
```
