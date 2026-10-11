/**
 * LIRA-306 T088 — expenses family (rest): `expenses:add-stock-use`,
 * `db:delete-expense` (lifted), `expenses:update-metadata`. Each replayed
 * through the ReplayEngine books what the REST route's service call books
 * online (SC-001), at the event's own time (FR-021), with the route's schema.
 *
 * Three-way key diff for the `db:delete-expense` lift (rule 23):
 *   (a) schema `expenseIdParamSchema` (the REST route's): { id }
 *   (b) preload `expenses.delete(id: number)` → positional id → { id }
 *   (c) handler forwards `id` only → `expenseService.deleteExpense(id, userId)`
 *   → no key missing from (a).
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../../db/tenantContext";
import { expenseIdParamSchema, createStockExpenseSchema, expenseUpdateMetadataSchema, createExpenseSchema } from "../../../validators/expense";
import { recordedSchema, PENDING_LIFT } from "../../channelPolicy";
import { getExpenseService, resetExpenseService } from "../../../services/ExpenseService";
import { EXPENSES_REST_BINDINGS } from "../expensesRest";
import { bindingLookup, runParity, EVENT_SQL_TIME } from "../../testHelpers/familyHarness";

const bindings = bindingLookup(EXPENSES_REST_BINDINGS);

function seed(db: Database.Database): void {
  db.exec(`
    UPDATE exchange_rates SET market_rate = 89750, buy_rate = 89500, sell_rate = 90000 WHERE tenant_id = 1 AND to_code = 'LBP';
    INSERT INTO products (id, tenant_id, name, item_type, category, cost_price_usd, selling_price_usd, stock_quantity)
      VALUES (33, 1, 'Cable', 'Product', 'General', 2, 5, 10);
  `);
  runWithTenant(1, () => {
    const r = getExpenseService().addExpense(
      createExpenseSchema.parse({ category: "Rent", amount_usd: 20, expense_date: "2026-10-09", description: "Oct rent" }) as never,
      1,
    );
    if (!r.success) throw new Error(r.error);
  });
}

const expenseRows = (db: Database.Database) =>
  db
    .prepare(
      `SELECT category, description, note, edited_by, status, ROUND(amount_usd, 4) AS amount_usd, ROUND(amount_lbp, 4) AS amount_lbp, item_source, item_id, item_quantity FROM expenses ORDER BY id`,
    )
    .all();

describe("expenses (rest) bindings (T088)", () => {
  it("validates with the route schemas; db:delete-expense lifted (rule 23)", () => {
    expect(recordedSchema("expenses:add-stock-use")).toBe(createStockExpenseSchema);
    expect(recordedSchema("expenses:update-metadata")).toBe(expenseUpdateMetadataSchema);
    expect(recordedSchema("db:delete-expense")).toBe(expenseIdParamSchema);
    expect(PENDING_LIFT).not.toContain("db:delete-expense");
    expect(expenseIdParamSchema.parse({ id: 5 })).toEqual({ id: 5 });
  });

  it("expenses:add-stock-use — replay equals online, booked at the event's time", async () => {
    const payload = { source: "INVENTORY", item_id: 33, quantity: 2, category: "Shop use", expense_date: "2026-10-10" };
    const run = await runParity({
      seed,
      reset: resetExpenseService,
      channel: "expenses:add-stock-use",
      payload,
      bindings,
      state: expenseRows,
      online: () => getExpenseService().addStockExpense(createStockExpenseSchema.parse(payload), 1),
    });
    expect(run.online.result).toMatchObject({ success: true });
    expect(run.replay.outcome.status).toBe("booked");
    expect(run.replay.state).toEqual(run.online.state);
    expect(run.replay.offTime).toEqual([]);
    expect(Object.keys(run.replay.outcome.serverIds ?? {})).toEqual(expect.arrayContaining(["expenses", "transactions"]));
  });

  it("db:delete-expense — replay voids exactly like online (nets the expense to 0)", async () => {
    const run = await runParity({
      seed,
      reset: resetExpenseService,
      channel: "db:delete-expense",
      payload: { id: 1 },
      bindings,
      state: expenseRows,
      online: () => getExpenseService().deleteExpense(1, 1),
    });
    expect(run.online.result).toEqual({ success: true });
    expect(run.replay.outcome.status).toBe("booked");
    expect(run.replay.state).toEqual(run.online.state);
    expect(run.replay.offTime).toEqual([]);
  });

  it("expenses:update-metadata — editedBy is the event actor's username, never a payload field", async () => {
    const payload = { id: 1, note: "paid late", description: "October rent" };
    const run = await runParity({
      seed,
      reset: resetExpenseService,
      channel: "expenses:update-metadata",
      payload: { ...payload, editedBy: "mallory" },
      bindings,
      actorUserId: 2,
      state: expenseRows,
      online: () => getExpenseService().updateExpenseMetadata(1, { note: "paid late", description: "October rent" }, "cashier"),
    });
    expect(run.replay.outcome.status).toBe("booked");
    expect(run.replay.state).toEqual(run.online.state);
    expect(JSON.stringify(run.replay.state)).toContain('"edited_by":"cashier"');
    expect(EVENT_SQL_TIME).toBe("2026-10-10 20:50:00");
  });

  it("an unknown expense is refused with the service's reason", async () => {
    const run = await runParity({
      seed,
      reset: resetExpenseService,
      channel: "expenses:update-metadata",
      payload: { id: 999, note: "x" },
      bindings,
      online: () => getExpenseService().updateExpenseMetadata(999, { note: "x" }, "admin"),
    });
    expect(run.online.result).toMatchObject({ success: false, error: "Expense not found" });
    expect(run.replay.outcome).toMatchObject({ status: "refused", error: "Expense not found" });
  });
});
