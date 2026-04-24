---
name: liratek-devops
description: DevOps skills for LiraTek POS - CI/CD pipelines, GitHub Actions, build automation, and release management
version: 1.0.0
license: MIT
metadata:
  author: LiraTek Engineering
  organization: LiraTek
  createdAt: "2026-03-20"
categories:
  - devops
  - cicd
  - github-actions
  - build
tags:
  - ci-cd
  - github-actions
  - build
  - release
  - electron-builder
---

# LiraTek DevOps Skills

DevOps skills for LiraTek POS system. Covers CI/CD pipelines, GitHub Actions, build automation, and release management.

## When to Use

Use these skills when:

- Configuring CI/CD pipelines
- Setting up GitHub Actions workflows
- Automating builds and releases
- Managing build configurations
- Configuring auto-update

## Skill Structure

This skill contains modular rules organized by category:

- **ci-** : CI pipeline configuration
- **build-** : Build automation
- **release-** : Release management
- **cache-** : Caching strategies

## Related Skills

- `liratek-electron` - Electron build configuration
- `liratek-testing` - Test automation in CI

## Release Process (Step-by-Step)

### Creating a New Release

```bash
# 1. Bump version in package.json FIRST
# Edit package.json "version" field to new version (e.g., "1.18.47")

# 2. Stage and commit all changes (including package.json)
git add -A
git commit -m "fix(scope): description - LIRA-XXX"

# 3. Create the tag matching the version
git tag v1.18.47

# 4. Push commit and tag together
git push
git push --tags
```

### Amending a Release Commit

If you need to amend the last commit after pushing (e.g., forgot package.json version bump):

```bash
# ⚠️ NEVER force-push tags — it triggers duplicate workflow runs
# which causes electron-builder to skip asset uploads (existingType mismatch)

# Instead: delete the remote tag first, then recreate
git tag -d v1.18.47                    # delete local tag
git push origin --delete v1.18.47      # delete remote tag
gh release delete v1.18.47 --yes       # delete the GitHub release if created

# Now amend and re-tag
git add -A
git commit --amend --no-edit
git tag v1.18.47
git push --force                       # force-push the amended commit
git push --tags                        # push the new tag (triggers ONE workflow)
```

### ⚠️ Critical Rules

1. **Always bump `package.json` version** before tagging — the tag version and package.json version must match
2. **Never force-push tags** (`git push --tags --force`) — this triggers duplicate CI runs which causes electron-builder to fail uploading assets (`latest.yml`, `.exe`, `.blockmap`) because it finds a published release when expecting a draft
3. **Delete tag before recreating** — if you need to re-tag, delete the old tag (local + remote) and the GitHub release first, then create fresh
4. **One tag push = one workflow run** — the build workflow creates a draft release, uploads artifacts, then publishes. Two runs race and break this flow

### Quick CI Checks (Local)

```bash
yarn typecheck
yarn lint
yarn build
yarn test
```

## Key Files

- `.github/workflows/ci.yml` - CI pipeline
- `.github/workflows/build.yml` - Build & Release
- `.github/actions/setup/` - Reusable setup action
- `package.json` - Build scripts
- `electron-builder.yml` - Electron build config

## Core Patterns

### CI Pipeline

```yaml
name: CI
on:
  pull_request:
    branches: [main, dev, develop]

jobs:
  install:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: ./.github/actions/setup
      - run: yarn install --immutable

  lint:
    needs: install
    runs-on: ubuntu-latest
    steps:
      - run: yarn lint

  typecheck:
    needs: install
    runs-on: ubuntu-latest
    steps:
      - run: yarn typecheck

  build:
    needs: [lint, typecheck]
    runs-on: ubuntu-latest
    steps:
      - run: yarn build
```

## Rules

Load the following rules for detailed guidance:

- `ci-pipeline-config` - CI pipeline setup
- `build-release-workflow` - Build and release automation
- `caching-strategy` - Dependency caching
- `release-process` - Release creation process

## Reference

- CI workflow: `.github/workflows/ci.yml`
- Build workflow: `.github/workflows/build.yml`
