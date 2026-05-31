import { useState, useEffect, useCallback, useRef } from "react";
import {
  Gift,
  Search,
  X,
  Check,
  Copy,
  Ban,
  Calendar,
  Loader2,
} from "lucide-react";
import { PageHeader } from "@liratek/ui";
import { useAuth } from "@/features/auth/context/AuthContext";
import type { Voucher } from "@/types/electron";

type StatusFilter = "all" | "pending" | "redeemed" | "expired" | "cancelled";

interface ClientLite {
  id: number;
  full_name: string;
  phone_number: string | null;
}

const STATUS_TABS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "pending", label: "Pending" },
  { key: "redeemed", label: "Redeemed" },
  { key: "expired", label: "Expired" },
  { key: "cancelled", label: "Cancelled" },
];

const STATUS_STYLES: Record<Voucher["status"], string> = {
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  redeemed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  expired: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  cancelled: "bg-red-500/15 text-red-300 border-red-500/30",
};

export function VouchersPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";

  // ─── List state ───
  const [vouchers, setVouchers] = useState<Voucher[]>([]);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);

  // ─── Create form state ───
  const [clientQuery, setClientQuery] = useState("");
  const [clientResults, setClientResults] = useState<ClientLite[]>([]);
  const [showResults, setShowResults] = useState(false);
  const [selectedClient, setSelectedClient] = useState<ClientLite | null>(null);
  const [clientPhone, setClientPhone] = useState("");
  const [amount, setAmount] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [createdVoucher, setCreatedVoucher] = useState<Voucher | null>(null);
  const [copied, setCopied] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadVouchers = useCallback(async () => {
    setLoading(true);
    setListError(null);
    const filters =
      statusFilter === "all" ? undefined : { status: statusFilter };
    const result = await window.api.vouchers.getAll(filters);
    if (result.success) {
      setVouchers(result.vouchers ?? []);
    } else {
      setListError(result.error ?? "Failed to load vouchers");
    }
    setLoading(false);
  }, [statusFilter]);

  useEffect(() => {
    loadVouchers();
  }, [loadVouchers]);

  // ─── Client search (debounced) ───
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (!clientQuery || clientQuery.length < 2) {
      setClientResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      try {
        const results = await window.api.clients.getAll(clientQuery);
        setClientResults(results.slice(0, 8) as ClientLite[]);
        setShowResults(true);
      } catch {
        setClientResults([]);
      }
    }, 250);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [clientQuery]);

  const selectClient = (client: ClientLite) => {
    setSelectedClient(client);
    setClientQuery(client.full_name);
    setClientPhone(client.phone_number ?? "");
    setShowResults(false);
    setClientResults([]);
  };

  const clearClient = () => {
    setSelectedClient(null);
    setClientQuery("");
    setClientPhone("");
    setClientResults([]);
  };

  const resetForm = () => {
    clearClient();
    setAmount("");
    setExpiryDate("");
    setNote("");
    setFormError(null);
  };

  /**
   * Resolve the client id for the voucher: use the selected client, or create a
   * new one from the entered name + phone. Falls back to an existing client when
   * the phone is already registered.
   */
  const resolveClientId = async (): Promise<
    { ok: true; clientId: number } | { ok: false; error: string }
  > => {
    if (selectedClient) return { ok: true, clientId: selectedClient.id };

    const name = clientQuery.trim();
    const phone = clientPhone.trim();
    if (!name) return { ok: false, error: "Enter a client name or select a client" };
    if (!phone) return { ok: false, error: "Enter a phone number for the new client" };

    const created = await window.api.clients.create({
      full_name: name,
      phone_number: phone,
      notes: null,
      whatsapp_opt_in: 1,
    });
    if (created.success && created.id) {
      return { ok: true, clientId: created.id };
    }

    // Phone may already belong to a client — reuse it instead of failing
    const matches = await window.api.clients.getAll(phone);
    const existing = matches.find((c) => c.phone_number === phone);
    if (existing) return { ok: true, clientId: existing.id };

    return { ok: false, error: created.error ?? "Failed to create client" };
  };

  const handleSubmit = async () => {
    setFormError(null);
    const amountVal = parseFloat(amount);
    if (!amountVal || amountVal <= 0) {
      setFormError("Enter a valid amount greater than zero");
      return;
    }

    setSubmitting(true);
    try {
      const resolved = await resolveClientId();
      if (!resolved.ok) {
        setFormError(resolved.error);
        return;
      }

      const result = await window.api.vouchers.create({
        clientId: resolved.clientId,
        amount: amountVal,
        expiryDate: expiryDate || null,
        note: note.trim() || null,
      });

      if (result.success && result.voucher) {
        setCreatedVoucher(result.voucher);
        resetForm();
        loadVouchers();
      } else {
        setFormError(result.error ?? "Failed to create voucher");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (voucher: Voucher) => {
    if (
      !window.confirm(
        `Cancel voucher ${voucher.code} ($${voucher.amount.toFixed(2)})? This cannot be undone.`,
      )
    ) {
      return;
    }
    const result = await window.api.vouchers.cancel(voucher.id);
    if (result.success) {
      loadVouchers();
    } else {
      alert(result.error ?? "Failed to cancel voucher");
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="h-full p-6 overflow-auto">
      <div className="mb-6">
        <PageHeader icon={Gift} title="Vouchers" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ─── Create form ─── */}
        <div className="lg:col-span-1">
          <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-5">
            <h2 className="text-lg font-semibold text-white mb-4">
              Create Voucher
            </h2>

            {createdVoucher && (
              <div className="mb-4 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                <p className="text-xs text-emerald-300 mb-1">
                  Voucher created for {createdVoucher.client_name}
                </p>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-mono font-bold text-white tracking-wider">
                    {createdVoucher.code}
                  </span>
                  <button
                    type="button"
                    onClick={() => copyCode(createdVoucher.code)}
                    className="p-1.5 rounded-md text-emerald-300 hover:bg-emerald-500/20 transition-colors"
                    title="Copy code"
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
                <p className="text-sm text-emerald-200 mt-1">
                  ${createdVoucher.amount.toFixed(2)}
                  {createdVoucher.expiry_date
                    ? ` · expires ${createdVoucher.expiry_date}`
                    : " · no expiry"}
                </p>
              </div>
            )}

            {/* Client — search existing or create new */}
            <div className="mb-3 relative">
              <label className="text-xs text-slate-400 block mb-1">
                Client *
              </label>
              {selectedClient ? (
                <div className="flex items-center justify-between bg-slate-900 border border-slate-600 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-sm text-white">
                      {selectedClient.full_name}
                    </p>
                    {selectedClient.phone_number && (
                      <p className="text-xs text-slate-400">
                        {selectedClient.phone_number}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={clearClient}
                    className="p-1 text-slate-500 hover:text-red-400"
                  >
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      value={clientQuery}
                      onChange={(e) => setClientQuery(e.target.value)}
                      onFocus={() =>
                        clientResults.length && setShowResults(true)
                      }
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-9 pr-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                      placeholder="Search or enter client name"
                    />
                    {showResults && clientResults.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg shadow-xl max-h-56 overflow-auto">
                        {clientResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => selectClient(c)}
                            className="w-full text-left px-3 py-2 hover:bg-slate-700/60 transition-colors"
                          >
                            <p className="text-sm text-white">{c.full_name}</p>
                            {c.phone_number && (
                              <p className="text-xs text-slate-400">
                                {c.phone_number}
                              </p>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <input
                    type="text"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                    placeholder="Phone number"
                  />
                  {clientQuery.trim() && clientResults.length === 0 && (
                    <p className="text-[11px] text-slate-500">
                      No match — a new client will be created.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Amount */}
            <div className="mb-3">
              <label className="text-xs text-slate-400 block mb-1">
                Amount (USD) *
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                  $
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-7 pr-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                  placeholder="0.00"
                />
              </div>
            </div>

            {/* Expiry */}
            <div className="mb-3">
              <label className="text-xs text-slate-400 block mb-1">
                Expiry date (optional)
              </label>
              <div className="relative">
                <Calendar className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-9 pr-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            {/* Note */}
            <div className="mb-4">
              <label className="text-xs text-slate-400 block mb-1">
                Note (optional)
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                placeholder="e.g. Birthday gift"
              />
            </div>

            {formError && (
              <p className="text-xs text-red-400 mb-3">{formError}</p>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={
                submitting ||
                !amount ||
                (!selectedClient &&
                  (!clientQuery.trim() || !clientPhone.trim()))
              }
              className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Creating...
                </>
              ) : (
                "Create Voucher"
              )}
            </button>
          </div>
        </div>

        {/* ─── Voucher list ─── */}
        <div className="lg:col-span-2">
          {/* Status tabs */}
          <div className="flex flex-wrap gap-2 mb-4">
            {STATUS_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setStatusFilter(tab.key)}
                className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
                  statusFilter === tab.key
                    ? "bg-orange-500 text-white"
                    : "bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="bg-slate-800 rounded-xl border border-slate-700/50 overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-slate-400 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading...
              </div>
            ) : listError ? (
              <div className="p-8 text-center text-red-400">{listError}</div>
            ) : vouchers.length === 0 ? (
              <div className="p-8 text-center text-slate-400">
                No vouchers found
              </div>
            ) : (
              <table className="w-full">
                <thead className="bg-slate-900">
                  <tr>
                    <th className="text-left text-xs text-slate-400 px-4 py-3">
                      Code
                    </th>
                    <th className="text-left text-xs text-slate-400 px-4 py-3">
                      Client
                    </th>
                    <th className="text-right text-xs text-slate-400 px-4 py-3">
                      Amount
                    </th>
                    <th className="text-left text-xs text-slate-400 px-4 py-3">
                      Expiry
                    </th>
                    <th className="text-left text-xs text-slate-400 px-4 py-3">
                      Status
                    </th>
                    <th className="text-right text-xs text-slate-400 px-4 py-3">
                      Action
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {vouchers.map((v) => (
                    <tr key={v.id} className="hover:bg-slate-700/50">
                      <td className="px-4 py-3 text-sm font-mono text-white">
                        {v.code}
                      </td>
                      <td className="px-4 py-3 text-sm text-white">
                        <div>{v.client_name}</div>
                        {v.client_phone && (
                          <div className="text-xs text-slate-400">
                            {v.client_phone}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-white text-right font-mono">
                        ${v.amount.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-sm text-slate-300">
                        {v.expiry_date ?? "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium border capitalize ${STATUS_STYLES[v.status]}`}
                        >
                          {v.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isAdmin && v.status === "pending" ? (
                          <button
                            type="button"
                            onClick={() => handleCancel(v)}
                            className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors"
                            title="Cancel voucher"
                          >
                            <Ban size={14} /> Cancel
                          </button>
                        ) : (
                          <span className="text-slate-600">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default VouchersPage;
