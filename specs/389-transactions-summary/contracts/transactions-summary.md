# Contract — transactions summary (read)

Both transports call `getTransactionSummaryService().summarize(input)` with the input
parsed by core `transactionSummarySchema` (research R1, data-model.md).

## Desktop (IPC)

- Channel: `transactions:summary`, one argument = `TransactionSummaryInput`.
- Guard: `requireRole(e.sender.id, ["admin", "staff"])`; `validatePayload(TransactionSummarySchema, payload)`.
- Returns `{ success: true, data: TransactionSummaryResult }` or `{ success: false, error }`.
- Offline channel policy: read (`channelPolicy.ts` read list).

## Web (REST)

- `GET /api/transactions/summary?payload=<JSON TransactionSummaryInput>` (JSON in one param, like `/recent`'s `typeFilters`).
- Guard: `requireAuth` (same as `/recent`).
- HTTP 200 always; body `{ success: true, data }` or `{ success: false, error }` (rule 19c).
- Registered before `/:id`.

## Adapter

- `backendApi.getTransactionSummary(payload: TransactionSummaryInput): Promise<{ success: boolean; data?: TransactionSummaryResult; error?: string }>`
- `ElectronApiAdapter.getTransactionSummary`, `ApiAdapter.getTransactionSummary` — payload type imported from `@liratek/core` (rule 21), exported from `browser.ts`.
