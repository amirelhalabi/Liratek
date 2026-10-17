# Contract: open an external URL (desktop IPC + web)

## Zod schema (core, `packages/core/src/validators/app.ts`)

```text
WHATSAPP_HOSTS = ["wa.me", "api.whatsapp.com"]
openExternalUrlSchema = z.object({ url: z.string().url() })
  .refine(u is https: AND URL(u).hostname ∈ WHATSAPP_HOSTS, "URL not allowed")
type OpenExternalUrlInput = z.input<typeof openExternalUrlSchema>
```

Exported from `index.ts` and `browser.ts`; the module imports only `zod`. Re-exported in `electron-app/schemas/index.ts` with the zod-major cast.

## IPC channel `app:open-external` (desktop only)

| | |
|---|---|
| Handler | `electron-app/handlers/appShellHandlers.ts`, registered in `main.ts` |
| Auth | none (no data touched); the allow-list is the guard |
| Request | `OpenExternalUrlInput` |
| Behaviour | `validatePayload(openExternalUrlSchema, data)`, then `await shell.openExternal(url)` |
| Success | `{ success: true }` |
| Refused URL | `{ success: false, error: "URL not allowed" }`, logged at warn; `shell.openExternal` is NOT called |
| Shell error | `{ success: false, error: <message> }` |
| Preload | `app: { openExternal: (data: OpenExternalUrlInput) => ipcRenderer.invoke("app:open-external", data) }` |
| Type | `frontend/src/types/electron.d.ts` mirrors the preload type |
| Offline mode | must be allowed by the offline channel policy (`electron-app/offline/channelPolicy*`), classed as a local, non-server channel |

## Adapter `openExternalUrl(input: OpenExternalUrlInput): Promise<{ success: boolean; error?: string }>`

`frontend/src/api/backendApi.ts`. This is the only place the transport is branched.

- `isElectron()` → `getElectronApi().app.openExternal(input)`
- web → the URL is validated client-side with the same schema; then `const w = window.open(input.url, "_blank")`:
  - `w === null` → `{ success: false, error: "blocked" }`
  - otherwise `w.opener = null` and `{ success: true }`.
- The web arm MUST NOT `await` anything before `window.open` (popup gesture rule).

It is also exposed on `ElectronApiAdapter.ts` and typed on `ApiAdapter` (`packages/ui/src/api/types.ts`) with `OpenExternalUrlInput` imported from `@liratek/core` (rule 21).

**No REST route**: nothing reaches the server.
