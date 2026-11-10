# Offline contract changes: Shop restore

## Check-in response (`OfflineDeviceService` check-in, `CheckinResult.data`)

New field, read from the PLATFORM file (`shop_restores`, latest `done` row for the shop):

```jsonc
"restore": { "id": 13, "restoredTo": "2026-11-10T12:00:00Z", "restoredAt": "2026-11-10T12:20:09Z", "byName": "owner" } | null
```

PC (`electron-app/offline/syncClient.ts`): stores `restore.id` in `pairing.json`. When it differs from the stored one (or the stored one is absent and `restore` is not null and newer than the PC's copy):

1. discard the mirror copies (not the working copy of a PC currently offline — `workingCopy.ts` "never overwritten, resume instead");
2. `refreshCopy()` immediately, regardless of `COPY_REFRESH_MS` / state;
3. show the banner "Shop restored to <restoredTo in shop time> by <byName>" until dismissed;
4. **never** reset `lastSeq`, `serverMaxSeq`, `serverMaxOfflineIds`.

A PC that starts after days switched off does its check-in before sending its outbox (already the order in the sync loop), so it learns of the restore first.

## Device routes during the swap

`verifyKey` and the event routes return error code `SHOP_RESTORING` (not `INVALID_DEVICE_KEY`) while the shop is blocked; the PC treats it like a network blip (retry next tick), never as "re-pair".

## Replay hold (`ReplayEngine`, after `rewriteIdPositions`)

For each id position of the event (mapped offline ids AND plain server ids):

- row exists → continue as today;
- row missing AND a `shop_restores` `done` row for this shop has `finished_at` > the event's recorded time → hold, kind `restore_removed`, details `{ restoreId, restoredTo, removed:[{table,id,label}] }`;
- row missing otherwise → today's behaviour (unchanged).

Because the restore raised every `sqlite_sequence` to its pre-restore value, a missing id can never have been given to another row in between.

## Review actions for `restore_removed`

- **Apply** — only when every removed reference is a client: the owner picks another client or "walk-in"; the stored payload is re-run with that reference replaced. New: today `apply()` re-runs the payload unchanged (`OfflineReviewService.ts:208-229`).
- **Dismiss** — always available; the item stays listed with its details so the cashier can re-enter it by hand.
