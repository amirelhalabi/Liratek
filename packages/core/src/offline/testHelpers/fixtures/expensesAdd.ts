/** `db:add-expense` fixture (expenses band 8; the rest of the expenses family
 *  is Agent B's module). Convention: ../bindingFixtures.ts */
import type { BindingFixture } from "../bindingFixtures";

export const FIXTURES: readonly BindingFixture[] = [
  {
    channel: "db:add-expense",
    payload: {
      category: "General",
      description: "Fixture expense",
      amount_usd: 2,
      amount_lbp: 0,
      paid_by_method: "CASH",
      expense_date: "2026-10-10",
    },
  },
];
