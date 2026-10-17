import { useState } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "@liratek/ui/i18n/format";
import { appEvents, useApi, Select } from "@liratek/ui";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import {
  Wallet,
  TrendingDown,
  TrendingUp,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";

interface UnsettledCheckpoint {
  id: number;
}

interface SettlementDrawerIntegrationProps {
  unsettledCheckpoints: UnsettledCheckpoint[];
  ourData: {
    totalSales: number;
    totalCommission: number;
    totalPrizes: number;
    shopPaysSupplier: number;
    supplierPaysShop: number;
    netSettlement: number;
  };
  lotoGuyClaims: {
    totalSales: string;
    totalCommission: string;
    totalPrizes: string;
  };
  onSettlementComplete?: () => void;
  onClose?: () => void;
}

export function SettlementDrawerIntegration({
  unsettledCheckpoints,
  ourData: _ourData,
  lotoGuyClaims,
  onSettlementComplete,
  onClose,
}: SettlementDrawerIntegrationProps) {
  const api = useApi();
  const { t } = useTranslation("loto");
  const { t: tc } = useTranslation("common");
  const { methods } = usePaymentMethods();
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<string>("CASH");
  const [drawerName, setDrawerName] = useState<string>("Loto");

  // Calculate settlement amounts based on claims
  const claimedTotalSales = parseFloat(lotoGuyClaims.totalSales) || 0;
  const claimedTotalCommission = parseFloat(lotoGuyClaims.totalCommission) || 0;
  const claimedNetSettlement = claimedTotalCommission - claimedTotalSales;

  // Determine if we pay the supplier or the supplier pays us
  const weOweSupplier = claimedNetSettlement < 0;

  async function handleSettlement() {
    setIsProcessing(true);
    setError(null);

    try {
      const checkpointIds = unsettledCheckpoints.map((cp) => cp.id);

      const baseArgs = {
        checkpointIds,
        totalSales: claimedTotalSales,
        totalCommission: claimedTotalCommission,
        settledAt: new Date().toISOString(),
      };
      const result = await api.loto.checkpoint.settleBatch(
        claimedNetSettlement !== 0
          ? {
              ...baseArgs,
              payment: {
                method: paymentMethod,
                drawer_name: drawerName,
                currency_code: "LBP",
                amount: claimedNetSettlement,
              },
            }
          : baseArgs,
      );

      if (!result.success) throw new Error(result.error ?? t("drawerSettle.failed"));

      appEvents.emit(
        "notification:show",
        t("drawerSettle.completedToast"),
        "success",
      );
      setSuccess(true);
      setTimeout(() => {
        onSettlementComplete?.();
      }, 1500);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : t("settle.failedComplete"),
      );
    } finally {
      setIsProcessing(false);
    }
  }

  if (success) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-md">
          <div className="p-6">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-8 h-8 text-green-500" />
              <div>
                <h3 className="text-xl font-bold text-white">
                  {t("drawerSettle.completeTitle")}
                </h3>
                <p className="text-slate-300 mt-2">
                  {t("drawerSettle.completeBody")}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-2xl">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <Wallet className="w-5 h-5 text-blue-500" />
              {t("drawerSettle.title")}
            </h3>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-white transition-colors"
              disabled={isProcessing}
            >
              ✕
            </button>
          </div>

          {error && (
            <div className="bg-red-900/50 border border-red-700 text-red-300 p-4 rounded-lg mb-6 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 mt-0.5 flex-shrink-0" />
              <div>
                <strong>{t("settle.errorLabel")}</strong> {error}
              </div>
            </div>
          )}

          {/* Settlement Summary */}
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-700 mb-6">
            <h4 className="text-lg font-semibold text-white mb-4">
              {t("drawerSettle.summary")}
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="flex items-center justify-between p-3 bg-slate-800 rounded-lg">
                <div className="flex items-center gap-2">
                  <TrendingDown className="w-5 h-5 text-red-400" />
                  <span className="text-slate-300">{t("drawerSettle.weOwe")}</span>
                </div>
                <span className="text-lg font-bold text-red-400">
                  {formatNumber(claimedTotalSales)} LBP
                </span>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-800 rounded-lg">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-400" />
                  <span className="text-slate-300">{t("drawerSettle.weEarn")}</span>
                </div>
                <span className="text-lg font-bold text-green-400">
                  {formatNumber(claimedTotalCommission)} LBP
                </span>
              </div>
            </div>

            <div className="border-t border-slate-700 pt-4 mt-4">
              <div className="flex justify-between items-center">
                <span className="text-lg text-slate-300">{t("drawerSettle.net")}</span>
                <span
                  className={`text-2xl font-bold ${
                    claimedNetSettlement >= 0
                      ? "text-green-400"
                      : "text-red-400"
                  }`}
                >
                  {claimedNetSettlement >= 0 ? "+" : ""}
                  {formatNumber(claimedNetSettlement)} LBP
                </span>
              </div>
              <p className="text-sm text-slate-400 mt-2 text-center">
                {weOweSupplier
                  ? t("drawerSettle.weOweHint")
                  : t("drawerSettle.theyOweHint")}
              </p>
            </div>
          </div>

          {/* Drawer Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              {t("drawerSettle.methodAndDrawer")}
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {t("drawerSettle.method")}
                </label>
                <Select
                  value={paymentMethod}
                  onChange={(v) => setPaymentMethod(v)}
                  options={methods.map((m) => ({
                    value: m.code,
                    label: m.label,
                  }))}
                  buttonClassName="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isProcessing}
                />
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  {t("drawerSettle.drawer")}
                </label>
                <Select
                  value={drawerName}
                  onChange={(v) => setDrawerName(v)}
                  options={[
                    { value: "Loto", label: t("drawerSettle.drawerLoto") },
                    { value: "General", label: t("drawerSettle.drawerGeneral") },
                    { value: "OMT_System", label: t("drawerSettle.drawerOmt") },
                  ]}
                  buttonClassName="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isProcessing}
                />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={onClose}
              disabled={isProcessing}
              className="flex-1 py-3 px-4 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 text-white rounded-lg transition-colors"
            >
              {tc("actions.cancel")}
            </button>
            <button
              onClick={handleSettlement}
              disabled={isProcessing}
              className="flex-1 py-3 px-4 bg-green-600 hover:bg-green-700 disabled:bg-green-800 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isProcessing ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  {t("settle.processing")}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5" />
                  <span>{t("drawerSettle.complete")}</span>
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
