/**
 * Test helper (not a test): a PC's working copy — a byte copy of the server
 * database with every id-range table seeded to PC `pc`'s offline range (what
 * go-offline does) — and the recorder's job on it: parse with the recorded
 * schema, run the binding (the PC runs the same core services) at the
 * event's instant, capture the created rows and the events it depends on.
 */
import Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { RowCaptureRepository } from "../../repositories/RowCaptureRepository";
import { getOfflineBinding } from "../bindings/index";
import { recordedSchema } from "../channelPolicy";
import { offlineIdsInPositions } from "../idPositions";
import { OFFLINE_ID_TABLES, encodeOfflineId } from "../idRange";

type G = typeof globalThis & { __LIRATEK_TEST_DB__?: Database.Database };
export const useDb = (db: Database.Database): void => {
  (globalThis as G).__LIRATEK_TEST_DB__ = db;
};

export interface RecordedAction {
  channel: string;
  payload: Record<string, unknown>;
  created: Record<string, number[]>;
  eventId: string;
  dependsOn: string[];
  occurredAt: string;
  actorUserId: number;
}

export class PcCopy {
  readonly db: Database.Database;
  readonly recorded: RecordedAction[] = [];
  private readonly createdBy = new Map<number, string>();

  constructor(
    server: Database.Database,
    readonly pc: number,
    private readonly eventPrefix: string,
  ) {
    this.db = new Database(server.serialize());
    const upd = this.db.prepare(`UPDATE sqlite_sequence SET seq = ? WHERE name = ?`);
    const ins = this.db.prepare(`INSERT INTO sqlite_sequence (name, seq) VALUES (?, ?)`);
    OFFLINE_ID_TABLES.forEach((t, i) => {
      const seq = encodeOfflineId(pc, i, 1) - 1;
      if (upd.run(seq, t).changes === 0) ins.run(t, seq);
    });
  }

  /** Do one action on the PC at `occurredAt`; returns what the recorder stores. */
  act(channel: string, payload: Record<string, unknown>, occurredAt: string, actorUserId = 2): RecordedAction {
    const prev = (globalThis as G).__LIRATEK_TEST_DB__;
    useDb(this.db);
    try {
      const parsed = recordedSchema(channel)!.parse(payload) as Record<string, unknown>;
      const capture = new RowCaptureRepository();
      const eventId = `${this.eventPrefix}${String(this.recorded.length + 1).padStart(12, "0")}`;
      let rec!: RecordedAction;
      runWithTenant(
        1,
        () => {
          this.db.transaction(() => {
            const before = capture.snapshotSequences();
            const binding = getOfflineBinding(channel);
            if (binding) {
              const result = binding.run(parsed, { tenantId: 1, actorUserId, eventId, deviceId: 0 }) as Record<string, unknown>;
              if (result.success !== true) throw new Error(`PC refused ${channel}: ${String(result.error)}`);
            }
            const created = capture.createdSince(before);
            const dependsOn = [
              ...new Set(
                offlineIdsInPositions(channel, parsed)
                  .map((id) => this.createdBy.get(id))
                  .filter((e): e is string => !!e),
              ),
            ];
            for (const ids of Object.values(created)) for (const id of ids) this.createdBy.set(id, eventId);
            rec = { channel, payload: parsed, created, eventId, dependsOn, occurredAt, actorUserId };
          })();
        },
        { effectiveNow: occurredAt, clientDay: occurredAt.slice(0, 10), clientTzOffsetMinutes: 0 },
      );
      this.recorded.push(rec);
      return rec;
    } finally {
      if (prev) useDb(prev);
    }
  }

  close(): void {
    this.db.close();
  }
}
