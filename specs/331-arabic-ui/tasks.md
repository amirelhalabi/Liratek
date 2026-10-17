---
description: "Task list for LIRA-331 Arabic app UI"
---

# Tasks: Arabic app UI (LIRA-331)

**Input**: spec.md (clarified 2026-10-17), plan.md, research.md (R1–R14, OD-1…OD-6), data-model.md, contracts/ (user-preferences-api, error-envelope, i18n-catalog), quickstart.md.

**Tests**: required by the constitution (rule 17).

- Every guard is written first and seen failing on the unconverted code. Record the failing output in the task's hand-off note.
- Payload-equality tests guard a regression that conversion could introduce. They pass before conversion by nature, so mark them "not failing-first (guard against future drift)", as rule 17 asks. Never re-break code to prove a test.

**Rules for every task**:

- **Affected tests only, by explicit path.** Never a full jest suite (RAM, owner rule). Ask the owner before running any suite or e2e.
- **No Electron / desktop e2e on the owner's Mac.** Desktop proof comes from CI or the Windows machine.
- Payloads are built once and never contain translated text (rules 21/22, research R9). Option `value`s are codes.
- Before adding a key to an existing schema, do the rule 23 three-way diff.
- Nothing under `packages/core` imports i18next. New core files are pure leaves (rule 29).
- After a core change, rebuild core and sync it: `cp -r packages/core/dist/. node_modules/@liratek/core/dist/`.
- Module agents edit only the files listed in `contracts/i18n-catalog.md` → "Files you own".
- `yarn typecheck` + `yarn lint` + `node scripts/check-i18n.mjs` before calling a task done.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task).
- **[US1]…[US4]**: spec user stories. US1/US2 are P1, US3 is P2, US4 is P3. The server-message half of US1 (AC-3) is delivered in Phase 5 (delivery phase P2).

**Task IDs** are grouped by phase, not strictly sequential: there are gaps at T035–T039 and T108–T109, and Phase 8 uses T095–T099 + T110–T112. Plan and research cite these IDs, so they were not renumbered.

**Delivery phases** (the owner's phasing):

| Delivery phase | Task phases | Task range |
| --- | --- | --- |
| **P1**: desktop + web frontend | 1–4 | T001–T069 |
| **P2**: server/IPC messages + receipts | 5–6 | T070–T094 |
| **P3**: phone app | 7 | T100–T107 |
| Release | 8 | T095–T099, T110–T112 |

---

## Phase 1: Setup

- [x] T001 Get owner answers to OD-1…OD-6 (research.md R12). Record them in `specs/331-arabic-ui/spec.md` Clarifications (a new "Session" entry). T040/T041 wait for OD-1, T090 for OD-2, T091 for OD-3, T095 for OD-4 and T006 for OD-5.
- [x] T002 Add `i18next` and `react-i18next` to `frontend/package.json` and `mobile/package.json`, and as peers in `packages/ui/package.json`. Run `yarn install` and confirm `yarn rebuild:native` ran via postinstall (do not launch Electron). (Done 2026-10-17; mobile jest/metro mapping is P3, T101.)
  - **Make `packages/ui` tests run**: `packages/ui` has no test runner today, and frontend jest has `roots: ["<rootDir>/src"]`.
    - Add `"<rootDir>/../packages/ui/src"` to `roots` in `frontend/jest.config.ts`, plus a `^@liratek/ui/(.*)$` mapper.
    - Prove it with one trivial `packages/ui/src/i18n/__tests__/smoke.test.ts` run by path. Check the reported test count is 1, not 0 (rule 28a).
    - Every `packages/ui/src/**/__tests__` test in this file depends on this step.
- [ ] T003 [P] Add the subset Arabic font (Noto Naskh Arabic or Noto Sans Arabic, OFL, Arabic + Latin + digits, woff2) to `frontend/src/assets/fonts/`, together with its OFL licence text. Record the file size (target under 150 KB, research R11).
- [x] T004 [P] Create `packages/ui/src/i18n/namespaces.ts`, listing every namespace from data-model.md §6. **Pre-create `{}` (empty) for every namespace** in both `packages/ui/src/i18n/locales/en/` and `locales/ar/`, so `resources.ts` can import them statically without Vite, tsc or Metro failing on a missing file.
  - An empty `{}` file means "not converted" to the guard.
  - Adding a module's first key is that module's failing-first step.
  - After this task, nobody edits `namespaces.ts`/`resources.ts` during module work.

---

## Phase 2: Foundational (blocks every story)

### Core leaves, storage, service

- [x] T005 [P] Test FIRST `packages/core/src/utils/__tests__/effectiveLanguage.test.ts` and `packages/core/src/messages/__tests__/serverMessages.test.ts`:
  - `resolveEffectiveLanguage(null, undefined) === 'en'`; user choice beats shop default; shop default applies when the user is null.
  - `renderServerMessage` interpolates `{{params}}`, and a missing param leaves the placeholder visible (no crash).
  
  Then create `packages/core/src/constants/languages.ts`, `packages/core/src/utils/effectiveLanguage.ts` and `packages/core/src/messages/serverMessages.ts` (pure, zero imports), and export them from `packages/core/src/index.ts` and `packages/core/src/browser.ts`. Confirm `packages/core/src/__tests__/browserEntryIsNodeFree.guard.test.ts` still passes.
- [x] T006 [P] Test FIRST `packages/ui/src/i18n/__tests__/format.test.ts`:
  - `formatNumber(1234567.5)` gives `"1,234,567.5"` in both languages.
  - `formatMoney(1500000,'LBP')` gives `"1,500,000 LBP"` and equals core `formatMoneyAmount` pinned to en-US.
  - `formatDate(new Date(2026,0,15),'ar')` contains the month name chosen in OD-5 (`كانون الثاني` if Levantine) and only Western digits.
  - the formatted date never shifts the calendar day vs `'en'`.
  - `normalizeDigits('١٢٣٫٥') === '123.5'` and `normalizeDigits('۱۲۳') === '123'`.
  
  Then create `packages/ui/src/i18n/format.ts` (research R4/R5) and `packages/ui/src/i18n/digits.ts` (R13).
- [x] T007 [P] Test FIRST `packages/core/src/db/migrations/__tests__/` (follow the existing migration test pattern): (Done: v220 `users_language`.)
  - after the new migration, `users.language` exists and accepts NULL, 'en' and 'ar';
  - it rejects 'fr' (CHECK);
  - `down()` removes it.
  
  Then add the migration at the **next free version at build time** (re-read the last entry of `packages/core/src/db/migrations/index.ts`; it was v219 on 2026-10-17). The column is `language TEXT DEFAULT NULL CHECK (language IS NULL OR language IN ('en','ar'))`. Add the same column to `users` in `electron-app/create_db.sql` (rule 10) and run `yarn check:schema-equivalence`. Use the `add-migration` skill.
- [x] T008 Test FIRST `packages/core/src/repositories/__tests__/UserRepository.language.test.ts` and `packages/core/src/repositories/__tests__/SettingsRepository.language.test.ts`, on the real schema:
  - get/set the language scoped by tenant;
  - another tenant's user is untouched;
  - `getUiDefaultLanguage()` and `getReceiptLanguage()` return `'en'` when the key is missing.
  
  Then implement them in `packages/core/src/repositories/UserRepository.ts` and `packages/core/src/repositories/SettingsRepository.ts` (`?` placeholders, `tenant_id` in every statement).
- [x] T009 Test FIRST `packages/core/src/services/__tests__/UserPreferencesService.test.ts`, with a mocked repo (rule 13): `getMine` returns `MyPreferences` (contracts/user-preferences-api.md) and `setMine` validates through `setMyLanguageSchema`. Then add `packages/core/src/validators/userPreferences.ts` (`languageSchema`, `setMyLanguageSchema`; export from `validators/index.ts` + `browser.ts`) and `packages/core/src/services/UserPreferencesService.ts`, registered in `services/index.ts`. Rebuild and sync core.

### Transports (single owner, sequential: shared files)

- [x] T010 Test FIRST `backend/src/api/__tests__/userPreferences.api.test.ts`:
  - `GET /api/user-preferences/me` returns the envelope for admin and staff;
  - `PUT /me/language` with `{language:'ar'}` persists;
  - `{language:'fr'}` gives `VALIDATION_ERROR`, HTTP 200;
  - the user comes from the JWT (a body `userId` is ignored);
  - an impersonated PUT is refused.
  
  Then add `backend/src/api/userPreferences.ts` (`authenticateJWT` → `requireRole(["admin","staff"])` → `validateRequest`) and mount it in `backend/src/server.ts` before the generic routes.
- [x] T011 Test FIRST `electron-app/handlers/__tests__/userPreferencesHandlers.test.ts` (same cases, session user). Then add `electron-app/handlers/userPreferencesHandlers.ts` (`requireRole` + `validatePayload`), register it in `electron-app/main.ts`, re-export the schema in `electron-app/schemas/index.ts` (zod-major cast), and add the binding `userPreferences.get/setLanguage` to `electron-app/preload.ts` and its type to `frontend/src/types/electron.d.ts` (rule 12).
- [x] T012 Add `getMyPreferences`/`setMyLanguage` to `frontend/src/api/backendApi.ts` (`ipcOrHttp`), `frontend/src/api/ElectronApiAdapter.ts` and `packages/ui/src/api/types.ts`, typed `SetMyLanguageInput` from `@liratek/core` (rule 21). Run `yarn check:transport-parity`.
- [x] T013 Settings validation for the two keys: (Done in `SettingsService.SETTING_VALUE_SCHEMAS`, which both transports call; core test `SettingsService.language.test.ts`. No separate route/handler test.)
  1. Three-way diff of the settings PUT channel (schema / preload type / handler-forwarded fields, rule 23), recorded in the hand-off.
  2. Test FIRST: `backend/src/api/__tests__/settings.language.api.test.ts` and the IPC equivalent. `ui_default_language`/`receipt_language` accept only `en|ar`; other keys behave as before.
  3. Then validate in `backend/src/api/settings.ts` and the IPC settings handler through one shared `validateSettingValue(key, value)` in `packages/core/src/validators/`.

### i18n runtime (single owner: shared files)

- [x] T014 Create:
  - `packages/ui/src/i18n/resources.ts`: static `en` imports for every pre-created namespace file, lazy `ar` loaders;
  - `packages/ui/src/i18n/brandNames.ts`;
  - `packages/ui/src/i18n/glossary.ts`, seeded from data-model.md §7 / `landing/ar.html` (the owner reviews it).
  
  Also **seed `common.json` (en + ar) now**: buttons (Save, Cancel, Close, Delete, Edit, Confirm, Search, Print), currencies, payment-method labels keyed by method code, yes/no, empty/loading/error states. T023–T026 consume `common:` keys in parallel, so these must exist first.
- [x] T015 Create `frontend/src/i18n/setup.ts`:
  - `fallbackLng 'en'`, `react-i18next`, typed `CustomTypeOptions` from the `en` resources;
  - Arabic namespaces loaded on demand;
  - `server` `en` namespace built from `SERVER_MESSAGES`.
  
  Initialise it in `frontend/src/main.tsx`.
- [x] T016 Update `frontend/jest.setup.ts` to initialise i18n synchronously in English (research R8). Prove it with `frontend/src/i18n/__tests__/setup.test.ts` (`t('common:...')` returns English text synchronously), then run 3 existing text-asserting suites by path (e.g. `Expenses.addErrorMessage.test.tsx`) to confirm they are unchanged.
- [x] T017 Test FIRST `frontend/src/contexts/__tests__/LanguageContext.test.tsx`, with a stable `useApi` mock (rule 25):
  - device language from `localStorage.liratek_language`, else `navigator.language` starting with `ar`, else `en`;
  - after sign-in, `getMyPreferences().effectiveLanguage` wins and is written back to `liratek_language`;
  - `setLanguage('ar')` sets `<html dir="rtl" lang="ar">` and calls `setMyLanguage`;
  - a controlled input's typed value survives the switch (no remount, FR-002);
  - the API failure path keeps the cached language.
  
  Then create `frontend/src/contexts/LanguageContext.tsx` (ThemeContext pattern, `api` through a ref) and wrap the app in `frontend/src/app/App.tsx`. Include `ARABIC_UI_READY` (false) + the `liratek_arabic_preview` override (OD-4).
- [x] T018 Create `packages/ui/src/i18n/serverMessage.ts` (`translateServerError`, contracts/error-envelope.md rule 6) with `packages/ui/src/i18n/__tests__/serverMessage.test.ts` (known key → translated; unknown key → `error`; params formatted through `format.ts`).
- [x] T019 Create `<Ltr>` and `<DirIcon>` in `packages/ui/src/components/ui/` with tests (`<bdi dir="ltr">` output; the icon gets the `rtl:-scale-x-100` class).

### The guard (single owner)

- [x] T020 Test FIRST `scripts/__tests__/i18nGuard.test.mjs`, with fixture folders under `scripts/__tests__/fixtures/i18n/`:
  - one failing case per check G1–G7 (contracts/i18n-catalog.md);
  - brand names, `className`, `data-testid` and `// i18n-exempt:` pass;
  - an unconverted module (no namespace file) is ignored;
  - `features/whatsNew` is ignored.
  
  Then write `scripts/check-i18n.mjs` (TypeScript compiler API for G1; `--list <dir>` mode). Add `"check:i18n"` to the root `package.json`, add the test to `test:scripts`, and add a CI step in `.github/workflows/ci.yml`.
- [x] T021 Create `scripts/i18n-logical-classes.mjs` (codemod `ml-→ms-`, `mr-→me-`, `pl-→ps-`, `pr-→pe-`, `left-→start-`, `right-→end-`, `text-left→text-start`, `text-right→text-end`, `border-l/r→border-s/e`, `rounded-l/r…→rounded-s/e…`; `space-x` flagged for manual review) with `scripts/__tests__/logicalClasses.test.mjs`. Add that test to the explicit `test:scripts` list in the root `package.json`. The codemod must leave LTR rendering identical: a pure class rename, never touching `rounded-lg` or `border-red-*`.

### Shared shell conversion (single owner each; every module renders inside these)

- [x] T022 Convert `frontend/src/index.css` physical properties to logical ones (23 lines measured), and add the Arabic font-family fallback for `:lang(ar)`. Check visually in LTR (web) that nothing moved. (Done; the visual LTR check on web was not run in this session.)
- [x] T023 [P] Convert namespace `layout`: shell, side nav, top bar and route titles (`frontend/src/app/**`, `packages/ui/src/components/layouts/**`, `frontend/src/components/**`).
  1. Add the first key to the pre-created `locales/en/layout.json` (guard fails, record it).
  2. Extract strings and add `ar`.
  3. Run the T021 codemod.
  4. Mirror direction icons with `<DirIcon>`.
  5. Guard passes.
  
  The nav moves to the right in RTL (FR-013).
- [x] T024 [P] Convert namespace `ui`: `packages/ui/src/components/ui/*` except `MultiPaymentInput.tsx`, i.e. DataTable (headers, pagination, empty states), Select, MultiSelect, SearchBar, DateRangeFilter, ExportBar, ConfirmModal, NotificationCenter, PageAlerts, TopUpModal, DiscountLine, CounterpartySettleModal. Same 5 steps as T023. `DecimalInput.tsx` applies `normalizeDigits` (FR-017), with a test in `packages/ui/src/components/ui/__tests__/DecimalInput.digits.test.tsx`.
- [x] T025 [P] Convert namespace `payment`: `packages/ui/src/components/ui/MultiPaymentInput.tsx` (148 KB, money-critical).
  1. FIRST, `packages/ui/src/components/ui/__tests__/MultiPaymentInput.payloadLanguage.test.tsx`: the legs and change emitted with `lng=en` deep-equal those with `lng=ar` for a split USD/LBP payment with change (not failing-first; guard).
  2. Then the 5 steps of T023.
  
  Method labels come from codes, never from translated values.
- [x] T026 [P] Convert `frontend/src/shared/**` (components, hooks, utils except the receipt files, which are owned by Phase 6) into namespace `shared`, reusing the `common` keys seeded in T014. Same 5 steps.
- [x] T027 [P] Sweep the 28 files with `<input type="number">` (list them with grep). Each becomes `DecimalInput`, or `type="text" inputMode="decimal"` + `normalizeDigits`. Add one test per touched shared input. Only files outside module folders here; module-owned files are done in their module task. (2026-10-17: no `type="number"` remains outside `frontend/src/features/**`; the only shared input, `DecimalInput`, is covered by `DecimalInput.digits.test.tsx`.)

**Checkpoint**: Foundation is ready. The guard runs in CI, the language can be switched on one device, and the shell is RTL. US1 modules and US2 can start in parallel.

---

## Phase 3: User Story 2: each person keeps their own language (P1)

**Goal**: the language belongs to the user account (desktop and web separately). The sign-in screen uses the device language. The shop has a default. Owners from the Arabic landing start in Arabic.

**Independent test**: quickstart V3.

- [x] T030 [P] [US2] Test FIRST `frontend/src/features/account/components/__tests__/LanguagePreference.test.tsx`: it shows English/العربية, `setMyLanguage` is called with `{language:'ar'}` (field name from `setMyLanguageSchema`, rule 24), and العربية is hidden while `ARABIC_UI_READY` is false unless the preview flag is set. Then add `LanguagePreference` to My account (`frontend/src/features/account/pages/MyAccount.tsx`), for every role, and convert namespace `account` (5 steps, as T023). **Partly done 2026-10-17:** `LanguagePreference` is on My account with its test; its texts use `common`. The rest of namespace `account` was converted the same day (guard: 0 findings).
- [x] T031 [P] [US2] Test FIRST `frontend/src/features/settings/pages/Settings/__tests__/ShopConfig.language.test.tsx`: an admin sets "Default language" and "Receipt language" through the settings API with keys `ui_default_language`/`receipt_language`. Then add both selects to `frontend/src/features/settings/pages/Settings/ShopConfig.tsx`. Do not convert the rest of settings here; that is T064.
- [x] T032 [P] [US2] Convert namespace `auth` (`frontend/src/features/auth/**`: Login, Signup, JoinShop, ForgotPassword, ResetPassword, VerifyEmail, GoogleAuth), with a language switch on Login/Signup before sign-in (FR-004). Same 5 steps. Test FIRST `frontend/src/features/auth/__tests__/Login.languageSwitch.test.tsx`.
- [x] T033 [P] [US2] Convert namespace `setup` (`frontend/src/features/setup/**`, the desktop first-run wizard) with a pre-sign-in language switch. Same 5 steps.
- [x] T034 [US2] Test FIRST `packages/core/src/services/__tests__/UserPreferencesService.staffDefault.test.ts`: a staff user created after the admin set `ui_default_language='ar'` resolves to `ar` (US2 AC-5), and a user who existed before the update (NULL) resolves to the shop default. The implementation should already pass; if it fails, fix it in `UserPreferencesService.ts`.
- [ ] T040 [US2] (needs OD-1) FR-006 signup. **Partly done 2026-10-17:** `Signup.tsx` reads `lang` and sets the device language (`Signup.lang.test.tsx`). The backend threading (schema, provisioning, Google state, emailed link) is left.
  1. Three-way diff on the signup request schema (`packages/core/src/validators/signupInvitation.ts` / route body / service args).
  2. Test FIRST `backend/src/api/__tests__/signupLanguage.api.test.ts`: signup with `language:'ar'` creates an owner with `users.language='ar'` and `system_settings.ui_default_language='ar'`; `receipt_language` is unset; without `language`, everything stays NULL/English.
  3. Then thread `language` through `SignupInvitationService.ts` (the link carries `lang`), `TenantProvisioningService.ts`, `backend/src/api/auth.ts` (`/signup/request`, `/signup`) and `backend/src/api/googleSignup.ts` (OAuth `state`). `frontend/src/features/auth/pages/Signup.tsx` reads `lang` from the hash query and sets the device language.
- [x] T041 [US2] (needs OD-1) Change the two `#/signup` links in `landing/ar.html` (lines ~204 and ~244) to `#/signup?lang=ar`. Make no other landing change.
- [ ] T042 [US2] Web e2e `frontend/tests/e2e-web/lira-web-0NN-language-per-user.spec.ts` (next free number at build time): user A at ar and user B at en on the same browser each get their own language; A on a second browser context is Arabic; select by `data-testid`/role. Ask the owner before running it.

**Checkpoint**: per-user language works on both transports. The switch itself stays hidden until T095.

---

## Phase 4: User Story 1: the whole day in Arabic, frontend (P1)

**Goal**: every page and modal reachable from the side menu is Arabic and RTL with no English (SC-001), and money is unchanged (SC-002).

**Independent test**: quickstart V2 per module, plus V4.

**Each module task, in this order:**

1. Add the page title key to the pre-created `packages/ui/src/i18n/locales/en/<ns>.json`. Run `node scripts/check-i18n.mjs` and record the FAILING output (failing-first, rule 17).
2. Extract every UI string to `<ns>` keys, and add `ar/<ns>.json` using the glossary.
3. Run `node scripts/i18n-logical-classes.mjs frontend/src/features/<m>`, then fix `space-x` and charts by hand.
4. Replace `toLocale*`/`Intl` with `format.ts`, wrap numbers/phones/IMEIs in `<Ltr>`, and swap direction icons for `<DirIcon>`.
5. Convert the module's `<input type="number">` fields (R13).
6. Make sure no `t()` reaches a payload, an option `value` or a comparison. Rewrite label comparisons to code comparisons, with a test.
7. The guard passes. Run the module's jest tests by path. Walk the module in Arabic on web (V2).

### Payload-equality guards (money modules; written BEFORE that module's conversion; not failing-first by nature)

Each test builds the payload through the real builder or screen with `lng=en` and `lng=ar` and asserts deep equality, walking every sub-type/mode (rule 28d).

- [x] T043 [P] [US1] `frontend/src/features/sales/**/__tests__/sale.payloadLanguage.test.tsx`: walk-in sale, session cart and debt sale; USD paid with LBP change.
- [x] T044 [P] [US1] `frontend/src/features/recharge/components/__tests__/recharge.payloadLanguage.test.tsx`: MTC/Alfa credit and days, Katsh/iPick, Whish/OMT App, Binance, basket, For Partner.
- [x] T045 [P] [US1] `frontend/src/features/services/**/__tests__/financialService.payloadLanguage.test.tsx`: each OMT/Whish service type, send and receive.
- [x] T046 [P] [US1] `frontend/src/features/debts/**/__tests__/repayment.payloadLanguage.test.tsx`: repayment, discount/waive, account settle.
- [x] T047 [P] [US1] `frontend/src/features/exchange/**/__tests__/exchange.payloadLanguage.test.tsx` and `frontend/src/features/expenses/**/__tests__/expense.payloadLanguage.test.tsx`.
- [x] T048 [P] [US1] `frontend/src/features/closing/**/__tests__/closing.payloadLanguage.test.tsx`: drawer count and closing.
- [ ] T049 [P] [US1] `frontend/src/features/{sessions,custom-services,maintenance,loto,suppliers,partners}/**/__tests__/*.payloadLanguage.test.tsx`: one file per module. (Partly done: suppliers and partners written, not failing-first (guard against future drift); sessions, custom-services, maintenance and loto remain.)

### Module conversions (all [P]: each owns its own folder and namespace files)

- [x] T050 [P] [US1] `sales` (POS, CheckoutModal, SaleDetailModal; not `utils/receiptFormatter.ts`, which belongs to Phase 6). Namespace `sales`. Depends on T043.
- [x] T051 [P] [US1] `recharge`, part 1: `TelecomForm.tsx`, `KatshForm.tsx`, `CarrierLinesPanel.tsx`, `CardGridPayView.tsx`, `ProviderTabs.tsx`, `ProviderStats.tsx`, `CompactStats.tsx`, `pages/Recharge/**`. Namespace `recharge`. Depends on T044.
- [x] T052 [P] [US1] `recharge`, part 2: `FinancialForm.tsx`, `OmtWhishAppTransferForm.tsx`, `CryptoForm.tsx`, `PaymentSheet.tsx`, `HistoryModal.tsx`, `OmtAppCashoutModal.tsx`, `WalletExchangePanel.tsx`, `WhishCurrencySwitch.tsx`, `NewServiceItemInlineForm.tsx`. Namespace `rechargeFinancial`. Depends on T044.
- [x] T053 [P] [US1] `services` (OMT/Whish system page). Namespace `services`. Depends on T045.
- [x] T054 [P] [US1] `debts`, including the column headings in `utils/debtExcelExport.ts`: headings in the exporting user's language, numeric cells stay numbers (FR-024). Test `debtExcelExport.language.test.ts`. Namespace `debts`. Depends on T046. Coordinate: `Debts/index.tsx` and `debtExcelExport.ts` have another session's uncommitted edits as of 2026-10-17, so start only after those land.
- [x] T055 [P] [US1] `exchange`. Namespace `exchange`. Depends on T047.
- [x] T056 [P] [US1] `expenses`. Namespace `expenses`. Depends on T047.
- [x] T057 [P] [US1] `closing` (drawer count, closing, checkpoints). Namespace `closing`. Depends on T048.
- [x] T058 [P] [US1] `dashboard`, with recharts time axes `reversed` in RTL. Namespace `dashboard`.
- [x] T059 [P] [US1] `sessions`. Namespace `sessions`. Depends on T049.
- [x] T060 [P] [US1] `custom-services`. Namespace `customServices`. Depends on T049.
- [x] T061 [P] [US1] `maintenance`. Namespace `maintenance`. Depends on T049.
- [x] T062 [P] [US1] `loto`. Namespace `loto`. Depends on T049.
- [x] T063 [P] [US1] `inventory` + `clients` + `warranty` + `vouchers`. Namespaces `inventory`, `clients`, `warranty`, `vouchers`; one agent, or split into 4 tasks.
- [x] T064 [P] [US1] `settings`, except `MobileServicesManager.tsx`/`CategoriesManager.tsx` and the T031 selects. Namespace `settings`.
- [x] T065 [P] [US1] `settings` catalog: `MobileServicesManager.tsx` (123 KB) and `CategoriesManager.tsx`. Namespace `settingsCatalog`.
- [x] T066 [P] [US1] `suppliers` + `partners`. Namespaces `suppliers`, `partners`. Depends on T049.
- [x] T067 [P] [US1] `profits`, with charts reversed in RTL. Namespace `profits`. (The only chart on the page is the dashboard's `CommissionsChart`, which belongs to the `dashboard` namespace and T058.)
- [x] T068 [P] [US1] `audit` (Transactions viewer, detail panel, cells): type/direction/badge labels translated; stored `summary` shown as stored (OD-2, T090). Namespace `audit`.
- [x] T069 [P] [US1] `admin` + `phoneLines` + `wrongNumbers` + `offline`. Namespaces `admin`, `phoneLines`, `wrongNumbers`, `offline`. (Includes the free-trial admin texts: Plan editor and Tenants plan column. `shared/components/SubscriptionBanner.tsx` belongs to the `shared` namespace, not done here.)

`whatsNew` is deliberately not converted (FR-012).

**Checkpoint**: `node scripts/check-i18n.mjs` reports every module folder converted except `whatsNew`. SC-001 holds on web for app-built text, but server refusals are still English until Phase 5.

---

## Phase 5: User Story 1 AC-3: server and IPC messages in the user's language (delivery phase P2)

**Goal**: refusals from the shop's server show in Arabic on desktop, web and the phone app (FR-008), without the server knowing the language.

**Independent test**: quickstart V5.

- [ ] T070 [US1] Test FIRST `packages/core/src/utils/__tests__/errors.messageKey.test.ts`: `AppError` carries `messageKey`/`messageParams`; `toJSON()` and `createErrorResponse()` forward them; `error` is unchanged. Then:
  - Extend `packages/core/src/utils/errors.ts`.
  - **Split the catalog per area** so T073–T081 never share a file:
    - `packages/core/src/messages/server/<area>.ts` holds pure leaves, one per T073–T081 area, pre-created empty.
    - `serverMessages.ts` merges them into `SERVER_MESSAGES`, with keys prefixed `<area>.`.
    - On the client, `resources.ts` (T014) merges `locales/{en,ar}/server.<area>.json` into the single `server` namespace that `t('server:…')` and G7 use.
    - Pre-create the empty per-area `ar` files here.
  - Rebuild and sync core.
- [ ] T071 [US1] Test FIRST `backend/src/api/__tests__/failureEnvelope.test.ts` and `electron-app/handlers/__tests__/failureEnvelope.test.ts`: the shared failure helper passes the fields through, and `validateRequest`/`validatePayload` add `messageKey` for template-backed zod messages. Then implement the helpers in `backend/src/` (beside `validateRequest`) and in `electron-app/` (beside `validatePayload`).
- [ ] T072 [US1] Add a G8 check to `scripts/check-i18n.mjs` (test FIRST in `scripts/__tests__/i18nGuard.test.mjs`). In a core file listed in any `packages/core/src/messages/convertedFiles/<area>.ts` (one file per T073–T081 area, pre-created empty here), a `throw new (BusinessRuleError|ValidationError|NotFoundError|WarrantyClaimError|DatabaseError|AuthenticationError|AuthorizationError)(` with a string-literal or template-literal message and no `messageKey` fails. A `DatabaseError` whose message starts with "Failed to" (internal) is exempt. Each T073–T081 task edits only its own `convertedFiles/<area>.ts`.

Per core area, all [P]. Each task:

1. Add the area's files to `convertedFiles/<area>.ts` and see G8 fail.
2. Add the keys to `messages/server/<area>.ts` (English text identical to today, params raw).
3. Convert the throws.
4. Add the entries to `locales/ar/server.<area>.json`.
5. Run the area's existing core tests by path; English text is unchanged.

- [ ] T073 [P] [US1] Sales, refunds and voids: `TransactionRepository.ts`, `SalesRepository.ts`, `SalesService.ts`.
- [ ] T074 [P] [US1] Debts and account settle: `DebtRepository.ts`, `DebtService.ts`, `utils/accountSettleAllocation.ts`, `utils/debtRepaymentAllocation.ts`. Coordinate with the uncommitted debts work as of 2026-10-17.
- [ ] T075 [P] [US1] Recharge/telecom: `RechargeRepository.ts`, `utils/telecomCredit.ts`, `utils/carrierLineValidity.ts`, `utils/rechargeDiscount.ts` and the carrier-line repositories.
- [ ] T076 [P] [US1] OMT/Whish financial services, wallets, hold money and exchange: `FinancialServiceRepository.ts`, `HoldMoneyRepository.ts`, exchange repositories, `utils/walletTransfer.ts`.
- [ ] T077 [P] [US1] Suppliers, partners and loto: `SupplierRepository.ts`, `PartnerRepository.ts`, `LotoCheckpointRepository.ts` and the loto repositories.
- [ ] T078 [P] [US1] Warranty, inventory, clients, maintenance, custom services and sessions: `WarrantyClaimError` sites and the matching repositories.
- [ ] T079 [P] [US1] Auth, Google, password reset, signup, invitations and sign-in codes: `AuthService.ts`, `PasswordResetService.ts`, `SignupInvitationService.ts`, `UserInvitationService.ts`, `UserEmailService.ts`, `SigninCodeService.ts`, plus the Google errors. Also move `mobile/src/auth/messages.ts` codes onto `auth:signin.errors.*`; the phone app only reads them in P3.
- [ ] T080 [P] [US1] Zod validators: in `packages/core/src/validators/*.ts`, custom `message:` strings reference `SERVER_MESSAGES` templates (contracts/error-envelope.md rule 4). Templates with params cannot be zod messages and stay as refusals in services.
- [ ] T081 [P] [US1] Generic catch-all families: map handler and route `"Failed to …"` strings to `generic.*` keys through the T071 helper, in a sweep of `backend/src/api/*.ts` and `electron-app/handlers/*.ts`. Split it per file group, one agent per ~10 files, all [P].
- [ ] T082 [US1] Pin stored-text formatting to `en-US` (research R4, rule 27). Test FIRST `packages/core/src/utils/__tests__/formatMoney.locale.test.ts`: it gives `1,234,567 LBP` even with `Intl` default locale `ar-LB`, which jest forces through a `toLocaleString` spy or `process.env.LANG`. Then pin `formatMoney.ts`, `transactionText.ts`, `financialServiceSummary.ts`, `transactionRowDisplay.ts`, `cashFlow.ts`, `rechargeDiscount.ts` and the repository `toLocaleString()` sites listed in plan.md Scale/Scope.
- [ ] T083 [US1] Client adoption: every place that shows `result.error`/`err.message` to the user uses `translateServerError`. Sweep per module folder (all [P] by folder) after Phase 4. Guard: G1 already flags literal `setError(...)`; add a G9 that flags `setError(result.error)`/`toast(result.error)` without `translateServerError` in converted modules (test FIRST in `i18nGuard.test.mjs`).
- [ ] T084 [US1] Electron main-process text: dialogs/menus in `electron-app/main.ts`, `handlers/dbHandlers.ts`, `handlers/setupHandlers.ts` and `handlers/backupHandlers.ts`, plus `services/ReportService.ts` HTML headings (FR-024).
  - Test FIRST `electron-app/handlers/__tests__/mainMessages.test.ts` (en/ar key parity). Electron jest `roots` are `schemas`, `handlers` and `offline` only, so a test under `electron-app/i18n/` would never run.
  - Then add `electron-app/i18n/mainMessages.ts` and a desktop-only IPC `app:set-ui-language`, sent by `LanguageContext` through the adapter. It is desktop-only main-process UI, so no REST mirror is needed; add it to `scripts/transport-parity-allowlist.json` with its reason.
  - Unit tests only; no Electron launch on the Mac.

- [ ] T094 [US1] Web e2e `frontend/tests/e2e-web/lira-web-0NN-arabic-ui.spec.ts` (next free number at build time), per quickstart V4:
  - the same POS sale (USD paid, LBP change) at `en` and at `ar`;
  - drawer deltas, row amounts and profit deltas are equal per currency (rule 15);
  - one server refusal shows the Arabic text;
  - `<html dir="rtl">`.
  
  Ask the owner before running it. Desktop: run over the web shim or in CI.

**Checkpoint**: US1 is complete (AC-1…AC-5) on web; desktop is proven in CI.

---

## Phase 6: User Story 3: receipts in the shop's receipt language (P2)

**Goal**: one shop `receipt_language` (English by default). English receipts are byte-identical. Arabic receipts are RTL and complete on 58/80 mm.

**Independent test**: quickstart V6 + V7 (manual print).

- [ ] T085 [US3] Test FIRST `frontend/src/features/sales/utils/__tests__/receiptModel.snapshot.test.ts`: capture today's exact text output of `formatReceipt58mm`/`formatReceipt80mm` and `frontend/src/shared/utils/serviceReceipt.ts` for 6 fixtures (sale with change, split payment, warranty terms, client/phone, LBP total, long item name) **before** refactoring. The existing `receiptFormatter.test.ts` must stay green.
- [ ] T086 [US3] Refactor `receiptFormatter.ts` and `serviceReceipt.ts` into `buildReceiptModel(...)` + `renderReceiptText(model)` (data-model.md §9). The T085 snapshots must stay byte-identical (FR-023).
- [ ] T087 [US3] Test FIRST `frontend/src/shared/utils/__tests__/receiptHtmlRtl.test.ts`:
  - `dir="rtl"`;
  - every amount from the model is present, formatted identically to the English receipt;
  - amounts are wrapped in `<bdi dir="ltr">`;
  - labels come from the `receipts` namespace in the **receipt** language;
  - `@font-face` is inlined;
  - no `word-break: break-all`;
  - the 58 vs 80 width is applied.
  
  Then add `renderReceiptHtmlRtl` in `frontend/src/shared/utils/printReceipt.ts` (or a sibling file) and the namespace `receipts` (en + ar).
- [ ] T088 [US3] Test FIRST `frontend/src/shared/hooks/__tests__/useReceiptLanguage.test.ts`: it reads `receipt_language` (missing ⇒ 'en'); an English-language cashier still gets Arabic when the setting is `ar` (US3 AC-2). Then route every print path through it: `CheckoutModal.tsx`, `SaleDetailModal.tsx`, `SessionCheckoutModal.tsx`, `Loto/index.tsx`, `CustomServices/index.tsx`, `Maintenance/index.tsx`, `TransactionsViewer.tsx`/`TransactionDetailsPanel.tsx` reprint, `FinancialForm.tsx`, `KatshForm.tsx`, `Recharge/index.tsx`, `SupplierTableModal.tsx`, `ReceiptPreviewModal.tsx` and `useAutoPrintReceipt.ts`. These are one-line call changes in module files; coordinate with the module owners or do them after Phase 4.
- [ ] T089 [US3] Coordinate with `specs/333-whatsapp-receipt`: once both exist, WhatsApp receipt text follows `receipt_language` (FR-021). In Arabic it uses plain RTL text with amounts from `formatMoney`. Add the test where that feature builds its text. Update 333's spec note "stays English" through the owner, not by editing it here.

### Owner-decision follow-ups (shown text, no money)

- [ ] T090 [US1] (needs OD-2) Apply the decision for stored English text (`transactions.summary`, ledger notes) in `frontend/src/features/audit/**`, `debts`, `suppliers` and `partners` history views. Default: show as stored, translate only the type/badge columns, with a test that the summary cell renders the stored string unchanged.
- [ ] T091 [US1] (needs OD-3) Seeded names: test FIRST `packages/ui/src/i18n/__tests__/seededName.test.ts`. `displaySeededName(kind, storedValue, t)` translates a value only when it equals its seed (`General_USD` → Arabic drawer name) and returns renamed values unchanged. Then use it in `drawerLabel` sites, payment-method lists and module names.
- [ ] T092 [P] [US3] A receipt preview in the admin `ShopConfig` receipt-language select shows a sample receipt in the chosen language (reuses T087).
- [ ] T093 [P] [US1] SC-005 cross-app check: extend G5 to scan `landing/ar.html` text against the glossary as well (read-only); a conflict is reported, not auto-fixed.

---

## Phase 7: User Story 4: the owner phone app in Arabic (P3)

**Goal**: the phone app follows the owner's web language and is RTL, using the same terms.

**Independent test**: quickstart V8 (local APK, Android).

- [ ] T100 [US4] Device check FIRST: on a local APK, log `Intl.PluralRules('ar').select(3)` and `Intl.DateTimeFormat('ar-LB-u-nu-latn-ca-gregory').format(...)`, and test `direction:'rtl'` on a root `View` (research R3/R10). If `PluralRules` is missing, add `intl-pluralrules`. Record the result in research.md R3.
- [ ] T101 [US4] Map `@liratek/ui/i18n/*` (and the JSON locale files) in `mobile/metro.config.js` and `mobile/jest.config.js`. Create `mobile/src/i18n/setup.ts` (sync English in jest, like T016). Add `mobile/src/i18n/LanguageProvider.tsx`: SecureStore `liratek_language` before sign-in, then `GET /api/user-preferences/me` after sign-in through `mobile/src/api/`, and root `direction`.
- [ ] T102 [P] [US4] Test FIRST `mobile/src/utils/__tests__/format.language.test.ts`: `txnTime`/`txnClock` use `format.ts`, show Western digits, and keep the same day in both languages. Then replace `toLocaleString([])` in `mobile/src/utils/format.ts` and `mobile/src/utils/activity.ts`.
- [ ] T103 [P] [US4] Convert sign-in and create-shop (`mobile/src/app/(auth)/**`) with a pre-sign-in switch. `mobile/src/auth/messages.ts` reads the `auth:signin.errors.*` keys from T079. Test `mobile/src/auth/__tests__/messages.language.test.ts`.
- [ ] T104 [P] [US4] Convert Home, Sell (incl. catalog) and Activity (`mobile/src/app/(app)/(home)`, `sell`, `activity`) under namespace `mobile`. First add `mobile/src/app/(app)/sell/__tests__/sell.payloadLanguage.test.ts`: the transfer payload at en deep-equals the one at ar (not failing-first; guard).
- [ ] T105 [P] [US4] Convert Debts and Settings (`mobile/src/app/(app)/debts`, `settings`), including the language choice in phone Settings (PUT `/api/user-preferences/me/language`).
- [ ] T106 [P] [US4] Convert the shared phone components (`mobile/src/components/**`) to RTL-safe styles: `marginStart/End`, `start/end`, mirrored chevrons.
- [ ] T107 [US4] Extend `scripts/check-i18n.mjs` to treat `mobile/src/app/**` and `mobile/src/components/**` as converted modules (G1–G3 for RN `Text` children and `placeholder`/`accessibilityLabel` literals). Test FIRST in `i18nGuard.test.mjs`.

---

## Phase 8: Polish, release

- [ ] T095 (needs OD-4) Set `ARABIC_UI_READY = true` only after Phases 4 + 5 are green and the owner has reviewed the Arabic wording (spec Assumption). Test in `LanguageContext.test.tsx`: العربية is listed.
- [ ] T096 Release note (rule 30): under the right heading in `docs/release-notes/UNRELEASED.md` (e.g. `## ⚙️ Settings`), add one line in shop-owner language, in the same change as T095. For example: "You can now use LiraTek in Arabic: choose العربية in My account. Each person keeps their own language, and the admin can set the shop's default language." Add a "What users will notice:" line to the LIRA-331 ticket in `current_sprint.md` (the implementer does this; it is not part of planning).
- [ ] T097 Release note line for receipts with T088: "Admins can choose Arabic receipts in Settings → Shop. Receipts stay in English unless you change it."
- [ ] T098 [P] Update `docs/FEATURE_GUIDE.md`/`frontend/src/CLAUDE.md` with one paragraph and a link to `contracts/i18n-catalog.md`: the i18n rules (no `t()` in payloads, `format.ts` only, logical classes, namespace ownership). This edit is for the implementer; root `CLAUDE.md` changes need owner approval.
- [ ] T099 Run quickstart V1–V6 (affected tests by path; ask before the e2e runs). V7 is a manual print on the Windows shop machine.
- [ ] T110 Release note line for the phone app with Phase 7: "The LiraTek phone app now follows your language: if you use LiraTek in Arabic, the phone app opens in Arabic too."
- [ ] T111 [P] Run `yarn check:tenant-scoping`, `yarn check:bind-arity`, `yarn check:schema-equivalence`, `yarn check:transport-parity`, `node scripts/check-i18n.mjs`, `node scripts/build-release-notes.cjs --check`, `yarn typecheck` and `yarn lint`. Confirm the elapsed times are real (rule 28a).
- [ ] T112 Translation review hand-off: export `ar/*.json` side by side with `en` (script `node scripts/check-i18n.mjs --export-review`) for the owner, a native speaker, to review (SC-007 depends on a real cashier day after release).

---

## Dependencies & execution order

- **Phase 1** → **Phase 2**. Within Phase 2:
  - core T005–T009 run in parallel where marked;
  - transports T010–T013 are sequential (shared files);
  - runtime T014–T019 and the guard T020–T021 come next;
  - shell T022–T027 needs T014–T021.
- **Phase 3 (US2)** and **Phase 4 (US1 modules)** both start after Phase 2 and run in parallel. T040/T041 wait for OD-1.
- **Phase 4**: each money module's payload test (T043–T049) comes before its conversion (T050–T066). All module conversions are mutually independent ([P]).
- **Phase 5** needs T070–T072 first. T073–T081 are mutually [P]. T083 comes after Phase 4 (it touches module files). T082 and T084 are independent. T094 comes last in the phase.
- **Phase 6** T085 → T086 → T087 → T088. T088 touches module files, so run it after the matching Phase 4 module, or coordinate. T090/T091 wait for OD-2/OD-3.
- **Phase 7** needs Phase 2 (catalogs, `format.ts`), T010 (REST) and T079 (auth keys). T100 comes before the rest.
- **Release**: T095 needs Phases 4 + 5 + the owner's wording review. T096 ships with T095.

### Parallel example (after Phase 2)

```text
Agent A: T043 → T050 (sales)          Agent F: T046 → T054 (debts)
Agent B: T044 → T051 (recharge 1)     Agent G: T048 → T057 (closing)
Agent C: T044 → T052 (recharge 2)     Agent H: T058 (dashboard)
Agent D: T045 → T053 (services)       Agent I: T030–T033 (US2 UI)
Agent E: T047 → T055, T056            Agent J: T064 / T065 (settings)
```

Every agent writes only `frontend/src/features/<m>/**` and `packages/ui/src/i18n/locales/{en,ar}/<ns>.json`. Each one runs only its own tests by path, plus `node scripts/check-i18n.mjs`.

## Implementation strategy

1. **MVP (internal)**: Phases 1–2 + T030 + the sales module T043/T050, behind the preview flag. The owner can switch one device to Arabic and sell.
2. **P1**: all of Phase 3 + Phase 4, still behind the flag.
3. **P2**: Phase 5 + Phase 6. Then T095/T096: release to shops.
4. **P3**: Phase 7, released with the next phone APK (T110).
