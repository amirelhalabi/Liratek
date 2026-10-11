/**
 * LIRA-306 — the "Offline work to review" list (US3, FR-037, R13).
 * Server-only (exported from `index.ts`); the web routes call it with the
 * admin from the JWT (FR-038).
 *
 * Actions (each idempotent: the item's state is checked inside the step; a
 * repeat of the same action returns the current state; who / when recorded):
 *   - Apply (held / refused items): re-runs the replay bypassing ONLY the
 *     reason the item was held — a held duplicate skips the duplicate check,
 *     a held checkpoint skips the hold; a refused or waiting item re-runs
 *     every check. Refused for a waiting item whose parent is still open and
 *     for a version refusal. On success the waiting dependants are processed
 *     in their original order (transitively).
 *   - Dismiss (held / refused items): nothing is booked. A dismissed LIKELY
 *     duplicate is linked to the row it matched — its MAIN row only
 *     (FR-027, O-new-28; T059 wins over T068's "relinked where counts
 *     agree", O-impl-A2-2) — and its dependants are released; other
 *     dependants stay held "depends on a dismissed item".
 *   - Mark reviewed (notes, and certain duplicates): closes the note; a
 *     certain duplicate's MAIN row is linked to the existing row and its
 *     dependants released (FR-026).
 *   - Book anyway (certain duplicates only, O-new-5): books it once.
 */
import { ReplayEngine, type ReplayOutcome } from "../offline/ReplayEngine.js";
import { OFFLINE_HOLDING_KINDS, OFFLINE_REVIEW_KIND_LABELS, type OfflineReviewKind } from "../offline/reviewKinds.js";
import { policyEntry } from "../offline/channelPolicy.js";
import { isOfflineId } from "../offline/idRange.js";
import { receiptNumberFor } from "../utils/receiptNumber.js";
import {
  getOfflineEventRepository,
  type OfflineEventRepository,
  type OfflineEventRow,
} from "../repositories/OfflineEventRepository.js";
import {
  getOfflineReviewRepository,
  type OfflineReviewRepository,
  type OfflineReviewRow,
  type OfflineReviewState,
} from "../repositories/OfflineReviewRepository.js";
import { getOfflineDeviceRepository, type OfflineDeviceRepository } from "../repositories/OfflineDeviceRepository.js";
import { getUserRepository, type UserRepository } from "../repositories/UserRepository.js";
import {
  offlineHistoryQuerySchema,
  reviewListQuerySchema,
  type OfflineHistoryQuery,
  type ReviewListQuery,
} from "../validators/offline.js";
import { offlineLogger } from "../utils/logger.js";
import type { OfflineHistoryView, ReviewAction, ReviewActionResult, ReviewItemView } from "../offline/views.js";
export type { OfflineHistoryView, ReviewAction, ReviewActionResult, ReviewItemView } from "../offline/views.js";





export interface OfflineReviewServiceDeps {
  engine?: ReplayEngine;
  events?: OfflineEventRepository;
  reviews?: OfflineReviewRepository;
  devices?: OfflineDeviceRepository;
  users?: UserRepository;
}

const NOTE_KINDS_REVIEWABLE = (kind: OfflineReviewKind): boolean => !OFFLINE_HOLDING_KINDS.includes(kind);
const DISMISSED_PARENT = "Depends on a dismissed item";
const PARENT_OPEN = "This item waits on an item that is still open — resolve that one first";

function parse<T>(text: string | null | undefined, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export class OfflineReviewService {
  private readonly engine: ReplayEngine;
  private readonly events: OfflineEventRepository;
  private readonly reviews: OfflineReviewRepository;
  private readonly devices: OfflineDeviceRepository;
  private readonly users: UserRepository;

  constructor(deps: OfflineReviewServiceDeps = {}) {
    this.engine = deps.engine ?? new ReplayEngine();
    this.events = deps.events ?? getOfflineEventRepository();
    this.reviews = deps.reviews ?? getOfflineReviewRepository();
    this.devices = deps.devices ?? getOfflineDeviceRepository();
    this.users = deps.users ?? getUserRepository();
  }

  // ── reads ────────────────────────────────────────────────────────────────

  list(query: ReviewListQuery = {}): {
    success: boolean;
    data?: { items: ReviewItemView[]; groups: Array<{ kind: OfflineReviewKind; label: string; count: number }> };
    error?: string;
  } {
    const q = reviewListQuerySchema.safeParse(query);
    if (!q.success) return { success: false, error: q.error.issues[0]?.message ?? "Invalid filter" };
    const devices = new Map(this.devices.list().map((d) => [d.id, d]));
    const names = new Map<number, string | null>();
    const items = this.reviews.list({ state: q.data.state, kind: q.data.kind }).map((r) => {
      const ev = r.event_row_id ? this.events.findById(r.event_row_id) : null;
      const d = devices.get(r.device_id);
      if (ev && !names.has(ev.actor_user_id)) {
        names.set(ev.actor_user_id, this.users.findByIdInShopAnyStatus(ev.actor_user_id)?.username ?? null);
      }
      const details = parse<Record<string, unknown>>(r.details_json, {});
      return {
        id: r.id,
        kind: r.kind,
        label: OFFLINE_REVIEW_KIND_LABELS[r.kind],
        state: r.state,
        holding: OFFLINE_HOLDING_KINDS.includes(r.kind),
        actions: r.state === "open" ? this.actionsFor(r, details) : [],
        // holding items show the event's CURRENT reason (refused again on
        // Apply, "depends on a dismissed item", …); notes keep their own
        reason:
          OFFLINE_HOLDING_KINDS.includes(r.kind) && r.state === "open" && ev?.error
            ? ev.error
            : typeof details.reason === "string"
              ? details.reason
              : (ev?.error ?? null),
        details,
        eventId: ev?.event_id ?? null,
        eventStatus: ev?.status ?? null,
        channel: ev?.channel ?? null,
        channelLabel: ev ? (policyEntry(ev.channel)?.label ?? ev.channel) : null,
        occurredAt: ev ? (ev.corrected_at ?? ev.occurred_at) : null,
        deviceId: r.device_id,
        deviceNo: d?.device_no ?? null,
        deviceName: d?.name ?? null,
        actorUserId: ev?.actor_user_id ?? null,
        actorName: ev ? (names.get(ev.actor_user_id) ?? null) : null,
        createdAt: r.created_at,
        resolvedBy: r.resolved_by,
        resolvedAt: r.resolved_at,
      } satisfies ReviewItemView;
    });
    const counts = new Map<OfflineReviewKind, number>();
    for (const i of items) counts.set(i.kind, (counts.get(i.kind) ?? 0) + 1);
    const groups = [...counts].map(([kind, count]) => ({ kind, label: OFFLINE_REVIEW_KIND_LABELS[kind], count }));
    return { success: true, data: { items, groups } };
  }

  history(query: OfflineHistoryQuery = {}): { success: boolean; data?: { events: OfflineHistoryView[] }; error?: string } {
    const q = offlineHistoryQuerySchema.safeParse(query);
    if (!q.success) return { success: false, error: q.error.issues[0]?.message ?? "Invalid filter" };
    const devices = new Map(this.devices.list().map((d) => [d.id, d]));
    const events = this.events.listHistory(q.data).map((e) => {
      const created = parse<Record<string, number[]>>(e.created_json, {});
      const pcSale = (created.sales ?? []).find((id) => isOfflineId(id));
      return {
        eventId: e.event_id,
        seq: e.device_seq,
        deviceId: e.device_id,
        deviceNo: devices.get(e.device_id)?.device_no ?? null,
        channel: e.channel,
        channelLabel: policyEntry(e.channel)?.label ?? e.channel,
        status: e.status,
        occurredAt: e.occurred_at,
        correctedAt: e.corrected_at,
        clientDay: e.client_day,
        error: e.error,
        serverIds: parse<{ serverIds?: Record<string, number[]> }>(e.result_json, {}).serverIds ?? null,
        receiptNumber: pcSale !== undefined ? receiptNumberFor(pcSale) : null,
      };
    });
    return { success: true, data: { events } };
  }

  // ── actions ──────────────────────────────────────────────────────────────

  async apply(itemId: number, adminUserId: number): Promise<ReviewActionResult> {
    const ctx = this.load(itemId);
    if ("error" in ctx) return ctx.error;
    const { item, event } = ctx;
    if (item.state !== "open") return this.repeat(item, event, "applied");
    if (!event || !OFFLINE_HOLDING_KINDS.includes(item.kind)) {
      return { success: false, code: "NOT_APPLICABLE", error: "Only held or refused items can be applied" };
    }
    if (parse<Record<string, unknown>>(item.details_json, {}).noApply === true) {
      return { success: false, code: "NOT_APPLICABLE", error: "Recorded by a different app version — re-enter it instead" };
    }
    if (this.engine.dependencyState(event).blocking.length > 0) {
      return { success: false, code: "PARENT_OPEN", error: PARENT_OPEN };
    }
    const bypass = item.kind === "possible_duplicate" ? { duplicate: true } : item.kind === "held_checkpoint" ? { checkpoint: true } : {};
    const outcome = await this.engine.process(event, {
      mode: "apply",
      bypass,
      onBooked: () => this.closeOpenItems(event, "applied", adminUserId),
    });
    return this.afterBooking(item, event, outcome, adminUserId);
  }

  async bookAnyway(itemId: number, adminUserId: number): Promise<ReviewActionResult> {
    const ctx = this.load(itemId);
    if ("error" in ctx) return ctx.error;
    const { item, event } = ctx;
    if (item.kind !== "certain_duplicate" || !event) {
      return { success: false, code: "NOT_APPLICABLE", error: "Book anyway is only for a skipped duplicate transfer or recharge" };
    }
    if (item.state !== "open") return this.repeat(item, event, "applied");
    const outcome = await this.engine.process(event, {
      mode: "apply",
      bypass: { duplicate: true },
      onBooked: () => this.closeOpenItems(event, "applied", adminUserId),
    });
    return this.afterBooking(item, event, outcome, adminUserId);
  }

  async dismiss(itemId: number, adminUserId: number, note?: string): Promise<ReviewActionResult> {
    const ctx = this.load(itemId);
    if ("error" in ctx) return ctx.error;
    const { item, event } = ctx;
    if (item.state !== "open") return this.repeat(item, event, "dismissed");
    if (!OFFLINE_HOLDING_KINDS.includes(item.kind) && item.kind !== "pc_data_mismatch") {
      return { success: false, code: "NOT_APPLICABLE", error: "Notes are closed with Mark reviewed" };
    }
    let linked = false;
    this.reviews.transaction(() => {
      if (event) {
        if (item.kind === "possible_duplicate") linked = this.linkToMatch(item, event);
        this.events.setStatus(event.id, "dismissed", adminUserId);
        if (note) this.events.setError(event.id, `Dismissed: ${note}`);
        this.closeOpenItems(event, "dismissed", adminUserId);
      } else {
        this.reviews.resolve(item.id, "dismissed", adminUserId);
      }
    });
    if (event) {
      if (linked) await this.releaseDependants(event, adminUserId);
      else this.markDependantsDismissed(event);
    }
    offlineLogger.info({ itemId, kind: item.kind, by: adminUserId }, "offline review item dismissed");
    return { success: true, data: { state: "dismissed" } };
  }

  async markReviewed(itemId: number, adminUserId: number): Promise<ReviewActionResult> {
    const ctx = this.load(itemId);
    if ("error" in ctx) return ctx.error;
    const { item, event } = ctx;
    if (item.state !== "open") return this.repeat(item, event, "reviewed");
    if (!NOTE_KINDS_REVIEWABLE(item.kind)) {
      return { success: false, code: "NOT_APPLICABLE", error: "A held item is resolved with Apply or Dismiss" };
    }
    let linked = false;
    this.reviews.transaction(() => {
      if (item.kind === "certain_duplicate" && event) {
        linked = this.linkToMatch(item, event);
        this.events.markResolved(event.id, adminUserId);
      }
      this.reviews.resolve(item.id, "reviewed", adminUserId);
    });
    if (linked && event) await this.releaseDependants(event, adminUserId);
    return { success: true, data: { state: "reviewed" } };
  }

  // ── internals ────────────────────────────────────────────────────────────

  private actionsFor(item: OfflineReviewRow, details: Record<string, unknown>): ReviewAction[] {
    if (item.kind === "certain_duplicate") return ["reviewed", "book_anyway"];
    if (item.kind === "pc_data_mismatch") return ["reviewed"];
    if (OFFLINE_HOLDING_KINDS.includes(item.kind)) return details.noApply === true ? ["dismiss"] : ["apply", "dismiss"];
    return ["reviewed"];
  }

  private load(itemId: number): { item: OfflineReviewRow; event: OfflineEventRow | null } | { error: ReviewActionResult } {
    const item = this.reviews.findById(itemId);
    if (!item) return { error: { success: false, code: "NOT_FOUND", error: "Review item not found" } };
    const event = item.event_row_id ? this.events.findById(item.event_row_id) : null;
    return { item, event };
  }

  /** A repeat of an action on a resolved item returns the current state. */
  private repeat(item: OfflineReviewRow, event: OfflineEventRow | null, expected: OfflineReviewState): ReviewActionResult {
    if (item.state !== expected) {
      return { success: false, code: "ALREADY_RESOLVED", error: `This item was already ${item.state}` };
    }
    const serverIds = parse<{ serverIds?: Record<string, number[]> }>(event?.result_json, {}).serverIds;
    return { success: true, data: { state: item.state, status: event?.status, ...(serverIds ? { serverIds } : {}) } };
  }

  private async afterBooking(
    item: OfflineReviewRow,
    event: OfflineEventRow,
    outcome: ReplayOutcome,
    adminUserId: number,
  ): Promise<ReviewActionResult> {
    if (outcome.technical) {
      return { success: false, code: "BUSY", error: "The server is busy booking offline work — try again in a moment" };
    }
    if (outcome.status === "applied") {
      await this.releaseDependants(event, adminUserId);
      return { success: true, data: { status: "applied", serverIds: outcome.serverIds ?? {} } };
    }
    if (outcome.status === "held" && !outcome.refusedOnApply) {
      // a refused item that now looks like a duplicate → a new possible-duplicate item
      this.reviews.resolve(item.id, "reviewed", adminUserId);
      return { success: false, code: "HELD", error: outcome.error ?? "Held again" };
    }
    return { success: false, code: "REFUSED", error: outcome.error ?? "Refused by the service" };
  }

  /** Close every open item of the event (inside the booking / action step). */
  private closeOpenItems(event: OfflineEventRow, state: Exclude<OfflineReviewState, "open">, by: number): void {
    for (const open of this.reviews.openForEvent(event.id)) {
      // notes on a booked event stay for Mark reviewed
      if (OFFLINE_HOLDING_KINDS.includes(open.kind) || open.kind === "certain_duplicate") {
        this.reviews.resolve(open.id, state, by);
      }
    }
  }

  /** Link a duplicate's MAIN row to the row it matched (never its children). */
  private linkToMatch(item: OfflineReviewRow, event: OfflineEventRow): boolean {
    const details = parse<{ match?: { table?: string; id?: number } }>(item.details_json, {});
    const match = details.match;
    if (!match?.table || typeof match.id !== "number") return false;
    const pc = parse<Record<string, number[]>>(event.created_json, {});
    return this.engine.mapMainRow(event, pc, match.table, match.id, "linked_existing");
  }

  /** Process the held dependants of `parent` in their original order,
   *  transitively, with every check (FR-034, O-new-20). */
  private async releaseDependants(parent: OfflineEventRow, adminUserId: number): Promise<void> {
    const released = new Set<string>([parent.event_id]);
    const tried = new Set<number>();
    for (;;) {
      const next = this.events.listHeldDependingOn([...released]).filter((e) => !tried.has(e.id));
      if (next.length === 0) return;
      for (const dep of next) {
        tried.add(dep.id);
        const stale = this.reviews.openForEvent(dep.id).filter((i) => i.kind === "waiting");
        const out = await this.engine.process(dep, {
          mode: "auto",
          release: true,
          onBooked: () => {
            for (const s of stale) this.reviews.resolve(s.id, "applied", adminUserId);
          },
        });
        if (out.status === "booked") {
          released.add(dep.event_id);
        } else if (!out.technical) {
          // held / refused again: the engine wrote a fresh item — close the stale one
          for (const s of stale) this.reviews.resolve(s.id, "reviewed", adminUserId);
        }
      }
    }
  }

  /** Dependants of a dismissed (unlinked) item stay held with the reason. */
  private markDependantsDismissed(parent: OfflineEventRow): void {
    for (const dep of this.events.listHeldDependingOn([parent.event_id])) {
      this.events.setError(dep.id, DISMISSED_PARENT);
    }
  }
}

let instance: OfflineReviewService | null = null;
export function getOfflineReviewService(): OfflineReviewService {
  if (!instance) instance = new OfflineReviewService();
  return instance;
}
export function resetOfflineReviewService(): void {
  instance = null;
}
