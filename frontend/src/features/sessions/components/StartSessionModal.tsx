import { useState, useEffect, useRef } from "react";
import type { FormEvent } from "react";
import { useSession } from "../context/SessionContext";
import { Search, X } from "lucide-react";
import type { Client } from "@liratek/ui";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { useSaveAsClient } from "@/shared/hooks/useSaveAsClient";
import { SaveAsClientCheckbox } from "@/shared/components/SaveAsClientCheckbox";

interface StartSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function StartSessionModal({ isOpen, onClose }: StartSessionModalProps) {
  useModalFocusFix(isOpen);
  const { startSession } = useSession();
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [todaySessionNames, setTodaySessionNames] = useState<string[]>([]);
  const [loadingNames, setLoadingNames] = useState(false);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const {
    saveAsClient,
    setSaveAsClient,
    showCheckbox: showSaveAsClient,
    trySaveAsClient,
    resetSaveAsClient,
  } = useSaveAsClient(customerName, customerPhone);

  // Focus name input and fetch today's session names when modal opens
  useEffect(() => {
    if (isOpen) {
      nameInputRef.current?.focus();
      setLoadingNames(true);
      const fetchTodayNames = async () => {
        try {
          const result = await window.api.session.getTodaySessions();
          if (result.success && result.sessions) {
            setTodaySessionNames(
              result.sessions
                .map((s) => s.customer_name?.trim().toLowerCase())
                .filter((n): n is string => !!n),
            );
          }
        } catch {
          // Silently ignore — non-critical
        } finally {
          setLoadingNames(false);
        }
      };
      fetchTodayNames();
    }
  }, [isOpen]);

  // Debounced server-side client search (same pattern as Debts page)
  const [searchLoading, setSearchLoading] = useState(false);
  useEffect(() => {
    if (customerName.length === 0 || selectedClient) {
      setClients([]);
      return;
    }
    setSearchLoading(true);
    const timer = setTimeout(async () => {
      try {
        const data = await window.api.clients.getAll(customerName);
        setClients(data);
      } catch {
        setClients([]);
      } finally {
        setSearchLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [customerName, selectedClient]);

  const filteredClients = clients;

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setCustomerName("");
      setCustomerPhone("");
      setCustomerNotes("");
      setSelectedClient(null);
      setError(null);
      setTodaySessionNames([]);
      resetSaveAsClient();
    }
  }, [isOpen]);

  const isDuplicateName =
    customerName.trim().length > 0 &&
    todaySessionNames.includes(customerName.trim().toLowerCase());

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!customerName.trim()) {
      setError("Customer name is required");
      return;
    }

    if (isDuplicateName) {
      setError("A session with this name already exists today");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await trySaveAsClient();

      await startSession({
        customer_name: customerName.trim(),
        ...(customerPhone.trim()
          ? { customer_phone: customerPhone.trim() }
          : {}),
        ...(customerNotes.trim()
          ? { customer_notes: customerNotes.trim() }
          : {}),
      });

      onClose();
    } catch (err: any) {
      setError(err?.message || "Failed to start session");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 animate-in fade-in duration-200">
      {/* Backdrop */}
      <div className="absolute inset-0" role="presentation" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-700">
          <h2 className="text-xl font-semibold text-white">
            New Customer Session
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg p-2 transition-colors"
            type="button"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 bg-red-900/30 border border-red-700 rounded-md">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {isDuplicateName && (
            <div className="p-3 bg-amber-900/30 border border-amber-700 rounded-md">
              <p className="text-sm text-amber-400">
                A session with this name already exists today. Please use a
                different name.
              </p>
            </div>
          )}

          {/* Customer Name */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
              Customer Name <span className="text-red-500">*</span>
            </label>
            {selectedClient ? (
              <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
                <span className="text-white text-sm font-medium">
                  {selectedClient.full_name}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedClient(null);
                    setCustomerName("");
                    setCustomerPhone("");
                  }}
                  className="text-slate-400 hover:text-white"
                >
                  <X size={14} />
                </button>
              </div>
            ) : (
              <div className="relative">
                <Search
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                  size={15}
                />
                <input
                  id="customer-name"
                  type="text"
                  value={customerName}
                  onChange={(e) => {
                    setCustomerName(e.target.value);
                    setShowDropdown(true);
                  }}
                  onFocus={() => setShowDropdown(true)}
                  onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
                  placeholder="Search client by name or phone..."
                  className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-9 pr-4 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                  ref={nameInputRef}
                  disabled={loading}
                  required
                />
                {customerName.length > 0 && showDropdown && (
                  <div className="absolute z-10 top-full mt-1 w-full bg-slate-800 border border-slate-600 rounded-lg shadow-xl max-h-48 overflow-y-auto">
                    {searchLoading ? (
                      <div className="px-3 py-2 text-sm text-slate-500">
                        Searching...
                      </div>
                    ) : filteredClients.length > 0 ? (
                      filteredClients.slice(0, 10).map((client) => (
                        <button
                          key={client.id}
                          type="button"
                          onClick={() => {
                            setSelectedClient(client);
                            setCustomerName(client.full_name);
                            setCustomerPhone(client.phone_number || "");
                          }}
                          className="w-full text-left px-3 py-2 hover:bg-slate-700 text-sm text-white border-b border-slate-700/50 last:border-0"
                        >
                          <div className="font-medium">{client.full_name}</div>
                          {client.phone_number && (
                            <div className="text-xs text-slate-400">
                              {client.phone_number}
                            </div>
                          )}
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-2 text-sm text-slate-500">
                        No clients found
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Customer Phone */}
          <div>
            <label
              htmlFor="customer-phone"
              className="block text-sm font-medium text-slate-300 mb-1"
            >
              Phone Number{" "}
              <span className="text-slate-500 text-xs">(optional)</span>
            </label>
            <input
              id="customer-phone"
              type="tel"
              value={customerPhone}
              onChange={(e) => setCustomerPhone(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-violet-600 focus:border-violet-500"
              placeholder="+1234567890"
              disabled={loading}
            />
            <SaveAsClientCheckbox
              checked={saveAsClient}
              onChange={setSaveAsClient}
              hidden={!!selectedClient || !showSaveAsClient}
            />
          </div>

          {/* Customer Notes */}
          <div>
            <label
              htmlFor="customer-notes"
              className="block text-sm font-medium text-slate-300 mb-1"
            >
              Notes <span className="text-slate-500 text-xs">(optional)</span>
            </label>
            <textarea
              id="customer-notes"
              value={customerNotes}
              onChange={(e) => setCustomerNotes(e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-violet-600 focus:border-violet-500 resize-none"
              placeholder="Regular customer, prefers cash..."
              rows={3}
              disabled={loading}
            />
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-3 pt-4">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-lg transition-colors"
              disabled={loading}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium text-white bg-violet-600 hover:bg-violet-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              disabled={
                loading ||
                loadingNames ||
                !customerName.trim() ||
                isDuplicateName
              }
            >
              {loading ? "Starting..." : "Start Session"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
