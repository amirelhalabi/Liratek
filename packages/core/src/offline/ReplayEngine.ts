/**
 * ReplayEngine (LIRA-306, plan §A steps 1–5, FR-016, FR-018–FR-021a) —
 * server-only (exported from `index.ts`, never `browser.ts`).
 *
 * Books ONE stored offline event:
 *   1. policy + schema: the channel's recorded schema, the event's schema
 *      shape compatible with today's, the payload parses (else refused
 *      "recorded by a different app version" — content kept, Dismiss only);
 *   2. checkpoint channels are held (N8) unless an admin applies them;
 *   3. dependencies and offline ids: every offline id in an id position is
 *      rewritten through the shop's id map; one with no entry holds the event
 *      (`waiting`);
 *   4. the actor: a user of the shop holding a role the channel allows
 *      (`actorPolicy.ts`, O-new-7); switched off since → booked with a note;
 *   5. inside `runWithTenant(event day, offset, effective now, recorded rates)`
 *      and the replay window, ONE transaction: binding (the same core service
 *      the web route calls) → created rows (sqlite_sequence diff) → duplicate
 *      hook → id-map rows → audit row → outcome + review items → COMMIT.
 * A binding refusal (thrown or `{success:false}`) rolls back and is stored as
 * `refused` with the service's message. A technical failure (the engine's own
 * steps, a transient SQLite error, or the binding yielding to the event loop)
 * rolls back and leaves the event `received` with attempts+1; at the limit it
 * is refused to the review list.
 */
import type Database from "better-sqlite3";
import { getDatabase } from "../db/connection.js";
import { runWithTenant } from "../db/tenantContext.js";
import {
  beginReplayTransaction,
  commitReplayTransaction,
  rollbackReplayTransaction,
  runReplayWindow,
} from "../db/replayGuard.js";
import { getOfflineMaxAttempts } from "../config/env.js";
import { classOf, policyEntry, recordedSchema } from "./channelPolicy.js";
import { describeShape, isCompatible, type ShapeNode } from "./schemaShape.js";
import { rewriteIdPositions } from "./idPositions.js";
import { isOfflineId } from "./idRange.js";
import type { OfflineEventStatus, OfflineReviewKind } from "./reviewKinds.js";
import type { OfflineBinding, BindingResult } from "./bindings/types.js";
import { getOfflineBinding } from "./bindings/index.js";
import { offlineActorPolicy } from "./actorPolicy.js";
import { offlineRatesSchema, offlineRatesToRows } from "../validators/offline.js";
import {
  getOfflineEventRepository,
  type OfflineEventRepository,
  type OfflineEventRow,
} from "../repositories/OfflineEventRepository.js";
import { getOfflineIdMapRepository, type OfflineIdMapRepository } from "../repositories/OfflineIdMapRepository.js";
import { getOfflineReviewRepository, type OfflineReviewRepository } from "../repositories/OfflineReviewRepository.js";
import { getRowCaptureRepository, type RowCaptureRepository } from "../repositories/RowCaptureRepository.js";
import { getUserRepository, type UserRepository } from "../repositories/UserRepository.js";
import { getRateRepository } from "../repositories/RateRepository.js";
import { getAuditService } from "../services/AuditService.js";
import { offlineLogger } from "../utils/logger.js";

export interface ReplayNote {
  kind: OfflineReviewKind;
  details: Record<string, unknown>;
}

export interface ReplayOutcome {
  status: OfflineEventStatus;
  error?: string | null;
  serverIds?: Record<string, number[]>;
  /** true when the event stays `received` for a retry */
  technical?: boolean;
  notes: OfflineReviewKind[];
}

export interface ActorCheck {
  ok: boolean;
  /** refusal text when !ok */
  error?: string;
  username?: string;
  role?: string;
  /** e.g. user_switched_off — booked, with a note */
  note?: ReplayNote;
}

export interface ReplayDeps {
  bindings?: (channel: string) => OfflineBinding | undefined;
  events?: OfflineEventRepository;
  idMap?: OfflineIdMapRepository;
  reviews?: OfflineReviewRepository;
  rowCapture?: RowCaptureRepository;
  users?: UserRepository;
  /** Actor policy (O-new-7). Default: `offlineActorPolicy` (actorPolicy.ts). */
  actorHook?: (actorUserId: number, channel: string) => ActorCheck;
  /** Duplicate detection (T060/T064). Runs inside the transaction after booking. */
  duplicateHook?: (input: {
    event: OfflineEventRow;
    created: Record<string, number[]>;
    result: BindingResult;
  }) => void | { outcome: "none" } | { outcome: "skipped" | "held"; note: ReplayNote };
  maxAttempts?: () => number;
}

export interface ReplayOptions {
  /** auto = merge round; apply = an admin pressed Apply on the review list */
  mode: "auto" | "apply";
  /** apply only: skip the hold this item was held for */
  bypass?: { checkpoint?: boolean; duplicate?: boolean };
}

class TechnicalReplayError extends Error {}

const VERSION_REFUSAL =
  "Recorded by a different app version — it cannot be booked automatically. Re-enter it from the details shown.";

const TRANSIENT_SQLITE = /^SQLITE_(BUSY|LOCKED|IOERR|FULL|NOMEM|CANTOPEN|PROTOCOL)/;

function isTransient(err: unknown): boolean {
  const code = (err as { code?: unknown })?.code;
  if (typeof code === "string" && (TRANSIENT_SQLITE.test(code) || code === "REPLAY_IN_PROGRESS")) return true;
  return false;
}

function message(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export class ReplayEngine {
  private readonly bindings: (channel: string) => OfflineBinding | undefined;
  private readonly events: OfflineEventRepository;
  private readonly idMap: OfflineIdMapRepository;
  private readonly reviews: OfflineReviewRepository;
  private readonly rowCapture: RowCaptureRepository;
  private readonly users: UserRepository;
  private readonly actorHook?: ReplayDeps["actorHook"];
  private readonly duplicateHook?: ReplayDeps["duplicateHook"];
  private readonly maxAttempts: () => number;

  constructor(deps: ReplayDeps = {}) {
    this.bindings = deps.bindings ?? getOfflineBinding;
    this.events = deps.events ?? getOfflineEventRepository();
    this.idMap = deps.idMap ?? getOfflineIdMapRepository();
    this.reviews = deps.reviews ?? getOfflineReviewRepository();
    this.rowCapture = deps.rowCapture ?? getRowCaptureRepository();
    this.users = deps.users ?? getUserRepository();
    // O-new-7 (G0 approved): shop user + channel role; switched off → note.
    this.actorHook = deps.actorHook ?? offlineActorPolicy(this.users);
    this.duplicateHook = deps.duplicateHook;
    this.maxAttempts = deps.maxAttempts ?? getOfflineMaxAttempts;
  }

  /** Must be called inside the event's tenant context. Never throws: an
   *  unexpected error anywhere is a technical failure of THIS event (retried,
   *  refused at the attempt limit) and never stops the merge round. */
  async process(event: OfflineEventRow, opts: ReplayOptions): Promise<ReplayOutcome> {
    try {
      return await this.processOnce(event, opts);
    } catch (err) {
      return this.technicalFailure(event, message(err));
    }
  }

  private async processOnce(event: OfflineEventRow, opts: ReplayOptions): Promise<ReplayOutcome> {
    if (opts.mode === "auto" && event.status !== "received") return this.stored(event);

    const payload = this.parseJson<Record<string, unknown>>(event.payload_json) ?? {};
    const cls = classOf(event.channel);

    // 1. policy + schema compatibility (FR-016)
    const schema = recordedSchema(event.channel);
    if (cls !== "offline" && cls !== "checkpoint") {
      return this.refuse(event, `NOT_RECORDABLE: "${event.channel}" cannot be done offline`, { payload });
    }
    if (schema) {
      const shape = this.parseJson<ShapeNode>(event.schema_shape_json);
      if (!shape || !isCompatible(shape, describeShape(schema))) {
        return this.refuse(event, VERSION_REFUSAL, { payload, noApply: true, reason: "schema_shape" });
      }
    }

    // 2. checkpoints are never booked by themselves (N8, FR-032)
    if (cls === "checkpoint" && !opts.bypass?.checkpoint) {
      return this.hold(event, "held_checkpoint", "Drawer count / checkpoint taken offline — waits for an admin", {
        payload,
      });
    }

    const binding = this.bindings(event.channel);
    if (!binding || !schema) {
      return this.refuse(event, `This kind of offline work cannot be booked yet (${policyEntry(event.channel)?.label ?? event.channel})`, {
        payload,
      });
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      return this.refuse(event, VERSION_REFUSAL, {
        payload,
        noApply: true,
        reason: "parse",
        issues: parsed.error.issues.slice(0, 3).map((i) => i.message),
      });
    }

    // 3. dependencies + id rewrite (FR-019, FR-034)
    const blocking = this.blockingDependencies(event);
    if (blocking.length > 0) {
      return this.hold(event, "waiting", `Waits on item ${blocking.join(", ")}`, { dependsOn: blocking });
    }
    const { payload: rewritten, unmapped } = rewriteIdPositions(
      event.channel,
      parsed.data as Record<string, unknown>,
      (id) => this.idMap.lookup(id),
    );
    if (unmapped.length > 0) {
      return this.hold(event, "waiting", "Refers to an offline item that was not booked", { offlineIds: unmapped });
    }

    // 4. actor (O-new-7)
    const actor = this.checkActor(event.actor_user_id, event.channel);
    if (!actor.ok) return this.refuse(event, actor.error ?? "Unknown user", { payload });

    // rates recorded on the PC (O-new-24); a missing/partial record refuses
    const rates = offlineRatesSchema.safeParse(this.parseJson(event.rates_json));
    if (!rates.success) return this.refuse(event, "The exchange rates recorded with this item are incomplete", { payload });
    const effectiveRates = offlineRatesToRows(rates.data);
    const rateNote = this.rateChangedNote(effectiveRates);

    // 5. the booking window
    const tenantId = event.tenant_id;
    const effectiveNow = event.corrected_at ?? event.occurred_at;
    const pcCreated = this.parseJson<Record<string, number[]>>(event.created_json) ?? {};
    let windowResult:
      | { kind: "booked"; outcome: ReplayOutcome }
      | { kind: "refused"; error: string }
      | { kind: "technical"; error: string };
    try {
      windowResult = await runWithTenant(
        tenantId,
        () =>
          runReplayWindow(async () => {
            const db = getDatabase();
            beginReplayTransaction(db);
            let yielded = false;
            const sentinel = setImmediate(() => {
              yielded = true;
            });
            try {
              const before = this.rowCapture.snapshotSequences();
              let result: BindingResult;
              try {
                result = await binding.run(rewritten, {
                  tenantId,
                  actorUserId: event.actor_user_id,
                  eventId: event.event_id,
                  deviceId: event.device_id,
                });
              } catch (err) {
                if (yielded) throw new TechnicalReplayError("The booking yielded to the event loop (not allowed in a replay)");
                if (isTransient(err)) throw new TechnicalReplayError(message(err));
                rollbackReplayTransaction(db);
                return { kind: "refused" as const, error: message(err) };
              }
              if (yielded) throw new TechnicalReplayError("The booking yielded to the event loop (not allowed in a replay)");
              if (!result || result.success !== true) {
                rollbackReplayTransaction(db);
                return { kind: "refused" as const, error: result?.error ?? "Refused by the service" };
              }
              const created = this.rowCapture.createdSince(before);
              this.duplicateHook?.({ event, created, result });
              const notes: ReplayNote[] = [];
              if (actor.note) notes.push(actor.note);
              if (rateNote) notes.push(rateNote);
              this.mapCreated(event, pcCreated, created, notes);
              this.writeAudit(event, actor, created);
              this.events.updateOutcome(event.id, {
                status: opts.mode === "apply" ? "applied" : "booked",
                resultJson: JSON.stringify({ result: this.trimResult(result), serverIds: created }),
                error: null,
              });
              for (const n of notes) {
                this.reviews.insert({ eventRowId: event.id, deviceId: event.device_id, kind: n.kind, details: n.details });
              }
              if (yielded) throw new TechnicalReplayError("The booking yielded to the event loop (not allowed in a replay)");
              commitReplayTransaction(db);
              return {
                kind: "booked" as const,
                outcome: {
                  status: (opts.mode === "apply" ? "applied" : "booked") as OfflineEventStatus,
                  serverIds: created,
                  notes: notes.map((n) => n.kind),
                },
              };
            } catch (err) {
              rollbackReplayTransaction(db);
              return { kind: "technical" as const, error: message(err) };
            } finally {
              clearImmediate(sentinel);
            }
          }),
        {
          clientDay: event.client_day,
          clientTzOffsetMinutes: event.client_tz_offset_minutes,
          effectiveNow,
          effectiveRates,
        },
      );
    } catch (err) {
      windowResult = { kind: "technical", error: message(err) };
    }

    if (windowResult.kind === "booked") return windowResult.outcome;
    if (windowResult.kind === "refused") return this.refuse(event, windowResult.error, { payload });
    return this.technicalFailure(event, windowResult.error);
  }

  // ---------------------------------------------------------------------------

  private stored(event: OfflineEventRow): ReplayOutcome {
    const serverIds = (this.parseJson<{ serverIds?: Record<string, number[]> }>(event.result_json ?? "") ?? {}).serverIds;
    return { status: event.status, error: event.error, serverIds, notes: [] };
  }

  private parseJson<T>(text: string | null | undefined): T | null {
    if (!text) return null;
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }

  private db(): Database.Database {
    return getDatabase();
  }

  private refuse(event: OfflineEventRow, error: string, details: Record<string, unknown>): ReplayOutcome {
    this.db().transaction(() => {
      this.events.updateOutcome(event.id, { status: "refused", resultJson: null, error });
      this.reviews.insert({
        eventRowId: event.id,
        deviceId: event.device_id,
        kind: "refused",
        details: { reason: error, channel: event.channel, ...details },
      });
    })();
    offlineLogger.info({ eventId: event.event_id, channel: event.channel, error }, "offline event refused");
    return { status: "refused", error, notes: ["refused"] };
  }

  private hold(event: OfflineEventRow, kind: OfflineReviewKind, error: string, details: Record<string, unknown>): ReplayOutcome {
    this.db().transaction(() => {
      this.events.updateOutcome(event.id, { status: "held", resultJson: null, error });
      this.reviews.insert({
        eventRowId: event.id,
        deviceId: event.device_id,
        kind,
        details: { reason: error, channel: event.channel, ...details },
      });
    })();
    return { status: "held", error, notes: [kind] };
  }

  private technicalFailure(event: OfflineEventRow, error: string): ReplayOutcome {
    const attempts = this.events.incrementAttempts(event.id, error);
    offlineLogger.warn({ eventId: event.event_id, channel: event.channel, attempts, error }, "offline replay technical failure");
    if (attempts >= this.maxAttempts()) {
      return this.refuse(event, `Could not be booked after ${attempts} attempts: ${error}`, {});
    }
    return { status: "received", error, technical: true, notes: [] };
  }

  /** Earlier events this one depends on that are not booked (FR-034). */
  private blockingDependencies(event: OfflineEventRow): string[] {
    const deps = this.parseJson<string[]>(event.depends_on_json) ?? [];
    if (deps.length === 0) return [];
    const rows = this.events.findManyByEventIds(deps);
    const ok = new Set(rows.filter((r) => r.status === "booked" || r.status === "applied").map((r) => r.event_id));
    return deps.filter((d) => !ok.has(d));
  }

  private checkActor(actorUserId: number, channel: string): ActorCheck {
    if (this.actorHook) return this.actorHook(actorUserId, channel);
    const user = this.users.findById(actorUserId) as { username?: string; role?: string } | null;
    if (!user) return { ok: false, error: "The person who did this is not a user of this shop" };
    return { ok: true, username: user.username, role: user.role };
  }

  /** Recorded LBP rate vs the shop's CURRENT rate (rates keep no history). */
  private rateChangedNote(recorded: ReturnType<typeof offlineRatesToRows>): ReplayNote | null {
    const notes: Array<{ currency: string; recorded: number; current: number }> = [];
    for (const r of recorded) {
      const current = getRateRepository().findByCode(r.to_code);
      if (current && current.sell_rate !== r.sell_rate) {
        notes.push({ currency: r.to_code, recorded: r.sell_rate, current: current.sell_rate });
      }
    }
    return notes.length ? { kind: "rate_changed", details: { rates: notes } } : null;
  }

  /** PC ids → server ids per table, in creation order (FR-020). */
  private mapCreated(
    event: OfflineEventRow,
    pc: Record<string, number[]>,
    server: Record<string, number[]>,
    notes: ReplayNote[],
  ): void {
    const mismatched: Array<{ table: string; pc: number; server: number }> = [];
    for (const table of new Set([...Object.keys(pc), ...Object.keys(server)])) {
      const p = (pc[table] ?? []).filter((id) => isOfflineId(id));
      const s = server[table] ?? [];
      if (p.length !== s.length) {
        mismatched.push({ table, pc: p.length, server: s.length });
        continue;
      }
      p.forEach((offlineId, i) => {
        this.idMap.insert({ offlineId, deviceId: event.device_id, tableName: table, serverId: s[i], eventId: event.event_id });
      });
    }
    if (mismatched.length > 0) notes.push({ kind: "came_out_differently", details: { tables: mismatched } });
  }

  private writeAudit(event: OfflineEventRow, actor: ActorCheck, created: Record<string, number[]>): void {
    getAuditService().log({
      user_id: event.actor_user_id,
      username: actor.username ?? `user ${event.actor_user_id}`,
      role: actor.role ?? "staff",
      action: "offline_replay",
      entity_type: "offline_event",
      entity_id: event.event_id,
      summary: `Offline work booked: ${policyEntry(event.channel)?.label ?? event.channel}`,
      metadata: { channel: event.channel, deviceId: event.device_id, seq: event.device_seq, created },
    });
  }

  private trimResult(result: BindingResult): Record<string, unknown> {
    const text = JSON.stringify(result);
    return text.length > 4000 ? { success: true, truncated: true } : (result as Record<string, unknown>);
  }
}
