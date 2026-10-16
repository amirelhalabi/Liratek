/**
 * LIRA-306 — the offline recorder (contracts/ipc-offline.md "Recorder";
 * FR-009–FR-011, FR-014, FR-036). Installed by main.ts BEFORE any
 * `register*Handlers()`: it wraps `ipcMain.handle` so every channel's
 * handler is called through `wrap()`.
 *
 * By mode (the mode is fixed per process; a change relaunches the app):
 *   standalone          untouched — today's app
 *   standby / blocked   only `offline:*` answers; everything else is refused
 *                       plainly (there is no shop database to act on)
 *   finishing           no new recordable actions; reads/local still run
 *   offline             by channel class (core channel policy):
 *     offline/checkpoint  parse with the channel's recorded schema → refuse
 *                         an offline id outside id positions → BEGIN
 *                         IMMEDIATE → original handler → on success the
 *                         created rows, dependencies and the outbox event are
 *                         written in the SAME transaction → COMMIT
 *     online_only         OFFLINE_NOT_AVAILABLE (handler never runs)
 *     read                runs under the write guard (query_only); a write it
 *                         attempts is refused by SQLite and logged
 *     local               runs writable, never recorded (sign-in, print…)
 *     unclassified        refused (fail closed)
 *
 * Every call in offline/finishing mode passes through ONE async queue, so
 * nothing interleaves with an open write window (reads wait; the sender uses
 * `runExclusive`). better-sqlite3's `db.transaction()` cannot wrap an awaited
 * handler, hence the manual BEGIN/COMMIT; a service's own nested
 * `db.transaction()` becomes a savepoint because one is already open.
 */
import {
  classOf,
  describeShape,
  namedPayload,
  offlineEventHash,
  offlineIdsInPositions,
  offlineIdsOutsidePositions,
  recordedSchema,
  logger,
  type NewOutboxRow,
  type OfflineRates,
} from "@liratek/core";
import type BetterSqlite3 from "better-sqlite3";
import type { OfflineMode } from "./bootDecision.js";
import {
  isReadOnlyRefusal,
  type ReadWriteLog,
  type WriteGuard,
} from "./writeGuard.js";

type IpcEvent = { sender: { id: number } };
type Handler = (event: IpcEvent, ...args: unknown[]) => unknown;

export interface IpcMainLike {
  handle: (channel: string, fn: Handler) => void;
}

export interface RecorderDeps {
  mode: () => OfflineMode;
  db: () => BetterSqlite3.Database;
  guard: WriteGuard;
  readWriteLog: ReadWriteLog;
  outbox: {
    maxSeq(): number;
    append(row: NewOutboxRow): void;
    insertCreated(
      rows: ReadonlyArray<{ offlineId: number; tableName: string }>,
      eventId: string,
    ): void;
    eventsCreating(ids: readonly number[]): string[];
  };
  rowCapture: {
    snapshotSequences(): Record<string, number>;
    createdSince(before: Record<string, number>): Record<string, number[]>;
  };
  /** pairing.json's last sequence and the server's (check-in) */
  pairing: () => { lastSeq: number; serverMaxSeq: number };
  /** persist the sequence just used (pairing.json lastSeq) */
  onSeqUsed: (seq: number) => void;
  /** the signed-in user of that window, or null */
  actorOf: (senderId: number) => number | null;
  copyId: () => string;
  rates: () => OfflineRates;
  appVersion: string;
  schemaVersion: number;
  now: () => Date;
  clientDay: (d: Date) => string;
  tzOffsetMinutes: (d: Date) => number;
  uuid: () => string;
  /** extra fields merged into a successful reply (e.g. offline receipt number) */
  decorate?: (
    channel: string,
    result: Record<string, unknown>,
    created: Record<string, number[]>,
  ) => Record<string, unknown>;
}

export const OFFLINE_NOT_AVAILABLE = {
  success: false,
  code: "OFFLINE_NOT_AVAILABLE",
  error:
    "Not available while offline — do this on the web app when the internet is back",
} as const;

function isEnvelope(v: unknown): v is { success: boolean; error?: unknown } {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as { success?: unknown }).success === "boolean"
  );
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** A promise chain: one task at a time, in arrival order. */
class Queue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(task: () => Promise<T> | T): Promise<T> {
    const next = this.tail.then(task, task);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

export class Recorder {
  private readonly queue = new Queue();

  constructor(private readonly d: RecorderDeps) {}

  /** Run `fn` between write windows (the sender's outbox reads/updates). */
  runExclusive<T>(fn: () => T | Promise<T>): Promise<T> {
    return this.queue.run(fn);
  }

  wrap(channel: string, handler: Handler): Handler {
    return (event: IpcEvent, ...args: unknown[]) =>
      this.dispatch(channel, handler, event, args);
  }

  private dispatch(
    channel: string,
    handler: Handler,
    event: IpcEvent,
    args: unknown[],
  ): unknown {
    const mode = this.d.mode();
    if (mode === "standalone") return handler(event, ...args);
    if (channel.startsWith("offline:")) {
      // offline controls never touch the working copy's business rows
      return handler(event, ...args);
    }
    if (mode === "standby" || mode === "blocked") {
      return {
        success: false,
        code: "PC_ON_STANDBY",
        error:
          "This PC is on standby — work in the web app while the internet works",
      };
    }
    const cls = classOf(channel);
    switch (cls) {
      case "offline":
      case "checkpoint":
        if (mode === "finishing") {
          return {
            success: false,
            code: "OFFLINE_FINISHING",
            error:
              "Sending the offline work — new actions wait until the PC is back on the web app",
          };
        }
        return this.queue.run(() => this.record(channel, handler, event, args));
      case "online_only":
        return { ...OFFLINE_NOT_AVAILABLE };
      case "read":
        return this.queue.run(() => this.read(channel, handler, event, args));
      case "local":
        return this.queue.run(async () => {
          this.d.guard.open();
          try {
            return await handler(event, ...args);
          } finally {
            this.d.guard.close();
          }
        });
      default:
        logger.warn({ channel }, "offline: unclassified channel refused");
        return {
          success: false,
          code: "OFFLINE_UNCLASSIFIED",
          error: "Not available while offline",
        };
    }
  }

  private totalChanges(): number {
    return (
      this.d.db().prepare(`SELECT total_changes() AS n`).get() as { n: number }
    ).n;
  }

  private async read(
    channel: string,
    handler: Handler,
    event: IpcEvent,
    args: unknown[],
  ): Promise<unknown> {
    const before = this.totalChanges();
    let result: unknown;
    try {
      result = await handler(event, ...args);
    } catch (error) {
      if (isReadOnlyRefusal(messageOf(error))) {
        this.d.readWriteLog.record(channel, 1);
        logger.warn({ channel }, "offline: a read tried to write — refused");
        return {
          success: false,
          code: "OFFLINE_READ_WROTE",
          error: "This screen tried to change data offline — refused",
        };
      }
      throw error;
    }
    const changed = this.totalChanges() - before;
    if (changed > 0) this.d.readWriteLog.record(channel, changed);
    if (
      isEnvelope(result) &&
      result.success === false &&
      isReadOnlyRefusal(String(result.error ?? ""))
    ) {
      this.d.readWriteLog.record(channel, 1);
    }
    return result;
  }

  private async record(
    channel: string,
    handler: Handler,
    event: IpcEvent,
    args: unknown[],
  ): Promise<unknown> {
    const schema = recordedSchema(channel);
    if (!schema) {
      return {
        success: false,
        code: "NOT_RECORDABLE",
        error: "This action cannot be recorded offline yet",
      };
    }
    const parsed = schema.safeParse(namedPayload(channel, args));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return {
        success: false,
        error: issue
          ? `${issue.path.join(".") || "form"}: ${issue.message}`
          : "Invalid form",
      };
    }
    const payload = parsed.data as Record<string, unknown>;
    const outside = offlineIdsOutsidePositions(payload);
    if (outside.length > 0) {
      logger.warn(
        { channel, outside },
        "offline: offline id outside id positions — refused",
      );
      return {
        success: false,
        code: "OFFLINE_UNRECORDABLE",
        error:
          "This action refers to something created offline in a way that cannot be sent — do it on the web app later",
      };
    }

    const db = this.d.db();
    this.d.guard.open();
    let open = false;
    try {
      db.exec("BEGIN IMMEDIATE");
      open = true;
      const before = this.d.rowCapture.snapshotSequences();
      const result = await handler(event, ...args);
      if (!isEnvelope(result) || result.success !== true) {
        db.exec("ROLLBACK");
        open = false;
        return isEnvelope(result)
          ? result
          : { success: false, error: "Not saved" };
      }
      const created = this.d.rowCapture.createdSince(before);
      const dependsOn = this.d.outbox.eventsCreating(
        offlineIdsInPositions(channel, payload),
      );
      const p = this.d.pairing();
      const seq =
        Math.max(this.d.outbox.maxSeq(), p.lastSeq, p.serverMaxSeq) + 1;
      const at = this.d.now();
      const occurredAt = at.toISOString();
      const actor = this.d.actorOf(event.sender.id);
      if (actor === null) {
        db.exec("ROLLBACK");
        open = false;
        return { success: false, error: "Sign in first" };
      }
      const eventId = this.d.uuid();
      this.d.outbox.append({
        eventId,
        seq,
        channel,
        payloadJson: JSON.stringify(payload),
        payloadHash: offlineEventHash({
          payload,
          channel,
          actorUserId: actor,
          occurredAt,
        }),
        actorUserId: actor,
        occurredAt,
        clientDay: this.d.clientDay(at),
        clientTzOffsetMinutes: this.d.tzOffsetMinutes(at),
        copyId: this.d.copyId(),
        appVersion: this.d.appVersion,
        schemaVersion: this.d.schemaVersion,
        schemaShapeJson: JSON.stringify(describeShape(schema)),
        ratesJson: JSON.stringify(this.d.rates()),
        createdJson: JSON.stringify(created),
        dependsOnJson: JSON.stringify(dependsOn),
      });
      this.d.outbox.insertCreated(
        Object.entries(created).flatMap(([tableName, ids]) =>
          ids.map((offlineId) => ({ offlineId, tableName })),
        ),
        eventId,
      );
      db.exec("COMMIT");
      open = false;
      this.d.onSeqUsed(seq);
      const reply = result as unknown as Record<string, unknown>;
      return this.d.decorate ? this.d.decorate(channel, reply, created) : reply;
    } catch (error) {
      logger.error(
        { error, channel },
        "offline: recording failed — rolled back",
      );
      return { success: false, error: messageOf(error) || "Not saved" };
    } finally {
      if (open) {
        try {
          db.exec("ROLLBACK");
        } catch {
          // already rolled back by SQLite
        }
      }
      this.d.guard.close();
    }
  }
}

/** Wrap `ipcMain.handle` so every later registration goes through the recorder. */
export function installRecorder(
  ipcMain: IpcMainLike,
  deps: RecorderDeps,
): Recorder {
  const recorder = new Recorder(deps);
  const original = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel: string, fn: Handler) =>
    original(channel, recorder.wrap(channel, fn));
  return recorder;
}
