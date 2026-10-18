# Quickstart: verify LIRA-336

Run only the affected tests, with explicit paths.

```bash
cd packages/core && npx jest src/repositories/__tests__/addedChange.test.ts src/repositories/__tests__/lira336.addedChange.test.ts
cd frontend && npx jest src/shared/components/__tests__/MultiPaymentInput.addedChange.test.tsx
cd frontend && npx playwright test --config playwright.web.config.ts lira-web-076
```

**Manual:** on Services, do an OMT receive of $197 → "+ Customer gives change" → Cash USD 3 → "Shop pays" shows $200 → pay $200. The drawer moves by −197 net, there is no Change rounding expense, and voiding it nets to 0.
