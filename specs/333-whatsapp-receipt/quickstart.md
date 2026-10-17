# Quickstart: validate LIRA-333

Run affected tests only, with explicit paths. Never run a full suite. Desktop e2e is not run on the owner's Mac.

## Unit (failing-first, then green)

```bash
yarn workspace @liratek/core test src/utils/__tests__/whatsappPhone.test.ts
yarn workspace @liratek/core test src/repositories/__tests__/SalesRepository.receiptRead.test.ts
yarn workspace @liratek/core test src/__tests__/browserEntryIsNodeFree.guard.test.ts
yarn workspace @liratek/frontend test src/features/sales/utils/__tests__/saleReceipt.test.ts
yarn workspace @liratek/frontend test src/features/sales/utils/__tests__/receiptFormatter.test.ts
yarn workspace @liratek/frontend test src/features/sales/hooks/__tests__/useSendReceiptOnWhatsApp.test.tsx
yarn workspace @liratek/electron-app test handlers/__tests__/appShellHandlers.test.ts
```

Before calling any of them green, confirm the test count is non-zero (rule 28a).

## Web e2e (owner machine OK)

`node scripts/run-e2e.mjs web -g "LIRA-333"` runs the new `lira-web-0NN-whatsapp-receipt.spec.ts`, which stubs `window.open` in the page and asserts:

1. Complete a sale for a client with phone `03 123 456`. The strip shows `RCP-<id>`, and Send calls `window.open("https://wa.me/9613123456?text=…")` once, synchronously.
2. The decoded text equals the text built for the same sale from its details window (SC-003). Its figures match that sale's reprint (SC-002). The account line is present for a partly on-account sale.
3. A walk-in sale prompts for a number. `abc` is refused, and `+33 6 12 34 56 78` opens `wa.me/33612345678`. The sale's phone is unchanged afterwards (FR-013).
4. `window.open` returning `null` shows the "blocked" message (FR-018).
5. The URL of the LiraTek page is unchanged after each click (SC-005).

Rows are matched by sale id (rule 15), never by row position.

## Manual (desktop, Windows shop PC)

1. Complete a sale, then press Send in the strip. The WhatsApp desktop app (or the default browser) opens; no LiraTek window opens.
2. Measure the length (T031): open the worst-case sale on WhatsApp desktop, WhatsApp Web and Android, and record the cap.

**Result (2026-10-17):** not run — the owner's Mac does not run Electron. Desktop path unverified beyond the `appShellHandlers.test.ts` unit test (rule 28c). Left for the owner on the Windows shop PC, together with the T031 length measurement.
