/**
 * LIRA-343 T033a (FR-016c) — the supplier Transactions window's from–to
 * filter runs on the SERVER, by the shop's own day (rule 27), BEFORE the row
 * limit, so any day can be shown however many rows exist.
 *
 * Reads covered:
 *  - FinancialServiceRepository.getAllByProvider(provider, limit, range)
 *  - SupplierRepository.getAccountLedger(accountId, limit, range)
 *  - FinancialService.getAllByProvider: plain-supplier FIFO labels must not
 *    change because a range hides older rows (rows before `from` still
 *    consume the manual-payment pool first).
 *  - FinancialService.getAllByAccount: an account parent's Transactions
 *    window lists EVERY member's rows (OMT + OMT App + iPick), not just
 *    the parent provider's.
 *
 * Rule 17: written before the change and run against the unfixed code. The
 * new range parameter is passed through a cast so the unfixed code compiles,
 * ignores it, and fails on an assertion (not on a compile error).
 */
import Database from "better-sqlite3";
import {
  initFixedTenantContext,
  resetTenantContext,
  runWithTenant,
} from "../../db/tenantContext";
import { FinancialServiceRepository } from "../FinancialServiceRepository";
import { SupplierRepository } from "../SupplierRepository";
import { FinancialService } from "../../services/FinancialService";
import {
  buildDb,
  omtAccount,
  resetAll,
  seedLedgerRow,
  seedOmtSend,
  type OmtAccount,
} from "../testHelpers/omtAccountDb";

/** Beirut summer time: UTC+3. */
const BEIRUT = { clientTzOffsetMinutes: 180 };
const UTC = { clientTzOffsetMinutes: 0 };

type Range = { from?: string; to?: string };
type Opts = typeof BEIRUT;

// Loose signatures so the unfixed code (no range parameter) still compiles.
type FsRead = (provider: string, limit?: number, range?: Range) => { id: number }[];
type LedgerRead = (id: number, limit?: number, range?: Range) => { id: number }[];
type TxnRow = { id: number; provider: string; fifo_status: string };
type SvcRead = (provider: string, limit?: number, range?: Range) => TxnRow[];
type AccountRead = (id: number, limit?: number, range?: Range) => TxnRow[];

describe("LIRA-343 T033a — server-side day range on the supplier Transactions reads", () => {
  let db: Database.Database;
  let fsRepo: FinancialServiceRepository;
  let supRepo: SupplierRepository;
  let acc: OmtAccount;

  beforeEach(() => {
    resetAll();
    db = buildDb();
    (globalThis as Record<string, unknown>).__LIRATEK_TEST_DB__ = db;
    initFixedTenantContext(1);
    fsRepo = new FinancialServiceRepository();
    supRepo = new SupplierRepository();
    acc = omtAccount(db);
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  const fsRead = (provider: string, limit?: number, range?: Range, opts: Opts = UTC) =>
    runWithTenant(
      1,
      () => (fsRepo.getAllByProvider as unknown as FsRead).call(fsRepo, provider, limit, range),
      opts,
    );

  const ledgerRead = (limit?: number, range?: Range, opts: Opts = UTC) =>
    runWithTenant(
      1,
      () =>
        (supRepo.getAccountLedger as unknown as LedgerRead).call(
          supRepo,
          acc.omtId,
          limit,
          range,
        ),
      opts,
    );

  const ids = (rows: { id: number }[]) => rows.map((r) => r.id).sort((a, b) => a - b);

  /** 205 OMT SENDs on 20 Oct (UTC noon), each with its TOP_UP sibling. */
  function seedBulk(): number[] {
    const out: number[] = [];
    for (let i = 0; i < 205; i++) {
      const mm = String(Math.floor(i / 60)).padStart(2, "0");
      const ss = String(i % 60).padStart(2, "0");
      out.push(
        seedOmtSend(db, acc.omtId, {
          amount: 10,
          created_at: `2026-10-20 12:${mm}:${ss}`,
        }),
      );
    }
    return out;
  }

  // ── FinancialServiceRepository.getAllByProvider ───────────────────────────

  describe("getAllByProvider", () => {
    it("a row older than the 200-row limit is returned when the range targets its day", () => {
      const old = seedOmtSend(db, acc.omtId, { amount: 50, created_at: "2026-09-01 10:00:00" });
      seedBulk();

      const latest = fsRead("OMT");
      expect(latest).toHaveLength(200);
      expect(latest.map((r) => r.id)).not.toContain(old);

      const day = fsRead("OMT", undefined, { from: "2026-09-01", to: "2026-09-01" });
      expect(ids(day)).toEqual([old]);
    });

    it("a 00:30 Beirut row lands on its local day (+180), not the UTC day", () => {
      // 21:30 UTC on 24 Oct = 00:30 on 25 Oct in Beirut.
      const late = seedOmtSend(db, acc.omtId, { amount: 7, created_at: "2026-10-24 21:30:00" });
      seedOmtSend(db, acc.omtId, { amount: 8, created_at: "2026-10-24 12:00:00" });

      expect(ids(fsRead("OMT", undefined, { from: "2026-10-25", to: "2026-10-25" }, BEIRUT))).toEqual([late]);
      expect(ids(fsRead("OMT", undefined, { from: "2026-10-24", to: "2026-10-24" }, BEIRUT))).not.toContain(late);
      // The same instant under a UTC browser is still 24 Oct.
      expect(ids(fsRead("OMT", undefined, { from: "2026-10-25", to: "2026-10-25" }, UTC))).toEqual([]);
    });

    it("either bound alone filters on its own side", () => {
      const a = seedOmtSend(db, acc.omtId, { amount: 1, created_at: "2026-10-01 09:00:00" });
      const b = seedOmtSend(db, acc.omtId, { amount: 2, created_at: "2026-10-05 09:00:00" });
      const c = seedOmtSend(db, acc.omtId, { amount: 3, created_at: "2026-10-09 09:00:00" });
      expect(ids(fsRead("OMT", undefined, { from: "2026-10-05" }))).toEqual([b, c]);
      expect(ids(fsRead("OMT", undefined, { to: "2026-10-05" }))).toEqual([a, b]);
    });

    it("an empty-string bound means no bound (the window's cleared field)", () => {
      const a = seedOmtSend(db, acc.omtId, { amount: 1, created_at: "2026-10-01 09:00:00" });
      const b = seedOmtSend(db, acc.omtId, { amount: 2, created_at: "2026-10-05 09:00:00" });
      expect(ids(fsRead("OMT", undefined, { from: "", to: "" }))).toEqual([a, b]);
    });

    it("no range: the latest N rows, exactly as before", () => {
      seedOmtSend(db, acc.omtId, { amount: 50, created_at: "2026-09-01 10:00:00" });
      seedBulk();
      expect(fsRead("OMT", 200, undefined)).toEqual(fsRead("OMT"));
      expect(fsRead("OMT", 200, {})).toEqual(fsRead("OMT"));
    });
  });

  // ── SupplierRepository.getAccountLedger ───────────────────────────────────

  describe("getAccountLedger", () => {
    it("a ledger row older than the 200-row limit is returned when the range targets its day", () => {
      const old = seedLedgerRow(db, acc.appId, {
        entry_type: "PAYMENT",
        amount_usd: -40,
        created_at: "2026-09-01 10:00:00",
      });
      seedBulk(); // 205 TOP_UP siblings on 20 Oct

      const latest = ledgerRead();
      expect(latest).toHaveLength(200);
      expect(latest.map((r) => r.id)).not.toContain(old);

      expect(ids(ledgerRead(undefined, { from: "2026-09-01", to: "2026-09-01" }))).toEqual([old]);
    });

    it("a 00:30 Beirut ledger row lands on its local day (+180)", () => {
      const late = seedLedgerRow(db, acc.ipickId, {
        entry_type: "TOP_UP",
        amount_usd: 20,
        created_at: "2026-10-24 21:30:00",
      });
      expect(ids(ledgerRead(undefined, { from: "2026-10-25", to: "2026-10-25" }, BEIRUT))).toEqual([late]);
      expect(ids(ledgerRead(undefined, { from: "2026-10-25", to: "2026-10-25" }, UTC))).toEqual([]);
    });

    it("no range: the latest N rows, exactly as before", () => {
      seedBulk();
      expect(ledgerRead(200, undefined)).toEqual(ledgerRead());
    });
  });

  // ── FinancialService.getAllByProvider — plain supplier FIFO labels ────────

  describe("FinancialService.getAllByProvider (plain supplier, FIFO pool)", () => {
    // LIRA-345 — Whish now settles on the day calendar (labels from
    // coverage), so the FIFO pool path is shown on a supplier that still
    // uses it: an OMT counter that is NOT an account (its links removed).
    function seedPlainSend(amount: number, createdAt: string): number {
      return Number(
        db
          .prepare(
            `INSERT INTO financial_services
               (tenant_id, provider, service_type, amount, currency, commission, omt_fee,
                commission_model, is_settled, created_by, created_at)
             VALUES (1, 'OMT', 'SEND', ?, 'USD', 0, 0, 1, 0, 1, ?)`,
          )
          .run(amount, createdAt).lastInsertRowid,
      );
    }

    it("a range that hides an older unpaid row does not hand its pool share to a newer row", () => {
      db.prepare(`UPDATE suppliers SET account_supplier_id = NULL WHERE tenant_id = 1`).run();
      const plainId = acc.omtId;
      const older = seedPlainSend(100, "2026-10-01 09:00:00");
      const newer = seedPlainSend(100, "2026-10-20 09:00:00");
      // One manual $100 payment: FIFO pays the OLDER row only.
      seedLedgerRow(db, plainId, { entry_type: "PAYMENT", amount_usd: -100 });

      const svc = new FinancialService(fsRepo);
      const read = (range?: Range) =>
        runWithTenant(
          1,
          () => (svc.getAllByProvider as unknown as SvcRead).call(svc, "OMT", undefined, range),
          UTC,
        );

      const all = read();
      expect(all.find((r) => r.id === older)?.fifo_status).toBe("paid");
      expect(all.find((r) => r.id === newer)?.fifo_status).toBe("unpaid");

      const filtered = read({ from: "2026-10-20", to: "2026-10-20" });
      expect(filtered.map((r) => r.id)).toEqual([newer]);
      // Same row, same label as the unfiltered read.
      expect(filtered[0].fifo_status).toBe("unpaid");
    });
  });

  // ── FinancialService.getAllByAccount — every member of an account ─────────

  describe("FinancialService.getAllByAccount (account parent)", () => {
    function seedMemberSale(provider: string, createdAt: string): number {
      return Number(
        db
          .prepare(
            `INSERT INTO financial_services
               (tenant_id, provider, service_type, amount, currency, commission, cost, price,
                commission_model, is_settled, created_by, created_at)
             VALUES (1, ?, 'SEND', 10, 'USD', 0, 9, 10, 1, 0, 1, ?)`,
          )
          .run(provider, createdAt).lastInsertRowid,
      );
    }

    it("lists OMT, OMT App and iPick rows of the range, newest first", () => {
      const omt = seedOmtSend(db, acc.omtId, { amount: 30, created_at: "2026-10-24 21:30:00" });
      const app = seedMemberSale("OMT_APP", "2026-10-25 08:00:00");
      const ipick = seedMemberSale("iPick", "2026-10-25 10:00:00");
      seedMemberSale("iPick", "2026-10-23 10:00:00"); // outside the range
      seedMemberSale("WHISH", "2026-10-25 09:00:00"); // not an account member

      const svc = new FinancialService(fsRepo);
      const fn = (svc as unknown as { getAllByAccount?: AccountRead }).getAllByAccount;
      expect(typeof fn).toBe("function");
      const rows = runWithTenant(
        1,
        () => fn!.call(svc, acc.omtId, undefined, { from: "2026-10-25", to: "2026-10-25" }),
        BEIRUT,
      );
      expect(rows.map((r) => r.id)).toEqual([ipick, app, omt]);
      expect(rows.map((r) => r.provider)).toEqual(["iPick", "OMT_APP", "OMT"]);
      for (const r of rows) expect(typeof r.fifo_status).toBe("string");
    });

    it("truncates the merged list to the limit", () => {
      seedOmtSend(db, acc.omtId, { amount: 30, created_at: "2026-10-25 07:00:00" });
      const app = seedMemberSale("OMT_APP", "2026-10-25 08:00:00");
      const ipick = seedMemberSale("iPick", "2026-10-25 10:00:00");
      const svc = new FinancialService(fsRepo);
      const fn = (svc as unknown as { getAllByAccount?: AccountRead }).getAllByAccount;
      expect(typeof fn).toBe("function");
      const rows = runWithTenant(1, () => fn!.call(svc, acc.omtId, 2), UTC);
      expect(rows.map((r) => r.id)).toEqual([ipick, app]);
    });
  });
});
