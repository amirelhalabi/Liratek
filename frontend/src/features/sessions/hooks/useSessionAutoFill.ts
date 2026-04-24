import { useEffect } from "react";
import { useSession } from "@/features/sessions/context/SessionContext";

interface SessionInfo {
  customer_name?: string;
  customer_phone?: string;
  customer_notes?: string;
}

interface SessionFieldString {
  select: (session: SessionInfo) => string | undefined;
  set: (value: string) => void;
  clearValue: string;
}

interface SessionFieldNullable {
  select: (session: SessionInfo) => undefined;
  set: (value: number | null) => void;
  clearValue: null;
}

type SessionField = SessionFieldString | SessionFieldNullable;

/**
 * Autofills local state from the active customer session and **clears it
 * automatically** when the session is closed.
 *
 * This prevents stale client data from leaking into subsequent transactions.
 *
 * @example
 * ```tsx
 * useSessionAutoFill([
 *   { select: (s) => s.customer_name, set: setClientName, clearValue: "" },
 *   { select: (s) => s.customer_phone, set: setClientPhone, clearValue: "" },
 * ]);
 * ```
 */
export function useSessionAutoFill(fields: SessionField[]): void {
  const { activeSession } = useSession();

  useEffect(() => {
    if (activeSession) {
      for (const field of fields) {
        const value = field.select(activeSession);
        if (value !== undefined) {
          (field.set as (v: string) => void)(value);
        }
      }
    } else {
      // Session closed — clear all fields
      for (const field of fields) {
        (field.set as (v: string | number | null) => void)(field.clearValue);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSession]);
}
