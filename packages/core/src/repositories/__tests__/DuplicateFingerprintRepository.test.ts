/**
 * LIRA-306 T056 — the duplicate fingerprint (FR-025, R8, N7): ONE definition,
 * computed from BOOKED rows, used for the replayed event and for the rows it
 * is compared with. Fields are exactly N7's: every event — type, totals per
 * currency, payment legs (method, currency, amount), client id or phone;
 * sale — items (product, quantity, price); transfer — provider, direction,
 * amount, fee, sender/receiver phone (+ the reference, for the certain rule);
 * recharge — carrier, phone, amount; expense — category, description,
 * amount; repayment — client, amount, ticked items; exchange — currencies,
 * amounts, rate.
 */
import type Database from "better-sqlite3";
import { runWithTenant } from "../../db/tenantContext";
import { DuplicateFingerprintRepository } from "../DuplicateFingerprintRepository";
import { installReplayDb, uninstallReplayDb } from "../../offline/testHelpers/replayHarness";
import {
  DUP_SEED_SQL,
  EXCHANGE,
  EXPENSE,
  OMT_SEND,
  RECHARGE,
  REPAYMENT,
  SALE,
  bookOnline,
} from "../../offline/testHelpers/dupHarness";

let db: Database.Database;
const repo = new DuplicateFingerprintRepository();
beforeEach(() => {
  ({ db } = installReplayDb());
  db.exec(DUP_SEED_SQL);
});
afterEach(() => uninstallReplayDb(db));

const AT = "2026-10-10T10:10:00.000Z";
const fp = (channel: string, payload: Record<string, unknown>) => {
  const { created } = bookOnline(channel, payload, AT);
  return runWithTenant(1, () => repo.fingerprint(created.transactions ?? []));
};

const COMMON = ["amountLbp", "amountUsd", "client", "legs", "type"];

describe("DuplicateFingerprintRepository.fingerprint", () => {
  it.each([
    ["sale", "sales:process", SALE(), ["items"]],
    ["transfer", "omt:add-transaction", OMT_SEND(), ["amount", "currency", "direction", "fee", "provider", "receiverPhone", "senderPhone"]],
    ["recharge", "recharge:process", RECHARGE(), ["amount", "carrier", "phone"]],
    ["expense", "db:add-expense", EXPENSE(), ["category", "description", "expenseLbp", "expenseUsd"]],
    ["repayment", "debt:add-repayment", REPAYMENT(), ["ticked"]],
    ["exchange", "exchange:add-transaction", EXCHANGE(), ["amountIn", "amountOut", "fromCurrency", "rate", "toCurrency"]],
  ])("%s: exactly the N7 fields, from the booked rows", (family, channel, payload, extra) => {
    const f = fp(channel as string, payload as Record<string, unknown>)!;
    expect(f).not.toBeNull();
    expect(f.family).toBe(family);
    expect(Object.keys(f.fields).sort()).toEqual([...COMMON, ...(extra as string[])].sort());
    expect(f.at).toBe("2026-10-10 10:10:00");
  });

  it("transfer: carries the reference (certain rule); recharge: carrier/phone/amount", () => {
    expect(fp("omt:add-transaction", OMT_SEND())!.reference).toBe("OM-7731");
    expect(fp("recharge:process", RECHARGE())!.recharge).toEqual({ carrier: "alfa", phone: "71006010", amount: 10 });
  });

  it("sale items are order-free: A then B equals B then A", () => {
    const ab = fp("sales:process", SALE({ items: [{ product_id: 33, quantity: 1, price: 40 }, { product_id: 34, quantity: 2, price: 10 }], total_amount: 60, final_amount: 60, payment_usd: 60, payments: [{ method: "CASH", currency_code: "USD", amount: 60 }] }))!;
    const ba = fp("sales:process", SALE({ items: [{ product_id: 34, quantity: 2, price: 10 }, { product_id: 33, quantity: 1, price: 40 }], total_amount: 60, final_amount: 60, payment_usd: 60, payments: [{ method: "CASH", currency_code: "USD", amount: 60 }] }))!;
    expect(ab.fields).toEqual(ba.fields);
  });

  it("client id when there is one, else the phone", () => {
    expect(fp("debt:add-repayment", REPAYMENT())!.fields.client).toBe("client:7001");
    expect(fp("recharge:process", RECHARGE())!.fields.client).toBe("phone:71006010");
  });

  it("one definition for both sides: a candidate read back equals the fingerprint of the same rows", () => {
    const { created } = bookOnline("sales:process", SALE(), AT);
    runWithTenant(1, () => {
      const own = repo.fingerprint(created.transactions!)!;
      const [cand] = repo.candidates({
        family: "sale",
        aboveTransactionId: 0,
        from: "2026-10-10 10:00:00",
        to: "2026-10-10 10:20:00",
        excludeTransactionIds: [],
      });
      expect(cand).toEqual(own);
      expect(
        repo.candidates({ family: "sale", aboveTransactionId: 0, from: "2026-10-10 10:00:00", to: "2026-10-10 10:20:00", excludeTransactionIds: [own.transactionId] }),
      ).toEqual([]);
      // above the copy's high-water mark only
      expect(
        repo.candidates({ family: "sale", aboveTransactionId: own.transactionId, from: null, to: null, excludeTransactionIds: [] }),
      ).toEqual([]);
    });
  });

  it("rows that are not a money event of these families have no fingerprint", () => {
    const { created } = bookOnline("clients:create", { full_name: "X", phone_number: "70111222", whatsapp_opt_in: 0 }, AT);
    runWithTenant(1, () => expect(repo.fingerprint(created.transactions ?? [])).toBeNull());
  });
});
