# Research: Arabic app UI (LIRA-331)

Phase 0 decisions. Each one gives the Decision, the Rationale and the Alternatives considered. Facts marked "measured" were checked in the repo or with Node 22 on 2026-10-17.

## R1. i18n library: one choice for web, desktop and the phone app

- **Decision**: `i18next` + `react-i18next`.
- **Rationale**:
  - It runs unchanged in Vite (frontend), in jest (no transform) and in React Native/Metro. The phone app can therefore load the same JSON catalogs.
  - No compile step or Babel/SWC macro, so neither the Vite config nor the Metro config needs touching.
  - Typed keys through `CustomTypeOptions`: a mistyped key is a compile error.
  - `fallbackLng: 'en'` gives FR-011's "never blank, never a key" behaviour.
  - Namespaces map 1:1 to module files, which is what makes parallel module work possible.
  - Built-in Arabic plural suffixes (`_zero/_one/_two/_few/_many/_other`) through `Intl.PluralRules`. Measured: `new Intl.PluralRules('ar').select(3)` gives `few`.
  - `changeLanguage` re-renders subscribers without remounting, so unsaved input survives (FR-002).
- **Alternatives considered**:
  - FormatJS / `react-intl`: ICU messages are powerful, but the runtime is heavier, React Native needs several Intl polyfills, and extraction tooling assumes a Babel plugin.
  - Lingui: the best extraction tooling, but it needs a compile macro in both Vite and Metro, plus a catalog compile step in CI. That is too much build surgery for a monorepo with three bundlers.
  - A hand-rolled dictionary: no plurals, no typed keys, no lazy loading. It would be rewritten later.

## R2. Where the catalogs and formatters live

- **Decision**: `packages/ui/src/i18n/`, as pure leaf files (JSON + small TS modules with no React and no Node imports). Each app creates its own i18next instance (`frontend/src/i18n/setup.ts`, `mobile/src/i18n/setup.ts`).
- **Rationale**:
  - `packages/ui` is already consumed as TS source by the frontend.
  - `mobile/metro.config.js` already resolves `@liratek/ui/<file>` to single pure files.
  - Core must not depend on it: Electron main and the backend run core's compiled `dist`. A source-only package imported from core would fail at runtime, and i18next has no business on the server (rule 27).
- **Alternatives considered**:
  - A new `packages/i18n` workspace: this needs its own build step to be importable from compiled core, and adds workspace plumbing for little gain.
  - Catalogs inside `frontend/`: the phone app could not reuse them, which fails FR-010/SC-005.

## R3. Hermes `Intl` on Android

- **Decision**: rely on Hermes `Intl` (`DateTimeFormat`, `NumberFormat`, `PluralRules`). Verify it on a real device as the first P3 task (T100). If `PluralRules` is missing, add the `intl-pluralrules` polyfill. Only the phone app is affected.
- **Rationale**: Likely, based on Hermes release notes up to RN 0.7x: Android Hermes exposes these through the platform ICU. This is not verified on our RN 0.83 build, so it is not assumed.
- **Alternatives considered**: i18next `compatibilityJSON: 'v3'`, which avoids `PluralRules`. Rejected because it gives the wrong Arabic plurals.

## R4. Number formatting

- **Decision**: numbers never depend on language. `formatNumber`/`formatMoney` in `packages/ui/src/i18n/format.ts` use `Intl.NumberFormat('en-US', …)` in both languages.
- **Rationale**: FR-016 asks for Western digits and the same look everywhere. Measured with Node 22:
  - `Intl.NumberFormat('ar-LB-u-nu-latn').format(1234567.5)` gives `1.234.567,5`. The dot is the thousands separator and the comma is the decimal mark, so a cashier could read a different amount.
  - `ar-LB` without `nu-latn` gives `١٬٢٣٤٬٥٦٧٫٥` (Arabic-Indic digits).
  - Only `en-US` guarantees `1,234,567.5`.
- **Also**:
  - Core's stored-summary formatting (`utils/formatMoney.ts`, `transactionText.ts`, `financialServiceSummary.ts`, `transactionRowDisplay.ts`, `cashFlow.ts`, `rechargeDiscount.ts` and about 10 repository call sites) uses `toLocaleString()` with **no locale**. That is a rule 27 hazard today: a Windows desktop with an Arabic regional setting would store `١٬٢٣٤` in `transactions.summary`.
  - All of these are pinned to `'en-US'`. The visible output is unchanged on every machine that formats en-US today.
- **Alternatives considered**: `ar-u-nu-latn` for Arabic numbers. It is correct today in Node (`1,234,567.5`), but it is one CLDR change away from differing, and it buys nothing.

## R5. Date formatting

- **Decision**: `formatDate/formatTime/formatDateTime(value, lang, style)`. English uses `en-US`. Arabic uses `ar-LB-u-nu-latn-ca-gregory`.
- **Rationale**: measured with Node 22:
  - `ar-LB-u-nu-latn-ca-gregory` gives `15 كانون الثاني 2026 في 2:05 م`: Levantine month names, Western digits, Gregorian calendar (FR-016/FR-020).
  - Plain `ar` gives `يناير`.
  - The timezone handling stays exactly as today: the formatter never adds a `timeZone`. The calendar day shown is therefore identical in both languages (FR-020).
  - Day bucketing keeps using `localDay()`/`clientDay()` (rule 27), never formatted strings.
- **Owner decision OD-5**: Levantine vs standard month names. Levantine is recommended. Switching is one locale string.
- **Alternatives considered**: `date-fns` locales. They are already a dependency, but `date-fns/locale/ar` uses standard names, and a second date path would duplicate `Intl`.

## R6. RTL approach

- **Decision**:
  - `dir`/`lang` on `<html>`.
  - Tailwind v4 logical utilities replace the physical ones, converted per module by a scripted codemod (`scripts/i18n-logical-classes.mjs`, run per folder). In LTR the result is identical: `ms-2` equals `ml-2` there.
  - `rtl:` variants only for icon mirroring (`<DirIcon>`).
  - `<bdi dir="ltr">` around numbers, phones, IMEIs and references (`<Ltr>`).
  - `index.css` converted to logical properties (23 physical lines measured).
  - Recharts time axes get `reversed` when `dir === 'rtl'`.
- **Rationale**:
  - Tailwind v4.1 (in use) ships `ms-/me-/ps-/pe-/start-/end-/text-start/text-end/border-s/border-e/rounded-s/rounded-e` and the `rtl:` variant.
  - Logical classes make one class list correct in both directions, with no duplicate `rtl:ml-0 rtl:mr-2` pairs.
- **Alternatives considered**:
  - `rtlcss` post-processing a second stylesheet: Tailwind's JIT classes are in the markup, and a flipped second bundle doubles the CSS and still misses inline styles.
  - Leaving physical classes and adding `rtl:` overrides: doubles every class and is easy to forget.

## R7. String extraction at scale (about 130k lines of TSX)

- **Decision**:
  - Convert module by module. The guard in plan D5 counts a module as converted once its namespace file exists.
  - **Foundational** converts the shared shell first: layout/nav, `packages/ui` components, `shared/` and auth. Every module renders inside these, and they are the files several module agents would otherwise collide on.
  - Each module task: create the namespace file (guard fails, which is the failing-first proof) → extract strings to `en` → add `ar` using the glossary → codemod logical classes → swap `toLocale*` for `format.ts` → guard passes.
  - Extraction can be assisted by a script that lists candidate strings per file (`node scripts/check-i18n.mjs --list <dir>`). A person or agent still names the keys. There is no blind auto-keying.
- **Rationale**:
  - One namespace file per module per language means parallel agents never edit the same file.
  - Detecting conversion from the file's existence removes the shared "converted modules" list, which would otherwise be a merge hotspot.
- **Alternatives considered**:
  - A big-bang extraction PR: unreviewable, and it conflicts with every concurrent session.
  - An ESLint plugin (`i18next/no-literal-string`): frontend lint runs `--max-warnings=9999`, so it needs error-level scoping per folder anyway, and it cannot see the module-converted signal or the `ar` key parity. One script covers all seven checks.

## R8. Existing tests that assert English text

- **Decision**: `frontend/jest.setup.ts` initialises i18n **synchronously** (`initAsync: false`) with the bundled `en` resources and `lng: 'en'`. `t()` therefore returns the same English text the tests assert today. Mobile jest gets the same setup.
- **Rationale**: thousands of frontend assertions and the 104K `lira-web-071-shop-day.spec.ts` select by English text. With English as the default, none of them change.
- **Alternatives considered**: mocking `react-i18next` to return keys. That would break every existing text assertion, which is wrong.

## R9. Keeping translation out of saved data (SC-002 / FR-018)

- **Decision**: three guards.
  1. **Payload equality test per money form** (rule 28d style). Build the form's payload through the real builder with i18n at `en`, then again at `ar`, and assert they are deep-equal. Each money module's conversion task writes this first.
  2. **No `t(` inside payload builders and option `value`s.** Option arrays use stable codes (`value: 'CASH'`, `label: t(...)`), never a translated label as the value. Conversion tasks must never rewrite comparisons such as `if (label === "Cash")`. Such sites are converted to code comparisons first, with a test.
  3. **The structural guard** (D5 #6): no i18next in core.
- **Rationale**: the realistic way Arabic corrupts money is not arithmetic. It is a translated label ending up as a payload value, a note, a category or a comparison key.
- **Alternatives considered**: re-running `lira-web-071` in Arabic. Its selectors are English text, so it would fail everywhere without proving anything. Instead one new web e2e compares deltas for a sale done in each language (quickstart V4).

## R10. Phone app RTL

- **Decision**: a root `View` with `style={{ direction: lang === 'ar' ? 'rtl' : 'ltr' }}`, plus `writingDirection` on text components. No `I18nManager.forceRTL`.
- **Rationale**:
  - `forceRTL` takes effect only after an app restart. The project avoids `expo-updates`/EAS (owner rule: local APK builds only), so a programmatic reload is not available.
  - Yoga's `direction` style flips flex layout immediately. Likely, based on React Native's layout docs; verified in T100.
- **Alternatives considered**: `forceRTL` + asking the user to restart. That is poor UX and fails "switch takes effect immediately".

## R11. Arabic receipts

- **Decision**:
  - Split the receipt builders into `ReceiptModel` → `renderReceiptText` (English, byte-identical to today) and `renderReceiptHtmlRtl` (Arabic).
  - Inline a subset Arabic font (Noto Naskh Arabic or Noto Sans Arabic, OFL) as base64 `@font-face` in the Arabic receipt HTML only.
  - Target under 150 KB after subsetting to Arabic + Latin + digits. Measure in T003.
- **Rationale**: measured in `frontend/src/features/sales/utils/receiptFormatter.ts` and `shared/utils/printReceipt.ts`, today's receipt is padded monospace text:
  - `padEnd`/`padStart` to 42 (58 mm) or 56 (80 mm) characters;
  - inside `<pre>` with `font-family: 'Courier New'`, `word-break: break-all`.
  
  Arabic cannot go through that path:
  - Courier New has no Arabic glyphs, so the fallback font is proportional and the padding misaligns.
  - Shaping and marks such as the shadda in الفكّة change the visual width.
  - `break-all` splits words mid-letter.
  
  Electron prints from a `data:` URL (`electron-app/handlers/printHandlers.ts`), so a relative font URL does not resolve. Inlining keeps offline desktop printing deterministic. Chromium does the shaping and bidi, both in Electron and in browser printing.
- **SC-006 (physical 58/80 mm print)**: manual check on the shop's printers (quickstart V7). Automated tests cover structure and amounts only.
- **Alternatives considered**:
  - Relying on system fonts (Tahoma/Arial have Arabic on Windows): non-deterministic across Android/Chromebook web printing, and an unknown on thermal driver rasterising.
  - ESC/POS raw Arabic code pages: printers vary, and the app does not print raw.

## R12. Things that need an owner decision (blocking specific tasks)

| Id | Question | Recommended | Blocks |
| --- | --- | --- | --- |
| OD-1 | FR-006 needs to know the owner came from the Arabic landing. Cross-origin `Referrer-Policy: strict-origin-when-cross-origin` (`landing/vercel.json`) sends only `https://liratek.shop/`, so the `/ar` path is lost. May the two `#/signup` links in `landing/ar.html` become `#/signup?lang=ar`? This conflicts with the spec Assumption "landing pages not changed". | Yes, two-link edit. | T040, T041 |
| OD-2 | Stored English text that core writes (`transactions.summary`, ledger notes, audit text) is shown in the Transactions table and the detail panels. SC-001 says zero English. Show it as stored, or re-render it from LIRA-329 `metadata_json.details`? | Show as stored (it is data) and translate only the type/direction/badge columns. Re-rendering is a later ticket. | T090 |
| OD-3 | System-seeded names: drawer names such as `General_USD` shown through `drawerLabel`, payment method labels, default categories, module names. Translate them? | Translate only while the stored value still equals its seed value; a renamed value is user data. | T091 |
| OD-4 | Release gating: show العربية to shops after P1, while server refusals are still English until P2? | No. Keep it behind `ARABIC_UI_READY` until P1 + P2 are done, with a per-device owner preview flag (`liratek_arabic_preview`) for early testing. | T095 |
| OD-5 | Arabic month names: Levantine (كانون الثاني) or standard (يناير)? | Levantine (`ar-LB`). | T006 |
| OD-6 | The signup/invitation/password-reset **emails** are server-sent English text. The spec does not list them. Keep them English for now? | Yes. Note in the spec's Assumptions when it is next edited. | none |

## R13. Arabic-Indic digit input (FR-017)

- **Decision**:
  - `normalizeDigits()` maps U+0660–0669 and U+06F0–06F9 to 0–9, `٫` to `.` and `٬` to nothing.
  - It is applied in `packages/ui/src/components/ui/DecimalInput.tsx` and in phone/quantity inputs.
  - The 28 files with `<input type="number">` move to `DecimalInput` or a `type="text" inputMode="decimal"` field with normalisation. Browsers reject Arabic-Indic digits in `type=number`: the value becomes `""`.
- **Rationale**: one normaliser (rule 14) keeps the saved value identical whichever digits were typed.
- **Alternatives considered**: normalising at the server. The value would already be lost in the browser for `type=number`.

## R14. Server messages without the server knowing the language

- **Decision**: `messageKey` + `messageParams` (raw numbers and currency codes) in the failure envelope, translated client-side, with the English `error` kept. Details in `contracts/error-envelope.md`.
- **Rationale**:
  - Rule 27: the server should not decide presentation from ambient state.
  - It works identically for IPC, REST and the phone app.
  - Offline desktop needs no extra round trip.
  - Old clients ignore the new fields.
  - `mobile/src/auth/messages.ts` already proves the pattern by mapping `code` to wording on the client.
- **Alternatives considered**: an `Accept-Language` header with server-side translation. That puts i18n into core and the backend, needs the IPC path to carry the language, and breaks rule 27's "client supplies, server falls back" shape for no gain.

## Owner decisions 2026-10-17 (answers to R12)

- **OD-1:** yes. Add `?lang=ar` to the two signup links in `landing/ar.html`. This overrides the spec's "landing pages unchanged" assumption.
- **OD-2:** system-stored English text (transaction summaries, ledger notes) is shown as stored.
- **OD-3:** system-seeded names (drawers, payment methods, categories) are translated only while the value still equals its seed.
- **OD-4:** Arabic stays hidden behind a switch until P2 is done.
- **OD-5:** Lebanese month names (كانون الثاني، شباط، آذار…).
- **OD-6:** signup and password-reset emails stay English for now.
