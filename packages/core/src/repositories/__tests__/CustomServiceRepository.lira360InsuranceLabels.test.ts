/**
 * LIRA-360 follow-up (owner 2026-10-31) — an insurance sale reads as
 * Insurance, not Custom Service:
 *  - Transactions page Type column: "Insurance" (derived from the sale's
 *    details, so the saved type stays CUSTOM_SERVICE and refunds, profits
 *    and settling are untouched);
 *  - Summary and the account (debt) note: "Insurance (Compulsory): Car
 *    insurance" — the insurance type lives in the text;
 *  - the Accounts row kind: "insurance" (badge "Insurance");
 *  - the debt row's saved type stays "Custom Service Debt".
 *
 * RULE 17 — written before the change. Real schema (create_db.sql + migrations).
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
import { CustomServiceRepository } from "../CustomServiceRepository";
import { createCustomServiceSchema } from "../../validators/customService";
import type { CreateCustomServicePayload } from "../../validators/customService";
import { transactionTitle } from "../../utils/transactionText";
import { buildClientDebtDetails } from "../../utils/clientDebtDetails";

const REPO_ROOT = path.join(__dirname, "../../../../..");
const CREATE_DB_SQL_PATH = path.join(REPO_ROOT, "electron-app/create_db.sql");

interface TxRow {
  id: number;
  type: string;
  summary: string | null;
  metadata_json: string | null;
  amount_usd: number;
  amount_lbp: number;
}
interface DebtRow {
  transaction_type: string;
  amount_usd: number;
  amount_lbp: number;
  note: string | null;
}

describe("LIRA-360 — insurance reads as Insurance", () => {
  let db: Database.Database;
  let repo: CustomServiceRepository;
  let clientId: number;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(fs.readFileSync(CREATE_DB_SQL_PATH, "utf-8"));
    initDatabase(db);
    runMigrations(db);
    initFixedTenantContext(1);
    clientId = Number(
      db
        .prepare(
          `INSERT INTO clients (tenant_id, full_name, phone_number) VALUES (1, 'Ali Haddad', '70123456')`,
        )
        .run().lastInsertRowid,
    );
    repo = new CustomServiceRepository();
  });

  afterEach(() => {
    resetTenantContext();
    db.close();
  });

  function sell(over: Partial<CreateCustomServicePayload> = {}): {
    tx: TxRow;
    debt: DebtRow | undefined;
  } {
    const res = repo.createService(
      createCustomServiceSchema.parse({
        description: "Car insurance",
        price_usd: 100,
        cost_usd: 80,
        category: "insurance",
        insurance_type: "COMPULSORY",
        paid_by: "CUSTOMER_ACCOUNT",
        client_id: clientId,
        client_name: "Ali Haddad",
        ...over,
      }),
    );
    if (!res.success || !res.id) throw new Error(res.error ?? "sell failed");
    const tx = db
      .prepare(
        `SELECT id, type, summary, metadata_json, amount_usd, amount_lbp FROM transactions
          WHERE source_table = 'custom_services' AND source_id = ?`,
      )
      .get(res.id) as TxRow;
    const debt = db
      .prepare(
        `SELECT transaction_type, amount_usd, amount_lbp, note FROM debt_ledger WHERE transaction_id = ?`,
      )
      .get(tx.id) as DebtRow | undefined;
    return { tx, debt };
  }

  it("keeps the saved types and puts the insurance type in the text", () => {
    const { tx, debt } = sell();
    expect(tx.type).toBe("CUSTOM_SERVICE");
    expect(tx.summary).toBe("Insurance (Compulsory): Car insurance");
    expect(debt?.transaction_type).toBe("Custom Service Debt");
    expect(debt?.note).toBe("Insurance (Compulsory): Car insurance");
  });

  it("shows Insurance in the Type column", () => {
    const { tx } = sell();
    expect(transactionTitle(tx)).toBe("Insurance");
  });

  it("records the insurance type in the sale's details", () => {
    const { tx } = sell({ insurance_type: "LIFE" });
    const meta = JSON.parse(tx.metadata_json ?? "{}") as {
      details?: { insuranceType?: string };
    };
    expect(meta.details?.insuranceType).toBe("LIFE");
    expect(tx.summary).toBe("Insurance (Life): Car insurance");
  });

  it("an untyped insurance says Insurance without a type", () => {
    const { tx } = sell({ insurance_type: undefined });
    expect(tx.summary).toBe("Insurance: Car insurance");
    expect(transactionTitle(tx)).toBe("Insurance");
  });

  it("the account row is an Insurance kind with its type", () => {
    const { tx, debt } = sell();
    const details = buildClientDebtDetails({ ledger: debt!, tx });
    expect(details.kind).toBe("insurance");
    expect(details.line).toMatch(/^Compulsory · Car insurance — \$100/);
  });

  it("any other custom service is unchanged", () => {
    const { tx, debt } = sell({
      category: "repair",
      insurance_type: undefined,
      description: "Screen fix",
    });
    expect(tx.summary).toBe("Custom Service: Screen fix");
    expect(debt?.note).toBe("Custom Service: Screen fix");
    expect(transactionTitle(tx)).toBe("CUSTOM SERVICE");
    expect(buildClientDebtDetails({ ledger: debt!, tx }).kind).toBe(
      "custom_service",
    );
  });
});
