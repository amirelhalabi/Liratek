# Contract — desktop side (IPC + recorder)

## Recorder (wraps `ipcMain.handle`, installed before `register*Handlers()`)

Behaviour by mode and class: see `channel-policy.md`. In `offline` mode for `offline`/`checkpoint` channels:

```text
queue.acquire()
named = argNames ? toNamed(args) : args[0]
parsed = recordedSchema.safeParse(named)      → fail: { success:false, error } (nothing written)
        (recordedSchema = envelope(argNames keys, coreBodySchema): positional ids such as sessionId are kept and are id
         positions; the binding receives the same envelope)
assertNoOfflineIdOutsidePositions(parsed)     → fail: { success:false, code:"OFFLINE_UNRECORDABLE" }
BEGIN IMMEDIATE; guard.open()          (read and local channels wait in the queue while this window is open)
  before = rowCapture.snapshotSequences()
  result = await originalHandler(event, ...args)
  if result?.success !== true → ROLLBACK, return result if it is an envelope, else { success:false, error:"Not saved" }
  created = rowCapture.createdSince(before)       (all tables in OFFLINE_ID_TABLES)
  dependsOn = outboxCreated.lookup(idPositions(parsed) ∩ offline range)
  outbox.append({ eventId, seq: max(outboxRepo.maxSeq(), pairing.lastSeq, server.maxSeq)+1, channel, payload: parsed, actor: session.userId, occurredAt: now,
                  clientDay: localDay(), tzOffset, copyId, created, dependsOn, versions,
                  schemaShape: describeShape(recordedSchema), rates: ratesRepo.current() })
  outboxCreated.insert(created → eventId)
COMMIT; guard.close(); queue.release()
return result   (sales also get receiptNumber = RCP-<offline sale id>)
```

Errors after `BEGIN` → `ROLLBACK`, return `{ success:false, error }`. The handler is the existing one, unchanged
(except the 23 schema lifts and the `session:close` actor fix).

## `offline:*` channels (desktop-only, E1)

| Channel | Pre-login? | Payload | Data |
| --- | --- | --- | --- |
| `offline:status` | yes | — | `{ mode, paired, deviceNo, shopName, copyAgeSeconds, ready, notReadyReason, serverReachable, unreachableSeconds, pendingCount, lastError }` |
| `offline:pair` | yes | `{ serverUrl?, shop, username, password, deviceName }` — the PC's own `deviceNo` is read from `pairing.json` for a re-key (FR-001a) | `{ deviceNo, shopName }` |
| `offline:unpair` | yes (admin password, unless no shop data on the PC) | `{ username?, password? }` | `{}` — refused while the outbox has waiting events |
| `offline:go-offline` | yes | — | relaunches into `offline` (only when `unreachableSeconds ≥ 30` and ready) |
| `offline:back-to-web` | no (signed-in user) | — | relaunches into `finishing` (only when reachable) |
| `offline:send-now` | no | — | triggers an upload attempt; `{ sent, waiting }` |
| `offline:open-web-app` | yes | — | `shell.openExternal(https://<shop>.liratek.shop)` |
| `offline:install-update` | yes | — | standby/blocked only |

All return the envelope. Classified as `local` in the policy (8 channels → policy local 24, total 422).

## Adapter functions (frontend, `useApi()`)

| Function | Desktop | Web |
| --- | --- | --- |
| `getOfflineStatus`, `pairThisPc`, `unpairThisPc`, `goOffline`, `backToWeb`, `sendOfflineNow`, `openWebApp`, `installOfflineUpdate` | IPC above | `{ success:false, error:"Available on the desktop app" }` |
| `getOfflineReview`, `getOfflineHistory`, `applyOfflineItem`, `dismissOfflineItem`, `markOfflineItemReviewed`, `bookOfflineItemAnyway`, `getPairedPcs`, `revokePairedPc` | `{ success:false, error:"Available on the web app" }` | REST `/api/offline/*` |

Payload types are `z.input<typeof schema>` from `@liratek/core` (rule 21), exported from both `index.ts` and `browser.ts`.
