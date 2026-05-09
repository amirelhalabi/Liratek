import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useRef,
} from "react";
import logger from "@/utils/logger";
import { useApi } from "@liratek/ui";
import { useFeatureFlags } from "@/contexts/FeatureFlagContext";
import type { CartItem, CartTotals } from "../types/cart";

interface CustomerSession {
  id: number;
  customer_name?: string;
  customer_phone?: string;
  customer_notes?: string;
  user_id?: number;
  started_at: string;
  closed_at?: string;
  started_by: string;
  closed_by?: string;
  is_active: 1 | 0;
}

interface SessionTransaction {
  id: number;
  session_id: number;
  transaction_type: string;
  transaction_id: number;
  amount_usd: number;
  amount_lbp: number;
  created_at: string;
}

interface SessionContextValue {
  activeSession: CustomerSession | null;
  allActiveSessions: CustomerSession[];
  allTodaySessions: CustomerSession[];
  sessionTransactions: SessionTransaction[];
  /** @deprecated No longer used — popup visibility is managed by hover in TopBar */
  isFloatingWindowOpen: boolean;
  /** @deprecated No longer used — popup visibility is managed by hover in TopBar */
  isFloatingWindowMinimized: boolean;

  // Cart state
  cartItems: CartItem[];
  addToCart: (item: Omit<CartItem, "id">) => void;
  removeFromCart: (itemId: string) => void;
  clearCart: () => void;
  getCartTotals: () => CartTotals;
  cartItemCount: number;

  // Actions
  startSession: (data: {
    customer_name: string;
    customer_phone?: string;
    customer_notes?: string;
  }) => Promise<void>;
  switchToSession: (sessionId: number) => Promise<void>;
  closeCurrentSession: () => Promise<void>;
  closeSession: (sessionId: number) => Promise<void>;
  deleteSession: (sessionId: number) => Promise<void>;
  updateSessionInfo: (data: {
    customer_name?: string;
    customer_phone?: string;
    customer_notes?: string;
  }) => Promise<void>;
  linkTransaction: (data: {
    transactionType: string;
    transactionId: number;
    amountUsd: number;
    amountLbp: number;
    profitUsd?: number;
    profitLbp?: number;
  }) => Promise<void>;

  /** @deprecated No longer used */
  openFloatingWindow: () => void;
  /** @deprecated No longer used */
  closeFloatingWindow: () => void;
  /** @deprecated No longer used */
  minimizeFloatingWindow: () => void;
  /** @deprecated No longer used */
  expandFloatingWindow: () => void;

  // Refresh
  refreshActiveSessions: () => Promise<void>;
  refreshSessionTransactions: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used within SessionProvider");
  }
  return context;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const api = useApi();
  const { flags } = useFeatureFlags();
  const [activeSession, setActiveSession] = useState<CustomerSession | null>(
    null,
  );
  const [allActiveSessions, setAllActiveSessions] = useState<CustomerSession[]>(
    [],
  );
  const [allTodaySessions, setAllTodaySessions] = useState<CustomerSession[]>(
    [],
  );
  const [sessionTransactions, setSessionTransactions] = useState<
    SessionTransaction[]
  >([]);
  const [isFloatingWindowOpen] = useState(false);
  const [isFloatingWindowMinimized] = useState(true);

  // Cart state — persisted to DB via IPC
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  // Load cart items from DB when activeSession changes
  useEffect(() => {
    if (activeSession) {
      loadCartItems(activeSession.id);
    } else {
      setCartItems([]);
    }
  }, [activeSession?.id]);

  const loadCartItems = async (sessionId: number) => {
    try {
      const result = await window.api.session.cartGet(sessionId);
      if (result.success && result.items) {
        // Convert DB rows to CartItem shape
        const items: CartItem[] = result.items.map((row) => ({
          id: row.item_id,
          module: row.module as CartItem["module"],
          label: row.label,
          amount: row.amount,
          currency: row.currency as CartItem["currency"],
          formData: JSON.parse(row.form_data),
          ipcChannel: row.ipc_channel,
        }));
        setCartItems(items);
      }
    } catch (err) {
      logger.error("Failed to load cart items:", err);
    }
  };

  const addToCart = useCallback(
    async (item: Omit<CartItem, "id">) => {
      if (!activeSession) return;
      const newItem: CartItem = {
        ...item,
        id: crypto.randomUUID(),
      };
      const sessionId = activeSession.id;

      // Persist to DB
      try {
        await window.api.session.cartAdd(sessionId, {
          item_id: newItem.id,
          module: newItem.module,
          label: newItem.label,
          amount: newItem.amount,
          currency: newItem.currency,
          form_data: JSON.stringify(newItem.formData),
          ipc_channel: newItem.ipcChannel,
        });
      } catch (err) {
        logger.error("Failed to persist cart item:", err);
      }

      setCartItems((prev) => [...prev, newItem]);
      logger.info(
        `Added item to cart: ${item.module} - ${item.label} (session ${sessionId})`,
      );
    },
    [activeSession],
  );

  const removeFromCart = useCallback(
    async (itemId: string) => {
      if (!activeSession) return;

      // Remove from DB
      try {
        await window.api.session.cartRemove(activeSession.id, itemId);
      } catch (err) {
        logger.error("Failed to remove cart item from DB:", err);
      }

      setCartItems((prev) => prev.filter((i) => i.id !== itemId));
    },
    [activeSession],
  );

  const clearCart = useCallback(async () => {
    if (!activeSession) return;

    // Clear in DB
    try {
      await window.api.session.cartClear(activeSession.id);
    } catch (err) {
      logger.error("Failed to clear cart in DB:", err);
    }

    setCartItems([]);
  }, [activeSession]);

  const getCartTotals = useCallback((): CartTotals => {
    return cartItems.reduce(
      (totals, item) => {
        if (item.currency === "USD") totals.usd += item.amount;
        else if (item.currency === "LBP") totals.lbp += item.amount;
        else if (item.currency === "USDT") totals.usdt += item.amount;
        return totals;
      },
      { usd: 0, lbp: 0, usdt: 0 },
    );
  }, [cartItems]);

  // Load active sessions on mount (only when customer sessions feature is enabled)
  useEffect(() => {
    if (flags.customerSessions) {
      refreshActiveSessions();
    }
  }, [flags.customerSessions]);

  const refreshActiveSessions = useCallback(async () => {
    try {
      const data = await window.api.session.getActiveSessions();

      if (data.success && data.sessions) {
        const active = data.sessions as CustomerSession[];
        setAllActiveSessions(active);

        // Clear activeSession if it's no longer in the active list (e.g. after checkout)
        if (activeSession && !active.find((s) => s.id === activeSession.id)) {
          setActiveSession(null);
          setSessionTransactions([]);
          setCartItems([]);
        }

        // Set first active as current if we don't have one
        if (!activeSession && active.length > 0) {
          setActiveSession(active[0]);
        }
      }

      // Also fetch today's sessions (active + closed) for the session list UI
      const todayData = await window.api.session.getTodayAllSessions();
      if (todayData.success && todayData.sessions) {
        setAllTodaySessions(todayData.sessions as CustomerSession[]);
      }
    } catch (err) {
      logger.error("Failed to load sessions:", err);
    }
  }, [activeSession]);

  const refreshSessionTransactions = useCallback(async () => {
    if (!activeSession) {
      setSessionTransactions([]);
      return;
    }

    try {
      const data = await api.getSessionDetails(activeSession.id);

      if (data.success && data.transactions) {
        setSessionTransactions(data.transactions);
      }
    } catch (err) {
      logger.error("Failed to load session transactions:", err);
    }
  }, [activeSession]);

  useEffect(() => {
    if (activeSession) {
      refreshSessionTransactions();
    }
  }, [activeSession, refreshSessionTransactions]);

  const startingRef = useRef(false);

  const startSession = useCallback(
    async (data: {
      customer_name: string;
      customer_phone?: string;
      customer_notes?: string;
    }) => {
      if (startingRef.current) return;
      startingRef.current = true;
      try {
        const result = await api.startSession(data);
        if (result.success && result.sessionId) {
          // Refresh the list to get the new session
          const updatedData = await window.api.session.getActiveSessions();
          if (updatedData.success && updatedData.sessions) {
            const active = updatedData.sessions as CustomerSession[];
            setAllActiveSessions(active);

            // Find and set the new session as active
            const newSession = active.find(
              (s: CustomerSession) => s.id === result.sessionId,
            );
            if (newSession) {
              setActiveSession(newSession);
            }
          }
        } else if (result.error) {
          throw new Error(result.error);
        }
      } catch (err) {
        logger.error("Failed to start session:", err);
        throw err;
      } finally {
        startingRef.current = false;
      }
    },
    [refreshActiveSessions],
  );

  const switchToSession = useCallback(
    async (sessionId: number) => {
      const session = allActiveSessions.find((s) => s.id === sessionId);
      if (session) {
        setActiveSession(session);
      }
    },
    [allActiveSessions],
  );

  const closeCurrentSession = useCallback(async () => {
    if (!activeSession) return;

    try {
      const result = await api.closeSession(activeSession.id);
      if (result.success) {
        // Clear cart for this session
        await window.api.session.cartClear(activeSession.id);
        setActiveSession(null);
        setSessionTransactions([]);
        setCartItems([]);
        await refreshActiveSessions();
      } else if (result.error) {
        throw new Error(result.error);
      }
    } catch (err) {
      logger.error("Failed to close session:", err);
      throw err;
    }
  }, [activeSession, refreshActiveSessions]);

  const closeSession = useCallback(
    async (sessionId: number) => {
      try {
        const result = await api.closeSession(sessionId);
        if (result.success) {
          // Clear cart for closed session
          await window.api.session.cartClear(sessionId);
          await refreshActiveSessions();
          // If we closed the active session, clear it
          if (activeSession?.id === sessionId) {
            setActiveSession(null);
            setSessionTransactions([]);
            setCartItems([]);
          }
        } else if (result.error) {
          throw new Error(result.error);
        }
      } catch (err) {
        logger.error("Failed to close session:", err);
        throw err;
      }
    },
    [activeSession, refreshActiveSessions],
  );

  const deleteSession = useCallback(
    async (sessionId: number) => {
      try {
        const result = await window.api.session.delete(sessionId);
        if (result.success) {
          await refreshActiveSessions();
          // If we deleted the active session, clear it
          if (activeSession?.id === sessionId) {
            setActiveSession(null);
            setSessionTransactions([]);
            setCartItems([]);
          }
        } else if (result.error) {
          throw new Error(result.error);
        }
      } catch (err) {
        logger.error("Failed to delete session:", err);
        throw err;
      }
    },
    [activeSession, refreshActiveSessions],
  );

  const updateSessionInfo = useCallback(
    async (data: {
      customer_name?: string;
      customer_phone?: string;
      customer_notes?: string;
    }) => {
      if (!activeSession) return;

      try {
        const result = await api.updateSession(activeSession.id, data);
        if (result.success) {
          // Update local state
          setActiveSession((prev) => (prev ? { ...prev, ...data } : null));
          await refreshActiveSessions();
        } else if (result.error) {
          throw new Error(result.error);
        }
      } catch (err) {
        logger.error("Failed to update session:", err);
        throw err;
      }
    },
    [activeSession, refreshActiveSessions],
  );

  const linkTransaction = useCallback(
    async (data: {
      transactionType: string;
      transactionId: number;
      amountUsd: number;
      amountLbp: number;
      profitUsd?: number;
      profitLbp?: number;
    }) => {
      if (!activeSession) {
        return;
      }

      try {
        await api.linkTransactionToSession({
          ...data,
          sessionId: activeSession.id,
        });
        // Refresh transactions list
        await refreshSessionTransactions();
      } catch (err) {
        logger.error("Failed to link transaction:", err);
      }
    },
    [activeSession, refreshSessionTransactions],
  );

  // -------------------------------------------------------------------------
  // 3-second polling for multi-PC sync
  // -------------------------------------------------------------------------
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!flags.customerSessions) return;

    pollingRef.current = setInterval(async () => {
      // Poll active sessions list
      try {
        const result = await window.api.session.getActiveSessions();
        if (result.success && result.sessions) {
          setAllActiveSessions(result.sessions as CustomerSession[]);
        }
      } catch {
        // Silently ignore polling errors
      }

      // Poll today's all sessions for the list UI
      try {
        const todayResult = await window.api.session.getTodayAllSessions();
        if (todayResult.success && todayResult.sessions) {
          setAllTodaySessions(todayResult.sessions as CustomerSession[]);
        }
      } catch {
        // Silently ignore polling errors
      }

      // Poll cart items for active session
      if (activeSession) {
        try {
          const cartResult = await window.api.session.cartGet(activeSession.id);
          if (cartResult.success && cartResult.items) {
            const items: CartItem[] = cartResult.items.map((row) => ({
              id: row.item_id,
              module: row.module as CartItem["module"],
              label: row.label,
              amount: row.amount,
              currency: row.currency as CartItem["currency"],
              formData: JSON.parse(row.form_data),
              ipcChannel: row.ipc_channel,
            }));
            setCartItems((prev) => {
              // Only update if actually changed (avoid unnecessary re-renders)
              if (JSON.stringify(prev) !== JSON.stringify(items)) {
                return items;
              }
              return prev;
            });
          }
        } catch {
          // Silently ignore polling errors
        }

        // Poll transactions for active session
        try {
          const txResult = await window.api.session.getTransactions(
            activeSession.id,
          );
          if (txResult.success && txResult.transactions) {
            setSessionTransactions((prev) => {
              if (
                JSON.stringify(prev) !== JSON.stringify(txResult.transactions)
              ) {
                return txResult.transactions as SessionTransaction[];
              }
              return prev;
            });
          }
        } catch {
          // Silently ignore polling errors
        }
      }
    }, 3000);

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    };
  }, [flags.customerSessions, activeSession?.id]);

  const value: SessionContextValue = {
    activeSession,
    allActiveSessions,
    allTodaySessions,
    sessionTransactions,
    isFloatingWindowOpen,
    isFloatingWindowMinimized,

    // Cart
    cartItems,
    addToCart,
    removeFromCart,
    clearCart,
    getCartTotals,
    cartItemCount: cartItems.length,

    startSession,
    switchToSession,
    closeCurrentSession,
    closeSession,
    deleteSession,
    updateSessionInfo,
    linkTransaction,

    openFloatingWindow: () => {},
    closeFloatingWindow: () => {},
    minimizeFloatingWindow: () => {},
    expandFloatingWindow: () => {},

    refreshActiveSessions,
    refreshSessionTransactions,
  };

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
