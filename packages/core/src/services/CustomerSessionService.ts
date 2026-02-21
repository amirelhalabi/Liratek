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

      // Check if there's already an active session for this customer
      if (data.customer_name) {
        const existingSession = repo.getActiveSessionByCustomerName(
          data.customer_name,
        );
        if (existingSession) {
          return {
            success: false,
            error: `An active session already exists for "${data.customer_name}". Please close or switch to that session first.`,
          };
        }
      }

      // Allow multiple active sessions for different customers
      // This enables scenarios like:
      // - Customer A arrives, session started
      // - Customer B arrives (urgent), new session started (Customer A's session remains open)
      // - Complete Customer B's transactions, switch back to Customer A

      const sessionId = repo.createSession(data);
      return { success: true, sessionId };
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
   * Link a transaction to a specific session by ID
   */
  async linkTransactionToSession(
    sessionId: number,
    transactionType: string,
    transactionId: number,
    amountUsd: number,
    amountLbp: number,
  ): Promise<{ success: boolean; linked: boolean; error?: string }> {
    try {
      const repo = getCustomerSessionRepository();
      repo.linkTransaction(
        sessionId,
        transactionType,
        transactionId,
        amountUsd,
        amountLbp,
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
}
