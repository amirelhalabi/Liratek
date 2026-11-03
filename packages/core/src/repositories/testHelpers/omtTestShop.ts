/**
 * LIRA-370 — the test shop's OMT account on 2026-11-03 (spec "Evidence"):
 * iPick + OMT App top-ups ($200 each), Cash to Business / Online Brokerage /
 * two Intra sends (commission 1.00 / 3.00 / 0.10 / 0.10): we owe OMT 776.50
 * with 4.20 expected commission. `withReceive` adds a $1,000 Western Union
 * receive (commission 2.00): OMT owes us 223.50 with 6.20 expected.
 */
import type Database from "better-sqlite3";
import { seedLedgerRow, seedOmtSend, type OmtAccount } from "./omtAccountDb";

export function seedTestShopOmt(
  db: Database.Database,
  acc: OmtAccount,
  withReceive: boolean,
): void {
  seedLedgerRow(db, acc.ipickId, {
    entry_type: "TOP_UP",
    amount_usd: 200,
    created_at: "2026-10-16 08:00:00",
  });
  seedLedgerRow(db, acc.appId, {
    entry_type: "TOP_UP",
    amount_usd: 200,
    created_at: "2026-10-16 08:05:00",
  });
  seedOmtSend(db, acc.omtId, {
    amount: 200,
    fee: 4,
    commission: 1,
    type: "CASH_TO_BUSINESS",
    created_at: "2026-10-16 09:00:00",
  });
  seedOmtSend(db, acc.omtId, {
    amount: 50,
    fee: 0.5,
    commission: 3,
    type: "ONLINE_BROKERAGE",
    created_at: "2026-10-16 09:10:00",
  });
  seedOmtSend(db, acc.omtId, {
    amount: 100,
    fee: 1,
    commission: 0.1,
    type: "INTRA",
    created_at: "2026-10-16 09:20:00",
  });
  seedOmtSend(db, acc.omtId, {
    amount: 20,
    fee: 1,
    commission: 0.1,
    type: "INTRA",
    created_at: "2026-10-26 09:00:00",
  });
  if (withReceive) {
    seedOmtSend(db, acc.omtId, {
      amount: 1000,
      commission: 2,
      type: "WESTERN_UNION",
      service_type: "RECEIVE",
      created_at: "2026-11-02 10:00:00",
    });
  }
}
