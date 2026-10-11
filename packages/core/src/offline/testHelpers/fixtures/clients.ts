/** Clients family fixtures (band 1 → ids 1001…). Convention: ../bindingFixtures.ts */
import type { BindingFixture } from "../bindingFixtures";

export const FIXTURES: readonly BindingFixture[] = [
  {
    channel: "clients:create",
    seedSql: `INSERT INTO clients (id, tenant_id, full_name, phone_number, whatsapp_opt_in, created_at)
      VALUES (1001, 1, 'Seeded Client 1001', '70001001', 1, '2026-10-09 10:00:00');`,
    payload: { full_name: "Fixture New Client", phone_number: "70001002", whatsapp_opt_in: 1 },
  },
  {
    channel: "clients:update",
    payload: { id: 1001, full_name: "Seeded Client 1001 (edited)", phone_number: "70001001", whatsapp_opt_in: 0, notes: null },
  },
];
