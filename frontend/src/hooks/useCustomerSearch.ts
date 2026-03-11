import { useState, useEffect, useRef, useCallback } from "react";
import { useApi } from "@liratek/ui";
import type { Client } from "@liratek/ui";
import { useSession } from "@/features/sessions/context/SessionContext";
import logger from "@/utils/logger";

interface UseCustomerSearchReturn {
  // State
  clientSearch: string;
  secondaryInput: string;
  selectedClient: Client | null;
  filteredClients: Client[];
  isAutoFilledFromSession: boolean;

  // Derived values
  isSearchPhone: boolean;
  secondaryLabel: string;
  secondaryPlaceholder: string;
  isNewClientInfoComplete: boolean;

  // Actions
  setClientSearch: (search: string) => void;
  setSecondaryInput: (input: string) => void;
  setSelectedClient: (client: Client | null) => void;
  clearCustomer: () => void;
  selectClient: (client: Client) => void;
  setIsAutoFilledFromSession: (filled: boolean) => void;
}

/**
 * Custom hook for managing customer search and selection
 */
export function useCustomerSearch(
  draftData?: {
    clientSearchInput?: string;
    clientSearchSecondary?: string;
    selectedClient?: Client | null;
  } | null,
): UseCustomerSearchReturn {
  const api = useApi();
  const { activeSession } = useSession();

  const [clients, setClients] = useState<Client[]>([]);
  const [clientSearch, setClientSearch] = useState("");
  const [secondaryInput, setSecondaryInput] = useState("");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [isAutoFilledFromSession, setIsAutoFilledFromSession] = useState(false);

  // Ref for customer search input — prevents focus loss during re-renders
  const customerSearchRef = useRef<HTMLInputElement>(null);

  // Fetch clients on mount
  useEffect(() => {
    const fetchClients = async () => {
      try {
        const data = await api.getClients("");
        setClients(data);
      } catch (err) {
        logger.error("Failed to fetch clients:", err);
      }
    };
    fetchClients();
  }, [api]);

  // Auto-fill customer from active session ONLY if no customer is already set
  useEffect(() => {
    const draftHasCustomer =
      draftData?.clientSearchInput &&
      draftData.clientSearchInput.trim().length > 0;

    if (activeSession && !draftHasCustomer && !clientSearch) {
      setClientSearch(activeSession.customer_name || "");
      if (activeSession.customer_phone) {
        setSecondaryInput(activeSession.customer_phone);
      }
      setIsAutoFilledFromSession(true);
    }
  }, [activeSession, draftData, clientSearch]);

  // Restore draft data when provided
  useEffect(() => {
    if (draftData) {
      setSelectedClient(draftData.selectedClient || null);
      setClientSearch(draftData.clientSearchInput || "");
      setSecondaryInput(draftData.clientSearchSecondary || "");
    }
  }, [draftData]);

  // Filter clients for dropdown
  const filteredClients = useCallback(
    () =>
      clients.filter(
        (c) =>
          c.full_name.toLowerCase().includes(clientSearch.toLowerCase()) ||
          (c.phone_number || "").includes(clientSearch),
      ),
    [clients, clientSearch],
  )();

  // Heuristic: Is the search mainly digits?
  const isSearchPhone =
    /^\+?[\d\s-]+$/.test(clientSearch) && clientSearch.length > 0;

  // Derived Label & Placeholder
  const secondaryLabel = isSearchPhone ? "Full Name" : "Phone Number";
  const secondaryPlaceholder = isSearchPhone
    ? "Enter Full Name..."
    : "Enter Phone Number...";

  // Validation for Debt: both primary and secondary must be filled for new clients
  const isNewClientInfoComplete =
    clientSearch.trim().length > 0 && secondaryInput.trim().length > 0;

  // Actions
  const clearCustomer = useCallback(() => {
    setSelectedClient(null);
    setClientSearch("");
    setSecondaryInput("");
  }, []);

  const selectClient = useCallback((client: Client) => {
    setSelectedClient(client);
    setClientSearch(client.full_name);
    setSecondaryInput(client.phone_number || "");
  }, []);

  const handleSetClientSearch = useCallback(
    (search: string) => {
      setClientSearch(search);
      if (selectedClient && search !== selectedClient.full_name) {
        setSelectedClient(null);
      }
      if (secondaryInput) setSecondaryInput("");
      if (isAutoFilledFromSession) setIsAutoFilledFromSession(false);
      requestAnimationFrame(() => {
        customerSearchRef.current?.focus();
      });
    },
    [selectedClient, secondaryInput, isAutoFilledFromSession],
  );

  const handleSetSecondaryInput = useCallback((input: string) => {
    setSecondaryInput(input);
    requestAnimationFrame(() => {
      const inputElement = document.querySelector(
        'input[placeholder*="Phone"], input[placeholder*="Name"]',
      ) as HTMLInputElement;
      inputElement?.focus();
    });
  }, []);

  return {
    // State
    clientSearch,
    secondaryInput,
    selectedClient,
    filteredClients,
    isAutoFilledFromSession,

    // Derived values
    isSearchPhone,
    secondaryLabel,
    secondaryPlaceholder,
    isNewClientInfoComplete,

    // Actions
    setClientSearch: handleSetClientSearch,
    setSecondaryInput: handleSetSecondaryInput,
    setSelectedClient,
    clearCustomer,
    selectClient,
    setIsAutoFilledFromSession,
  };
}
