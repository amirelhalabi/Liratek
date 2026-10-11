/**
 * Drawers / hold-money family fixtures (band 14 → ids 14001…). Convention:
 * ../bindingFixtures.ts. `drawer-cashout:create` is admin-only: it books only
 * when the event's actor is an admin (user 1). Payloads spell out the schema
 * defaults so online (raw payload) and replay (parsed payload) see the same object.
 */
import type { BindingFixture } from "../bindingFixtures";

export const FIXTURES: readonly BindingFixture[] = [
  {
    // a float into General first — the cash-out below draws on it
    channel: "drawer-topup:create",
    seedSql: `INSERT INTO hold_money (id, tenant_id, client_name, usd_amount, lbp_amount, status, created_by, created_at, updated_at)
        VALUES (14001, 1, 'Hold Fixture A', 100, 0, 'held', 1, '2026-10-09 10:00:00', '2026-10-09 10:00:00');
      INSERT INTO hold_money (id, tenant_id, client_name, usd_amount, lbp_amount, status, created_by, created_at, updated_at)
        VALUES (14002, 1, 'Hold Fixture B', 50, 0, 'held', 1, '2026-10-09 10:00:00', '2026-10-09 10:00:00');
      INSERT INTO transactions (id, tenant_id, type, source_table, source_id, user_id, amount_usd, amount_lbp, client_name, created_at)
        VALUES (14001, 1, 'HOLD_MONEY_COLLECT', 'hold_money', 14002, 1, 20, 0, 'Hold Fixture B', '2026-10-09 10:00:00');
      INSERT INTO hold_money_pickups (id, tenant_id, hold_money_id, transaction_id, usd_amount, lbp_amount, created_by, created_at, updated_at)
        VALUES (14001, 1, 14002, 14001, 20, 0, 1, '2026-10-09 10:00:00', '2026-10-09 10:00:00');
      INSERT INTO payments (id, tenant_id, transaction_id, method, drawer_name, currency_code, amount, note, created_by, created_at)
        VALUES (14001, 1, 14001, 'CASH', 'General', 'USD', -20, 'Hold Collected: Hold Fixture B', 1, '2026-10-09 10:00:00');`,
    payload: { amount_usd: 500, amount_lbp: 1000000, notes: "fixture float" },
  },
  {
    // EUR into General → an exchange lot costed at the shop's EUR market rate
    channel: "drawer-topup:create",
    payload: { amount_usd: 0, amount_lbp: 0, extra_currencies: [{ currency_code: "EUR", amount: 100 }], notes: "EUR float" },
  },
  {
    channel: "drawer-topup:create-from-drawer",
    payload: { source_drawer: "OMT_System", amount_usd: 30, amount_lbp: 0, notes: "sweep" },
  },
  {
    channel: "drawer-topup:transfer",
    payload: { fromDrawer: "General", toDrawer: "OMT_System", amount_usd: 25, amount_lbp: 0, notes: "float to OMT" },
  },
  {
    channel: "drawer-cashout:create",
    payload: { amount_usd: 50, amount_lbp: 0, notes: "owner withdrawal" },
  },
  {
    channel: "hold-money:create",
    payload: { client_name: "Walk-in hold", usd_amount: 40, lbp_amount: 0, notes: "keep for tomorrow" },
  },
  {
    // full pickup → the hold flips to collected
    channel: "hold-money:collect",
    payload: { id: 14001, usd_amount: 100 },
  },
  {
    channel: "hold-money:void-pickup",
    payload: { pickup_id: 14001 },
  },
];
