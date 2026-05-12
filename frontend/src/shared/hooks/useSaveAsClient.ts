/**
 * useSaveAsClient Hook
 *
 * Shared logic for optionally saving a customer as a client.
 * - Auto-checks whether a client with the given name already exists.
 * - Only shows the checkbox when both name and phone are filled AND no match is found.
 * - On submit, creates the client if the checkbox is checked.
 */

import { useState, useCallback, useEffect, useRef } from "react";
import logger from "@/utils/logger";

interface SaveAsClientResult {
  clientId: number | null;
  error?: string;
}

export function useSaveAsClient(name: string, phone: string) {
  const [saveAsClient, setSaveAsClient] = useState(false);
  /** Whether the checkbox should be visible (both fields filled + no existing match) */
  const [showCheckbox, setShowCheckbox] = useState(false);
  /** Debounce timer ref */
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-check client existence when name/phone change
  useEffect(() => {
    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();

    // Both fields must be filled to even consider showing
    if (!trimmedName || !trimmedPhone) {
      setShowCheckbox(false);
      setSaveAsClient(false);
      return;
    }

    // Debounce the API call (300ms)
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      try {
        const results = await window.api.clients.getAll(trimmedName);
        const exists = results.some(
          (c) => c.full_name?.toLowerCase() === trimmedName.toLowerCase(),
        );
        setShowCheckbox(!exists);
        // If the client now exists, uncheck
        if (exists) setSaveAsClient(false);
      } catch {
        // On error, hide checkbox
        setShowCheckbox(false);
      }
    }, 300);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [name, phone]);

  /**
   * Attempt to save the given name+phone as a client, if saveAsClient is checked.
   * Creates a new client and returns the new ID.
   * If saveAsClient is false or name is empty, returns null (no-op).
   */
  const trySaveAsClient = useCallback(async (): Promise<SaveAsClientResult> => {
    if (!saveAsClient || !name.trim()) {
      return { clientId: null };
    }

    try {
      // Double-check: don't create duplicates
      const results = await window.api.clients.getAll(name.trim());
      const existing = results.find(
        (c) => c.full_name?.toLowerCase() === name.trim().toLowerCase(),
      );

      if (existing) {
        return { clientId: existing.id };
      }

      // Create new client
      const result = await window.api.clients.create({
        full_name: name.trim(),
        phone_number: phone.trim() || "",
        whatsapp_opt_in: 1,
      } as Parameters<typeof window.api.clients.create>[0]);

      if (result.success && result.id) {
        return { clientId: result.id };
      }

      return {
        clientId: null,
        error: result.error ?? "Failed to create client",
      };
    } catch (err) {
      logger.error("Failed to save as client:", err);
      return {
        clientId: null,
        error: err instanceof Error ? err.message : "Failed to save client",
      };
    }
  }, [saveAsClient, name, phone]);

  const resetSaveAsClient = useCallback(() => {
    setSaveAsClient(false);
    setShowCheckbox(false);
  }, []);

  return {
    saveAsClient,
    setSaveAsClient,
    showCheckbox,
    trySaveAsClient,
    resetSaveAsClient,
  };
}
