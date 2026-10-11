/**
 * Checkpoints family fixtures (band 15 → ids 15001…). Convention: ../bindingFixtures.ts
 *
 * The drawer count uses its own drawer ("Safe") whose only journal row is
 * seeded here with an explicit old `created_at`: Apply reconciles against the
 * drawer AS OF the event's time (O-new-27), so a shared drawer whose seeds
 * stamp `payments.created_at` with the real clock would book a different
 * delta online (now) and replayed (the event's past instant).
 *
 * Six of the seven channels are admin-only and the actor policy refuses the
 * guards' default staff actor (user 2): T077/T104 can book these only once
 * the fixture convention lets a fixture name its actor (or the guards use
 * user 1 for admin-only channels) — a helper change requested from the parent.
 * The family test replays them as user 1.
 */
import type { BindingFixture } from "../bindingFixtures";

export const FIXTURES: readonly BindingFixture[] = [
  {
    channel: "closing:create-checkpoint",
    seedSql: `INSERT INTO payments (id, tenant_id, transaction_id, method, drawer_name, currency_code, amount, note, created_by, created_at)
      VALUES (15001, 1, NULL, 'CASH', 'Safe', 'USD', 100, 'seeded', 1, '2026-09-01 09:00:00');
    INSERT OR REPLACE INTO drawer_balances (tenant_id, drawer_name, currency_code, balance) VALUES (1, 'Safe', 'USD', 100);
    INSERT INTO daily_closings (id, tenant_id, closing_date, drawer_name, opening_balance_usd, opening_balance_lbp, physical_usd, physical_lbp, physical_eur,
      system_expected_usd, system_expected_lbp, variance_usd, notes, created_by, created_at, updated_at)
      VALUES (15001, 1, '2026-09-01', 'Safe', 0, 0, 0, 0, 0, 0, 0, 0, 'seeded', 1, '2026-09-01 20:00:00', '2026-09-01 20:00:00');
    INSERT INTO loto_checkpoints (id, tenant_id, checkpoint_date, period_start, period_end, note, created_at, updated_at)
      VALUES (15001, 1, '2026-09-02', '2026-09-01', '2026-09-02', 'seeded', '2026-09-02 20:00:00', '2026-09-02 20:00:00'),
             (15002, 1, '2026-09-03', '2026-09-03', '2026-09-03', 'seeded', '2026-09-03 20:00:00', '2026-09-03 20:00:00');
    INSERT INTO carrier_lines (id, tenant_id, carrier, phone_number, label, credits, validity_expires_at, is_active, is_primary, created_at, updated_at)
      VALUES (15001, 1, 'mtc', '70150001', 'checkpoints fixture', 50, '2026-12-31', 1, 0, '2026-09-01 08:00:00', '2026-09-01 08:00:00');`,
    payload: {
      drawer_name: "Safe",
      closing_date: "2026-10-10",
      notes: "counted offline",
      amounts: [{ drawer_name: "Safe", currency_code: "USD", expected_amount: 100, physical_amount: 95 }],
    },
  },
  {
    channel: "closing:update-daily-closing",
    payload: { id: 15001, notes: "edited offline", physical_usd: 12 },
  },
  {
    channel: "loto:checkpoint:create",
    payload: { checkpoint_date: "2026-10-05", period_start: "2026-09-04", period_end: "2026-10-05", note: "loto offline" },
  },
  {
    channel: "loto:checkpoint:update",
    payload: { id: 15001, note: "edited offline" },
  },
  {
    channel: "loto:checkpoint:delete",
    payload: { id: 15002 },
  },
  {
    channel: "loto:checkpoint:create-scheduled",
    payload: { checkpointDate: "2026-10-10" },
  },
  {
    channel: "carrier-lines:update-balance",
    payload: { id: 15001, credits: 60 },
  },
];
