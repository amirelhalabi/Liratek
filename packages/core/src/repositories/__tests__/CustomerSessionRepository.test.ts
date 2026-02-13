import Database from "better-sqlite3";
import {
  CustomerSessionRepository,
  resetCustomerSessionRepository,
} from "../CustomerSessionRepository.js";

describe("CustomerSessionRepository", () => {
  let db: Database.Database;
  let repo: CustomerSessionRepository;

  beforeEach(() => {
    db = new Database(":memory:");
    resetCustomerSessionRepository();

    // Create schema
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

    repo = new CustomerSessionRepository(db);
  });

  afterEach(() => {
    db.close();
  });

  it("creates a customer session", () => {
    const sessionId = repo.createSession({
      customer_name: "John Doe",
      customer_phone: "+1234567890",
      started_by: "admin",
    });

    expect(sessionId).toBeGreaterThan(0);

    const session = repo.getSessionById(sessionId);
    expect(session).toBeTruthy();
    expect(session!.customer_name).toBe("John Doe");
    expect(session!.customer_phone).toBe("+1234567890");
    expect(session!.is_active).toBe(1);
    expect(session!.started_by).toBe("admin");
  });

  it("retrieves the active session", () => {
    const sessionId1 = repo.createSession({ started_by: "admin" });
    repo.closeSession(sessionId1, "admin");

    const sessionId2 = repo.createSession({
      customer_name: "Jane Doe",
      started_by: "admin",
    });

    const active = repo.getActiveSession();
    expect(active).toBeTruthy();
    expect(active!.id).toBe(sessionId2);
    expect(active!.customer_name).toBe("Jane Doe");
  });

  it("closes a session", () => {
    const sessionId = repo.createSession({ started_by: "admin" });

    repo.closeSession(sessionId, "admin");

    const session = repo.getSessionById(sessionId);
    expect(session!.is_active).toBe(0);
    expect(session!.closed_by).toBe("admin");
    expect(session!.closed_at).toBeTruthy();
  });

  it("links transactions to a session", () => {
    const sessionId = repo.createSession({ started_by: "admin" });

    repo.linkTransaction(sessionId, "sale", 1, 100, 0);
    repo.linkTransaction(sessionId, "recharge", 2, 50, 0);

    const transactions = repo.getSessionTransactions(sessionId);
    expect(transactions).toHaveLength(2);
    expect(transactions[0].transaction_type).toBe("sale");
    expect(transactions[0].transaction_id).toBe(1);
    expect(transactions[0].amount_usd).toBe(100);
    expect(transactions[1].transaction_type).toBe("recharge");
  });

  it("updates session customer details", () => {
    const sessionId = repo.createSession({
      customer_name: "John",
      started_by: "admin",
    });

    repo.updateSession(sessionId, {
      customer_name: "John Doe",
      customer_phone: "+9876543210",
    });

    const session = repo.getSessionById(sessionId);
    expect(session!.customer_name).toBe("John Doe");
    expect(session!.customer_phone).toBe("+9876543210");
  });

  it("lists recent sessions", () => {
    repo.createSession({ customer_name: "Alice", started_by: "admin" });
    repo.createSession({ customer_name: "Bob", started_by: "admin" });
    repo.createSession({ customer_name: "Charlie", started_by: "admin" });

    const sessions = repo.listSessions(2, 0);
    expect(sessions).toHaveLength(2);
    // Most recent first
    expect(sessions[0].customer_name).toBe("Charlie");
    expect(sessions[1].customer_name).toBe("Bob");
  });
});
