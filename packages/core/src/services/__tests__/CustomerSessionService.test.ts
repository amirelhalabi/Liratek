import Database from "better-sqlite3";
import { CustomerSessionService } from "../CustomerSessionService.js";
import {
  CustomerSessionRepository,
  resetCustomerSessionRepository,
} from "../../repositories/CustomerSessionRepository.js";

describe("CustomerSessionService", () => {
  let db: Database.Database;
  let service: CustomerSessionService;

  beforeEach(() => {
    db = new Database(":memory:");
    resetCustomerSessionRepository();

    db.exec(`
      CREATE TABLE customer_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_name TEXT,
        customer_phone TEXT,
        customer_notes TEXT,
        started_at TEXT NOT NULL DEFAULT (datetime('now')),
        closed_at TEXT,
        started_by TEXT NOT NULL,
        closed_by TEXT,
        is_active INTEGER NOT NULL DEFAULT 1,
        CHECK (is_active IN (0, 1))
      );

      CREATE TABLE customer_session_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER NOT NULL,
        transaction_type TEXT NOT NULL,
        transaction_id INTEGER NOT NULL,
        amount_usd REAL NOT NULL DEFAULT 0,
        amount_lbp REAL NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES customer_sessions(id) ON DELETE CASCADE
      );
    `);

    // Initialize repo with test DB
    new CustomerSessionRepository(db);
    service = new CustomerSessionService();
  });

  afterEach(() => {
    db.close();
  });

  it("starts a new session", async () => {
    const result = await service.startSession({
      customer_name: "John Doe",
      started_by: "admin",
    });

    expect(result.success).toBe(true);
    expect(result.sessionId).toBeGreaterThan(0);
  });

  it("prevents starting a new session if one is already active", async () => {
    await service.startSession({ started_by: "admin" });

    const result = await service.startSession({ started_by: "admin" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("active session already exists");
  });

  it("retrieves the active session", async () => {
    const startResult = await service.startSession({
      customer_name: "Jane",
      started_by: "admin",
    });

    const result = await service.getActiveSession();

    expect(result.success).toBe(true);
    expect(result.session).toBeTruthy();
    expect(result.session!.id).toBe(startResult.sessionId);
    expect(result.session!.customer_name).toBe("Jane");
  });

  it("returns no session when none is active", async () => {
    const result = await service.getActiveSession();

    expect(result.success).toBe(true);
    expect(result.session).toBeUndefined();
  });

  it("closes a session", async () => {
    const startResult = await service.startSession({ started_by: "admin" });
    const sessionId = startResult.sessionId!;

    const closeResult = await service.closeSession(sessionId, "admin");

    expect(closeResult.success).toBe(true);

    const activeResult = await service.getActiveSession();
    expect(activeResult.session).toBeUndefined();
  });

  it("prevents closing a non-existent session", async () => {
    const result = await service.closeSession(999, "admin");

    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });

  it("prevents closing an already closed session", async () => {
    const startResult = await service.startSession({ started_by: "admin" });
    const sessionId = startResult.sessionId!;

    await service.closeSession(sessionId, "admin");
    const result = await service.closeSession(sessionId, "admin");

    expect(result.success).toBe(false);
    expect(result.error).toContain("already closed");
  });

  it("links a transaction to the active session", async () => {
    const startResult = await service.startSession({ started_by: "admin" });
    const sessionId = startResult.sessionId!;

    const linkResult = await service.linkTransactionToActiveSession(
      "sale",
      123,
      100,
      0,
    );

    expect(linkResult.success).toBe(true);
    expect(linkResult.linked).toBe(true);

    const detailsResult = await service.getSessionDetails(sessionId);
    expect(detailsResult.transactions).toHaveLength(1);
    expect(detailsResult.transactions![0].transaction_type).toBe("sale");
    expect(detailsResult.transactions![0].transaction_id).toBe(123);
  });

  it("does not link transaction when no session is active", async () => {
    const linkResult = await service.linkTransactionToActiveSession(
      "sale",
      123,
      100,
      0,
    );

    expect(linkResult.success).toBe(true);
    expect(linkResult.linked).toBe(false);
  });

  it("updates session customer information", async () => {
    const startResult = await service.startSession({
      customer_name: "John",
      started_by: "admin",
    });
    const sessionId = startResult.sessionId!;

    const updateResult = await service.updateSession(sessionId, {
      customer_name: "John Doe",
      customer_phone: "+1234567890",
    });

    expect(updateResult.success).toBe(true);

    const detailsResult = await service.getSessionDetails(sessionId);
    expect(detailsResult.session!.customer_name).toBe("John Doe");
    expect(detailsResult.session!.customer_phone).toBe("+1234567890");
  });

  it("lists recent sessions", async () => {
    await service.startSession({ customer_name: "Alice", started_by: "admin" });
    await service.closeSession(1, "admin");

    await service.startSession({ customer_name: "Bob", started_by: "admin" });

    const result = await service.listSessions(10, 0);

    expect(result.success).toBe(true);
    expect(result.sessions).toHaveLength(2);
    expect(result.sessions![0].customer_name).toBe("Bob");
  });
});
