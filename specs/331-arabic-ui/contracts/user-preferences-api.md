# Contract: user language preference (IPC + REST)

Both transports call `UserPreferencesService` in `@liratek/core` (rule 19).

- The schemas live in `packages/core/src/validators/userPreferences.ts`. They are re-exported from `validators/index.ts` and `browser.ts`, and in `electron-app/schemas/index.ts` with the zod-major cast.
- The adapter payload types are `z.input<typeof setMyLanguageSchema>` (rule 21).

```ts
export const languageSchema = z.enum(["en", "ar"]);
export const setMyLanguageSchema = z.object({ language: languageSchema }).strict();
export type SetMyLanguageInput = z.input<typeof setMyLanguageSchema>;

export interface MyPreferences {
  language: "en" | "ar" | null;          // the user's own choice; null = never chose
  effectiveLanguage: "en" | "ar";        // resolveEffectiveLanguage(language, shopDefaultLanguage)
  shopDefaultLanguage: "en" | "ar";      // system_settings.ui_default_language ?? 'en'
  receiptLanguage: "en" | "ar";          // system_settings.receipt_language ?? 'en'
}
```

## Read my preferences

| | Desktop (IPC) | Web (REST) |
| --- | --- | --- |
| Channel / route | `user-preferences:get` | `GET /api/user-preferences/me` |
| Auth | signed-in session; roles `admin`, `staff` | `authenticateJWT` → `requireRole(["admin","staff"])` |
| Actor | user from the IPC session (as `auth:change-own-password` does) | `req.user.userId` (never a param) |
| Impersonated session | — | allowed (read-only) |
| Success | `{ success: true, data: MyPreferences }` | same, HTTP 200 |
| Failure | `{ success: false, error, code }` | same, HTTP 200 (envelope parity) |

## Set my language

| | Desktop (IPC) | Web (REST) |
| --- | --- | --- |
| Channel / route | `user-preferences:set-language` | `PUT /api/user-preferences/me/language` |
| Body | `SetMyLanguageInput` via `validatePayload(setMyLanguageSchema)` | same via `validateRequest(setMyLanguageSchema)` |
| Actor | session user | `req.user.userId` |
| Impersonated session | — | refused: `{ success:false, code:"FORBIDDEN" }` (the `/api/user-email/me/change` pattern) |
| Success | `{ success: true, data: MyPreferences }` | same |
| Unknown value | `{ success:false, code:"VALIDATION_ERROR" }` | same |

## Adapter (frontend)

- `backendApi.ts`:
  - `getMyPreferences(): Promise<MyPreferences>` is a read and returns the raw `data` shape.
  - `setMyLanguage(payload: SetMyLanguageInput): Promise<{ success: boolean; data?: MyPreferences; error?: string }>` is a write and returns the envelope.
  - Both use `ipcOrHttp`.
- Both are exposed on `ElectronApiAdapter.ts`, typed on `ApiAdapter` in `packages/ui/src/api/types.ts`, bound in `preload.ts` as `userPreferences.get/setLanguage`, and typed in `frontend/src/types/electron.d.ts`.
- The phone app uses `GET`/`PUT` on the same REST routes through `mobile/src/api/` (P3).

## Shop settings (existing channel, new keys)

Writes go through `PUT /api/settings/:key` (admin) and the matching IPC settings update. These keys gain value validation:

| Key | Schema | Default when missing |
| --- | --- | --- |
| `ui_default_language` | `languageSchema` | `en` |
| `receipt_language` | `languageSchema` | `en` |

A bad value returns `{ success:false, code:"VALIDATION_ERROR" }`. Other keys behave exactly as before. Do the three-way diff first (rule 23).

## Signup from the Arabic landing (FR-006; depends on OD-1)

- The `Signup` page reads `lang=ar` from the hash query (`#/signup?lang=ar`). It sets the device language at once, so the signup screen itself is in Arabic.
- It sends `language: "ar"` in the signup request. This is an optional `languageSchema` key on the signup request schema in `packages/core/src/validators/signupInvitation.ts`; do the three-way diff first.
- The emailed completion link carries `lang=ar`.
- On completion, `TenantProvisioningService` sets the owner's `users.language = 'ar'` and the tenant's `system_settings.ui_default_language = 'ar'`. It leaves `receipt_language` unset (English).
- The Google signup path (`backend/src/api/googleSignup.ts`) carries `lang` through its OAuth `state` and applies the same writes.
