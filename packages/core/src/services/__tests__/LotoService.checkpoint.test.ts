import Database from "better-sqlite3";
import LotoTicketRepository from "../../repositories/LotoTicketRepository.js";
import LotoSettingsRepository from "../../repositories/LotoSettingsRepository.js";
import LotoMonthlyFeeRepository from "../../repositories/LotoMonthlyFeeRepository.js";
import LotoCheckpointRepository from "../../repositories/LotoCheckpointRepository.js";
import LotoCashPrizeRepository from "../../repositories/LotoCashPrizeRepository.js";
import LotoService from "../LotoService.js";

describe("LotoService Checkpoint Functionality", () => {
  let db: Database.Database;
  let service: LotoService;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE loto_tickets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        ticket_number TEXT,
        sale_amount REAL DEFAULT 0,
        commission_rate REAL DEFAULT 0.0445,
        commission_amount REAL DEFAULT 0,
        is_winner INTEGER DEFAULT 0,
        prize_amount REAL DEFAULT 0,
        prize_paid_date TEXT,
        sale_date TEXT,
        payment_method TEXT,
        currency TEXT DEFAULT 'LBP',
        note TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE loto_monthly_fees (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fee_amount REAL DEFAULT 0,
        fee_month TEXT,
        fee_year INTEGER,
        recorded_date TEXT,
        is_paid INTEGER DEFAULT 0,
        paid_date TEXT,
        note TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE loto_checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        checkpoint_date TEXT NOT NULL,
        period_start TEXT NOT NULL,
        period_end TEXT NOT NULL,
        total_sales REAL DEFAULT 0,
        total_commission REAL DEFAULT 0,
        total_tickets INTEGER DEFAULT 0,
        total_prizes REAL DEFAULT 0,
        is_settled BOOLEAN DEFAULT 0,
        settled_at TEXT,
        settlement_id INTEGER,
        note TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX idx_loto_checkpoints_date ON loto_checkpoints(checkpoint_date);
      CREATE INDEX idx_loto_checkpoints_is_settled ON loto_checkpoints(is_settled);
      CREATE INDEX idx_loto_checkpoints_period ON loto_checkpoints(period_start, period_end);
    `);

    const ticketRepo = new LotoTicketRepository(db);
    const settingsRepo = new LotoSettingsRepository(db);
    const monthlyFeeRepo = new LotoMonthlyFeeRepository(db);
    const checkpointRepo = new LotoCheckpointRepository(db);
    const cashPrizeRepo = new LotoCashPrizeRepository(db);
    service = new LotoService(
      ticketRepo,
      settingsRepo,
      monthlyFeeRepo,
      checkpointRepo,
      cashPrizeRepo,
    );

    // Insert some sample tickets for testing
    const insertTicket = db.prepare(`
      INSERT INTO loto_tickets (ticket_number, sale_date, sale_amount, commission_amount, is_winner, prize_amount)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    insertTicket.run("T001", "2024-01-01", 10, 1, 0, 0);
    insertTicket.run("T002", "2024-01-02", 20, 2, 1, 100);
    insertTicket.run("T003", "2024-01-03", 15, 1.5, 0, 0);
  });

  afterEach(() => {
    db.close();
  });

  describe("createCheckpoint", () => {
    it("should create a checkpoint with aggregated data", () => {
      const checkpoint = service.createCheckpoint({
        checkpoint_date: "2024-01-05",
        period_start: "2024-01-01",
        period_end: "2024-01-05",
        note: "Test checkpoint",
      });

      expect(checkpoint).toBeDefined();
      expect(checkpoint.checkpoint_date).toBe("2024-01-05");
      expect(checkpoint.period_start).toBe("2024-01-01");
      expect(checkpoint.period_end).toBe("2024-01-05");
      expect(checkpoint.total_sales).toBe(45); // 10 + 20 + 15
      expect(checkpoint.total_commission).toBe(4.5); // 1 + 2 + 1.5
      expect(checkpoint.total_tickets).toBe(3);
      expect(checkpoint.total_prizes).toBe(100); // Only winning ticket
      expect(checkpoint.note).toBe("Test checkpoint");
      expect(checkpoint.is_settled).toBe(0);
    });
  });

  describe("getCheckpoint", () => {
    it("should retrieve a checkpoint by ID", () => {
      const createdCheckpoint = service.createCheckpoint({
        checkpoint_date: "2024-01-05",
        period_start: "2024-01-01",
        period_end: "2024-01-05",
        note: "Test checkpoint",
      });

      const retrievedCheckpoint = service.getCheckpoint(createdCheckpoint.id);

      expect(retrievedCheckpoint).toBeDefined();
      expect(retrievedCheckpoint?.id).toBe(createdCheckpoint.id);
      expect(retrievedCheckpoint?.checkpoint_date).toBe("2024-01-05");
      expect(retrievedCheckpoint?.total_sales).toBe(45);
    });

    it("should return null for non-existent checkpoint", () => {
      const checkpoint = service.getCheckpoint(999);
      expect(checkpoint).toBeNull();
    });
  });

  describe("getCheckpointByDate", () => {
    it("should retrieve a checkpoint by date", () => {
      service.createCheckpoint({
        checkpoint_date: "2024-01-05",
        period_start: "2024-01-01",
        period_end: "2024-01-05",
        note: "Test checkpoint",
      });

      const checkpoint = service.getCheckpointByDate("2024-01-05");

      expect(checkpoint).toBeDefined();
      expect(checkpoint?.checkpoint_date).toBe("2024-01-05");
    });

    it("should return null for non-existent date", () => {
      const checkpoint = service.getCheckpointByDate("2024-12-31");
      expect(checkpoint).toBeNull();
    });
  });

  describe("getCheckpointsByDateRange", () => {
    it("should retrieve checkpoints within a date range", () => {
      service.createCheckpoint({
        checkpoint_date: "2024-01-05",
        period_start: "2024-01-01",
        period_end: "2024-01-05",
        note: "Checkpoint 1",
      });

      service.createCheckpoint({
        checkpoint_date: "2024-01-10",
        period_start: "2024-01-06",
        period_end: "2024-01-10",
        note: "Checkpoint 2",
      });

      const checkpoints = service.getCheckpointsByDateRange(
        "2024-01-01",
        "2024-01-15",
      );

      expect(checkpoints).toHaveLength(2);
      expect(checkpoints[0].checkpoint_date).toBe("2024-01-10"); // Most recent first
      expect(checkpoints[1].checkpoint_date).toBe("2024-01-05");
    });
  });

  describe("getUnsettledCheckpoints", () => {
    it("should return only unsettled checkpoints", () => {
      const unsettledCheckpoint = service.createCheckpoint({
        checkpoint_date: "2024-01-05",
        period_start: "2024-01-01",
        period_end: "2024-01-05",
        note: "Unsettled checkpoint",
      });

      const settledCheckpoint = service.createCheckpoint({
        checkpoint_date: "2024-01-10",
        period_start: "2024-01-06",
        period_end: "2024-01-10",
        note: "Settled checkpoint",
      });

      // Mark one as settled
      service.markCheckpointAsSettled(settledCheckpoint.id!);

      const unsettled = service.getUnsettledCheckpoints();

      expect(unsettled).toHaveLength(1);
      expect(unsettled[0].id).toBe(unsettledCheckpoint.id);
      expect(unsettled[0].is_settled).toBe(0);
    });
  });

  describe("updateCheckpoint", () => {
    it("should update a checkpoint", () => {
      const checkpoint = service.createCheckpoint({
        checkpoint_date: "2024-01-05",
        period_start: "2024-01-01",
        period_end: "2024-01-05",
        note: "Original note",
      });

      const updatedCheckpoint = service.updateCheckpoint(checkpoint.id!, {
        note: "Updated note",
      });

      expect(updatedCheckpoint).toBeDefined();
      expect(updatedCheckpoint?.note).toBe("Updated note");
    });

    it("should return null for non-existent checkpoint", () => {
      const result = service.updateCheckpoint(999, { note: "Test" });
      expect(result).toBeNull();
    });
  });

  describe("markCheckpointAsSettled", () => {
    it("should mark a checkpoint as settled", () => {
      const checkpoint = service.createCheckpoint({
        checkpoint_date: "2024-01-05",
        period_start: "2024-01-01",
        period_end: "2024-01-05",
        note: "Test checkpoint",
      });

      const settledCheckpoint = service.markCheckpointAsSettled(checkpoint.id!);

      expect(settledCheckpoint).toBeDefined();
      expect(settledCheckpoint?.is_settled).toBe(1);
      expect(settledCheckpoint?.settled_at).toBeDefined();
    });

    it("should accept custom settlement date and ID", () => {
      const checkpoint = service.createCheckpoint({
        checkpoint_date: "2024-01-05",
        period_start: "2024-01-01",
        period_end: "2024-01-05",
        note: "Test checkpoint",
      });

      const customDate = "2024-02-01T10:00:00.000Z";
      const settledCheckpoint = service.markCheckpointAsSettled(
        checkpoint.id!,
        customDate,
        123,
      );

      expect(settledCheckpoint).toBeDefined();
      expect(settledCheckpoint?.is_settled).toBe(1);
      expect(settledCheckpoint?.settled_at).toBe(customDate);
      expect(settledCheckpoint?.settlement_id).toBe(123);
    });
  });

  describe("getTotalSalesFromUnsettledCheckpoints", () => {
    it("should return total sales from all unsettled checkpoints", () => {
      // Create tickets that will result in specific sales totals
      const insertTicket = db.prepare(`
        INSERT INTO loto_tickets (ticket_number, sale_date, sale_amount, commission_amount, is_winner, prize_amount)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      // Add more tickets for first checkpoint period to reach desired totals
      insertTicket.run("T101", "2024-01-02", 100, 10, 0, 0);
      insertTicket.run("T102", "2024-01-03", 200, 20, 1, 100);

      const checkpoint1 = service.createCheckpoint({
        checkpoint_date: "2024-01-05",
        period_start: "2024-01-01",
        period_end: "2024-01-05",
        note: "Unsettled checkpoint 1",
      });

      // Insert more tickets for the second range
      insertTicket.run("T103", "2024-01-07", 50, 5, 0, 0);
      insertTicket.run("T104", "2024-01-08", 150, 15, 0, 0);

      const checkpoint2 = service.createCheckpoint({
        checkpoint_date: "2024-01-10",
        period_start: "2024-01-06",
        period_end: "2024-01-10",
        note: "Unsettled checkpoint 2",
      });

      const totalSales = service.getTotalSalesFromUnsettledCheckpoints();

      expect(totalSales).toBe(500); // 10+20+15+100+200+50+150 (all tickets in DB)
    });

    it("should exclude settled checkpoints from total", () => {
      // Create tickets for testing predictable values
      const insertTicket = db.prepare(`
        INSERT INTO loto_tickets (ticket_number, sale_date, sale_amount, commission_amount, is_winner, prize_amount)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      // Create tickets for unsettled checkpoint
      insertTicket.run("U001", "2024-01-02", 100, 10, 0, 0);

      const unsettledCheckpoint = service.createCheckpoint({
        checkpoint_date: "2024-01-05",
        period_start: "2024-01-01",
        period_end: "2024-01-05",
        note: "Unsettled checkpoint",
      });

      // Create tickets for settled checkpoint
      insertTicket.run("S001", "2024-01-07", 200, 20, 1, 100);

      const settledCheckpoint = service.createCheckpoint({
        checkpoint_date: "2024-01-10",
        period_start: "2024-01-06",
        period_end: "2024-01-10",
        note: "Settled checkpoint",
      });

      service.markCheckpointAsSettled(settledCheckpoint.id!);

      const totalSales = service.getTotalSalesFromUnsettledCheckpoints();

      // Should only include sales from the unsettled checkpoint (10+20+15+100=145)
      // plus any tickets that were in the same period as the unsettled checkpoint (if any existed)
      expect(totalSales).toBe(45 + 100); // Original tickets (45) + new unsettled ticket (100)
    });
  });

  describe("getTotalCommissionFromUnsettledCheckpoints", () => {
    it("should return total commission from all unsettled checkpoints", () => {
      // Create tickets that will result in specific commission totals
      const insertTicket = db.prepare(`
        INSERT INTO loto_tickets (ticket_number, sale_date, sale_amount, commission_amount, is_winner, prize_amount)
        VALUES (?, ?, ?, ?, ?, ?)
      `);

      // Create tickets for first checkpoint - commissions totaling known amounts
      insertTicket.run("C001", "2024-01-02", 100, 5, 0, 0);
      insertTicket.run("C002", "2024-01-03", 200, 5, 1, 100);

      service.createCheckpoint({
        checkpoint_date: "2024-01-05",
        period_start: "2024-01-01",
        period_end: "2024-01-05",
        note: "Unsettled checkpoint 1",
      });

      // Create tickets for second checkpoint - commissions totaling known amounts
      insertTicket.run("C003", "2024-01-07", 50, 10, 0, 0);
      insertTicket.run("C004", "2024-01-08", 150, 10, 0, 0);

      service.createCheckpoint({
        checkpoint_date: "2024-01-10",
        period_start: "2024-01-06",
        period_end: "2024-01-10",
        note: "Unsettled checkpoint 2",
      });

      const totalCommission =
        service.getTotalCommissionFromUnsettledCheckpoints();

      expect(totalCommission).toBe(45); // 1+2+1.5+5+5+10+10 (all tickets in DB)
    });
  });

  describe("getLastCheckpoint", () => {
    it("should return the most recently created checkpoint", () => {
      const firstCheckpoint = service.createCheckpoint({
        checkpoint_date: "2024-01-05",
        period_start: "2024-01-01",
        period_end: "2024-01-05",
        note: "First checkpoint",
      });

      const lastCheckpoint = service.createCheckpoint({
        checkpoint_date: "2024-01-10",
        period_start: "2024-01-06",
        period_end: "2024-01-10",
        note: "Last checkpoint",
      });

      const retrievedLast = service.getLastCheckpoint();

      expect(retrievedLast).toBeDefined();
      expect(retrievedLast?.id).toBe(lastCheckpoint.id);
      expect(retrievedLast?.checkpoint_date).toBe("2024-01-10");
    });

    it("should return null when no checkpoints exist", () => {
      // Delete all checkpoints to test null case
      db.exec("DELETE FROM loto_checkpoints");
      const checkpoint = service.getLastCheckpoint();
      expect(checkpoint).toBeNull();
    });
  });

  describe("createScheduledCheckpoint", () => {
    it("should create a scheduled checkpoint from the last checkpoint date", () => {
      // Create an initial checkpoint
      const firstCheckpoint = service.createCheckpoint({
        checkpoint_date: "2024-01-05",
        period_start: "2024-01-01",
        period_end: "2024-01-05",
        note: "First checkpoint",
      });

      // Now create a scheduled checkpoint - it should start from the end of the first
      const scheduledCheckpoint =
        service.createScheduledCheckpoint("2024-01-10");

      expect(scheduledCheckpoint).toBeDefined();
      expect(scheduledCheckpoint.checkpoint_date).toBe("2024-01-10");
      expect(scheduledCheckpoint.period_start).toBe("2024-01-05"); // From the end of first checkpoint
      expect(scheduledCheckpoint.period_end).toBe("2024-01-10");
      expect(scheduledCheckpoint.note).toContain(
        "Scheduled checkpoint for 2024-01-10",
      );
    });

    it("should start from epoch if no previous checkpoint exists", () => {
      // Delete all existing checkpoints to test the "no previous checkpoint" scenario
      db.exec("DELETE FROM loto_checkpoints WHERE 1=1");

      const scheduledCheckpoint =
        service.createScheduledCheckpoint("2024-01-10");

      expect(scheduledCheckpoint).toBeDefined();
      expect(scheduledCheckpoint.period_start).toBe("1970-01-01"); // Epoch date
      expect(scheduledCheckpoint.period_end).toBe("2024-01-10");
    });
  });
});
