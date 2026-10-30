# Contract: reading monthly KPI snapshots (LIRA-364)

There is no write contract. Snapshots are created only by the automatic capture (web server sweep, desktop boot/hourly timer). Neither transport exposes a channel to create, edit or delete one (FR-010).

## Read: list snapshots

| | Desktop | Web |
|---|---|---|
| Channel / route | IPC `kpi:list-snapshots` | `GET /api/kpi/snapshots` |
| Auth | `requireRole(e.sender.id, ["admin"])` | `authenticateJWT` → `requireRole(["admin"])` |
| Offline policy | `read` in `packages/core/src/offline/channelPolicy.ts` (count test updated) | — |
| Adapter | `backendApi.ts` `getKpiSnapshots()` via `ipcOrHttp`; `ElectronApiAdapter`; `ApiAdapter` type | same function |

No input. Optional later: a `limit`; v1 returns everything (12 rows a year).

### Response (both transports; reads return the raw shape, like other reads)

```ts
// exported from @liratek/core (browser.ts too: rule 21, rule 29)
type KpiSnapshotView = {
  month: string;            // "2026-10" (Beirut month described)
  taken_at: string;         // UTC "YYYY-MM-DD HH:MM:SS"
  is_late: boolean;
  usd_lbp_buy_rate: number | null;
  usd_lbp_sell_rate: number | null;
  values: Record<KpiKey, { usd: number; lbp: number }>; // missing key = "not recorded"
};
type KpiSnapshotsResponse = { success: true; snapshots: KpiSnapshotView[] } // newest month first
  | { success: false; error: string };
```

REST returns HTTP 200 with `{ success: false, error }` on failure (rule 6). A non-admin gets 403 (REST) or `{ success: false, error }` (IPC), and no data.

## Internal: capture (not exposed)

`KpiSnapshotService.captureDue(nowUtc: Date): { captured: string | null; reason: 'started' | 'not_due' | 'exists' | 'captured' }`

Owner decision 2026-10-30: the start month is saved straight away (`started`, no separate column, no mark on the page) and replaced once by its month-end balances; every later month is saved once at its month end.

- Runs inside the caller's tenant context (`runWithTenant` on web, fixed tenant on desktop).
- Never throws for "nothing to do". It throws only on a real failure, so the sweep logs it and retries next hour.
