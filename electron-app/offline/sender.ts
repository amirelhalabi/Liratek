/**
 * LIRA-306 — uploads the PC's waiting events (FR-015, FR-001a;
 * contracts/rest-offline.md POST /events, GET /events/status). Driven by the
 * sync client's 30 s tick whenever the server is reachable in offline or
 * finishing mode, and by `offline:send-now`.
 *
 *   - waiting events in sequence order, batches of ≤ 100;
 *   - acked events are marked; outcomes from /events/status are copied
 *     (booked/applied/dismissed → done);
 *   - a lost response simply resends the same events (the server stores by
 *     event id), so nothing is duplicated;
 *   - VERSION_AHEAD / a revoked key / SEQ_CONFLICT / EVENT_ID_REUSED stop
 *     sending and put the reason on screen; events stay on the PC;
 *   - "renumber unsent work" (O-new-29) renumbers the waiting events above
 *     the server's max sequence, keeping their event ids;
 *   - when every event of the last finished period has left `received`, the
 *     period is settled (readiness for the next outage, FR-008).
 *
 * Outbox SQL lives in core `OfflineOutboxRepository` (rule 13); every outbox
 * access runs through `exclusive` (the recorder's queue + writable guard), so
 * it never interleaves with an open write window.
 */
import { logger, type OfflineEventInput, type OutboxRow } from "@liratek/core";
import type { PairingStore } from "./pairingStore";
import { DEVICE_KEY_HEADER_NAME, type FetchLike } from "./syncClient";

export const UPLOAD_BATCH = 100;
export const UPLOAD_TIMEOUT_MS = 60_000;

export interface Sender {
  sendWaiting(): Promise<{ sent: number; waiting: number }>;
  renumberUnsent(serverMaxSeq: number): Promise<void>;
}

export interface SenderDeps {
  store: PairingStore;
  fetch: FetchLike;
  now: () => number;
  appVersion: string;
  schemaVersion: number;
  outbox: {
    listWaiting(limit: number): OutboxRow[];
    waitingCount(): number;
    markAcked(ids: readonly string[]): void;
    setServerStatus(
      eventId: string,
      status: OutboxRow["server_status"] & string,
      error: string | null,
    ): void;
    oldestOpenSeq(): number | null;
    unsettledCount(): number;
    renumberWaiting(startSeq: number): number;
  };
  /** run between write windows with the guard open */
  exclusive: <T>(fn: () => T) => Promise<T>;
  /** the server answered */
  onReachable?: () => void;
  /** an attempt got no answer */
  onUnreachable?: () => void;
}

type Env<T> = { success: boolean; data?: T; error?: string; code?: string };

const STOP_CODES = new Set(["SEQ_CONFLICT", "EVENT_ID_REUSED"]);

function toEvent(r: OutboxRow): OfflineEventInput {
  return {
    eventId: r.event_id,
    seq: r.device_seq,
    channel: r.channel,
    payload: JSON.parse(r.payload_json) as Record<string, unknown>,
    actorUserId: r.actor_user_id,
    occurredAt: r.occurred_at,
    clientDay: r.client_day,
    clientTzOffsetMinutes: r.client_tz_offset_minutes,
    copyId: r.copy_id,
    schemaShape: JSON.parse(r.schema_shape_json) as Record<string, unknown>,
    rates: JSON.parse(r.rates_json) as OfflineEventInput["rates"],
    created: JSON.parse(r.created_json) as Record<string, number[]>,
    dependsOn: JSON.parse(r.depends_on_json) as string[],
  };
}

export class OfflineSender implements Sender {
  private sending: Promise<{ sent: number; waiting: number }> | null = null;

  constructor(private readonly d: SenderDeps) {}

  private base(): { url: string; key: string } | null {
    const p = this.d.store.read();
    const key = this.d.store.deviceKey();
    return p && key ? { url: p.serverUrl.replace(/\/+$/, ""), key } : null;
  }

  /** One upload pass (concurrent callers share it). Never throws. */
  sendWaiting(): Promise<{ sent: number; waiting: number }> {
    this.sending ??= this.pass().finally(() => {
      this.sending = null;
    });
    return this.sending;
  }

  private async pass(): Promise<{ sent: number; waiting: number }> {
    const b = this.base();
    let sent = 0;
    if (b) {
      for (;;) {
        const batch = await this.d.exclusive(() =>
          this.d.outbox.listWaiting(UPLOAD_BATCH),
        );
        if (batch.length === 0) break;
        let env: Env<{
          acked: string[];
          rejected: Array<{ eventId: string; code: string; error: string }>;
        }>;
        try {
          const res = await this.d.fetch(`${b.url}/api/offline/events`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              [DEVICE_KEY_HEADER_NAME]: b.key,
            },
            body: JSON.stringify({
              appVersion: this.d.appVersion,
              schemaVersion: this.d.schemaVersion,
              pcClock: new Date(this.d.now()).toISOString(),
              events: batch.map(toEvent),
            }),
            signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
          });
          env = (await res.json()) as typeof env;
        } catch (error) {
          logger.debug({ error }, "offline upload: no answer — will resend");
          this.d.onUnreachable?.();
          break;
        }
        this.d.onReachable?.();
        if (!env.success || !env.data) {
          this.stopWith(env.code, env.error);
          break;
        }
        const acked = env.data.acked ?? [];
        if (acked.length > 0) {
          await this.d.exclusive(() => this.d.outbox.markAcked(acked));
          sent += acked.length;
        }
        const stop = (env.data.rejected ?? []).find((r) =>
          STOP_CODES.has(r.code),
        );
        if (stop) {
          this.stopWith(stop.code, stop.error);
          break;
        }
        if (acked.length === 0) break; // no progress — do not spin
      }
      await this.refreshStatus();
    }
    const waiting = await this.d.exclusive(() => this.d.outbox.waitingCount());
    return { sent, waiting };
  }

  private stopWith(code: string | undefined, error: string | undefined): void {
    let msg: string;
    if (code === "VERSION_AHEAD")
      msg =
        "This PC's app is newer than the server — wait for the server update; nothing is lost";
    else if (code === "DEVICE_REVOKED" || code === "INVALID_DEVICE_KEY")
      msg =
        "This PC's key was revoked — re-pair this PC (an admin signs in on it); its offline work is kept";
    else if (code === "SEQ_CONFLICT" || code === "EVENT_ID_REUSED")
      msg = `Sending stopped (${code}): this PC's numbering is out of step — open the PCs panel on the web app`;
    else msg = error ?? "The server refused the upload";
    logger.warn({ code, error }, "offline upload stopped");
    this.d.store.update({ lastError: msg });
  }

  /** Copy the server's outcomes into the outbox; settle the last period. Never throws. */
  async refreshStatus(): Promise<void> {
    const b = this.base();
    if (!b) return;
    const from = await this.d.exclusive(() => this.d.outbox.oldestOpenSeq());
    if (from !== null) {
      try {
        const res = await this.d.fetch(
          `${b.url}/api/offline/events/status?fromSeq=${from}`,
          {
            method: "GET",
            headers: { [DEVICE_KEY_HEADER_NAME]: b.key },
            signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
          },
        );
        const env = (await res.json()) as Env<{
          outcomes: Array<{
            eventId: string;
            status: OutboxRow["server_status"] & string;
            error?: string | null;
          }>;
        }>;
        this.d.onReachable?.();
        if (env.success && env.data) {
          const outcomes = env.data.outcomes;
          await this.d.exclusive(() => {
            for (const o of outcomes)
              this.d.outbox.setServerStatus(
                o.eventId,
                o.status,
                o.error ?? null,
              );
          });
        }
      } catch (error) {
        logger.debug({ error }, "offline status: no answer");
        return;
      }
    }
    const p = this.d.store.read();
    if (p?.lastPeriod && !p.lastPeriod.settledAt) {
      const open = await this.d.exclusive(() => this.d.outbox.unsettledCount());
      if (open === 0) {
        this.d.store.update({
          lastPeriod: {
            ...p.lastPeriod,
            settledAt: new Date(this.d.now()).toISOString(),
          },
        });
      }
    }
  }

  async renumberUnsent(serverMaxSeq: number): Promise<void> {
    const last = await this.d.exclusive(() =>
      this.d.outbox.renumberWaiting(serverMaxSeq + 1),
    );
    const p = this.d.store.read();
    this.d.store.update({
      lastSeq: Math.max(last, serverMaxSeq),
      lastError: p?.lastError?.includes("numbering")
        ? null
        : (p?.lastError ?? null),
    });
    logger.info({ serverMaxSeq, last }, "offline: unsent work renumbered");
  }
}
