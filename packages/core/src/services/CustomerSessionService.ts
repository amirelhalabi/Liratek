import {
  getCustomerSessionRepository,
  type CustomerSession,
  type CreateCustomerSessionData,
  type SessionTransaction,
} from "../repositories/CustomerSessionRepository.js";

export class CustomerSessionService {
  /**
   * Start a new customer visit session
   * Note: Multiple active sessions are allowed, but not for the same customer.
   */
  async startSession(
    data: CreateCustomerSessionData,
  ): Promise<{ success: boolean; sessionId?: number; error?: string }> {
    try {
      const repo = getCustomerSessionRepository();

      const result = repo.createSessionIfNotActive(data);

      if ("error" in result) {
        return { success: false, error: result.error };
      }

      return { success: true, sessionId: result.sessionId };
    } catch (err: any) {
      return { success: false, error: err?.message ?? "Unknown error" };
    }
  }

  /**
   * Get the current active session
   */
  async getActiveSession(): Promise<{
    success: boolean;
    session?: CustomerSession;
    error?: string;
  }> {
    try {
      const repo = getCustomerSessionRepository();
      const session = repo.getActiveSession();
      return { success: true, session: session ?? undefined };
    } catch (err: any) {
      return { success: false, error: err?.message ?? "Unknown error" };
    }
  }

  /**
   * Get session by ID with its transactions
   */
  async getSessionDetails(sessionId: number): Promise<{
    success: boolean;
    session?: CustomerSession;
    transactions?: SessionTransaction[];
    error?: string;
  }> {
    try {
      const repo = getCustomerSessionRepository();
      const session = repo.getSessionById(sessionId);
      if (!session) {
        return { success: false, error: "Session not found" };
      }

      const transactions = repo.getSessionTransactions(sessionId);
      return { success: true, session, transactions };
    } catch (err: any) {
      return { success: false, error: err?.message ?? "Unknown error" };
    }
  }

  /**
   * Update customer information for a session
   */
  async updateSession(
    sessionId: number,
    data: Partial<
      Pick<
        CustomerSession,
        "customer_name" | "customer_phone" | "customer_notes"
      >
    >,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const repo = getCustomerSessionRepository();
      const session = repo.getSessionById(sessionId);
      if (!session) {
        return { success: false, error: "Session not found" };
      }

      repo.updateSession(sessionId, data);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ?? "Unknown error" };
    }
  }

  /**
   * Close a customer session
   */
  async closeSession(
    sessionId: number,
    closedBy: string,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const repo = getCustomerSessionRepository();
      const session = repo.getSessionById(sessionId);
      if (!session) {
        return { success: false, error: "Session not found" };
      }

      if (!session.is_active) {
        return { success: false, error: "Session is already closed" };
      }

      repo.closeSession(sessionId, closedBy);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ?? "Unknown error" };
    }
  }

  /**
   * Permanently delete a session and all its data
   */
  async deleteSession(
    sessionId: number,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const repo = getCustomerSessionRepository();
      const session = repo.getSessionById(sessionId);
      if (!session) {
        return { success: false, error: "Session not found" };
      }

      repo.deleteSession(sessionId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message ?? "Unknown error" };
    }
  }

  /**
   * Link a transaction to a specific session by ID
   */
  async linkTransactionToSession(
    sessionId: number,
    transactionType: string,
    transactionId: number,
    amountUsd: number,
    amountLbp: number,
    profitUsd: number = 0,
    profitLbp: number = 0,
  ): Promise<{ success: boolean; linked: boolean; error?: string }> {
    try {
      const repo = getCustomerSessionRepository();
      repo.linkTransaction(
        sessionId,
        transactionType,
        transactionId,
        amountUsd,
        amountLbp,
        profitUsd,
        profitLbp,
      );
      return { success: true, linked: true };
    } catch (err: any) {
      return {
        success: false,
        linked: false,
        error: err?.message ?? "Unknown error",
      };
    }
  }

  /**
   * Link a transaction to the active session (if any)
   */
  async linkTransactionToActiveSession(
    transactionType: string,
    transactionId: number,
    amountUsd: number,
    amountLbp: number,
    profitUsd: number = 0,
    profitLbp: number = 0,
  ): Promise<{ success: boolean; linked: boolean; error?: string }> {
    try {
      const repo = getCustomerSessionRepository();
      const session = repo.getActiveSession();
      if (!session) {
        // No active session, that's okay - not all transactions need to be linked
        return { success: true, linked: false };
      }

      repo.linkTransaction(
        session.id,
        transactionType,
        transactionId,
        amountUsd,
        amountLbp,
        profitUsd,
        profitLbp,
      );
      return { success: true, linked: true };
    } catch (err: any) {
      return {
        success: false,
        linked: false,
        error: err?.message ?? "Unknown error",
      };
    }
  }

  /**
   * List recent sessions
   */
  async listSessions(
    limit = 50,
    offset = 0,
  ): Promise<{
    success: boolean;
    sessions?: CustomerSession[];
    error?: string;
  }> {
    try {
      const repo = getCustomerSessionRepository();
      const sessions = repo.listSessions(limit, offset);
      return { success: true, sessions };
    } catch (err: any) {
      return { success: false, error: err?.message ?? "Unknown error" };
    }
  }

  /**
   * Get sessions within a date range
   */
  async getSessionsByDateRange(
    from: string,
    to: string,
  ): Promise<{
    success: boolean;
    sessions?: Array<
      CustomerSession & {
        checkout_total_usd: number;
        checkout_total_lbp: number;
        checkout_profit_usd: number;
        checkout_profit_lbp: number;
        item_count: number;
        total_usd: number;
        total_lbp: number;
      }
    >;
    error?: string;
  }> {
    try {
      const repo = getCustomerSessionRepository();
      const sessions = repo.getSessionsByDateRange(from, to);
      return { success: true, sessions };
    } catch (err: any) {
      return { success: false, error: err?.message ?? "Unknown error" };
    }
  }

  /**
   * Get today's sessions with summary data
   */
  async getTodaySessions(): Promise<{
    success: boolean;
    sessions?: Array<
      CustomerSession & {
        checkout_total?: number;
        checkout_currency?: string;
        item_count: number;
        total_usd: number;
        total_lbp: number;
      }
    >;
    error?: string;
  }> {
    try {
      const repo = getCustomerSessionRepository();
      const sessions = repo.getTodaySessions();
      return { success: true, sessions };
    } catch (err: any) {
      return { success: false, error: err?.message ?? "Unknown error" };
    }
  }

  /**
   * Get today's sessions (active + closed) for session list UI
   */
  async getTodayAllSessions(): Promise<{
    success: boolean;
    sessions?: CustomerSession[];
    error?: string;
  }> {
    try {
      const repo = getCustomerSessionRepository();
      const sessions = repo.getTodayAllSessions();
      return { success: true, sessions };
    } catch (err: any) {
      return { success: false, error: err?.message ?? "Unknown error" };
    }
  }

  /**
   * Get all sessions for a specific customer
   */
  async getSessionsByCustomer(
    customerName: string,
    customerPhone?: string,
  ): Promise<{
    success: boolean;
    sessions?: Array<{
      session: CustomerSession;
      transactions: SessionTransaction[];
      total_usd: number;
      total_lbp: number;
    }>;
    error?: string;
  }> {
    try {
      const repo = getCustomerSessionRepository();
      const sessions = repo.getSessionsByCustomer(customerName, customerPhone);

      const sessionsWithDetails = sessions.map((session) => {
        const transactions = repo.getSessionTransactions(session.id);
        const total_usd = transactions.reduce(
          (sum, t) => sum + Math.abs(t.amount_usd),
          0,
        );
        const total_lbp = transactions.reduce(
          (sum, t) => sum + Math.abs(t.amount_lbp),
          0,
        );

        return {
          session,
          transactions,
          total_usd,
          total_lbp,
        };
      });

      return { success: true, sessions: sessionsWithDetails };
    } catch (err: any) {
      return { success: false, error: err?.message ?? "Unknown error" };
    }
  }
}
