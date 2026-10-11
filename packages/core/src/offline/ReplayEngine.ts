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
 * The booking runs inside `SAVEPOINT offline_dup`: a certain / likely
 * duplicate (DuplicateDetector, the default hook) rolls back to it and the
 * event is stored `skipped` / `held` in the same transaction (no map rows, no
 * audit row). After booking: "stock count was off" (products that went below
 * zero), "closed day changed" (a later drawer count of that day) and the
 * binding's replay-only notes / link (`BindingResult.offline`).
 * In `apply` mode (an admin's Apply / Book anyway) a refusal changes nothing
 * but the event's error and a technical failure burns no attempt; `onBooked`
 * runs inside the transaction before COMMIT (resolves the review item).
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
import { dayAt } from "./skew.js";
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
import { DuplicateDetector } from "../services/DuplicateDetector.js";
import { getClosingRepository } from "../repositories/ClosingRepository.js";
import { toSqliteUtc } from "../utils/requestNow.js";
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
  /** apply mode: refused/held again — nothing changed but the event's error */
  refusedOnApply?: boolean;
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
  /** auto only: re-process a HELD dependant whose parent was just resolved
   *  (the review service; every check runs, the outcome is `booked`). */
  release?: boolean;
  /** runs inside the booking transaction, just before COMMIT */
  onBooked?: (outcome: { serverIds: Record<string, number[]> }) => void;
}

class TechnicalReplayError extends Error {}

export const UNLINKED_PART = "This item was booked, but this part could not be linked";

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
    this.duplicateHook = deps.duplicateHook ?? new DuplicateDetector().check;
    this.maxAttempts = deps.maxAttempts ?? getOfflineMaxAttempts;
  }

  /** Must be called inside the event's tenant context. Never throws: an
   *  unexpected error anywhere is a technical failure of THIS event (retried,
   *  refused at the attempt limit) and never stops the merge round. */
  async process(event: OfflineEventRow, opts: ReplayOptions): Promise<ReplayOutcome> {
    try {
      return await this.processOnce(event, opts);
    } catch (err) {
      return this.technicalFailure(event, message(err), opts);
    }
  }

  private async processOnce(event: OfflineEventRow, opts: ReplayOptions): Promise<ReplayOutcome> {
    if (opts.mode === "auto" && event.status !== "received" && !(opts.release && event.status === "held")) {
      return this.stored(event);
    }

    const payload = this.parseJson<Record<string, unknown>>(event.payload_json) ?? {};
    const cls = classOf(event.channel);

    // 1. policy + schema compatibility (FR-016)
    const schema = recordedSchema(event.channel);
    if (cls !== "offline" && cls !== "checkpoint") {
      return this.refuse(opts, event, `NOT_RECORDABLE: "${event.channel}" cannot be done offline`, { payload });
    }
    if (schema) {
      const shape = this.parseJson<ShapeNode>(event.schema_shape_json);
      if (!shape || !isCompatible(shape, describeShape(schema))) {
        return this.refuse(opts, event, VERSION_REFUSAL, { payload, noApply: true, reason: "schema_shape" });
      }
    }

    // 2. checkpoints are never booked by themselves (N8, FR-032)
    if (cls === "checkpoint" && !opts.bypass?.checkpoint) {
      return this.hold(opts, event, "held_checkpoint", "Drawer count / checkpoint taken offline — waits for an admin", {
        payload,
      });
    }

    const binding = this.bindings(event.channel);
    if (!binding || !schema) {
      return this.refuse(opts, event, `This kind of offline work cannot be booked yet (${policyEntry(event.channel)?.label ?? event.channel})`, {
        payload,
      });
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      return this.refuse(opts, event, VERSION_REFUSAL, {
        payload,
        noApply: true,
        reason: "parse",
        issues: parsed.error.issues.slice(0, 3).map((i) => i.message),
      });
    }

    // 3. dependencies + id rewrite (FR-019, FR-020, FR-034)
    const deps = this.dependencyState(event);
    if (deps.blocking.length > 0) {
      return this.hold(opts, event, "waiting", `Waits on item ${deps.blocking.join(", ")}`, { dependsOn: deps.blocking });
    }
    const { payload: rewritten, unmapped } = rewriteIdPositions(
      event.channel,
      parsed.data as Record<string, unknown>,
      (id) => this.idMap.lookup(id),
    );
    if (unmapped.length > 0) {
      // an id created by an event that IS settled (booked / linked) but has
      // no map row: the part that could not be linked (FR-020, O-new-28)
      const ofSettled = unmapped.some((id) => deps.settledCreated.has(id));
      return this.hold(
        opts,
        event,
        "waiting",
        ofSettled ? UNLINKED_PART : "Refers to an offline item that was not booked",
        { offlineIds: unmapped },
      );
    }

    // 4. actor (O-new-7)
    const actor = this.checkActor(event.actor_user_id, event.channel);
    if (!actor.ok) return this.refuse(opts, event, actor.error ?? "Unknown user", { payload });

    // rates recorded on the PC (O-new-24); a missing/partial record refuses
    const rates = offlineRatesSchema.safeParse(this.parseJson(event.rates_json));
    if (!rates.success) return this.refuse(opts, event, "The exchange rates recorded with this item are incomplete", { payload });
    const effectiveRates = offlineRatesToRows(rates.data);
    const rateNote = this.rateChangedNote(effectiveRates);

    // 5. the booking window
    const tenantId = event.tenant_id;
    const effectiveNow = event.corrected_at ?? event.occurred_at;
    // FR-022: a corrected instant may fall on another day (rule 27)
    const day = event.corrected_at ? dayAt(event.corrected_at, event.client_tz_offset_minutes) : event.client_day;
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
              db.exec("SAVEPOINT offline_dup");
              const before = this.rowCapture.snapshotSequences();
              const negativeBefore = this.rowCapture.negativeStock();
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

              // duplicate check (N7) — inside the savepoint
              const dup = opts.bypass?.duplicate ? undefined : this.duplicateHook?.({ event, created, result });
              if (dup && dup.outcome !== "none") {
                db.exec("ROLLBACK TO offline_dup");
                db.exec("RELEASE offline_dup");
                if (yielded) throw new TechnicalReplayError("The booking yielded to the event loop (not allowed in a replay)");
                const status: OfflineEventStatus = dup.outcome;
                const error = String(dup.note.details.reason ?? dup.note.kind);
                this.events.updateOutcome(event.id, { status, resultJson: null, error });
                this.reviews.insert({
                  eventRowId: event.id,
                  deviceId: event.device_id,
                  kind: dup.note.kind,
                  details: { ...dup.note.details, channel: event.channel, payload },
                });
                commitReplayTransaction(db);
                return { kind: "booked" as const, outcome: { status, error, notes: [dup.note.kind] } };
              }
              db.exec("RELEASE offline_dup");

              const notes: ReplayNote[] = [];
              if (actor.note) notes.push(actor.note);
              if (rateNote) notes.push(rateNote);
              const stockNote = this.stockNote(negativeBefore);
              if (stockNote) notes.push(stockNote);
              const dayNote = this.closedDayNote(day, effectiveNow, created);
              if (dayNote) notes.push(dayNote);
              for (const n of result.offline?.notes ?? []) notes.push({ kind: n.kind, details: n.details });
              this.mapBooking(event, binding, result, pcCreated, created, notes);
              this.writeAudit(event, actor, created);
              this.events.updateOutcome(event.id, {
                status: opts.mode === "apply" ? "applied" : "booked",
                resultJson: JSON.stringify({ result: this.trimResult(result), serverIds: created }),
                error: null,
              });
              for (const n of notes) {
                this.reviews.insert({ eventRowId: event.id, deviceId: event.device_id, kind: n.kind, details: n.details });
              }
              opts.onBooked?.({ serverIds: created });
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
          clientDay: day,
          clientTzOffsetMinutes: event.client_tz_offset_minutes,
          effectiveNow,
          effectiveRates,
        },
      );
    } catch (err) {
      windowResult = { kind: "technical", error: message(err) };
    }

    if (windowResult.kind === "booked") return windowResult.outcome;
    if (windowResult.kind === "refused") return this.refuse(opts, event, windowResult.error, { payload });
    return this.technicalFailure(event, windowResult.error, opts);
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

  /** Apply mode: a refusal / hold changes nothing but the event's error (data-model). */
  private failedOnApply(event: OfflineEventRow, error: string, kind: OfflineReviewKind): ReplayOutcome {
    this.events.setError(event.id, error);
    return { status: event.status, error, refusedOnApply: true, notes: [kind] };
  }

  private refuse(opts: ReplayOptions, event: OfflineEventRow, error: string, details: Record<string, unknown>): ReplayOutcome {
    if (opts.mode === "apply") return this.failedOnApply(event, error, "refused");
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

  private hold(
    opts: ReplayOptions,
    event: OfflineEventRow,
    kind: OfflineReviewKind,
    error: string,
    details: Record<string, unknown>,
  ): ReplayOutcome {
    if (opts.mode === "apply") return this.failedOnApply(event, error, kind);
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

  private technicalFailure(event: OfflineEventRow, error: string, opts?: ReplayOptions): ReplayOutcome {
    // an admin's click never burns an attempt (e.g. REPLAY_IN_PROGRESS while a round runs)
    if (opts?.mode === "apply") return { status: event.status, error, technical: true, notes: [] };
    const attempts = this.events.incrementAttempts(event.id, error);
    offlineLogger.warn({ eventId: event.event_id, channel: event.channel, attempts, error }, "offline replay technical failure");
    if (attempts >= this.maxAttempts()) {
      return this.refuse({ mode: "auto" }, event, `Could not be booked after ${attempts} attempts: ${error}`, {});
    }
    return { status: "received", error, technical: true, notes: [] };
  }

  /**
   * The events this one depends on (FR-034). A dependency is settled when it
   * was booked / applied, or resolved by LINKING it to an existing row (a
   * certain duplicate marked reviewed, a likely duplicate dismissed — their
   * main row is mapped `linked_existing`). Anything else blocks.
   * `settledCreated` = the PC ids the settled dependencies created (an
   * unmapped one is "a part that could not be linked").
   */
  dependencyState(event: OfflineEventRow): { blocking: string[]; settledCreated: Set<number> } {
    const deps = this.parseJson<string[]>(event.depends_on_json) ?? [];
    const settledCreated = new Set<number>();
    if (deps.length === 0) return { blocking: [], settledCreated };
    const rows = this.events.findManyByEventIds(deps);
    const settled = new Set<string>();
    for (const r of rows) {
      const ok =
        r.status === "booked" ||
        r.status === "applied" ||
        ((r.status === "skipped" || r.status === "dismissed") && this.idMap.listForEvent(r.event_id).length > 0);
      if (!ok) continue;
      settled.add(r.event_id);
      const created = this.parseJson<Record<string, number[]>>(r.created_json) ?? {};
      for (const ids of Object.values(created)) for (const id of ids) settledCreated.add(id);
    }
    return { blocking: deps.filter((d) => !settled.has(d)), settledCreated };
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

  /** Map the booking (FR-020): a replay-only link / main-row-only rule
   *  maps ONE row; otherwise every PC row per table, in creation order. */
  private mapBooking(
    event: OfflineEventRow,
    binding: OfflineBinding,
    result: BindingResult,
    pc: Record<string, number[]>,
    server: Record<string, number[]>,
    notes: ReplayNote[],
  ): void {
    const link = result.offline?.linkExisting;
    if (link) {
      this.mapMainRow(event, pc, link.table, link.id, "linked_existing");
      return;
    }
    if (result.offline?.mainRowOnly) {
      const main = binding.mainRow?.(result);
      if (main) this.mapMainRow(event, pc, main.table, main.id, "created");
      return;
    }
    this.mapCreated(event, pc, server, notes);
  }

  /** Map the PC's main row of `table` (its first created id) to `serverId`. */
  mapMainRow(
    event: OfflineEventRow,
    pc: Record<string, number[]>,
    table: string,
    serverId: number,
    linkKind: "created" | "linked_existing",
  ): boolean {
    const offlineId = (pc[table] ?? []).find((id) => isOfflineId(id));
    if (offlineId === undefined || this.idMap.lookup(offlineId) !== undefined) return false;
    this.idMap.insert({ offlineId, deviceId: event.device_id, tableName: table, serverId, eventId: event.event_id, linkKind });
    return true;
  }

  /** Products the booking pushed below zero (or further below), FR-028. */
  private stockNote(before: Map<number, { name: string; stock: number }>): ReplayNote | null {
    const products: Array<{ id: number; name: string; stock: number }> = [];
    for (const [id, p] of this.rowCapture.negativeStock()) {
      const was = before.get(id);
      if (!was || p.stock < was.stock) products.push({ id, name: p.name, stock: p.stock });
    }
    return products.length ? { kind: "stock_count_off", details: { products } } : null;
  }

  /** A later drawer count / closing of the event's day exists (FR-033). */
  private closedDayNote(day: string, effectiveNow: string, created: Record<string, number[]>): ReplayNote | null {
    const ids = getClosingRepository().findClosingsRecordedAfter(day, toSqliteUtc(effectiveNow), created.daily_closings ?? []);
    return ids.length ? { kind: "closed_day_changed", details: { day, closings: ids } } : null;
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
