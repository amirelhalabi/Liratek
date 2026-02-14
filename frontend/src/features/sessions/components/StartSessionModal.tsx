import { useState, useEffect } from "react";
import type { FormEvent } from "react";
import { useSession } from "../context/SessionContext";
import { User, X } from "lucide-react";
import * as api from "../../../api/backendApi";
import type { Client } from "@liratek/ui";

interface StartSessionModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function StartSessionModal({ isOpen, onClose }: StartSessionModalProps) {
  const { startSession } = useSession();
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch clients for search
  useEffect(() => {
    const fetchClients = async () => {
      const data = await api.getClients("");
      setClients(data);
    };
    fetchClients();
  }, []);

  // Filter clients for dropdown
  const filteredClients = clients.filter(
    (c) =>
      c.full_name.toLowerCase().includes(customerName.toLowerCase()) ||
      (c.phone_number || "").includes(customerName),
  );

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      setCustomerName("");
      setCustomerPhone("");
      setCustomerNotes("");
      setSelectedClient(null);
      setError(null);
    }
  }, [isOpen]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();

    if (!customerName.trim()) {
      setError("Customer name is required");
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      {/* Backdrop */}
      <div className="absolute inset-0" onClick={onClose} />

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

          {/* Customer Name */}
          <div className="relative">
            <label
              htmlFor="customer-name"
              className="block text-sm font-medium text-slate-300 mb-1"
            >
              Customer Name <span className="text-red-500">*</span>
            </label>
            <div className="flex items-center bg-slate-800 border border-slate-700 rounded-lg p-1 focus-within:ring-2 focus-within:ring-violet-600 transition-all">
              <div className="p-2 text-slate-400">
                <User size={18} />
              </div>
              <input
                id="customer-name"
                type="text"
                value={customerName}
                onChange={(e) => {
                  setCustomerName(e.target.value);
                  // Reset selection if user types
                  if (
                    selectedClient &&
                    e.target.value !== selectedClient.full_name
                  ) {
                    setSelectedClient(null);
                  }
                }}
                className="bg-transparent border-none text-white w-full px-2 focus:outline-none"
                placeholder="Search or enter customer name..."
                autoFocus
                disabled={loading}
                required
              />
              {selectedClient && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedClient(null);
                    setCustomerName("");
                    setCustomerPhone("");
                  }}
                  className="p-2 text-slate-400 hover:text-white"
                >
                  <X size={16} />
                </button>
              )}
            </div>

            {/* Dropdown Results */}
            {customerName && !selectedClient && filteredClients.length > 0 && (
              <div className="absolute top-full left-0 right-0 mt-2 bg-slate-800 border border-slate-700 rounded-xl shadow-xl z-20 max-h-48 overflow-y-auto">
                {filteredClients.map((client) => (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() => {
                      setSelectedClient(client);
                      setCustomerName(client.full_name);
                      setCustomerPhone(client.phone_number || "");
                    }}
                    className="w-full text-left p-3 hover:bg-slate-700 text-slate-200 border-b border-slate-700/50 last:border-0"
                  >
                    <div className="font-medium">{client.full_name}</div>
                    <div className="text-xs text-slate-500">
                      {client.phone_number}
                    </div>
                  </button>
                ))}
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
              disabled={loading || !customerName.trim()}
            >
              {loading ? "Starting..." : "Start Session"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
