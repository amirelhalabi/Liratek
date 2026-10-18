# Contracts: Checkpoint open differences (LIRA-335)

These names are fixed so the lanes can build in parallel. Change one only by editing this file first.

## Core (packages/core)

### Constants
```ts
// constants/checkpointAdjustment.ts (next to CHECKPOINT_ADJUSTMENT_METHOD); re-exported from browser.ts and index.ts
export const CHECKPOINT_RESOLUTION_METHOD = "CHECKPOINT_RESOLUTION";
// repositories/drawerShortageExpense.ts
export const DRAWER_SHORTAGE_EXPENSE_CATEGORY = "Drawer shortage";
export const CHECKPOINT_DIFFERENCE_SOURCE_TABLE = "checkpoint_differences";
```

### Pure helper (browser-safe, `utils/checkpointDifference.ts`, exported from browser.ts + index.ts)
```ts
export type CheckpointDifferenceStatus = "OPEN" | "PARTLY_RESOLVED" | "RESOLVED" | "CLOSED";
export type CheckpointDifferenceDirection = "OVER" | "SHORT";
export function describeCheckpointDifference(input: {
  amount: number; resolved: number; closed: boolean; currencyCode: string;
}): { direction: CheckpointDifferenceDirection; abs: number; open: number; status: CheckpointDifferenceStatus };
export function isOpenCheckpointDifference(d: { status: CheckpointDifferenceStatus }): boolean; // OPEN | PARTLY_RESOLVED
```

### View types (exported types, `repositories/CheckpointDifferenceRepository.ts`; type-only re-export from browser.ts)
```ts
export interface CheckpointDifferenceResolutionView {
  transaction_id: number;
  transaction_type: string;
  summary: string | null;
  amount: number;            // magnitude, signed like the difference
  effective_time: string;    // transactions.created_at (the custom time)
  entered_at: string;        // resolution row created_at (when it was saved)
  user_name: string | null;
}
export interface CheckpointDifferenceView {
  id: number;
  closing_id: number;
  closing_created_at: string;
  drawer_name: string;
  currency_code: string;
  amount: number;            // signed delta
  direction: CheckpointDifferenceDirection;
  resolved: number;
  open: number;
  status: CheckpointDifferenceStatus;
  closed_at: string | null;
  closed_by_name: string | null;
  shortage_expense_id: number | null;
  resolutions: CheckpointDifferenceResolutionView[];
}
```

### Engine (`repositories/checkpointResolution.ts`, server-only, NOT reachable from browser.ts)
```ts
/** Call at the end of a flow's db transaction, after all its legs are posted. No-op unless a
 *  checkpoint of a touched drawer exists after the transaction's created_at. Returns what it did. */
export function resolveBackTimedDrawerMovement(
  db: Database, input: { transactionId: number; userId: number },
): { resolutions: { differenceId: number; drawer: string; currency: string; amount: number }[] };

/** Re-derive a closed SHORT difference's Drawer shortage expense (void + recreate). Idempotent. */
export function syncShortageExpense(db: Database, input: { differenceId: number; userId: number }): void;

/** Differences whose drawer's first checkpoint after `at` could still absorb money (open > 0, incl. closed SHORT). */
export function getOpenDifferencesAfter(db: Database, input: { at: string }): CheckpointDifferenceView[];
```

### Repository (`CheckpointDifferenceRepository`, extends BaseRepository, singleton getter `getCheckpointDifferenceRepository()`)
```ts
recordForCheckpoint(closingId: number, adjustments: { drawer_name: string; currency_code: string; delta: number }[]): void; // called by createCheckpoint
listForClosings(closingIds: number[]): Map<number, CheckpointDifferenceView[]>;
getById(id: number): CheckpointDifferenceView | null;
close(id: number, userId: number): { success: boolean; error?: string };
reopen(id: number, userId: number): { success: boolean; error?: string };
```

### Service (`ClosingService`)
```ts
getCheckpointTimeline(filters: CheckpointFilters & { open_only?: boolean })
  : { success: boolean; checkpoints?: CheckpointRecord[]; open_count?: number; error?: string };
  // CheckpointRecord gains: differences: CheckpointDifferenceView[]  (empty for pre-v222 checkpoints)
closeCheckpointDifference(input: CloseCheckpointDifferenceInput & { userId: number }): { success: boolean; data?: CheckpointDifferenceView; error?: string };
reopenCheckpointDifference(input: ReopenCheckpointDifferenceInput & { userId: number }): { success: boolean; data?: CheckpointDifferenceView; error?: string };
getOpenDifferencesAfter(input: OpenDifferencesAfterInput): { success: boolean; data?: CheckpointDifferenceView[]; error?: string };
```

### Validators (`validators/closing.ts`)
```ts
export const closeCheckpointDifferenceSchema = z.object({ difference_id: z.number().int().positive() });
export const reopenCheckpointDifferenceSchema = z.object({ difference_id: z.number().int().positive() });
export const openDifferencesAfterSchema = z.object({ at: z.string().min(1) }); // ISO or 'YYYY-MM-DD HH:MM:SS'
export type CloseCheckpointDifferenceInput = z.input<typeof closeCheckpointDifferenceSchema>;
export type ReopenCheckpointDifferenceInput = z.input<typeof reopenCheckpointDifferenceSchema>;
export type OpenDifferencesAfterInput = z.input<typeof openDifferencesAfterSchema>;
```
`CheckpointFilters` gains `open_only?: boolean`.

## Transports

| Operation | IPC channel | Roles | REST | Offline policy |
|---|---|---|---|---|
| timeline (extended) | `closing:getCheckpointTimeline` (existing) | admin | `GET /api/closing/checkpoint-timeline?…&open_only=1` | READ (existing) |
| open differences after | `closing:get-open-differences-after` | admin, staff | `GET /api/closing/differences/open-after?at=…` | READ |
| close | `closing:close-difference` | admin | `POST /api/closing/differences/close` body `{difference_id}` | ONLINE_ONLY (reason comment) |
| reopen | `closing:reopen-difference` | admin | `POST /api/closing/differences/reopen` body `{difference_id}` | ONLINE_ONLY (reason comment) |

All return the IPC envelope `{ success, data?, error? }` (REST HTTP 200 even on failure); `userId` from the session/JWT, never the client. Write handlers call `audit(...)` / `auditRest(...)` like `create-checkpoint`.

Staff may read open-differences-after because the hint shows on cashier forms; it returns drawer, currency, open amount and checkpoint time only (no user names for staff — the handler strips `resolutions` and `closed_by_name` when the caller is not admin).

## Adapter (frontend/src/api/backendApi.ts, ElectronApiAdapter.ts, packages/ui/src/api/types.ts, preload.ts, electron.d.ts)

```ts
getCheckpointTimeline(filters?: CheckpointFilters & { open_only?: boolean }) // existing fn, new filter + response fields
getOpenDifferencesAfter(input: OpenDifferencesAfterInput): Promise<{ success: boolean; data?: CheckpointDifferenceView[]; error?: string }>;
closeCheckpointDifference(input: CloseCheckpointDifferenceInput): Promise<{ success: boolean; data?: CheckpointDifferenceView; error?: string }>;
reopenCheckpointDifference(input: ReopenCheckpointDifferenceInput): Promise<{ success: boolean; data?: CheckpointDifferenceView; error?: string }>;
```
Preload namespace: `window.api.closing.getOpenDifferencesAfter / closeDifference / reopenDifference`.

## UI strings (packages/ui/src/i18n/locales/{en,ar}/closing.json — both, same keys, `yarn check:i18n`)

```
difference.status.OPEN            "Open"
difference.status.PARTLY_RESOLVED "Partly resolved · {{open}} open"
difference.status.RESOLVED        "Resolved"
difference.status.CLOSED_SHORT    "Closed · Short"
difference.status.CLOSED_OVER     "Closed · Over"
difference.resolvedBy             "Resolved by"
difference.stillOpen              "Still open"
difference.byTxn                  "{{label}} · entered {{entered}} with time {{time}}"
difference.closedBy               "Closed by {{name}}"
difference.shortageExpense        "Drawer shortage expense"
timeline.openOnly                 "Open differences only"
details.closeButton               "Close difference…"
details.reopenButton              "Reopen"
details.footerHint                "Missing entry found? Re-enter it with Set custom time before {{time}}."
close.title / close.checkpoint / close.stillOpen / close.shortBody / close.overBody / close.noExpenseCurrency / close.reopenNote / close.confirmShort / close.confirmOver / close.cancel
hint.resolvesOver                 "This time is before {{drawer}}'s checkpoint of {{time}} (Over {{amount}} open). Money into {{drawer}} saved at this time will resolve it instead of raising the balance."
hint.resolvesShort                "This time is before {{drawer}}'s checkpoint of {{time}} (Short {{amount}} open). Money out of {{drawer}} saved at this time will resolve it instead of lowering the balance."
```
`shared.json txnTime.*` unchanged; the hint lives in the `closing` namespace. Expense category label key for "Drawer shortage" in `expenses.json` (both languages).
