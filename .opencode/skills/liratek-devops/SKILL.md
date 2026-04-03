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

## Quick Start

```bash
# Run CI checks locally
yarn typecheck
yarn lint
yarn build
yarn test

# Create release
git tag v1.0.0 && git push origin v1.0.0
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
