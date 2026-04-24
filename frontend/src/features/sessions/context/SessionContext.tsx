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
  sessionTransactions: SessionTransaction[];
  isFloatingWindowOpen: boolean;
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
  }) => Promise<void>;

  // Window controls
  openFloatingWindow: () => void;
  closeFloatingWindow: () => void;
  minimizeFloatingWindow: () => void;
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
  const [sessionTransactions, setSessionTransactions] = useState<
    SessionTransaction[]
  >([]);
  const [isFloatingWindowOpen, setIsFloatingWindowOpen] = useState(false);
  const [isFloatingWindowMinimized, setIsFloatingWindowMinimized] =
    useState(true); // Default to minimized

  // Cart state: Map of sessionId -> CartItem[] for multi-session support
  const cartsBySession = useRef<Map<number, CartItem[]>>(new Map());
  const [cartItems, setCartItems] = useState<CartItem[]>([]);

  // Sync cartItems state when activeSession changes
  useEffect(() => {
    if (activeSession) {
      const items = cartsBySession.current.get(activeSession.id) || [];
      setCartItems(items);
    } else {
      setCartItems([]);
    }
  }, [activeSession?.id]);

  const addToCart = useCallback(
    (item: Omit<CartItem, "id">) => {
      if (!activeSession) return;
      const newItem: CartItem = {
        ...item,
        id: crypto.randomUUID(),
      };
      const sessionId = activeSession.id;
      const existing = cartsBySession.current.get(sessionId) || [];
      const updated = [...existing, newItem];
      cartsBySession.current.set(sessionId, updated);
      setCartItems(updated);
      logger.info(
        `Added item to cart: ${item.module} - ${item.label} (session ${sessionId})`,
      );
    },
    [activeSession],
  );

  const removeFromCart = useCallback(
    (itemId: string) => {
      if (!activeSession) return;
      const sessionId = activeSession.id;
      const existing = cartsBySession.current.get(sessionId) || [];
      const updated = existing.filter((i) => i.id !== itemId);
      cartsBySession.current.set(sessionId, updated);
      setCartItems(updated);
    },
    [activeSession],
  );

  const clearCart = useCallback(() => {
    if (!activeSession) return;
    cartsBySession.current.set(activeSession.id, []);
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
      const data = await api.listSessions(50, 0);

      if (data.success && data.sessions) {
        const active = data.sessions.filter(
          (s: CustomerSession) => s.is_active === 1,
        );
        setAllActiveSessions(active);

        // Set first active as current if we don't have one
        if (!activeSession && active.length > 0) {
          setActiveSession(active[0]);
          setIsFloatingWindowOpen(true);
        }
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

  const startSession = useCallback(
    async (data: {
      customer_name: string;
      customer_phone?: string;
      customer_notes?: string;
    }) => {
      try {
        const result = await api.startSession(data);
        if (result.success && result.sessionId) {
          // Refresh the list to get the new session
          await refreshActiveSessions();

          // Fetch the updated list to find the new session
          const updatedData = await api.listSessions(50, 0);
          if (updatedData.success && updatedData.sessions) {
            const active = updatedData.sessions.filter(
              (s: CustomerSession) => s.is_active === 1,
            );
            setAllActiveSessions(active);

            // Find and set the new session as active
            const newSession = active.find(
              (s: CustomerSession) => s.id === result.sessionId,
            );
            if (newSession) {
              setActiveSession(newSession);
              setIsFloatingWindowOpen(true);
              setIsFloatingWindowMinimized(false);
            }
          }
        } else if (result.error) {
          throw new Error(result.error);
        }
      } catch (err) {
        logger.error("Failed to start session:", err);
        throw err;
      }
    },
    [refreshActiveSessions],
  );

  const switchToSession = useCallback(
    async (sessionId: number) => {
      const session = allActiveSessions.find((s) => s.id === sessionId);
      if (session) {
        setActiveSession(session);
        setIsFloatingWindowOpen(true);
        setIsFloatingWindowMinimized(false);
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
        cartsBySession.current.delete(activeSession.id);
        setActiveSession(null);
        setSessionTransactions([]);
        setCartItems([]);
        setIsFloatingWindowOpen(false);
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
          cartsBySession.current.delete(sessionId);
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

  const value: SessionContextValue = {
    activeSession,
    allActiveSessions,
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
    updateSessionInfo,
    linkTransaction,

    openFloatingWindow: () => setIsFloatingWindowOpen(true),
    closeFloatingWindow: () => setIsFloatingWindowOpen(false),
    minimizeFloatingWindow: () => setIsFloatingWindowMinimized(true),
    expandFloatingWindow: () => setIsFloatingWindowMinimized(false),

    refreshActiveSessions,
    refreshSessionTransactions,
  };

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}
