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
import { PageHeader, DecimalInput, useApi } from "@liratek/ui";
import { useAuth } from "@/features/auth/context/AuthContext";
import type { Voucher } from "@/types/electron";
import { localDay } from "@/shared/utils/localDay";
import { useTranslation } from "react-i18next";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import { useFormat } from "@/i18n/useFormat";

type StatusFilter = "all" | "pending" | "redeemed" | "expired" | "cancelled";

interface ClientLite {
  id: number;
  full_name: string;
  phone_number: string | null;
}

// Labels are catalog keys, translated at render; `key` is the status code.
const STATUS_TABS = [
  { key: "all", labelKey: "status.all" },
  { key: "pending", labelKey: "status.pending" },
  { key: "redeemed", labelKey: "status.redeemed" },
  { key: "expired", labelKey: "status.expired" },
  { key: "cancelled", labelKey: "status.cancelled" },
] as const satisfies readonly { key: StatusFilter; labelKey: string }[];

const STATUS_STYLES: Record<Voucher["status"], string> = {
  pending: "bg-amber-500/15 text-amber-300 border-amber-500/30",
  redeemed: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
  expired: "bg-slate-500/15 text-slate-300 border-slate-500/30",
  cancelled: "bg-red-500/15 text-red-300 border-red-500/30",
};

export function VouchersPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const api = useApi();
  const { t } = useTranslation(["vouchers", "common"]);
  const { formatNumber } = useFormat();
  const formatVoucherAmount = (v: Voucher) =>
    v.currency_code === "LBP"
      ? `${formatNumber(Math.round(v.amount))} LBP`
      : `$${v.amount.toFixed(2)}`;

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
  const [currency, setCurrency] = useState<"USD" | "LBP">("USD");
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
    // The server can't be trusted to know the shop's timezone (web runs on a
    // UTC Fly machine, the shop is Beirut UTC+3) — send the browser's own
    // calendar day so a voucher's pending/expired status is never up to 3h
    // out of step with the shop.
    const result = await api.vouchers.getAll(undefined, localDay());
    if (result.success) {
      setVouchers(result.vouchers ?? []);
    } else {
      setListError(result.error ?? t("page.loadFailed"));
    }
    setLoading(false);
  }, [api]);

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
        const results = await api.getClients(clientQuery);
        setClientResults(results.slice(0, 8) as ClientLite[]);
        setShowResults(true);
      } catch {
        setClientResults([]);
      }
    }, 250);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [clientQuery, api]);

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
    setCurrency("USD");
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
    if (!name)
      return { ok: false, error: t("form.errNameOrClient") };
    if (!phone)
      return { ok: false, error: t("form.errPhone") };

    const created = await api.createClient({
      full_name: name,
      phone_number: phone,
      whatsapp_opt_in: 1,
    });
    if (created.success && created.id) {
      return { ok: true, clientId: created.id };
    }

    // Phone may already belong to a client — reuse it instead of failing
    const matches = await api.getClients(phone);
    const existing = matches.find((c) => c.phone_number === phone);
    if (existing) return { ok: true, clientId: existing.id };

    return {
      ok: false,
      error: created.error ?? t("form.errCreateClient"),
    };
  };

  const handleSubmit = async () => {
    setFormError(null);
    const amountVal = parseFloat(amount);
    if (!amountVal || amountVal <= 0) {
      setFormError(t("form.errAmount"));
      return;
    }

    setSubmitting(true);
    try {
      const resolved = await resolveClientId();
      if (!resolved.ok) {
        setFormError(resolved.error);
        return;
      }

      const result = await api.vouchers.create({
        clientId: resolved.clientId,
        amount: amountVal,
        currency,
        expiryDate: expiryDate || null,
        note: note.trim() || null,
      });

      if (result.success && result.voucher) {
        setCreatedVoucher(result.voucher);
        resetForm();
        loadVouchers();
      } else {
        setFormError(result.error ?? t("form.errCreate"));
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleCancel = async (voucher: Voucher) => {
    const amtLabel = formatVoucherAmount(voucher);
    if (
      !window.confirm(
        t("list.cancelConfirm", { code: voucher.code, amount: amtLabel }),
      )
    ) {
      return;
    }
    const result = await api.vouchers.cancel(voucher.id);
    if (result.success) {
      loadVouchers();
    } else {
      alert(result.error ?? t("list.cancelFailed"));
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

  const filteredVouchers =
    statusFilter === "all"
      ? vouchers
      : vouchers.filter((v) => v.status === statusFilter);

  return (
    <div className="h-full p-6 overflow-auto">
      <div className="mb-6">
        <PageHeader title={t("page.title")} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* ─── Create form ─── */}
        <div className="lg:col-span-1">
          <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-5">
            <h2 className="text-lg font-semibold text-white mb-4">
              {t("form.title")}
            </h2>

            {createdVoucher && (
              <div className="mb-4 p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/30">
                <p className="text-xs text-emerald-300 mb-1">
                  {t("form.createdFor", {
                    name: createdVoucher.client_name,
                  })}
                </p>
                <div className="flex items-center gap-2">
                  <Ltr className="text-xl font-mono font-bold text-white tracking-wider">
                    {createdVoucher.code}
                  </Ltr>
                  <button
                    type="button"
                    onClick={() => copyCode(createdVoucher.code)}
                    className="p-1.5 rounded-md text-emerald-300 hover:bg-emerald-500/20 transition-colors"
                    title={t("list.copyCode")}
                  >
                    {copied ? <Check size={16} /> : <Copy size={16} />}
                  </button>
                </div>
                <p className="text-sm text-emerald-200 mt-1">
                  <Ltr>{formatVoucherAmount(createdVoucher)}</Ltr>
                  {" · "}
                  {createdVoucher.expiry_date
                    ? t("list.expires", { date: createdVoucher.expiry_date })
                    : t("list.noExpiry")}
                </p>
              </div>
            )}

            {/* Client — search existing or create new */}
            <div className="mb-3 relative">
              <label className="text-xs text-slate-400 block mb-1">
                {t("form.client")}
              </label>
              {selectedClient ? (
                <div className="flex items-center justify-between bg-slate-900 border border-slate-600 rounded-lg px-3 py-2">
                  <div>
                    <p className="text-sm text-white">
                      {selectedClient.full_name}
                    </p>
                    {selectedClient.phone_number && (
                      <p className="text-xs text-slate-400">
                        <Ltr>{selectedClient.phone_number}</Ltr>
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
                    <Search className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                    <input
                      type="text"
                      value={clientQuery}
                      onChange={(e) => setClientQuery(e.target.value)}
                      onFocus={() =>
                        clientResults.length && setShowResults(true)
                      }
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg ps-9 pe-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                      placeholder={t("form.clientPlaceholder")}
                    />
                    {showResults && clientResults.length > 0 && (
                      <div className="absolute z-10 mt-1 w-full bg-slate-900 border border-slate-600 rounded-lg shadow-xl max-h-56 overflow-auto">
                        {clientResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => selectClient(c)}
                            className="w-full text-start px-3 py-2 hover:bg-slate-700/60 transition-colors"
                          >
                            <p className="text-sm text-white">{c.full_name}</p>
                            {c.phone_number && (
                              <p className="text-xs text-slate-400">
                                <Ltr>{c.phone_number}</Ltr>
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
                    placeholder={t("form.phonePlaceholder")}
                  />
                  {clientQuery.trim() && clientResults.length === 0 && (
                    <p className="text-[11px] text-slate-500">
                      {t("form.newClientHint")}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Amount + currency toggle */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-slate-400">
                  {t("form.amount")}
                </label>
                <div className="flex items-center gap-1 bg-slate-900 rounded-lg border border-slate-600 p-0.5">
                  {(["USD", "LBP"] as const).map((cur) => (
                    <button
                      key={cur}
                      type="button"
                      onClick={() => {
                        if (cur === currency) return;
                        setCurrency(cur);
                        setAmount("");
                      }}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                        currency === cur
                          ? "bg-violet-600 text-white"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {cur}
                    </button>
                  ))}
                </div>
              </div>
              <div className="relative">
                {currency === "USD" && (
                  <span className="absolute start-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                    $
                  </span>
                )}
                <DecimalInput
                  value={parseFloat(amount) || 0}
                  onChange={(n) => setAmount(n ? String(n) : "")}
                  className={`w-full bg-slate-900 border border-slate-600 rounded-lg ${currency === "USD" ? "ps-7" : "ps-3"} pe-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500`}
                  placeholder={currency === "USD" ? "0.00" : "0"}
                />
              </div>
            </div>

            {/* Expiry */}
            <div className="mb-3">
              <label className="text-xs text-slate-400 block mb-1">
                {t("form.expiry")}
              </label>
              <div className="relative">
                <Calendar className="absolute start-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                <input
                  type="date"
                  value={expiryDate}
                  onChange={(e) => setExpiryDate(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg ps-9 pe-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            {/* Note */}
            <div className="mb-4">
              <label className="text-xs text-slate-400 block mb-1">
                {t("form.note")}
              </label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                placeholder={t("form.notePlaceholder")}
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
                  <Loader2 className="w-4 h-4 animate-spin" /> {t("form.creating")}
                </>
              ) : (
                t("form.title")
              )}
            </button>
          </div>
        </div>

        {/* ─── Voucher list ─── */}
        <div className="lg:col-span-2">
          <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
              <Gift size={14} className="text-amber-400" />
              {t("list.heading", { n: filteredVouchers.length })}
            </h3>

            {/* Status tabs */}
            <div className="flex flex-wrap gap-2 mb-3">
              {STATUS_TABS.map((tab) => {
                const count = vouchers.filter((v) =>
                  tab.key === "all" ? true : v.status === tab.key,
                ).length;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setStatusFilter(tab.key)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      statusFilter === tab.key
                        ? "bg-violet-600 text-white"
                        : "bg-slate-900/60 text-slate-400 border border-slate-700 hover:text-slate-200 hover:border-slate-600"
                    }`}
                  >
                    {t(tab.labelKey)}
                    <span className="ms-1.5 opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Voucher list */}
            {loading ? (
              <div className="py-8 text-center text-sm text-slate-500 flex items-center justify-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin" />{" "}
                {t("common:state.loading")}
              </div>
            ) : listError ? (
              <div className="py-8 text-center text-sm text-red-400">
                {listError}
              </div>
            ) : filteredVouchers.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">
                {t("list.empty")}
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-auto custom-scrollbar">
                {filteredVouchers.map((v) => (
                  <div
                    key={v.id}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-start transition-all hover:bg-slate-700/70 bg-slate-900/50 border border-slate-700/40"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Ltr className="text-sm font-mono font-medium text-white truncate">
                          {v.code}
                        </Ltr>
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded font-medium border capitalize ${STATUS_STYLES[v.status]}`}
                        >
                          {t(`status.${v.status}`)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        {v.client_name && (
                          <span className="text-xs text-slate-500 truncate">
                            {v.client_name}
                          </span>
                        )}
                        <span className="text-[10px] text-slate-600">
                          {v.expiry_date
                            ? t("list.expires", { date: v.expiry_date })
                            : t("list.noExpiry")}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => copyCode(v.code)}
                      className="text-[10px] px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors whitespace-nowrap"
                      title={t("list.copyCode")}
                    >
                      {t("list.copy")}
                    </button>
                    {isAdmin && v.status === "pending" && (
                      <button
                        type="button"
                        onClick={() => handleCancel(v)}
                        className="text-[10px] px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 transition-colors whitespace-nowrap inline-flex items-center gap-1"
                        title={t("list.cancelTitle")}
                      >
                        <Ban size={12} /> {t("common:actions.cancel")}
                      </button>
                    )}
                    <span className="text-xs font-mono text-emerald-400">
                      <Ltr>{formatVoucherAmount(v)}</Ltr>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default VouchersPage;
