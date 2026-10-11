/**
 * Test helper (not a test) — the per-channel binding FIXTURE convention used
 * by the cross-family guards T077 (`__tests__/bindings.complete.test.ts`) and
 * T104 (`__tests__/allFamilies.parity.test.ts`).
 *
 * CONVENTION (every family, Agents A/B/C):
 *   - one module per family at `offline/testHelpers/fixtures/<family>.ts`
 *     (the `ChannelFamily` name, e.g. `exchange.ts`, `customServices.ts`),
 *     exporting `FIXTURES: readonly BindingFixture[]` — at least one entry per
 *     channel of that family. Modules are discovered by directory listing, so
 *     adding a family never edits the guards.
 *   - `seedSql` runs ONCE on a fresh real-schema database (create_db.sql +
 *     the replay harness) before ANY fixture of ANY family runs — the guards
 *     seed every family into one shop. So seeds MUST:
 *       * insert rows only with explicit ids inside the family's id band
 *         `1000 × k + n` (k = FAMILY_BAND below, n = 1…999), so two
 *         families never collide;
 *       * otherwise only UPDATE shared config (rates, drawers) — never
 *         INSERT a row another family could also insert.
 *   - `payload` is the NAMED payload (what `recordedSchema(channel)` parses
 *     — positional IPC args already named, rule 23), using ids from the seed.
 *   - a fixture must book successfully (`booked`/`applied`) when replayed,
 *     after the earlier fixtures in the same module (fixtures of one module
 *     run in declaration order; nothing else is assumed about order).
 */
import fs from "node:fs";
import path from "node:path";
import { policyEntry, recordedSchema, type ChannelFamily } from "../channelPolicy";

export interface BindingFixture {
  channel: string;
  seedSql?: string;
  payload: Record<string, unknown>;
  /** who did it on the PC; default: admin user 1 for admin-only channels, else staff user 2 */
  actorUserId?: number;
}

/** The fixture's actor (admin-only channels are refused for staff on replay). */
export function fixtureActor(f: BindingFixture): number {
  if (f.actorUserId !== undefined) return f.actorUserId;
  const roles = policyEntry(f.channel)?.roles ?? [];
  return roles.includes("staff") ? 2 : 1;
}

/** Makes the shop's configured LBP rate equal the harness' recorded RATES, so
 *  online and replayed rate snapshots agree (create_db.sql seeds market 89500). */
export const MATCH_RECORDED_RATES_SQL = `UPDATE exchange_rates SET sell_rate = 90000, buy_rate = 89500, market_rate = 89750 WHERE tenant_id = 1 AND to_code = 'LBP';`;

/** Online legs must pass the payload the replay passes: parsed by the recorded schema (defaults filled). */
export function parsedPayload(channel: string, payload: Record<string, unknown>): Record<string, unknown> {
  const schema = recordedSchema(channel);
  return schema ? (schema.parse(payload) as Record<string, unknown>) : payload;
}

/** Id band per family (`1000 × k + n`). */
export const FAMILY_BAND: Record<ChannelFamily, number> = {
  clients: 1,
  transactions: 2,
  sales: 3,
  sessions: 4,
  financial: 5,
  recharge: 6,
  debts: 7,
  expenses: 8,
  exchange: 9,
  maintenance: 10,
  customServices: 11,
  loto: 12,
  stock: 13,
  drawers: 14,
  checkpoints: 15,
};

const DIR = path.join(__dirname, "fixtures");

/** Every family fixture module present, keyed by family file name. */
export function loadAllFixtures(): Record<string, readonly BindingFixture[]> {
  const out: Record<string, readonly BindingFixture[]> = {};
  if (!fs.existsSync(DIR)) return out;
  for (const f of fs.readdirSync(DIR).sort()) {
    if (!f.endsWith(".ts") || f.endsWith(".d.ts")) continue;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require(path.join(DIR, f)) as { FIXTURES?: readonly BindingFixture[] };
    if (mod.FIXTURES) out[f.replace(/\.ts$/, "")] = mod.FIXTURES;
  }
  return out;
}
