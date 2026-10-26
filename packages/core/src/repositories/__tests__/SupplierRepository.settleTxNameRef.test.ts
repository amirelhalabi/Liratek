/**
 * "See transactions" (owner mock 2026-10-26, omt-settle-by-day §7) — the
 * settle sheet's table shows each transaction's name / reference, so the
 * account rows carry them: FINANCIAL_SERVICE rows the customer / sender /
 * receiver name, the reference number, the phone number and the note;
 * LEDGER rows their note. Both modes (open queue and month range).
 *
 * Rule 17: written before the projection carried these fields; the first run
 * must fail on the missing `party_name` / `reference` / `note`.
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";
import { SupplierRepository, type AccountUnsettledRow } from "../SupplierRepository";
import {
  buildDb,
  omtAccount,
  resetAll,
  seedLedgerRow,
  seedOmtSend,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";

const UTC = { clientTzOffsetMinutes: 0 };

describe("account rows carry name / reference for the settle table", () => {
  let db: Database.Database;
  let repo: SupplierRepository;
  let acc: OmtAccount;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    repo = new SupplierRepository();
    acc = omtAccount(db);
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  const pick = (rows: AccountUnsettledRow[], kind: string, id: number) => {
    const row = rows.find((r) => r.kind === kind && r.id === id);
    if (!row) throw new Error(`${kind}:${id} not returned`);
    return row;
  };

  function seed(): { fs: number; fsBare: number; ledger: number } {
    const fs = seedOmtSend(db, acc.omtId, { amount: 100, created_at: "2026-10-21 09:00:00" });
    db.prepare(
      `UPDATE financial_services
          SET client_name = NULL, sender_name = 'Nour A.', receiver_name = 'Sami B.',
              reference_number = 'OMT-77610', phone_number = '70123456', note = 'urgent'
        WHERE id = ?`,
    ).run(fs);
    const fsBare = seedOmtSend(db, acc.omtId, { amount: 50, created_at: "2026-10-21 10:00:00" });
    db.prepare(
      `UPDATE financial_services
          SET client_name = '', sender_name = NULL, receiver_name = NULL,
              reference_number = NULL, phone_number = NULL, note = NULL
        WHERE id = ?`,
    ).run(fsBare);
    const ledger = seedLedgerRow(db, acc.ipickId, {
      entry_type: "TOP_UP",
      amount_usd: 95,
      created_at: "2026-10-21 11:00:00",
    });
    db.prepare(`UPDATE supplier_ledger SET note = 'Order IP-55310' WHERE id = ?`).run(ledger);
    return { fs, fsBare, ledger };
  }

  it("open mode: FS rows carry the first non-empty name, the reference and the note; ledger rows their note", () => {
    const { fs, fsBare, ledger } = seed();
    const rows = runWithTenant(1, () => repo.getAccountUnsettled(acc.omtId), UTC);

    const r = pick(rows, "FINANCIAL_SERVICE", fs);
    expect(r.party_name).toBe("Nour A.");
    expect(r.reference).toBe("OMT-77610");
    expect(r.phone).toBe("70123456");
    expect(r.note).toBe("urgent");

    const bare = pick(rows, "FINANCIAL_SERVICE", fsBare);
    expect(bare.party_name).toBeNull();
    expect(bare.reference).toBeNull();
    expect(bare.phone).toBeNull();
    expect(bare.note).toBeNull();

    const l = pick(rows, "LEDGER", ledger);
    expect(l.party_name).toBeNull();
    expect(l.reference).toBeNull();
    expect(l.note).toBe("Order IP-55310");
  });

  it("range mode (the month read) carries the same fields", () => {
    const { fs, ledger } = seed();
    const rows = runWithTenant(
      1,
      () =>
        repo.getAccountRows(acc.omtId, {
          fromUtc: "2026-10-01 00:00:00",
          toUtc: "2026-11-01 00:00:00",
        }),
      UTC,
    );
    expect(pick(rows, "FINANCIAL_SERVICE", fs).party_name).toBe("Nour A.");
    expect(pick(rows, "FINANCIAL_SERVICE", fs).reference).toBe("OMT-77610");
    expect(pick(rows, "LEDGER", ledger).note).toBe("Order IP-55310");
  });
});
