import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import {
  startSession as apiStartSession,
  getActiveSession as apiGetActiveSession,
  getSessionDetails,
  updateSession as apiUpdateSession,
  closeSession as apiCloseSession,
  listSessions,
  linkTransactionToSession,
} from '../../../api/backendApi';

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
  
  // Actions
  startSession: (data: { customer_name: string; customer_phone?: string; customer_notes?: string }) => Promise<void>;
  switchToSession: (sessionId: number) => Promise<void>;
  closeCurrentSession: () => Promise<void>;
  updateSessionInfo: (data: { customer_name?: string; customer_phone?: string; customer_notes?: string }) => Promise<void>;
  linkTransaction: (data: { transactionType: string; transactionId: number; amountUsd: number; amountLbp: number }) => Promise<void>;
  
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
    throw new Error('useSession must be used within SessionProvider');
  }
  return context;
}

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [activeSession, setActiveSession] = useState<CustomerSession | null>(null);
  const [allActiveSessions, setAllActiveSessions] = useState<CustomerSession[]>([]);
  const [sessionTransactions, setSessionTransactions] = useState<SessionTransaction[]>([]);
  const [isFloatingWindowOpen, setIsFloatingWindowOpen] = useState(false);
  const [isFloatingWindowMinimized, setIsFloatingWindowMinimized] = useState(true); // Default to minimized

  // Load active sessions on mount
  useEffect(() => {
    refreshActiveSessions();
  }, []);

  const refreshActiveSessions = useCallback(async () => {
    try {
      const data = await listSessions(50, 0);
      
      if (data.success && data.sessions) {
        const active = data.sessions.filter((s: CustomerSession) => s.is_active === 1);
        setAllActiveSessions(active);
        
        // Set first active as current if we don't have one
        if (!activeSession && active.length > 0) {
          setActiveSession(active[0]);
          setIsFloatingWindowOpen(true);
        }
      }
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  }, [activeSession]);

  const refreshSessionTransactions = useCallback(async () => {
    if (!activeSession) {
      setSessionTransactions([]);
      return;
    }

    try {
      const data = await getSessionDetails(activeSession.id);
      
      if (data.success && data.transactions) {
        setSessionTransactions(data.transactions);
      }
    } catch (err) {
      console.error('Failed to load session transactions:', err);
    }
  }, [activeSession]);

  useEffect(() => {
    if (activeSession) {
      refreshSessionTransactions();
    }
  }, [activeSession, refreshSessionTransactions]);

  const startSession = useCallback(async (data: { customer_name: string; customer_phone?: string; customer_notes?: string }) => {
    try {
      const result = await apiStartSession(data);
      if (result.success && result.sessionId) {
        // Refresh the list to get the new session
        await refreshActiveSessions();
        
        // Fetch the updated list to find the new session
        const updatedData = await listSessions(50, 0);
        if (updatedData.success && updatedData.sessions) {
          const active = updatedData.sessions.filter((s: CustomerSession) => s.is_active === 1);
          setAllActiveSessions(active);
          
          // Find and set the new session as active
          const newSession = active.find(s => s.id === result.sessionId);
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
      console.error('Failed to start session:', err);
      throw err;
    }
  }, [refreshActiveSessions]);

  const switchToSession = useCallback(async (sessionId: number) => {
    const session = allActiveSessions.find(s => s.id === sessionId);
    if (session) {
      setActiveSession(session);
      setIsFloatingWindowOpen(true);
      setIsFloatingWindowMinimized(false);
    }
  }, [allActiveSessions]);

  const closeCurrentSession = useCallback(async () => {
    if (!activeSession) return;

    try {
      const result = await apiCloseSession(activeSession.id);
      if (result.success) {
        setActiveSession(null);
        setSessionTransactions([]);
        setIsFloatingWindowOpen(false);
        await refreshActiveSessions();
      } else if (result.error) {
        throw new Error(result.error);
      }
    } catch (err) {
      console.error('Failed to close session:', err);
      throw err;
    }
  }, [activeSession, refreshActiveSessions]);

  const updateSessionInfo = useCallback(async (data: { customer_name?: string; customer_phone?: string; customer_notes?: string }) => {
    if (!activeSession) return;

    try {
      const result = await apiUpdateSession(activeSession.id, data);
      if (result.success) {
        // Update local state
        setActiveSession(prev => prev ? { ...prev, ...data } : null);
        await refreshActiveSessions();
      } else if (result.error) {
        throw new Error(result.error);
      }
    } catch (err) {
      console.error('Failed to update session:', err);
      throw err;
    }
  }, [activeSession, refreshActiveSessions]);

  const linkTransaction = useCallback(async (data: { transactionType: string; transactionId: number; amountUsd: number; amountLbp: number }) => {
    if (!activeSession) {
      return;
    }

    try {
      await linkTransactionToSession(data);
      // Refresh transactions list
      await refreshSessionTransactions();
    } catch (err) {
      console.error('Failed to link transaction:', err);
    }
  }, [activeSession, refreshSessionTransactions]);

  const value: SessionContextValue = {
    activeSession,
    allActiveSessions,
    sessionTransactions,
    isFloatingWindowOpen,
    isFloatingWindowMinimized,

    startSession,
    switchToSession,
    closeCurrentSession,
    updateSessionInfo,
    linkTransaction,

    openFloatingWindow: () => setIsFloatingWindowOpen(true),
    closeFloatingWindow: () => setIsFloatingWindowOpen(false),
    minimizeFloatingWindow: () => setIsFloatingWindowMinimized(true),
    expandFloatingWindow: () => setIsFloatingWindowMinimized(false),

    refreshActiveSessions,
    refreshSessionTransactions,
  };

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}
