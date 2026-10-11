/**
 * LIRA-306 T040 — the five US1 channels get ONE core schema each before
 * their offline binding exists (rule 23: a schema put in front of a handler
 * must drop no key the caller sends or the handler forwards).
 *
 * Three-way key diff (2026-10-11):
 *
 * clients:create / clients:update
 *   (a) desktop ClientCreateSchema (hand-written, electron-app/schemas):
 *       id?, full_name, phone_number (min 1), notes? (nullable),
 *       whatsapp_opt_in (boolean | 0 | 1)
 *   (b) preload: `client: unknown` — no declared keys
 *   (c) handler forwards: full_name, phone_number, whatsapp_opt_in, notes
 *       (+ id for update)
 *   → lifted VERBATIM as core `clientWriteSchema`. The web route keeps its
 *     own stricter `createClientSchema`/`updateClientSchema` (phone format,
 *     boolean opt-in) — unifying them would change one transport's behaviour
 *     (O-impl-3).
 *
 * transactions:void
 *   (a) PositiveIdSchema on the positional id; (b) preload `(id: number)`;
 *   (c) handler forwards the id → `transactionVoidSchema { transactionId }`.
 *
 * transactions:refund
 *   (a) PositiveIdSchema + refundLegsSchema / refundUnitExtrasSchema /
 *       refundExchangeRateSchema / refundKeptChangeSchema, each "only when
 *       present" (null = absent); (b) preload: 5 positional args;
 *   (c) handler forwards all five → `transactionRefundSchema`, composed of
 *       the SAME core component schemas (nullish = absent).
 *
 * db:add-expense
 *   (a) desktop AddExpenseSchema: description (min 1), category, expense_type?,
 *       paid_by_method?, amount_usd, amount_lbp, expense_date,
 *       transaction_time?, payments?, kept_change_usd/lbp?, tender_exchange_rate?
 *   (b) preload: core `CreateExpenseRequest` (createExpenseSchema input)
 *   (c) handler forwards the whole parsed object to ExpenseService.addExpense
 *   → core `createExpenseSchema` (what POST /api/expenses already uses).
 *     `expense_type` is read nowhere (core, frontend) — dropping it loses
 *     nothing. Desktop now accepts what the web accepts: an empty
 *     description, and a missing amount_lbp defaulting to 0 (O-impl-4).
 */
import {
  clientWriteSchema,
  transactionVoidSchema,
  transactionRefundSchema,
  createExpenseSchema,
} from "../index";
import { PENDING_LIFT, policyEntry, recordedSchema } from "../../offline/channelPolicy";
import { describeShape } from "../../offline/schemaShape";

const keys = (s: Parameters<typeof describeShape>[0]) => Object.keys(describeShape(s).keys ?? {}).sort();

describe("US1 schema lifts", () => {
  it("clients: every key the handler forwards is in the schema; 0/1 and boolean opt-in both accepted", () => {
    expect(keys(clientWriteSchema)).toEqual(["full_name", "id", "notes", "phone_number", "whatsapp_opt_in"]);
    const base = { full_name: "Rami", phone_number: "70 123 456", whatsapp_opt_in: 1 as const, notes: null };
    expect(clientWriteSchema.parse(base)).toEqual(base);
    expect(clientWriteSchema.parse({ ...base, whatsapp_opt_in: true }).whatsapp_opt_in).toBe(true);
    expect(clientWriteSchema.safeParse({ ...base, phone_number: "" }).success).toBe(false);
  });

  it("transactions:void / refund: the positional ids and every refund argument survive", () => {
    expect(keys(transactionVoidSchema)).toEqual(["transactionId"]);
    expect(keys(transactionRefundSchema)).toEqual(["exchangeRate", "keptChange", "refundLegs", "refundUnitExtras", "transactionId"]);
    const parsed = transactionRefundSchema.parse({
      transactionId: 9,
      refundLegs: null,
      refundUnitExtras: undefined,
      exchangeRate: null,
      keptChange: { kept_change_usd: 1 },
    });
    expect(parsed.transactionId).toBe(9);
    expect(parsed.refundLegs ?? undefined).toBeUndefined();
    expect(parsed.keptChange).toEqual({ kept_change_usd: 1 });
  });

  it("db:add-expense uses the web route's createExpenseSchema and keeps every forwarded key", () => {
    for (const k of [
      "description", "category", "paid_by_method", "amount_usd", "amount_lbp", "expense_date", "transaction_time",
      "payments", "kept_change_usd", "kept_change_lbp", "tender_exchange_rate",
    ]) expect(keys(createExpenseSchema)).toContain(k);
  });

  it("the policy names them and they left PENDING_LIFT", () => {
    for (const [ch, name] of [
      ["clients:create", "clientWriteSchema"],
      ["clients:update", "clientWriteSchema"],
      ["transactions:void", "transactionVoidSchema"],
      ["transactions:refund", "transactionRefundSchema"],
      ["db:add-expense", "createExpenseSchema"],
    ] as const) {
      expect(PENDING_LIFT).not.toContain(ch);
      expect(policyEntry(ch)?.coreSchema).toBe(name);
      expect(recordedSchema(ch)).not.toBeNull();
    }
    expect(recordedSchema("db:add-expense")).toBe(createExpenseSchema);
    // Phase 6 families lift the rest (T077 drives it to 0); US1 left at most 18.
    expect(PENDING_LIFT.length).toBeLessThanOrEqual(18);
  });
});
