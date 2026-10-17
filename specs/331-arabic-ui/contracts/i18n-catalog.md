# Contract: i18n catalogs, formatters and the guard

This is the contract that parallel module agents work against. If you follow it, your module never conflicts with another agent's.

## Files you own when converting module `<m>`

- `frontend/src/features/<m>/**`
- `packages/ui/src/i18n/locales/en/<m>.json`
- `packages/ui/src/i18n/locales/ar/<m>.json`
- tests under `frontend/src/features/<m>/**/__tests__/`

## Files you must NOT edit during module work

These are owned by Foundational (single owner):

- `common.json`, `layout.json`, `ui.json`, `glossary.ts`, `brandNames.ts`, `format.ts`, `digits.ts`, `namespaces.ts`, `resources.ts`
- `frontend/src/i18n/setup.ts`, `LanguageContext.tsx`
- `backendApi.ts`, `ElectronApiAdapter.ts`, `packages/ui/src/api/types.ts`, `preload.ts`, `electron.d.ts`
- `scripts/check-i18n.mjs`, `ci.yml`, `package.json`, `index.css`

If you need a new `common` word, use a key in your own namespace and list it in your hand-off. The Foundational owner may promote it later.

## Using translations

```tsx
const { t } = useTranslation("debts");
<h1>{t("repay.title")}</h1>
<span>{t("repay.owed", { amount: formatMoney(owed, "USD") })}</span>   // formatted value as a param
<option value="CASH">{t("common:payment.cash")}</option>               // value is a code, label is translated
```

- **Never** use `t()` to build a payload field, an option `value`, a stored note/category, or a comparison key (research R9).
- Data typed by people and brand names are shown as they are (FR-009).
- Wrap numbers, phones, IMEIs, references and amounts in `<Ltr>` when they sit inside Arabic text (FR-015).

## Formatters (`packages/ui/src/i18n/format.ts`, the ONLY place allowed to call `Intl`/`toLocale*`)

| Function | Behaviour |
| --- | --- |
| `formatNumber(n, opts?)` | `Intl.NumberFormat('en-US', opts)` in both languages |
| `formatMoney(n, currency)` | Same output as core `formatMoneyAmount`: `$1,234` for USD, `1,234 LBP` for LBP, `1,234 EUR` otherwise. Pinned `en-US`, so identical in both languages. |
| `formatDate/formatTime/formatDateTime(v, lang, style?)` | `en-US` or `ar-LB-u-nu-latn-ca-gregory`. No `timeZone` option, so the calendar day is unchanged. |
| `useFormat()` | A hook binding the current language to the date functions |

## Direction

- Use logical utilities only: `ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/border-e/rounded-s/rounded-e`.
- Use `<DirIcon icon={ChevronRight} />` for direction icons. Never mirror cash, phone, printer, search or currency icons (FR-014).
- For charts with a time axis: `reversed={dir === "rtl"}`.

## The guard: `node scripts/check-i18n.mjs` (CI, error level)

Every namespace file is pre-created as `{}` in Foundational (T004). Your module counts as converted once `locales/en/<m>.json` holds at least one key, so adding the first key is your failing-first step. From then on these fail:

| # | Check | Scope |
| --- | --- | --- |
| G1 | Hard-coded Latin-letter UI text: JSX text, `placeholder/title/aria-label/alt/label/tooltip/emptyText/confirmText` literals, and literal args to `toast*/showToast/setError/setMessage/confirm/alert` | converted modules |
| G2 | Physical direction classes | converted modules |
| G3 | `toLocale*` / `Intl.NumberFormat` / `Intl.DateTimeFormat` outside `format.ts` | converted modules |
| G4 | `en`/`ar` key-set mismatch, or `{{placeholder}}` mismatch | all namespaces |
| G5 | An `ar` value containing a glossary `forbidden` variant | all namespaces |
| G6 | `i18next`/`react-i18next` import under `packages/core` | global |
| G7 | `server` namespace key set differs from `SERVER_MESSAGES` | global |

- **Exemptions**: `BRAND_NAMES`, symbol/number-only strings, `className`, `data-testid`, `key`, import paths, test files, `features/whatsNew` (FR-012).
- **Per-line escape**: `// i18n-exempt: <reason>` for data values. The script counts them.
- `--list <dir>` prints candidate strings to help extraction.

## Definition of done for a module

- G1–G5 pass for the module.
- Its affected jest tests pass, run by explicit path.
- For a money module, the payload-equality test (`en` vs `ar` deep-equal) passes.
- The module was clicked through in Arabic on web (quickstart V2).

## As built (foundation, branch `lira-331-arabic-ui`, 2026-10-17): the module recipe

Everything above still holds; this section names the real files and commands.

### What already exists

| Thing | Where | Import it as |
| --- | --- | --- |
| Catalogs | `packages/ui/src/i18n/locales/{en,ar}/<ns>.json` (all pre-created `{}`) | registered already: `resources.ts` imports every file |
| Which files a namespace owns | `packages/ui/src/i18n/scopes.json` (longest matching path wins) | — |
| Formatters | `packages/ui/src/i18n/format.ts` | `@liratek/ui/i18n/format`, or the hook `useFormat()` from `@/i18n/useFormat` |
| Digit normaliser | `packages/ui/src/i18n/digits.ts` (already inside `sanitizeDecimal`, so every `DecimalInput` accepts ١٢٣) | `@liratek/ui/i18n/digits` |
| `<Ltr>` / `<DirIcon>` | `packages/ui/src/components/ui/Ltr.tsx`, `DirIcon.tsx` | `@liratek/ui/components/ui/Ltr`, `@liratek/ui/components/ui/DirIcon` |
| Server refusal text | `packages/ui/src/i18n/serverMessage.ts` | `translateServerError(result, t)` from `@liratek/ui/i18n/serverMessage` |
| Current language | `frontend/src/contexts/LanguageContext.tsx` | `useLanguage()` (`language`, `dir`) |
| Shared words | `common.json`: `actions.*`, `currency.*`, `payment.<METHOD_CODE>`, `yes`, `no`, `state.*`, `language.*` | `t("common:actions.save")` |

**Never import i18n helpers from the `@liratek/ui` barrel.** About 400 test files `jest.mock("@liratek/ui", …)` with a fixed export list; a subpath import is not affected by those mocks.

`react-i18next` works in every jest test with no setup: `frontend/jest.setup.ts` initialises the app's instance in English, synchronously. Existing English assertions keep passing as long as the English catalog text is byte-identical to the old literal (including spaces around `{" "}`).

### Steps for one module

1. **Failing-first (rule 17).** Add the page-title key to `packages/ui/src/i18n/locales/en/<ns>.json` and the same key to `locales/ar/<ns>.json`. Run `node scripts/check-i18n.mjs`. It now fails with the module's G1/G2/G3 findings; paste the summary line into the commit message.
2. **Money modules only:** write the payload-equality test first (T043–T049 below), with `i18n.changeLanguage("en")` vs `("ar")` from `@/i18n/setup`, building the payload through the real screen or builder for every sub-type and mode (rule 28d). It passes before conversion: write "not failing-first (guard against future drift)".
3. **Extract strings.** `node scripts/check-i18n.mjs --list frontend/src/features/<m>` lists candidates. Use `const { t } = useTranslation("<ns>")`, keys `<screen>.<element>`, `{{name}}` params with values already formatted. Copy English exactly. Add the Arabic with `packages/ui/src/i18n/glossary.ts` words. Keys are typed: a wrong key is a compile error.
4. **Logical classes.** `node scripts/i18n-logical-classes.mjs frontend/src/features/<m>` (`--dry` to preview). Fix any `REVIEW` line by hand (`left-1/2` + `translate-x`). `space-x`/`divide-x` need nothing.
5. **Numbers, dates, direction.** Replace `toLocale*`/`Intl` with `useFormat()` (or the `format.ts` functions). Wrap amounts, phones, IMEIs and references inside Arabic text in `<Ltr>`. Use `<DirIcon icon={ChevronRight} />` for direction icons only.
6. **Inputs.** Replace the module's `<input type="number">` with `DecimalInput`, or `type="text" inputMode="decimal"` + `normalizeDigits`. First grep the jest tests and both e2e trees for `spinbutton`/`type="number"` selectors in that module and update them.
7. **No `t()` in data.** Never in a payload, an option `value`, a stored note/category, or a comparison. Rewrite label comparisons to code comparisons, with a test.
8. **Check.** `node scripts/check-i18n.mjs` passes, the module's jest tests pass by path, and `yarn typecheck` + `yarn lint` pass.

Exemption for a real data value: `// i18n-exempt: <reason>` on the same line or the line above. New shared words go in your own namespace; list them in the hand-off.

Do not edit: `namespaces.ts`, `resources.ts`, `scopes.json`, `common.json`, `format.ts`, `digits.ts`, `glossary.ts`, `brandNames.ts`, `frontend/src/i18n/*`, `LanguageContext.tsx`, `scripts/check-i18n.mjs`, `index.css`.

### Example test (a converted component, English unchanged)

```tsx
import { render, screen } from "@testing-library/react";
import { i18n } from "@/i18n/setup";
import Thing from "../Thing";

afterEach(() => i18n.changeLanguage("en"));

it("shows the same English text", () => {
  render(<Thing />);
  expect(screen.getByRole("heading", { name: "Settle debt" })).toBeInTheDocument();
});

it("shows Arabic when the language is ar", async () => {
  const { loadLanguage } = await import("@/i18n/setup");
  await loadLanguage("ar");
  await i18n.changeLanguage("ar");
  render(<Thing />);
  expect(screen.getByRole("heading", { name: "تسديد الدين" })).toBeInTheDocument();
});
```

### Modules and their tasks

| Namespace | Owns (scopes.json) | Task(s) |
| --- | --- | --- |
| `layout` | `frontend/src/app`, `frontend/src/components`, `frontend/src/shared/components/layouts` | T023 |
| `ui` | `packages/ui/src/components/ui` (not MultiPaymentInput) | T024 |
| `payment` | `packages/ui/src/components/ui/MultiPaymentInput.tsx` | T025 |
| `shared` | `frontend/src/shared`, `frontend/src/hooks`, `frontend/src/contexts` | T026, T027 |
| `account` | `features/account` | T030 (rest of the module) |
| `auth` | `features/auth` | T032 |
| `setup` | `features/setup` | T033 |
| `sales` | `features/sales` (not `utils/receiptFormatter.ts`) | T043 → T050 |
| `recharge` | `features/recharge` (not the part-2 files) | T044 → T051 |
| `rechargeFinancial` | the 9 part-2 files in `features/recharge/components` | T044 → T052 |
| `services` | `features/services` | T045 → T053 |
| `debts` | `features/debts` | T046 → T054 |
| `exchange`, `expenses` | `features/exchange`, `features/expenses` | T047 → T055, T056 |
| `closing` | `features/closing` | T048 → T057 |
| `dashboard` | `features/dashboard` | T058 |
| `sessions`, `customServices`, `maintenance`, `loto` | `features/sessions`, `features/custom-services`, `features/maintenance`, `features/loto` | T049 → T059–T062 |
| `inventory`, `clients`, `warranty`, `vouchers` | same-named folders | T063 |
| `settings` | `features/settings` (not the two catalog files) | T064 |
| `settingsCatalog` | `MobileServicesManager.tsx`, `CategoriesManager.tsx` | T065 |
| `suppliers`, `partners` | same-named folders | T049 → T066 |
| `profits` | `features/profits` | T067 |
| `audit` | `features/audit` | T068 |
| `admin`, `phoneLines`, `wrongNumbers`, `offline` | same-named folders | T069 |
| `receipts` | the receipt builders (P2) | T085–T088 |

`features/whatsNew` is not in `scopes.json` and is never converted (FR-012).
