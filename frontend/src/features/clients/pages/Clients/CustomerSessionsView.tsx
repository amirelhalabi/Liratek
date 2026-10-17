import { useState, useEffect } from "react";
import {
  X,
  Clock,
  DollarSign,
  ShoppingCart,
  Send,
  Smartphone,
  Wrench,
} from "lucide-react";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { useApi } from "@liratek/ui";
import { useTranslation } from "react-i18next";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import { useFormat } from "@/i18n/useFormat";

interface SessionTransaction {
  id: number;
  session_id: number;
  transaction_type: string;
  transaction_id: number;
  amount_usd: number;
  amount_lbp: number;
  created_at: string;
}

interface SessionWithDetails {
  session: {
    id: number;
    customer_name?: string;
    customer_phone?: string;
    customer_notes?: string;
    started_at: string;
    closed_at?: string;
    started_by: string;
    closed_by?: string;
    is_active: 1 | 0;
  };
  transactions: SessionTransaction[];
  total_usd: number;
  total_lbp: number;
}

interface CustomerSessionsViewProps {
  customerName: string;
  customerPhone?: string;
  onClose: () => void;
}

const TRANSACTION_ICONS: Record<string, any> = {
  SALE: ShoppingCart,
  FINANCIAL_SERVICE: Send,
  RECHARGE: Smartphone,
  MAINTENANCE: Wrench,
  CUSTOM_SERVICE: Wrench,
  EXCHANGE: DollarSign,
};

// Catalog keys, translated at render (a module-level t() would not follow a
// language switch). Unknown types fall back to the stored code.
const TRANSACTION_LABEL_KEYS = {
  SALE: "sessions.type.SALE",
  FINANCIAL_SERVICE: "sessions.type.FINANCIAL_SERVICE",
  RECHARGE: "sessions.type.RECHARGE",
  MAINTENANCE: "sessions.type.MAINTENANCE",
  CUSTOM_SERVICE: "sessions.type.CUSTOM_SERVICE",
  EXCHANGE: "sessions.type.EXCHANGE",
} as const;

export default function CustomerSessionsView({
  customerName,
  customerPhone,
  onClose,
}: CustomerSessionsViewProps) {
  const api = useApi();
  const { t } = useTranslation("clients");
  const fmt = useFormat();
  useModalFocusFix(true);
  const [sessions, setSessions] = useState<SessionWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedSession, setExpandedSession] = useState<number | null>(null);

  useEffect(() => {
    loadSessions();
  }, [customerName, customerPhone]);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const result = await api.session.getByCustomer(
        customerPhone ? { customerName, customerPhone } : { customerName },
      );

      if (result.success && result.sessions) {
        setSessions(result.sessions);
      }
    } catch (error) {
      console.error("Failed to load sessions:", error);
    } finally {
      setLoading(false);
    }
  };

  const toggleExpand = (sessionId: number) => {
    setExpandedSession(expandedSession === sessionId ? null : sessionId);
  };

  const formatDate = (dateString: string) => {
    const date = parseDbDate(dateString);
    return fmt.formatDate(date, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatCurrency = (amount: number, currency: "USD" | "LBP") => {
    if (currency === "USD") {
      return `$${amount.toFixed(2)}`;
    }
    return `${fmt.formatNumber(amount)} LBP`;
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-900 border border-slate-700 rounded-2xl p-8 max-w-2xl w-full">
          <div className="text-center text-slate-400 animate-pulse">
            {t("sessions.loading")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-2xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-slate-700 flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold text-white">
              {t("sessions.title")}
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              {customerName}{" "}
              {customerPhone && (
                <>
                  • <Ltr>{customerPhone}</Ltr>
                </>
              )}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {sessions.length === 0 ? (
            <div className="text-center text-slate-400 py-12">
              <Clock size={48} className="mx-auto mb-4 opacity-50" />
              <p>{t("sessions.empty")}</p>
            </div>
          ) : (
            <div className="space-y-4">
              {sessions.map((sessionData) => (
                <div
                  key={sessionData.session.id}
                  className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden"
                >
                  {/* Session Summary */}
                  <div
                    className="p-4 cursor-pointer hover:bg-slate-750 transition-colors"
                    onClick={() => toggleExpand(sessionData.session.id)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-3 h-3 rounded-full ${
                            sessionData.session.is_active
                              ? "bg-green-500"
                              : "bg-slate-500"
                          }`}
                        />
                        <div>
                          <p className="text-white font-medium">
                            {t("sessions.sessionNo", {
                              id: sessionData.session.id,
                            })}
                          </p>
                          <p className="text-sm text-slate-400">
                            {formatDate(sessionData.session.started_at)}
                            {sessionData.session.closed_at && (
                              <span>
                                {" "}
                                - {formatDate(sessionData.session.closed_at)}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-end">
                          <p className="text-sm text-slate-400">
                            {t("sessions.totalSpent")}
                          </p>
                          <p className="text-lg font-bold text-emerald-400">
                            {formatCurrency(sessionData.total_usd, "USD")}
                          </p>
                          {sessionData.total_lbp > 0 && (
                            <p className="text-sm text-emerald-400">
                              {formatCurrency(sessionData.total_lbp, "LBP")}
                            </p>
                          )}
                        </div>
                        <div
                          className={`transform transition-transform ${
                            expandedSession === sessionData.session.id
                              ? "rotate-180"
                              : ""
                          }`}
                        >
                          <svg
                            className="w-5 h-5 text-slate-400"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 9l-7 7-7-7"
                            />
                          </svg>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Expanded Transactions */}
                  {expandedSession === sessionData.session.id && (
                    <div className="border-t border-slate-700 p-4 bg-slate-850">
                      <h4 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-3">
                        {t("sessions.transactions", {
                          n: sessionData.transactions.length,
                        })}
                      </h4>
                      <div className="space-y-2">
                        {sessionData.transactions.map((txn) => {
                          const Icon =
                            TRANSACTION_ICONS[txn.transaction_type] ||
                            ShoppingCart;
                          const labelKey =
                            TRANSACTION_LABEL_KEYS[
                              txn.transaction_type as keyof typeof TRANSACTION_LABEL_KEYS
                            ];
                          const label = labelKey
                            ? t(labelKey)
                            : txn.transaction_type;

                          return (
                            <div
                              key={txn.id}
                              className="flex items-center justify-between p-3 bg-slate-800 rounded-lg"
                            >
                              <div className="flex items-center gap-3">
                                <div className="p-2 bg-violet-600/20 rounded-lg">
                                  <Icon size={16} className="text-violet-400" />
                                </div>
                                <div>
                                  <p className="text-white text-sm font-medium">
                                    {label} <Ltr>#{txn.transaction_id}</Ltr>
                                  </p>
                                  <p className="text-xs text-slate-400">
                                    {formatDate(txn.created_at)}
                                  </p>
                                </div>
                              </div>
                              <div className="text-end">
                                <p className="text-white font-medium">
                                  {formatCurrency(
                                    Math.abs(txn.amount_usd),
                                    "USD",
                                  )}
                                </p>
                                {txn.amount_lbp !== 0 && (
                                  <p className="text-xs text-slate-400">
                                    {formatCurrency(
                                      Math.abs(txn.amount_lbp),
                                      "LBP",
                                    )}
                                  </p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
