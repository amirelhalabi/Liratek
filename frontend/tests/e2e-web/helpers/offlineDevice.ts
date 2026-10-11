/**
 * LIRA-306 web e2e helper — act as a paired PC over the real device routes.
 *
 *  - `pairPc`: POST /api/offline/pair (admin signs in "on the PC");
 *  - `offlineId`: the id a PC would give a row (PC × 10¹² + table × 10⁹ + n);
 *  - `buildEvent`: an OfflineEvent whose payload is typed from the channel's
 *    core schema input (rule 24) and whose schema shape / rates are the
 *    server's own (as a PC on the same version would record them);
 *  - `uploadEvents` + `waitProcessed`: upload, then poll /events/status until
 *    nothing is `received`.
 */
import { randomUUID } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import {
  describeShape,
  encodeOfflineId,
  offlineTableIndex,
  recordedSchema,
  type OfflineEventInput,
  type PairDeviceInput,
} from "@liratek/core";
import { BACKEND_URL } from "../fixtures";

/** The core schema's own input type (rule 24 — never a hand copy). */
export type OfflineEventBody = OfflineEventInput;

export interface PairedPc {
  key: string;
  deviceNo: number;
  tenantId: number;
  serverSchemaVersion: number;
}

export async function pairPc(
  request: APIRequestContext,
  body: PairDeviceInput,
): Promise<PairedPc> {
  const res = await (await request.post(`${BACKEND_URL}/api/offline/pair`, { data: body })).json();
  if (!res.success) throw new Error(`pairing failed: ${JSON.stringify(res)}`);
  return {
    key: res.data.deviceKey,
    deviceNo: res.data.deviceNo,
    tenantId: res.data.tenantId,
    serverSchemaVersion: res.data.serverSchemaVersion,
  };
}

export function offlineId(pc: PairedPc, table: string, n: number): number {
  return encodeOfflineId(pc.deviceNo, offlineTableIndex(table), n);
}

/** The shop's current rates, as the PC's copy would hold them (strict record). */
export async function currentRates(
  request: APIRequestContext,
  auth: Record<string, string>,
): Promise<OfflineEventBody["rates"]> {
  const res = await (await request.get(`${BACKEND_URL}/api/rates`, { headers: auth })).json();
  const out: OfflineEventBody["rates"] = {};
  for (const r of (res.rates ?? []) as Array<{
    to_code: string;
    market_rate: number;
    buy_rate: number;
    sell_rate: number;
    is_stronger: 1 | -1;
  }>) {
    out[r.to_code] = { sell: r.sell_rate, buy: r.buy_rate, market: r.market_rate, direction: r.is_stronger };
  }
  if (Object.keys(out).length === 0) out.LBP = { sell: 90000, buy: 89000, market: 89500, direction: 1 };
  return out;
}

export function buildEvent(o: {
  seq: number;
  channel: string;
  payload: Record<string, unknown>;
  actorUserId: number;
  occurredAt: string;
  clientDay: string;
  clientTzOffsetMinutes: number;
  copyId: string;
  rates: OfflineEventBody["rates"];
  created: Record<string, number[]>;
  dependsOn?: string[];
  eventId?: string;
}): OfflineEventBody {
  const schema = recordedSchema(o.channel);
  if (!schema) throw new Error(`${o.channel} has no recorded schema`);
  // The PC parses with the same schema before recording (FR-011).
  const payload = schema.parse(o.payload) as Record<string, unknown>;
  return {
    eventId: o.eventId ?? randomUUID(),
    seq: o.seq,
    channel: o.channel,
    payload,
    actorUserId: o.actorUserId,
    occurredAt: o.occurredAt,
    clientDay: o.clientDay,
    clientTzOffsetMinutes: o.clientTzOffsetMinutes,
    copyId: o.copyId,
    schemaShape: describeShape(schema) as unknown as Record<string, unknown>,
    rates: o.rates,
    created: o.created,
    dependsOn: o.dependsOn ?? [],
  };
}

export async function uploadEvents(
  request: APIRequestContext,
  pc: PairedPc,
  events: OfflineEventBody[],
  schemaVersion: number,
): Promise<{ success: boolean; data?: { acked: string[]; rejected: unknown[] }; code?: string; error?: string }> {
  return (
    await request.post(`${BACKEND_URL}/api/offline/events`, {
      headers: { "x-liratek-device-key": pc.key },
      data: { appVersion: "e2e", schemaVersion, pcClock: new Date().toISOString(), events },
    })
  ).json();
}

export interface EventOutcome {
  eventId: string;
  seq: number;
  status: string;
  error: string | null;
  serverIds: Record<string, number[]> | null;
}

/** Poll until no event of this PC is `received` (or the deadline). */
export async function waitProcessed(
  request: APIRequestContext,
  pc: PairedPc,
  expected: number,
  timeoutMs = 20_000,
): Promise<EventOutcome[]> {
  const deadline = Date.now() + timeoutMs;
  let outcomes: EventOutcome[] = [];
  while (Date.now() < deadline) {
    const res = await (
      await request.get(`${BACKEND_URL}/api/offline/events/status?fromSeq=0`, {
        headers: { "x-liratek-device-key": pc.key },
      })
    ).json();
    outcomes = (res.data?.outcomes ?? []) as EventOutcome[];
    if (outcomes.length >= expected && outcomes.every((o) => o.status !== "received")) return outcomes;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`offline events not processed in time: ${JSON.stringify(outcomes)}`);
}
