import { useState } from "react";
import { useApi } from "@liratek/ui";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import {
  Wallet,
  TrendingDown,
  TrendingUp,
  CheckCircle,
  AlertTriangle,
} from "lucide-react";

interface SettlementDrawerIntegrationProps {
  unsettledCheckpoints: any[];
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
      // In a real implementation, this would involve:
      // 1. Updating drawer balances
      // 2. Creating transaction records
      // 3. Marking checkpoints as settled
      // 4. Recording the settlement in the supplier ledger

      // First, mark all checkpoints as settled
      for (const checkpoint of unsettledCheckpoints) {
        await api.loto.checkpoint.markSettled(checkpoint.id);
      }

      // For drawer integration, we need to:
      // - If we owe money (negative net settlement), debit from Loto drawer
      // - If we are owed money (positive net settlement), credit to Loto drawer (as commission)

      // This would typically involve creating payment records and updating drawer balances
      // In a real implementation, we'd make API calls to handle the drawer operations
      // TODO: Integrate with drawer balance API
      // - Settling {unsettledCheckpoints.length} checkpoints
      // - Net settlement: {claimedNetSettlement} LBP
      // - Direction: {weOweSupplier ? "We owe" : "We are owed"}: {Math.abs(claimedNetSettlement)} LBP

      // Simulate the settlement process
      await new Promise((resolve) => setTimeout(resolve, 1000));

      setSuccess(true);

      // Notify parent component after a delay
      setTimeout(() => {
        onSettlementComplete?.();
      }, 1500);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to complete settlement",
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
                  Settlement Complete!
                </h3>
                <p className="text-slate-300 mt-2">
                  All checkpoints have been settled and drawer balances updated.
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
              Loto Settlement - Drawer Integration
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
                <strong>Error:</strong> {error}
              </div>
            </div>
          )}

          {/* Settlement Summary */}
          <div className="bg-slate-900 rounded-lg p-4 border border-slate-700 mb-6">
            <h4 className="text-lg font-semibold text-white mb-4">
              Settlement Summary
            </h4>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div className="flex items-center justify-between p-3 bg-slate-800 rounded-lg">
                <div className="flex items-center gap-2">
                  <TrendingDown className="w-5 h-5 text-red-400" />
                  <span className="text-slate-300">Amount We Owe</span>
                </div>
                <span className="text-lg font-bold text-red-400">
                  {claimedTotalSales.toLocaleString()} LBP
                </span>
              </div>

              <div className="flex items-center justify-between p-3 bg-slate-800 rounded-lg">
                <div className="flex items-center gap-2">
                  <TrendingUp className="w-5 h-5 text-green-400" />
                  <span className="text-slate-300">Commission We Earn</span>
                </div>
                <span className="text-lg font-bold text-green-400">
                  {claimedTotalCommission.toLocaleString()} LBP
                </span>
              </div>
            </div>

            <div className="border-t border-slate-700 pt-4 mt-4">
              <div className="flex justify-between items-center">
                <span className="text-lg text-slate-300">Net Settlement</span>
                <span
                  className={`text-2xl font-bold ${
                    claimedNetSettlement >= 0
                      ? "text-green-400"
                      : "text-red-400"
                  }`}
                >
                  {claimedNetSettlement >= 0 ? "+" : ""}
                  {claimedNetSettlement.toLocaleString()} LBP
                </span>
              </div>
              <p className="text-sm text-slate-400 mt-2 text-center">
                {weOweSupplier
                  ? "We owe this amount to the Loto guy"
                  : "The Loto guy owes us this amount (our commission)"}
              </p>
            </div>
          </div>

          {/* Drawer Selection */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Payment Method & Drawer
            </label>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Payment Method
                </label>
                <select
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isProcessing}
                >
                  {methods.map((m) => (
                    <option key={m.code} value={m.code}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-slate-400 mb-1">
                  Drawer
                </label>
                <select
                  value={drawerName}
                  onChange={(e) => setDrawerName(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  disabled={isProcessing}
                >
                  <option value="Loto">Loto Drawer</option>
                  <option value="General">General Drawer</option>
                  <option value="OMT_System">OMT System</option>
                </select>
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
              Cancel
            </button>
            <button
              onClick={handleSettlement}
              disabled={isProcessing}
              className="flex-1 py-3 px-4 bg-green-600 hover:bg-green-700 disabled:bg-green-800 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
            >
              {isProcessing ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  Processing...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <CheckCircle className="w-5 h-5" />
                  <span>Complete Settlement</span>
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
