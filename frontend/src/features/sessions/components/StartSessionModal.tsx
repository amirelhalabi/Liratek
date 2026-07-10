import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { useSession } from "../context/SessionContext";
import { X } from "lucide-react";
import type { Client } from "@liratek/ui";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { ClientAutocompleteInput } from "@/shared/components/ClientAutocompleteInput";
import { useApi } from "@liratek/ui";

interface StartSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function StartSessionModal({ isOpen, onClose }: StartSessionModalProps) {
  useModalFocusFix(isOpen);
  const api = useApi();
  const { startSession } = useSession();
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSessionNames, setActiveSessionNames] = useState<string[]>([]);
  const [loadingNames, setLoadingNames] = useState(false);

  // Fetch the names of currently OPEN sessions when the modal opens. We only
  // block on active sessions (not closed ones), so the same customer can be
  // served multiple times a day — each visit re-opened once the prior one is
  // closed. Two simultaneously-open sessions for one customer stay blocked.
  useEffect(() => {
    if (isOpen) {
      setLoadingNames(true);
      const fetchActiveNames = async () => {
        try {
          const result = await api.session.getActiveSessions();
          if (result.success && result.sessions) {
            setActiveSessionNames(
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
      fetchActiveNames();
    }
  }, [isOpen]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setCustomerName("");
      setCustomerPhone("");
      setCustomerNotes("");
      setSelectedClient(null);
      setError(null);
      setActiveSessionNames([]);
    }
  }, [isOpen]);

  const isDuplicateName =
    customerName.trim().length > 0 &&
    activeSessionNames.includes(customerName.trim().toLowerCase());

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!customerName.trim()) {
      setError("Customer name is required");
      return;
    }

    if (isDuplicateName) {
      setError("This customer already has an open session. Close it first.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
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
                This customer already has an open session. Close it before
                starting a new one.
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
              <ClientAutocompleteInput
                id="customer-name"
                value={customerName}
                onChange={(v) => {
                  setCustomerName(v);
                  if (!v) {
                    setSelectedClient(null);
                    setCustomerPhone("");
                  }
                }}
                onClientSelect={(client) => {
                  setSelectedClient(client);
                  setCustomerName(client.full_name);
                  setCustomerPhone(client.phone_number || "");
                }}
                placeholder="Search client by name or phone..."
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                disabled={loading}
                showDebtBadge
                autoFocus={isOpen}
              />
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
            {/* Client registration follows the app-wide name+phone identity
                rule (canChargeToCustomerAccount): with a phone the customer is
                auto-registered as a client at session start — the PHONE is the
                identity key, so a phone that already belongs to a client
                reuses that client (no new row, typed name ignored). Without a
                phone, no client is saved and Customer Account stays
                unavailable — that warning also applies when an existing
                phone-less client is picked from the autocomplete. */}
            {!selectedClient && customerName.trim() && customerPhone.trim() && (
              <p className="text-xs text-emerald-300/80 mt-1 px-1">
                Customer will be registered as a client — if this phone already
                belongs to a client, that client is used.
              </p>
            )}
            {customerName.trim() && !customerPhone.trim() && (
              <p className="text-xs text-amber-300/80 mt-1 px-1">
                No phone number — the customer won&apos;t be saved as a client
                and Customer Account payment will be unavailable.
              </p>
            )}
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
