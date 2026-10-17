# Data Model: Arabic app UI (LIRA-331)

The language is a display choice. None of these entities touch money tables.

## 1. User language: `users.language` (NEW column)

| Field | Type | Rules |
| --- | --- | --- |
| `language` | `TEXT NULL` | `CHECK (language IS NULL OR language IN ('en','ar'))`. NULL means "use the shop default" (FR-005). Users created before the update are NULL (spec edge case "Desktop after an update"). |

- **Migration**: one entry at the **next free version at build time**.
  - Read the last `version:` in `packages/core/src/db/migrations/index.ts` when writing it. It was v219 on 2026-10-17, and other sessions add migrations concurrently.
  - `up`: `ALTER TABLE users ADD COLUMN language TEXT DEFAULT NULL CHECK (language IS NULL OR language IN ('en','ar'))`.
  - `down`: `ALTER TABLE users DROP COLUMN language`.
  - The same column is added to the `users` CREATE TABLE in `electron-app/create_db.sql` (rule 10). It goes on the line with the other trailing columns, matching how v196/v202 placed theirs, so SQLite's DROP COLUMN stays valid. `yarn check:schema-equivalence` must pass.
- **Tenant scope**: rows are already tenant-scoped through `users.tenant_id`. Every read and write filters by `tenant_id` (`yarn check:tenant-scoping`).
- **Ownership**: written only by `UserRepository.setLanguage(userId, lang)` through `UserPreferencesService.setMine`. The actor is always the signed-in user (from the JWT or the IPC session), never a body field.
- **Not synced** desktop↔web (owner decision): the desktop DB and the web tenant DB are separate stores.

## 2. Shop default language: `system_settings.ui_default_language` (NEW key, no schema change)

| Key | Values | Missing ⇒ |
| --- | --- | --- |
| `ui_default_language` | `'en'` \| `'ar'` | `'en'` (FR-005: shops that change nothing keep English) |

- Written by an admin through the existing `PUT /api/settings/:key` (admin-only) and the matching IPC settings update.
- Also written once by signup when the owner came from the Arabic landing (FR-006).
- **Validation**: the settings write path validates these two keys against `languageSchema`. Unknown values are refused. Do the rule 23 three-way diff on the settings channel first.
- **No seed row**: the reader `SettingsRepository.getUiDefaultLanguage()` applies the default. The same pattern is used by `getShopBaseSystem()`.

## 3. Receipt language: `system_settings.receipt_language` (NEW key, no schema change)

| Key | Values | Missing ⇒ |
| --- | --- | --- |
| `receipt_language` | `'en'` \| `'ar'` | `'en'` (FR-023: today's receipts unchanged) |

- Read by every receipt and print path and by customer-facing text (FR-021), whatever the cashier's own language. Any role may read it: `GET /api/settings/:key` is open to every authenticated role.
- Written only by an admin.
- Signup from the Arabic landing does **not** change it, because receipts default to English.

## 4. Effective language (derived, not stored)

```
effectiveLanguage = users.language ?? system_settings.ui_default_language ?? 'en'
```

- One pure function, `resolveEffectiveLanguage` in `packages/core/src/utils/effectiveLanguage.ts`, used by the service, signup and tests (rule 14).
- A staff user who never chose a language therefore follows the shop default, including later changes to it (US2 AC-5).

## 5. Device language (client storage, not server)

| Where | Key | Meaning |
| --- | --- | --- |
| Web / desktop `localStorage` | `liratek_language` | Last language used on this device. It drives the sign-in and sign-up screens (FR-004) and serves as the offline-desktop cache. |
| Web / desktop `localStorage` | `liratek_arabic_preview` | `'1'` shows العربية before `ARABIC_UI_READY` (OD-4 owner preview). |
| Phone app SecureStore | `liratek_language` | Same meaning, for the phone app's sign-in screen. |

- On a first-ever visit, `navigator.language` (web/desktop) or the device locale (phone) is used if it starts with `ar`. Otherwise the language is `en`.
- This follows the existing per-device pattern in `frontend/src/contexts/ThemeContext.tsx`. The theme stays per device; only the language becomes per user.

## 6. Translation catalogs (files, not DB)

`packages/ui/src/i18n/locales/{en,ar}/<namespace>.json`

- **Namespaces**:
  - `common`, `layout`, `ui`, `auth`, `server`;
  - one per `frontend/src/features/<module>` (whatsNew excluded);
  - `mobile`, `receipts`, `reports`.
- **Keys**: `<screen>.<element>` inside the namespace, lower camelCase, e.g. `repay.title`, `repay.amountLabel`.
- **Rules** (enforced by `scripts/check-i18n.mjs`):
  - Every `en` key has an `ar` key with the **same `{{placeholders}}`**.
  - Plurals use the i18next suffixes, and Arabic carries all six where relevant.
  - Values never contain formatted numbers, currency symbols or dates. Those come in as params already formatted by `format.ts`.
  - Brand names from `brandNames.ts` appear verbatim in Latin letters.
- The `server` namespace: `en/server.json` is not hand-written. Its keys and English text are `SERVER_MESSAGES` from core (one source). `ar/server.json` is hand-written, and its key set must equal `SERVER_MESSAGES`.

## 7. Glossary (FR-010): `packages/ui/src/i18n/glossary.ts`

`GLOSSARY: Record<TermId, { en: string; ar: string; forbidden: string[]; source: 'landing' | 'owner' }>`

Seeded from `landing/ar.html`:

| TermId | en | ar | forbidden (examples) |
| --- | --- | --- | --- |
| `shopKind` | mobile shop | محل خليوي | محل هواتف |
| `drawers` / `drawer` | drawers / drawer | الصناديق / الصندوق | الأدراج، الدرج |
| `change` | change (money returned) | الفكّة | الباقي (as a noun for change), الصرافة |
| `currencies` | dollars and lira | الدولار والليرة | |
| `debts` / `debtBook` | debts / customer debt book | الديون / دفتر ديون الزبائن | الذمم |
| `closing` | closing | الإقفال | الإغلاق |
| `profits` | profits | الأرباح | |
| `recharge` | credit and days top-up | تشريج رصيد وأيام | شحن (as a noun for the module) |
| `repairs` | repairs | التصليحات | الصيانة |
| `warranty` | warranty | الكفالة | الضمان |
| `inventory` | inventory | المخزون | |
| `sales` | sales | المبيعات | |
| `customer` | customer | الزبون | العميل |
| `supplier` | supplier | المورّد | |
| `wallet` | wallet | المحفظة | |
| `commission` | commission | العمولة | |
| `drawerCount` | count the drawer | عدّ الصندوق | جرد |
| `monthNames` | — | Levantine (كانون الثاني …) | per OD-5 |

The owner reviews and extends this table before P1 ships (spec Assumption: owner reviews translation quality). The guard fails if any `ar` value contains a `forbidden` variant (SC-005).

## 8. Server message (envelope extension, P2)

| Field | Type | Rules |
| --- | --- | --- |
| `messageKey` | `ServerMessageKey` (union of `SERVER_MESSAGES` keys) | Optional. Present on converted refusals. |
| `messageParams` | `Record<string, string \| number>` | Optional. Amounts are **raw numbers** and currencies are codes; the client formats them. |

The full contract is in `contracts/error-envelope.md`. `SERVER_MESSAGES` is a pure leaf in `packages/core/src/messages/serverMessages.ts` (rule 29).

## 9. ReceiptModel (P2, in memory)

```
ReceiptModel {
  width: 58 | 80
  header: { shopName, headerText?, logo? }          // user data, never translated
  meta: Array<{ labelKey, value }>                   // receipt #, date, client, phone
  lines: Array<{ name, qty, unitPrice, total, currency, serial?, warranty? }>
  totals: Array<{ labelKey, amount, currency }>      // total, paid, change, LBP equivalent
  footer: { warrantyTerms?, thanksKey }
}
```

- `labelKey` resolves through the `receipts` namespace in the **receipt language**, not the user's language.
- `renderReceiptText(model)` is English only and byte-identical to today.
- `renderReceiptHtmlRtl(model)` renders Arabic.
- Amounts are raw numbers formatted by `formatMoney`, so they are identical in both renderers.

## State transitions

`users.language`: `NULL → 'en' | 'ar'` (user picks), `'en' ↔ 'ar'` (user switches). There is no path back to NULL in the UI. Nothing else has state.
