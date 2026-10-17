# Contract: translatable failure envelope (P2)

This extends the existing envelope `{ success: false, error: string, code?: string, details? }` on both transports. **It is additive**: clients that ignore the new fields keep showing `error`, which is unchanged English.

```ts
{
  success: false,
  error: string,                 // English, rendered from SERVER_MESSAGES[messageKey] when a key is present
  code?: string,                 // unchanged (VALIDATION_ERROR, BUSINESS_RULE_ERROR, …)
  messageKey?: ServerMessageKey, // NEW
  messageParams?: Record<string, string | number>, // NEW — raw values only
  details?: unknown
}
```

## Source of truth

`packages/core/src/messages/serverMessages.ts` is pure: it imports only its per-area leaves in `messages/server/<area>.ts`, which are pure too and have no Node built-ins (rule 29). It merges them with `<area>.` key prefixes and is exported from `index.ts` and `browser.ts`. On the client, the `locales/{en,ar}/server.<area>.json` files are merged into the one `server` namespace.

```ts
export const SERVER_MESSAGES = {
  "refund.alreadyResold": "This refund can't be undone — one or more of its returned units have already been sold again.",
  "refund.notEnoughAvailable": "Cannot refund {{requested}} - only {{available}} available (already refunded {{refunded}})",
  "generic.saveFailed": "Could not save. Please try again.",
  // …
} as const;
export type ServerMessageKey = keyof typeof SERVER_MESSAGES;
export function renderServerMessage(key: ServerMessageKey, params?: Record<string, string | number>): string;
```

## Rules

1. **Params are raw.**
   - An amount is a `number` with a sibling `currency` code param, never `"1,500 LBP"`.
   - The client formats with `formatMoney`/`formatNumber`. The Arabic message then shows the same digits as English (FR-016) and does not depend on the server's locale (rule 27).
2. **The English text is unchanged.** `renderServerMessage` must reproduce today's English wording for each converted throw, and the existing tests that assert English messages stay green. Where today's English embeds `toLocaleString()` output, the English rendering pins `en-US`.
3. **Throwing**: `new BusinessRuleError(renderServerMessage(k, p), { messageKey: k, messageParams: p })`, or a small helper `refuse(k, p)` per error class. `AppError.toJSON()`, `createErrorResponse()` and the shared failure helpers forward the two fields. Every REST route and IPC handler that today returns `{ success:false, error: err.message }` must use the shared helper so the fields survive. That is the P2 sweep in `tasks.md`.
4. **Zod**:
   - A validator's custom message references a template: `{ message: SERVER_MESSAGES["debts.amountPositive"] }`.
   - `validateRequest` (backend) and `validatePayload` (electron) look up the first issue's message in a reverse map of the static templates. On a match they add `messageKey`.
   - Templates with `{{params}}` cannot be zod messages.
5. **Catch-all strings** in handlers and routes (`"Failed to load users"`) map to a generic family key (`generic.loadFailed`, `generic.saveFailed`, `generic.deleteFailed`, `generic.unexpected`). The English `error` keeps its specific text.
6. **Client**: `translateServerError(result, t)` in `packages/ui/src/i18n/serverMessage.ts`.
   - If `messageKey` is in the loaded `server` namespace, it returns `t("server:" + key, formattedParams)`.
   - Else, if `code` has a generic key, it returns that.
   - Else it returns `result.error`.
   - Every place that shows `result.error` to the user switches to it. The `server` namespace's `ar` file must cover every `ServerMessageKey`, which the guard enforces.
7. **Phone app**: `mobile/src/auth/messages.ts`'s code→wording switch becomes catalog keys (`auth:signin.errors.<CODE>`) in the shared namespaces.
