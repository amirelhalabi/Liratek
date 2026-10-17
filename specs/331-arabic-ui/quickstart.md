# Quickstart: validating the Arabic app UI (LIRA-331)

This page says how to prove the feature works. The details live in [contracts/](./contracts/) and [data-model.md](./data-model.md).

## Standing constraints

These come from the owner's rules:

- Run **affected tests only**, by explicit path. Never a full jest suite. Ask before running any suite or e2e.
- **No desktop e2e and no launching Electron on the owner's Mac.** Desktop checks run in CI (`.github/workflows/ci.yml` / e2e workflow) or on the Windows shop machine.
- Web e2e runs locally with `node scripts/run-e2e.mjs web -g "<title>"`.
- A fast or empty run is not a pass. Check the reported test count (rule 28a).

## V1: Guard and catalogs (every module, every PR)

```bash
node scripts/check-i18n.mjs                        # G1–G7; must print the converted-module count and exit 0
node --test scripts/__tests__/i18nGuard.test.mjs   # guard's own tests
```

Expected:

- 0 findings.
- The converted-module count rises as modules land.
- Deleting one `ar` key or adding a JSX literal in a converted module makes it fail.

## V2: Module walk in Arabic, web

1. `yarn dev:web`, then sign in as a staff user.
2. Go to My account → Language → العربية.
3. Check that `<html dir="rtl" lang="ar">` is set. The nav is on the right. A half-typed form keeps its input across the switch (FR-002).
4. Open the module's pages and modals. No English text remains except brand names (LiraTek, OMT, Whish, MTC, Alfa, Binance, iPick, Katsh, IMEI) and user data (SC-001).
5. Check that amounts show `1,234,567` with Western digits in both languages (FR-016). Dates show Levantine month names (OD-5). A record shows the same calendar day as in English (FR-020).
6. Type `١٢٣٫٥` in an amount field. It saves `123.5` (FR-017).

## V3: Per-user language (US2)

1. Web: set user A to Arabic and user B to English.
   - Sign in as A: the app is Arabic.
   - Sign out, sign in as B: the app is English.
   - Sign in as A from a second browser profile: the app is Arabic (SC-004).
2. The sign-in screen on a fresh profile with `navigator.language = ar-LB` is Arabic. With `en-US` it is English. The last-used language wins afterwards (FR-004).
3. As admin, set Shop → Default language = العربية. A new staff user's first sign-in is Arabic (US2 AC-5).
4. Desktop (CI or Windows): repeat step 1 on one machine. The web choice does not appear on desktop, which is expected (owner decision).
5. Signup: open `https://www.liratek.shop/#/signup?lang=ar` (after OD-1). The signup screen is Arabic, and the new owner and the shop default are Arabic. Receipts stay English.

## V4: Money is identical in both languages (SC-002)

Automated:

- Payload-equality tests, one per money form, run by path. Example: `frontend/src/features/sales/**/__tests__/*.payloadLanguage.test.ts`. Each asserts that the payload built with `en` deep-equals the one built with `ar`.
- New web e2e `frontend/tests/e2e-web/lira-web-0NN-arabic-ui.spec.ts`. Use the next free number at build time; the last was 071.
  - It performs the same POS sale (USD paid, LBP change) once with the user at `en` and once at `ar`.
  - It selects by `data-testid`/role, never English text.
  - It asserts that the **drawer deltas, the sale row amounts and the profit deltas** are equal per currency (rule 15).
- Desktop: the same spec over the web shim, or the desktop e2e equivalent in CI.

Manual (SC-002, full day): run `docs/testing/SHOP_DAY.md` once in English and once in Arabic on the test tenant. Compare the closing totals per currency.

## V5: Server refusals in Arabic (P2)

- Trigger, as an Arabic user: insufficient balance, wrong password, refund of a resold unit, and an invalid amount (a zod refusal).
- Each message is Arabic and its amounts use Western digits.
- The English user sees exactly today's text.
- Automated: backend route tests and electron handler tests assert that `messageKey` and `messageParams` are present and that `error` is unchanged. Use the schema's names (rule 24).

## V6: Receipts (P2)

- `receipt_language` unset: the printed and previewed receipt is **byte-identical** to before. The snapshot tests in `frontend/src/features/sales/utils/__tests__/receiptFormatter.test.ts` and the new `receiptModel.snapshot.test.ts` pass (FR-023).
- `receipt_language = ar`:
  - The preview is RTL and Arabic.
  - The amounts equal the English receipt's.
  - A reprint from Transactions by an English-language cashier is still Arabic (US3 AC-2).

## V7: Physical printing (manual, SC-006)

On the shop's Windows desktop, with 58 mm and 80 mm thermal printers:

- Print an Arabic sale receipt (with change), a session receipt and a repair receipt.
- Check: nothing cut, no reversed amounts, the `$`/`LBP` markers attached, and the font rendered (not boxes) **while offline**.
- Repeat from the web app in Chrome.

## V8: Phone app (P3)

- Local APK build only (no EAS/online Expo).
- The owner at Arabic on web → open the phone app → Arabic, RTL.
- A wrong shop address on sign-in → Arabic refusal.
- Record a Whish App transfer in Arabic. Its amounts equal the English one (US4).
- First P3 check (T100): Hermes `Intl.PluralRules('ar')` and `Intl.DateTimeFormat('ar-LB-u-nu-latn-ca-gregory')` work on the device.
