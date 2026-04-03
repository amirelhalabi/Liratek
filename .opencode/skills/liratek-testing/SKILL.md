---
name: liratek-testing
description: Testing skills for LiraTek POS - Unit tests, integration tests, and test automation
version: 1.0.0
license: MIT
metadata:
  author: LiraTek Engineering
  organization: LiraTek
  createdAt: "2026-03-20"
categories:
  - testing
  - unit-tests
  - integration-tests
  - automation
tags:
  - testing
  - jest
  - vitest
  - playwright
  - e2e
---

# LiraTek Testing Skills

Testing skills for LiraTek POS system. Covers unit tests, integration tests, and test automation.

## When to Use

Use these skills when:

- Writing unit tests
- Creating integration tests
- Setting up test automation
- Running tests in CI/CD
- Measuring test coverage

## Skill Structure

This skill contains modular rules organized by category:

- **unit-** : Unit test patterns
- **integration-** : Integration test patterns
- **e2e-** : E2E test patterns
- **coverage-** : Coverage requirements

## Related Skills

- `liratek-backend` - Backend unit tests
- `liratek-frontend` - Frontend unit tests
- `liratek-devops` - CI/CD test automation

## Quick Start

```bash
# Run all tests
yarn test

# Backend tests
yarn workspace @liratek/backend test
yarn workspace @liratek/backend test:coverage

# Frontend tests
yarn workspace @liratek/frontend test
yarn workspace @liratek/frontend test:coverage
```

## Key Files

- `backend/tests/` - Backend tests
- `frontend/tests/` - Frontend tests
- `.github/workflows/ci.yml` - CI test automation

## Core Patterns

### Unit Test

```typescript
describe("MyService", () => {
  beforeEach(() => {
    resetMyService();
    resetMyRepository();
  });

  it("should create entity", () => {
    const service = getMyService();
    const result = service.createEntity(data);
    expect(result.id).toBeDefined();
  });
});
```

## Rules

Load the following rules for detailed guidance:

- `unit-test-pattern` - Unit test structure
- `test-reset-singletons` - Reset singletons between tests
- `coverage-requirements` - Coverage thresholds

## Reference

- Backend tests: `backend/tests/`
- Frontend tests: `frontend/tests/`
