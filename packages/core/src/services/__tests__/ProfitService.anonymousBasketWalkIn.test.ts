/**
 * LIRA-393 — Profits: an anonymous basket counts as Walk-in.
 *
 * The Sessions page names an unnamed basket `Client<N>` (the first free
 * number among today's baskets) and copies that label onto every
 * transaction the basket writes, with no client id. Profits › By Client
 * grouped name-only rows by that label, so "Client2" became one By Client
 * row holding dozens of unrelated walk-ins (owner audit, Cornertech
 * 2026-11-16), and every drill-down showed "Client4" as the counterpart.
 *
 * Rule 17: written first with literal names (no import of the new matcher)
 * and seen failing on the unfixed code, then fixed.
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { initDatabase } from "../../db/connection";
import { runMigrations } from "../../db/migrations/index";
import {
  initFixedTenantContext,
  resetTenantContext,
} from "../../db/tenantContext";
import { ProfitRepository } from "../../repositories/ProfitRepository";
import { ProfitService } from "../ProfitService";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const FROM = "2026-11-01";
const TO = "2026-11-30";
const IN_RANGE = "2026-11-13 14:45:38";
let db: Database.Database;
let profits: ProfitService;

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(
    fs.readFileSync(
      path.join(REPO_ROOT, "electron-app/create_db.sql"),
      "utf-8",
    ),
  );
  initDatabase(db);
  runMigrations(db);
  initFixedTenantContext(1);
  db.prepare(
    `INSERT OR IGNORE INTO users (id, username) VALUES (1, 'owner')`,
  ).run();
  profits = new ProfitService(new ProfitRepository());
});
afterEach(() => {
  resetTenantContext();
  db.close();
});

function addClient(name: string, phone: string): number {
  return Number(
    db
      .prepare(
        `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, ?, ?)`,
      )
      .run(name, phone).lastInsertRowid,
  );
}

/** One MTC recharge (USD) with its RECHARGE transaction, as a basket writes
 *  it: the basket label on both rows, no client id for an anonymous one. */
function addRecharge(r: {
  clientName: string | null;
  clientId?: number | null;
  price: number;
  profit: number;
}): number {
  const id = Number(
    db
      .prepare(
        `INSERT INTO recharges (tenant_id, carrier, recharge_type, amount, cost, price, currency_code, client_id, client_name, created_at)
         VALUES (1, 'MTC', 'CREDIT_TRANSFER', ?, ?, ?, 'USD', ?, ?, ?)`,
      )
      .run(
        r.price,
        r.price - r.profit,
        r.price,
        r.clientId ?? null,
        r.clientName,
        IN_RANGE,
      ).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_id, client_name, summary, created_at)
     VALUES (1, 'RECHARGE', 'ACTIVE', 'recharges', ?, 1, ?, 0, ?, 0, ?, ?, 'MTC recharge', ?)`,
  ).run(id, r.price, r.profit, r.clientId ?? null, r.clientName, IN_RANGE);
  return id;
}

/** One Katsh SEND with its FINANCIAL_SERVICE transaction. */
function addKatshSend(clientName: string, profit: number): number {
  const id = Number(
    db
      .prepare(
        `INSERT INTO financial_services (tenant_id, provider, service_type, amount, currency, commission, cost, price, client_name, created_at)
         VALUES (1, 'Katsh', 'SEND', 100, 'USD', ?, 100, 100, ?, ?)`,
      )
      .run(profit, clientName, IN_RANGE).lastInsertRowid,
  );
  db.prepare(
    `INSERT INTO transactions (tenant_id, type, status, source_table, source_id, user_id, amount_usd, amount_lbp, profit_usd, profit_lbp, client_name, summary, created_at)
     VALUES (1, 'FINANCIAL_SERVICE', 'ACTIVE', 'financial_services', ?, 1, 100, 0, ?, 0, ?, 'Katsh SEND', ?)`,
  ).run(id, profit, clientName, IN_RANGE);
  return id;
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6;

describe("LIRA-393 By Client — an auto-named basket is part of Walk-in", () => {
  it("two anonymous baskets fold into Walk-in; a real client named Client2 keeps its own row; the total is unchanged", () => {
    addRecharge({ clientName: "Client1", price: 10, profit: 2 });
    addRecharge({ clientName: "Client2", price: 20, profit: 3 });
    addRecharge({ clientName: null, price: 5, profit: 1 }); // unnamed walk-in
    const realId = addClient("Client2", "70123456");
    addRecharge({
      clientName: "Client2",
      clientId: realId,
      price: 40,
      profit: 7,
    });

    const rows = profits.getByClient(FROM, TO, 1000);

    const walkIn = rows.filter(
      (r) => r.client_id == null && r.client_name === "Walk-in",
    );
    expect(walkIn).toHaveLength(1);
    expect(r6(walkIn[0].profit_usd)).toBe(6);
    expect(r6(walkIn[0].revenue_usd)).toBe(35);
    expect(walkIn[0].transaction_count).toBe(3);

    // No name-only row carries an auto-name.
    const anonymousRows = rows.filter(
      (r) => r.client_id == null && /^Client\d+$/.test(r.client_name ?? ""),
    );
    expect(anonymousRows).toEqual([]);

    // The real client keeps its row, holding only its own sale.
    const real = rows.filter((r) => r.client_id === realId);
    expect(real).toHaveLength(1);
    expect(real[0].client_name).toBe("Client2");
    expect(r6(real[0].profit_usd)).toBe(7);

    // Money moves between rows, never disappears.
    expect(r6(rows.reduce((s, r) => s + r.profit_usd, 0))).toBe(13);
    expect(rows).toHaveLength(2);
  });

  it("only exactly Client<digits> folds — 'Client 7', 'client7', 'Client7b' and 'Client' keep their own rows", () => {
    addRecharge({ clientName: "Client7", price: 10, profit: 1 });
    for (const name of ["Client 7", "client7", "Client7b", "Client"]) {
      addRecharge({ clientName: name, price: 10, profit: 1 });
    }

    const names = profits
      .getByClient(FROM, TO, 1000)
      .map((r) => r.client_name)
      .sort();
    expect(names).toEqual(
      ["Client", "Client 7", "Client7b", "Walk-in", "client7"].sort(),
    );
  });
});

describe("LIRA-393 drill-down — an auto-named basket's counterpart reads Walk-in", () => {
  it("a Client3 basket's MTC recharge and Katsh SEND both show 'Walk-in'", () => {
    const rechargeId = addRecharge({
      clientName: "Client3",
      price: 10,
      profit: 2,
    });
    const sendId = addKatshSend("Client3", 1);

    const mtc = profits.getModuleDetail("RECHARGE_MTC", FROM, TO);
    const mtcRow = [...mtc.counted, ...mtc.not_counted].find(
      (r) => r.id === rechargeId,
    );
    expect(mtcRow).toBeDefined();
    expect(mtcRow!.counterpart).toBe("Walk-in");

    const katsh = profits.getModuleDetail("FINANCIAL_SERVICE_Katsh", FROM, TO);
    const katshRow = [...katsh.counted, ...katsh.not_counted].find(
      (r) => r.id === sendId,
    );
    expect(katshRow).toBeDefined();
    expect(katshRow!.counterpart).toBe("Walk-in");
  });

  it("a real name is untouched ('Client 7' with a space is something the shop typed)", () => {
    const id = addRecharge({ clientName: "Client 7", price: 10, profit: 2 });
    const mtc = profits.getModuleDetail("RECHARGE_MTC", FROM, TO);
    const row = [...mtc.counted, ...mtc.not_counted].find((r) => r.id === id);
    expect(row!.counterpart).toBe("Client 7");
  });
});
