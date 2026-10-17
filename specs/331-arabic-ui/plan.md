# Implementation Plan: Arabic app UI

**Branch**: `main` (owner works on main) | **Date**: 2026-10-17 | **Spec**: [spec.md](./spec.md) | **Ticket**: LIRA-331

**Input**: Feature specification from `specs/331-arabic-ui/spec.md` (clarified 2026-10-17), plus owner decisions given with the planning request (listed under "Owner decisions" below).

## Summary

Add English/Arabic to the desktop app, the web app and the owner phone app. Arabic is laid out right to left. The language changes what is shown and never what is saved.

How it is built:

1. **One i18n stack for all three apps**: `i18next` + `react-i18next`.
   - The translation files sit in `packages/ui/src/i18n/`, one namespace file per module per language (`locales/{en,ar}/<module>.json`).
   - The frontend (Vite), `packages/ui` and the phone app (Metro, which resolves `@liratek/ui/<file>` as single pure files) read the same files.
   - Nothing under `packages/core` imports i18next (rule 29, and core also runs on the server).
2. **Language per user**:
   - One nullable column, `users.language`. NULL means "use the shop default".
   - Two new `system_settings` keys: `ui_default_language` and `receipt_language`. Missing means `en`.
   - Read and written through one core service on both transports (IPC + REST).
   - Before sign-in, the screen uses the device's last language (`localStorage`, like `ThemeContext.tsx`).
3. **RTL**:
   - `<html dir="rtl" lang="ar">`.
   - Tailwind v4 logical utilities (`ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/border-e/rounded-s/rounded-e`) replace the physical ones.
   - `rtl:` variants only where a logical utility does not exist, such as mirroring direction icons.
4. **Numbers and dates**:
   - Numbers do NOT depend on language (FR-016). Every number goes through one formatter pinned to `en-US`.
   - Dates use `en-US` or `ar-LB-u-nu-latn-ca-gregory` (Arabic month names, Western digits, Gregorian calendar).
   - The 154 machine-locale `toLocale*`/`Intl.*Format` call sites become calls to these two functions (FR-019, rule 27).
5. **Module-by-module string extraction**:
   - Each module converts on its own and can run in parallel.
   - A guard script (`scripts/check-i18n.mjs`, error level, in CI) treats a module as **converted** once its namespace file exists.
   - From then on the guard fails on any hard-coded English, physical direction class or `toLocale*` call in that module.
   - Adding a module's first key makes the guard fail. That is the failing-first proof (rule 17).
6. **Server messages (P2)**:
   - The envelope gains an optional `messageKey` + `messageParams`, with raw numbers, never pre-formatted.
   - The client translates the key and falls back to the English `error`.
   - The server never needs to know the user's language (rule 27).
7. **Receipts (P2)**:
   - One shop `receipt_language` setting.
   - English output stays byte-identical.
   - Arabic goes through a new RTL HTML renderer with a bundled Arabic font. Padded monospace text cannot carry Arabic.
8. **Phone app (P3)**: the same catalogs, the same language endpoint, and a root-level `direction: 'rtl'`.

## Owner decisions this plan relies on

Taken from the spec's Clarifications and the planning request:

- Western digits 0-9 everywhere. Arabic-Indic digits are accepted when typed only.
- "What's new" stays English (FR-012).
- Receipts follow ONE shop setting, default English (FR-021/023).
- A user's language does not sync desktop↔web.
- The shop default is set by an admin and is English unless changed (FR-005).
- Owners signing up from the Arabic landing start in Arabic, for both their own language and the shop default (FR-006).
- Brand names (LiraTek, OMT, Whish, MTC, Alfa, Binance, iPick, Katsh, IMEI) are never translated (FR-009).
- Language changes display only, never money (FR-018, SC-002).

**Still open: needs an owner answer before the task that depends on it.** See research.md R12.

- **OD-1 (blocks T040)**: FR-006 needs the two signup links in `landing/ar.html` to carry `?lang=ar`, because `Referrer-Policy: strict-origin-when-cross-origin` hides the `/ar` path. This contradicts the spec Assumption "landing pages are not changed". Recommended: allow this two-link edit.
- **OD-2 (blocks T090)**: stored English text shown in the UI conflicts with SC-001's "zero English".
  - Affected: `transactions.summary`, ledger notes, and audit text written by core.
  - Recommended: show it as stored (it is data, like user-typed text) and translate only the type/badge columns. Re-rendering from LIRA-329 `metadata_json.details` is a later option.
- **OD-3 (blocks T091)**: system-seeded names (default drawers such as `General_USD`, payment method labels, default categories, module names).
  - Recommended: translate a seeded name only while it still equals its seed value; once a user renames it, it is user data.
- **OD-4 (release gating)**: may the Arabic option be shown to shops after P1, while server refusals are still English (US1 AC-3 incomplete until P2)?
  - Recommended: no. Keep the option behind `ARABIC_UI_READY` until P1 + P2 are done, and let the owner try it earlier with a per-device override.
- **OD-5 (glossary)**: Arabic month names. Levantine (كانون الثاني، شباط) via `ar-LB`, or the standard يناير/فبراير?
  - Recommended: Levantine, matching the shop's dialect words.

## Technical Context

**Language/Version**: TypeScript strict. React 19 renderer (Vite 7, Tailwind v4.1). Electron 31 main process. Node 22 backend (Express on Fly). Expo SDK 55 / React Native 0.83 (Hermes) for the phone app.

**Primary Dependencies**:

- New: `i18next`, `react-i18next` (frontend, `packages/ui` peer, mobile).
- New: a bundled Arabic font (Noto Naskh Arabic or Noto Sans Arabic, OFL), subset to woff2, for receipts and the UI fallback.
- Existing: zod (validators), TanStack Query, recharts, xlsx, lucide-react.
- No ICU polyfill on desktop/web: Chromium ships full ICU.
- Phone app: Hermes `Intl` must be verified on a device, see research R3.

**Storage**:

- `users.language TEXT NULL` (CHECK `'en'|'ar'`) via one migration at the **next free version at build time**. The last entry was v219 on 2026-10-17; other sessions add migrations concurrently, so re-read the last entry of `packages/core/src/db/migrations/index.ts` when writing it.
- Mirrored in `electron-app/create_db.sql` (rule 10).
- The two settings live in the existing `system_settings` (no schema change, no seed, missing = `en`).
- Device keys (web/desktop `localStorage`):
  - `liratek_language`: the last language used on this device, read before sign-in.
  - `liratek_arabic_preview`: the owner override for OD-4.

**Testing**:

- core jest (repository + service + migration on the real schema).
- backend jest (REST routes).
- frontend jest. `jest.setup.ts` initialises i18n **synchronously with English** so that every existing English-text assertion keeps passing.
- `node --test` for the guard script.
- mobile jest.
- One new web e2e spec.
- Desktop e2e runs in CI/Windows only; never on the owner's Mac.
- Affected tests only, always by explicit path.

**Target Platform**:

- Electron desktop (Windows shops).
- Web (Vercel frontend + Fly API).
- Android phone app (local APK builds only, no EAS).

**Project Type**: monorepo (`packages/core`, `packages/ui`, `electron-app`, `backend`, `frontend`, `mobile`).

**Performance Goals**:

- A language switch shows in under 1 s with no remount (SC-003).
- Arabic resources are lazy-loaded with a dynamic import, so English users download nothing extra.
- English bundle growth stays under 5 KB gzip for the i18n runtime.

**Constraints**:

- No amount, currency, rounding, drawer, ledger, profit or calendar-day difference between the languages (FR-018/SC-002).
- English receipts stay byte-identical (FR-023).
- `browser.ts` stays Node-free (rule 29).
- Payloads are built once and never contain translated text (rule 22, research R9).
- No `key={language}` remount (FR-002).

**Scale/Scope** (measured 2026-10-17):

- About 130k lines of `.tsx` in 29 frontend feature folders + `shared/`, `app/`, `components/` + `packages/ui/src` (19 files, 7.8k lines).
- 154 non-test files use `toLocaleString`/`toLocaleDateString`/`toLocaleTimeString`/`Intl.*Format`, across frontend, `packages/ui`, `mobile/src`, `packages/core/src`, `electron-app` and `backend/src`.
- Physical direction classes in `.ts/.tsx`, counted with token-anchored regexes (`(^|[ "`:])` prefix, so `rounded-lg` and `border-red-*` are excluded):

  | Class pattern | Occurrences |
  | --- | --- |
  | `ml-/mr-` | 147 |
  | `pl-/pr-` | 243 |
  | `left-/right-` | 146 |
  | `text-left/right` | 412 |
  | `border-l/r` | 62 |
  | `rounded-l/r/tl/tr/bl/br` | 6 |
  | `space-x/divide-x` | 3 |

  These sit in 136 files. On top of that, `frontend/src/index.css` has 23 physical-property lines.
- 21 files use direction icons (`Chevron*/Arrow*Left|Right`).
- 28 files have `<input type="number">`.
- Core user-facing throws:

  | Error type | Throws |
  | --- | --- |
  | `DatabaseError` | 383 (many carry user-facing refusals) |
  | `BusinessRuleError` | 60 |
  | `WarrantyClaimError` | 37 |
  | `NotFoundError` | 35 |
  | `ValidationError` | 30 |
  | auth/Google/password errors | about 40 |

  Plus about 537 `success:false`/error sites in `backend/src/api` and about 673 `error:` sites in `electron-app/handlers`.
- Phone app: about 30 source files.

## Constitution Check

_GATE: checked before Phase 0 and again after Phase 1 design._

| Principle | How this plan complies | Status |
| --- | --- | --- |
| I. One core, two transports | Language read/write is one core `UserPreferencesService`, behind an IPC handler and a REST route with the same roles. The adapter function sits in `backendApi.ts` via `ipcOrHttp`. Settings keys go through the existing settings channel on both transports. A web e2e spec proves parity. | Pass |
| I. Payload built once | Translated strings never enter payloads. Each money form gets an "en vs ar payload deep-equal" test (research R9). | Pass |
| I. Rule 27 (where code runs) | Number and date formatting take the language explicitly and pin the locale. The server never formats for the user; it sends `messageKey` + raw params. Core's stored-summary formatting is pinned to `en-US` (it is `toLocaleString()` with no locale today, which already breaks on a Windows box with an Arabic locale). | Pass, and it fixes an existing hazard |
| I. Rule 29 (browser.ts leaf) | Core gains only pure files: `constants/languages.ts`, `messages/serverMessages.ts` + `messages/server/<area>.ts`, `utils/effectiveLanguage.ts`. i18next lives only in `packages/ui`, `frontend` and `mobile`. A guard asserts that no `i18next` import exists under `packages/core`, and the existing `browserEntryIsNodeFree.guard.test.ts` covers the new exports. | Pass |
| II. Layer boundaries | SQL lives in `UserRepository` (language column) and `SettingsRepository`. The service only resolves. Handlers and routes validate, authorize and call. | Pass |
| III. Contracts defined once | `languageSchema` (`z.enum(['en','ar'])`) and `setMyLanguageSchema` live in `packages/core/src/validators/userPreferences.ts`. Adapter types are `z.input<…>` (rule 21). Before validation is put in front of the settings PUT for the two keys, a three-way diff is done (rule 23). Server message English templates exist once in core and are reused as the `en/server` catalog. | Pass |
| IV. Money integrity | No money flow changes. FR-018 is guarded by the payload-equality tests and the web e2e delta check. | Pass (no ledger writes added) |
| V. Data & security | Parameterised SQL. The new column is tenant-scoped through `users.tenant_id`. The self route takes the user from the JWT/IPC session, never the body. Impersonated sessions may read but not write (the `/api/user-email/me/change` pattern). The migration has `down()`. | Pass |
| V. Rule 5 (`created_at`/`updated_at`) | `users` lacks them today (pre-existing). This feature adds a column and does not touch that debt. | Pre-existing, noted |
| VI. Testing | Every guard is failing-first: a module's namespace file is created before its strings are extracted. Payload-equality tests are written before conversion. Receipt snapshot tests run before the renderer split. Affected tests only. | Pass |
| VII. Code quality | No `any`. Typed keys through `react-i18next` `CustomTypeOptions`. `useApi()` read through a ref inside `LanguageProvider` (rule 25), and stable mocks in tests. | Pass |
| Delivery | Release-note lines in `docs/release-notes/UNRELEASED.md` when the switch becomes visible (P1+P2 release), with a second line for receipts and a third for the phone app. "What's new" stays English. | Pass |

Post-design re-check: still passes, no violations. Complexity Tracking is therefore empty.

## Design

### D1. Where things live

```text
packages/core/src/
├── constants/languages.ts            # NEW leaf: LANGUAGES = ['en','ar'] as const; type Language; DEFAULT_LANGUAGE='en'
├── utils/effectiveLanguage.ts        # NEW leaf: resolveEffectiveLanguage(userLang, shopDefault) — the ONE resolver
├── messages/serverMessages.ts        # NEW: merges messages/server/<area>.ts leaves → SERVER_MESSAGES; renderServerMessage(key, params)
├── validators/userPreferences.ts     # NEW: languageSchema, setMyLanguageSchema (+ export from validators/index.ts, browser.ts)
├── repositories/UserRepository.ts    # getLanguage / setLanguage
├── repositories/SettingsRepository.ts# getUiDefaultLanguage / getReceiptLanguage (missing ⇒ 'en')
├── services/UserPreferencesService.ts# NEW: getMine(userId) → {language, effectiveLanguage, shopDefaultLanguage, receiptLanguage}; setMine(userId, lang)
├── utils/errors.ts                   # AppError gains optional messageKey/messageParams; toJSON forwards them
└── db/migrations/index.ts            # vNEXT users.language

packages/ui/src/i18n/                 # pure leaf files (Metro maps @liratek/ui/<file>)
├── locales/en/<ns>.json, locales/ar/<ns>.json   # one namespace per module (D4)
├── namespaces.ts                     # NAMESPACES list (pre-created for every module in Foundational)
├── resources.ts                      # static en import; lazy ar loader per namespace
├── format.ts                         # formatNumber/formatMoney (en-US pinned), formatDate/formatTime/formatDateTime(lang)
├── digits.ts                         # normalizeDigits: U+0660–0669, U+06F0–06F9, '٫' → '.', '٬' → ''
├── glossary.ts                       # GLOSSARY: id → {en, ar, forbidden[]} (FR-010)
├── brandNames.ts                     # BRAND_NAMES allowlist (FR-009)
└── serverMessage.ts                  # translateServerError(envelope, t) → string (key → ar/en, else envelope.error)

frontend/src/
├── i18n/setup.ts                     # i18next init (react-i18next), typed CustomTypeOptions
├── contexts/LanguageContext.tsx      # NEW, ThemeContext-style: device language pre-sign-in; user language after; sets <html dir/lang>
├── features/account/components/DisplayPreferences.tsx → LanguagePreference (My account, every role)
├── features/settings/pages/Settings/ShopConfig.tsx  # admin: shop default language + receipt language
├── shared/utils/printReceipt.ts, shared/utils/serviceReceipt.ts, features/sales/utils/receiptFormatter.ts  # P2 receipts
└── features/**                       # module-by-module conversion (D4)

electron-app/handlers/userPreferencesHandlers.ts  # NEW IPC: user-preferences:get / user-preferences:set-language
backend/src/api/userPreferences.ts                # NEW REST: GET/PUT /api/user-preferences/me
scripts/check-i18n.mjs (+ scripts/__tests__/i18nGuard.test.mjs)  # the guard (D5)
mobile/src/i18n/, mobile/src/app/**               # P3
```

### D2. Language resolution (one function, rule 14)

`resolveEffectiveLanguage(user.language, setting ui_default_language)` returns `user.language ?? shopDefault ?? 'en'`.

| Situation | Language used |
| --- | --- |
| Before sign-in | `localStorage.liratek_language`. On a device never used before: `navigator.language` if it starts with `ar`, else `en` (FR-004). |
| After sign-in | The effective language from `GET /api/user-preferences/me` or `user-preferences:get`. It is written back to `liratek_language`, so the next sign-in screen opens in it. |
| User switches | `PUT`/IPC `set-language`, then `i18n.changeLanguage`. There is no remount, so unsaved input survives (FR-002). |
| Server unreachable (offline desktop) | The cached `liratek_language` is kept. |

### D3. RTL

- `LanguageContext` sets `document.documentElement.dir` and `lang`.
- Logical Tailwind utilities are used everywhere. `rtl:-scale-x-100` is used only on direction icons (`Chevron*`, `Arrow*Left/Right`, back/next), through one `<DirIcon>` wrapper in `packages/ui`.
- Direction-neutral icons are never mirrored (FR-014).
- Numbers, phones, IMEIs, references and amounts with their currency marker render inside `<bdi dir="ltr">` through one `<Ltr>` component and the money formatter's output. This keeps the sign and the `$`/`LBP` attached (FR-015).
- Recharts time axes get `reversed` in RTL.
- `index.css` physical properties are converted to logical ones (`margin-inline-start`, `inset-inline-end`, `text-align: start`).

### D4. Module-by-module extraction

- Namespaces map 1:1 to folders:
  - `common`: buttons, currencies, generic words. Owned by Foundational and frozen after it; additions go through one owner.
  - `layout`: shell, nav, top bar.
  - `ui`: `packages/ui` components.
  - `auth`, `server`, `glossary`.
  - One namespace per `frontend/src/features/<module>`.
- Keys are `<ns>:<screen>.<element>`, e.g. `debts:repay.title`.
- Interpolation uses `{{name}}` with raw values. Values are formatted by the caller through `format.ts`, never inside translations.
- Plurals use i18next `_zero/_one/_two/_few/_many/_other` for Arabic.
- Module order follows the shop day (SC-002 flows first):
  1. sales (POS)
  2. recharge
  3. services (OMT/Whish)
  4. debts
  5. exchange
  6. expenses
  7. closing
  8. dashboard
  9. then everything else
  
  `whatsNew` is excluded (FR-012).

### D5. The guard: `scripts/check-i18n.mjs`

It runs in CI, fails at error level, and does not depend on frontend lint, which uses `--max-warnings=9999`.

Every namespace file is pre-created as `{}` (so static imports never break the build). A module counts as converted when `packages/ui/src/i18n/locales/en/<ns>.json` holds at least one key.

For converted modules, it fails on:

1. **Hard-coded English**:
   - JSX text with Latin letters;
   - string literals in `placeholder|title|aria-label|alt|label|tooltip|emptyText|confirmText` props;
   - string-literal arguments to `toast*`, `showToast`, `setError`, `setMessage`, `confirm`, `alert`, `throw new Error` in components.
   
   Brand names (`brandNames.ts`), pure symbols/numbers, `className`, `data-testid`, `key` and import paths are exempt. A per-line `// i18n-exempt: <reason>` escape exists for data values.
2. Physical direction classes (the D3 list).
3. `toLocaleString|toLocaleDateString|toLocaleTimeString|Intl.NumberFormat|Intl.DateTimeFormat` outside `packages/ui/src/i18n/format.ts`.
4. A namespace present in `en` but missing in `ar`, a key missing in `ar`, or `{{placeholders}}` that differ between `en` and `ar`. This is FR-011's "detectable before release".

Global checks:

5. Any `ar` string containing a glossary `forbidden` variant (SC-005).
6. Any `i18next`/`react-i18next` import under `packages/core`.
7. A `server` catalog key set that differs from `SERVER_MESSAGES`.

### D6. Server messages (P2)

- `AppError` gains `messageKey?: ServerMessageKey` and `messageParams?: Record<string, string | number>`.
- `createErrorResponse` and `toJSON` forward them, and so do the shared failure helpers in `backend/src/api` and `electron-app/handlers`.
- The English `error` stays, rendered from the same template, so English output does not change.
- The client's `translateServerError` uses `t('server:'+key, params)` when the key is known, else `error`.
- Surfaces are converted per core repository/service file (parallel): `BusinessRuleError`, `ValidationError`, `NotFoundError`, `WarrantyClaimError`, auth/Google/password-reset errors, and the user-facing `DatabaseError` refusals ("This refund can't be undone…").
- **Zod custom messages**: validators reference `SERVER_MESSAGES` templates, and `validateRequest`/`validatePayload` map an issue message back to its key, since the templates are static.
- **Handler catch-all strings** (`"Failed to X"`) map to one generic key per failure family (`server:generic.saveFailed`, `server:generic.loadFailed`).
- **Electron main-process text** (dialogs, menus, backup/setup prompts in `main.ts`, `dbHandlers.ts`, `setupHandlers.ts`, `backupHandlers.ts`) and **ReportService HTML headings** take a language argument from the renderer. This is desktop-only UI, so no REST mirror is needed. The catalog is `electron-app/i18n/mainMessages.ts`, covered by the parity check.
- **Phone app**: `mobile/src/auth/messages.ts` already maps codes to wording client-side; it moves onto the shared `auth`/`server` namespaces.

### D7. Receipts (P2)

- The receipt builders (`receiptFormatter.ts`, `serviceReceipt.ts` and the session/loto/maintenance/custom-service/Transactions reprint paths) are refactored to produce a structured `ReceiptModel`.
- `renderReceiptText(model)` reproduces today's English output **byte for byte**. The existing `receiptFormatter.test.ts` plus new snapshot tests are written first.
- `renderReceiptHtmlRtl(model, width: 58|80)` builds `dir="rtl"` two-column rows, with amounts in `<bdi dir="ltr">`, `word-break: normal`, and the bundled Arabic font inlined as base64 `@font-face`. The print window loads a `data:` URL, so relative font URLs do not resolve, and offline desktop must still print.
- The choice reads the shop's `receipt_language` (any role may read settings), never the cashier's language (FR-021).
- WhatsApp receipt text (`specs/333-whatsapp-receipt`, which says "stays English") reads the same setting once both features exist. That is coordinated in T089.

### D8. Phone app (P3)

- The same `packages/ui/src/i18n` catalogs, resolved by Metro per file.
- `react-i18next` in `mobile/src/i18n/setup.ts`.
- Language from `GET /api/user-preferences/me` after sign-in (web account, so it follows the user, FR-003). Before sign-in: SecureStore last-used, else the device locale.
- RTL through a root `View style={{direction}}` (no `I18nManager.forceRTL`, which needs an app restart; research R10).
- `mobile/src/utils/format.ts` (`txnTime`/`txnClock` currently call `toLocaleString([])`) moves onto `format.ts`.

## Project Structure

### Documentation (this feature)

```text
specs/331-arabic-ui/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0 decisions R1–R12
├── data-model.md        # language column, settings keys, device keys, catalogs, glossary, ReceiptModel
├── quickstart.md        # validation guide
├── contracts/
│   ├── user-preferences-api.md   # IPC + REST for language
│   ├── error-envelope.md         # messageKey / messageParams
│   └── i18n-catalog.md           # namespace layout, key rules, guard rules
├── checklists/requirements.md
└── tasks.md
```

### Source Code (repository root)

See D1 for the tree. Touched areas:

- `packages/core/src/{constants,utils,messages,validators,repositories,services,db/migrations}`
- `packages/ui/src/{i18n,components}`
- `frontend/src/{i18n,contexts,app,shared,features/*}`
- `electron-app/{handlers,i18n,services/ReportService.ts,preload.ts,main.ts,create_db.sql,schemas}`
- `backend/src/{api,server.ts}`
- `mobile/src/**`
- `scripts/check-i18n.mjs`
- `.github/workflows/ci.yml`
- `landing/ar.html` (two links, only if OD-1 is approved)

**Structure Decision**: this is a monorepo change.

- Catalogs and formatters go in `packages/ui` because it is the one package all three UIs already resolve as pure source files.
- Core gets only leaf constants, the resolver, the server-message templates and the preference service.
- No new workspace package. A source-only package imported by core would break the compiled Electron main process and backend, which run core's `dist` JS.

## Complexity Tracking

No constitution violations.
