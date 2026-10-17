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
