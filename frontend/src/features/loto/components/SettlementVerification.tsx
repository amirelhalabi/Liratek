import { useState, useEffect } from "react";
import { useApi, MultiPaymentInput, type PaymentLine } from "@liratek/ui";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { getExchangeRates } from "@/utils/exchangeRates";
import {
  Calculator,
  CheckCircle,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface SettlementVerificationProps {
  onSettlementComplete?: () => void;
}

interface UnsettledCheckpoint {
  id: number;
  checkpoint_date: string;
  period_start: string;
  period_end: string;
  total_sales: number;
  total_commission: number;
  total_tickets: number;
  total_prizes: number;
  total_cash_prizes: number;
  total_cash_prizes_count: number;
  is_settled: number;
}

interface CheckpointBreakdown {
  sales: number;
  commission: number;
  cashPrizes: number;
  cashPrizesCount: number;
  weOweLoto: number;
  lotoOwesUs: number;
  net: number;
}

interface UncheckedActivity {
  sales: number;
  commission: number;
  cashPrizes: number;
  cashPrizesCount: number;
  ticketsCount: number;
  net: number;
}

export function SettlementVerification({
  onSettlementComplete,
}: SettlementVerificationProps) {
  const api = useApi();
  const { methods } = usePaymentMethods();
  const [exchangeRate, setExchangeRate] = useState(90000);
  const [showDialog, setShowDialog] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unsettledCheckpoints, setUnsettledCheckpoints] = useState<
    UnsettledCheckpoint[]
  >([]);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [breakdowns, setBreakdowns] = useState<
    Map<number, CheckpointBreakdown>
  >(new Map());
  const [uncheckedActivity, setUncheckedActivity] =
    useState<UncheckedActivity | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [settlementSuccess, setSettlementSuccess] = useState(false);
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([]);

  // Load exchange rate
  useEffect(() => {
    (async () => {
      try {
        const getRatesApi = (api as any)?.getRates;
        if (!getRatesApi) return;
        const ratesList = await getRatesApi();
        const { sellRate } = getExchangeRates(ratesList);
        setExchangeRate(sellRate);
      } catch {
        // silent
      }
    })();
  }, []);

  useEffect(() => {
    if (showDialog) {
      loadSettlementData();
    }
  }, [showDialog]);

  async function loadSettlementData() {
    try {
      setIsLoading(true);
      setError(null);

      const checkpointsResult = await api.loto.checkpoint.getUnsettled();
      if (!checkpointsResult.success) {
        throw new Error(
          checkpointsResult.error || "Failed to get unsettled checkpoints",
        );
      }

      const checkpoints = checkpointsResult.checkpoints || [];
      setUnsettledCheckpoints(checkpoints);

      // Calculate breakdown for each checkpoint (cash prizes now per-checkpoint)
      const breakdownMap = new Map<number, CheckpointBreakdown>();
      for (const cp of checkpoints) {
        const weOweLoto = cp.total_sales - cp.total_commission;
        const lotoOwesUs = cp.total_cash_prizes || 0;
        const net = lotoOwesUs - weOweLoto;
        breakdownMap.set(cp.id, {
          sales: cp.total_sales,
          commission: cp.total_commission,
          cashPrizes: cp.total_cash_prizes || 0,
          cashPrizesCount: cp.total_cash_prizes_count || 0,
          weOweLoto,
          lotoOwesUs,
          net,
        });
      }
      setBreakdowns(breakdownMap);

      // Calculate unchecked activity (sales not in any checkpoint)
      try {
        const today = new Date().toISOString().split("T")[0];
        let periodStart = "1970-01-01";

        // Use the latest checkpoint (settled OR unsettled) to determine period start
        const lastResult = await api.loto.checkpoint.getLast();
        if (lastResult.success && lastResult.checkpoint) {
          const nextDay = new Date(lastResult.checkpoint.period_end);
          nextDay.setDate(nextDay.getDate() + 1);
          periodStart = nextDay.toISOString().split("T")[0];
        }

        // Get sales after the last checkpoint period
        const ticketsResult = await api.loto.getByDateRange(periodStart, today);
        const tickets = ticketsResult.tickets || [];

        const sales = tickets.reduce((sum, t) => sum + t.sale_amount, 0);
        const commission = tickets.reduce(
          (sum, t) => sum + t.commission_amount,
          0,
        );

        // Unchecked activity: tickets + unassigned cash prizes (no checkpoint yet)
        const unreimbursedResult = await api.loto.cashPrize.getUnreimbursed();
        const unassignedPrizes =
          unreimbursedResult.success && unreimbursedResult.prizes
            ? unreimbursedResult.prizes.filter(
                (p: { checkpoint_id?: number | null }) => !p.checkpoint_id,
              )
            : [];
        const cashPrizesTotal = unassignedPrizes.reduce(
          (sum: number, p: { prize_amount: number }) => sum + p.prize_amount,
          0,
        );

        const weOweLoto = sales - commission;
        const net = cashPrizesTotal - weOweLoto;

        if (tickets.length > 0 || unassignedPrizes.length > 0) {
          setUncheckedActivity({
            sales,
            commission,
            cashPrizes: cashPrizesTotal,
            cashPrizesCount: unassignedPrizes.length,
            ticketsCount: tickets.length,
            net,
          });
        }
      } catch {
        // Ignore errors in unchecked activity calculation
      }
    } catch (err) {
      console.error("Error loading settlement data:", err);
      setError(
        err instanceof Error ? err.message : "Failed to load settlement data",
      );
    } finally {
      setIsLoading(false);
    }
  }

  function openDialog() {
    setShowDialog(true);
  }

  function closeDialog() {
    setShowDialog(false);
    setError(null);
    setSettlementSuccess(false);
    setExpandedId(null);
  }

  function toggleExpand(id: number) {
    setExpandedId(expandedId === id ? null : id);
  }

  async function handleSettle() {
    setIsProcessing(true);
    setError(null);

    try {
      const today = new Date().toISOString().split("T")[0];

      // Build payments array from payment lines
      // Net > 0 = LOTO pays us (positive drawer credit)
      // Net < 0 = we pay LOTO (negative drawer debit)
      const totals = calculateTotals();
      const sign = totals.net >= 0 ? 1 : -1;
      const paymentsPayload = paymentLines.map((p) => ({
        method: p.method,
        currency_code: p.currencyCode,
        amount: sign * Math.abs(p.amount),
      }));

      // If there's unchecked activity but no checkpoints, create a checkpoint first
      if (unsettledCheckpoints.length === 0 && uncheckedActivity) {
        try {
          const checkpointResult =
            await api.loto.checkpoint.createScheduled(today);
          if (checkpointResult.success && checkpointResult.checkpoint) {
            // Now settle the newly created checkpoint
            const newCheckpoint = checkpointResult.checkpoint;
            const settleResult = await api.loto.checkpoint.settle({
              id: newCheckpoint.id,
              totalSales: newCheckpoint.total_sales,
              totalCommission: newCheckpoint.total_commission,
              totalPrizes: newCheckpoint.total_prizes,
              payments: paymentsPayload,
            });
            if (!settleResult.success) {
              throw new Error(
                settleResult.error || "Failed to settle checkpoint",
              );
            }
          }
        } catch (checkpointErr) {
          console.error("Failed to create checkpoint:", checkpointErr);
          throw new Error("Failed to create checkpoint for unchecked activity");
        }
      } else {
        // Settle all existing checkpoints
        for (const checkpoint of unsettledCheckpoints) {
          const result = await api.loto.checkpoint.settle({
            id: checkpoint.id,
            totalSales: checkpoint.total_sales,
            totalCommission: checkpoint.total_commission,
            totalPrizes: checkpoint.total_prizes,
            payments: paymentsPayload,
          });
          if (!result.success) {
            throw new Error(
              result.error || `Failed to settle checkpoint #${checkpoint.id}`,
            );
          }
        }
      }

      // Cash prizes are now automatically marked as reimbursed by the backend
      // during settleCheckpoint() — no separate loop needed

      setSettlementSuccess(true);

      if (onSettlementComplete) {
        setTimeout(() => {
          onSettlementComplete();
        }, 2000);
      }

      setTimeout(() => {
        closeDialog();
      }, 3000);
    } catch (err) {
      console.error("Error during settlement:", err);
      setError(
        err instanceof Error ? err.message : "Failed to complete settlement",
      );
    } finally {
      setIsProcessing(false);
    }
  }

  // Calculate totals across all checkpoints
  function calculateTotals() {
    const totalSales = unsettledCheckpoints.reduce(
      (sum, cp) => sum + cp.total_sales,
      0,
    );
    const totalCommission = unsettledCheckpoints.reduce(
      (sum, cp) => sum + cp.total_commission,
      0,
    );
    const totalCashPrizes = unsettledCheckpoints.reduce(
      (sum, cp) => sum + (cp.total_cash_prizes || 0),
      0,
    );
    const weOweLoto = totalSales - totalCommission;
    const net = totalCashPrizes - weOweLoto;
    return { totalSales, totalCommission, totalCashPrizes, weOweLoto, net };
  }

  if (!showDialog) {
    return (
      <button
        onClick={openDialog}
        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors flex items-center gap-2"
      >
        <Calculator className="w-4 h-4" />
        Settle
      </button>
    );
  }

  if (settlementSuccess) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-md">
          <div className="p-6">
            <div className="flex items-center gap-3">
              <CheckCircle className="w-8 h-8 text-green-500" />
              <div>
                <h3 className="text-xl font-bold text-white">
                  Settlement Successful!
                </h3>
                <p className="text-slate-300 mt-2">
                  All checkpoints have been settled successfully.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const totals = calculateTotals();

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-800 rounded-xl border border-slate-700 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="text-xl font-bold text-white flex items-center gap-2">
              <Calculator className="w-5 h-5 text-blue-500" />
              Settle Checkpoints
            </h3>
            <button
              onClick={closeDialog}
              className="text-slate-400 hover:text-white transition-colors"
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

          {isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
              <span className="ml-3 text-slate-300">
                Loading checkpoints...
              </span>
            </div>
          ) : unsettledCheckpoints.length === 0 && !uncheckedActivity ? (
            <div className="text-center py-8 text-slate-400">
              <CheckCircle className="w-12 h-12 mx-auto mb-3 text-green-500" />
              <p className="text-lg font-medium">All Caught Up!</p>
              <p className="text-sm mt-1">No unsettled checkpoints found.</p>
            </div>
          ) : (
            <>
              {/* Checkpoint List */}
              {unsettledCheckpoints.some(
                (cp) => cp.total_tickets > 0 || cp.total_sales > 0,
              ) && (
                <div className="space-y-3 mb-6">
                  <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wide">
                    Checkpoint Details
                  </h4>

                  {unsettledCheckpoints
                    .filter((cp) => cp.total_tickets > 0 || cp.total_sales > 0)
                    .map((checkpoint) => {
                      const isExpanded = expandedId === checkpoint.id;
                      const breakdown = breakdowns.get(checkpoint.id);

                      return (
                        <div
                          key={checkpoint.id}
                          className="border border-slate-700 rounded-lg overflow-hidden"
                        >
                          {/* Checkpoint Header (Clickable) */}
                          <button
                            onClick={() => toggleExpand(checkpoint.id)}
                            className={`w-full p-4 transition-colors ${
                              isExpanded
                                ? "bg-blue-900/30 border-b border-slate-700"
                                : "bg-slate-900/50 hover:bg-slate-900"
                            }`}
                          >
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-3">
                                <div
                                  className={`w-10 h-10 rounded-full flex items-center justify-center ${
                                    isExpanded ? "bg-blue-600" : "bg-slate-700"
                                  }`}
                                >
                                  <Calculator
                                    className={`w-5 h-5 ${
                                      isExpanded
                                        ? "text-white"
                                        : "text-slate-400"
                                    }`}
                                  />
                                </div>
                                <div className="text-left">
                                  <p className="text-sm font-semibold text-white">
                                    {new Date(
                                      checkpoint.checkpoint_date,
                                    ).toLocaleDateString("en-US", {
                                      weekday: "short",
                                      month: "short",
                                      day: "numeric",
                                      year: "numeric",
                                    })}
                                  </p>
                                  <p className="text-xs text-slate-400">
                                    {checkpoint.total_tickets} tickets •{" "}
                                    {checkpoint.total_sales.toLocaleString()}{" "}
                                    LBP
                                    {(checkpoint.total_cash_prizes_count || 0) >
                                      0 &&
                                      ` • ${checkpoint.total_cash_prizes_count} cash prize${checkpoint.total_cash_prizes_count !== 1 ? "s" : ""}`}
                                  </p>
                                </div>
                              </div>
                              {isExpanded ? (
                                <ChevronUp className="w-5 h-5 text-blue-400" />
                              ) : (
                                <ChevronDown className="w-5 h-5 text-slate-400" />
                              )}
                            </div>

                            {/* Settlement Hint - Always Visible */}
                            {breakdown && (
                              <div
                                className={`px-3 py-2 rounded-lg flex items-center justify-between ${
                                  breakdown.net >= 0
                                    ? "bg-green-900/30 border border-green-700/50"
                                    : "bg-red-900/30 border border-red-700/50"
                                }`}
                              >
                                <span
                                  className={`text-xs font-medium ${
                                    breakdown.net >= 0
                                      ? "text-green-400"
                                      : "text-red-400"
                                  }`}
                                >
                                  Net
                                </span>
                                <span
                                  className={`text-sm font-bold ${
                                    breakdown.net >= 0
                                      ? "text-green-400"
                                      : "text-red-400"
                                  }`}
                                >
                                  {Math.abs(breakdown.net).toLocaleString()} LBP
                                </span>
                              </div>
                            )}
                          </button>

                          {/* Expanded Breakdown */}
                          {isExpanded && breakdown && (
                            <div className="bg-slate-900/50 p-4">
                              <h5 className="text-sm font-semibold text-white mb-4">
                                How it's calculated
                              </h5>

                              {/* Money Flow */}
                              <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm text-slate-400">
                                    Sales collected
                                  </span>
                                  <span className="text-sm font-bold text-green-400">
                                    +{breakdown.sales.toLocaleString()} LBP
                                  </span>
                                </div>

                                <div className="flex items-center justify-between">
                                  <span className="text-sm text-slate-400">
                                    We keep (commission)
                                  </span>
                                  <span className="text-sm font-bold text-blue-400">
                                    +{breakdown.commission.toLocaleString()} LBP
                                  </span>
                                </div>

                                <div className="flex items-center justify-between pt-2 border-t border-slate-700">
                                  <span className="text-sm text-slate-400">
                                    We owe LOTO
                                  </span>
                                  <span className="text-sm font-bold text-red-400">
                                    {breakdown.weOweLoto.toLocaleString()} LBP
                                  </span>
                                </div>

                                {breakdown.cashPrizes > 0 && (
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm text-slate-400">
                                      LOTO owes us (cash prizes ×{" "}
                                      {breakdown.cashPrizesCount})
                                    </span>
                                    <span className="text-sm font-bold text-yellow-400">
                                      +{breakdown.cashPrizes.toLocaleString()}{" "}
                                      LBP
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}

              {/* Unchecked Activity */}
              {uncheckedActivity && (
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
                    Unchecked Activity
                  </h4>
                  <div className="bg-amber-900/20 border border-amber-700/50 rounded-lg overflow-hidden">
                    <div className="p-4">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-full bg-amber-900/50 flex items-center justify-center">
                            <AlertTriangle className="w-5 h-5 text-amber-400" />
                          </div>
                          <div>
                            <p className="text-sm font-semibold text-white">
                              Sales Without Checkpoint
                            </p>
                            <p className="text-xs text-slate-400">
                              {uncheckedActivity.ticketsCount} ticket
                              {uncheckedActivity.ticketsCount !== 1 ? "s" : ""}
                              {uncheckedActivity.cashPrizesCount > 0 &&
                                ` • ${uncheckedActivity.cashPrizesCount} cash prize${uncheckedActivity.cashPrizesCount !== 1 ? "s" : ""}`}
                            </p>
                          </div>
                        </div>
                        <div
                          className={`text-right px-3 py-2 rounded-lg ${
                            uncheckedActivity.net >= 0
                              ? "bg-green-900/30 border border-green-700/50"
                              : "bg-red-900/30 border border-red-700/50"
                          }`}
                        >
                          <p
                            className={`text-xs font-medium ${
                              uncheckedActivity.net >= 0
                                ? "text-green-400"
                                : "text-red-400"
                            }`}
                          >
                            {uncheckedActivity.net >= 0
                              ? "LOTO pays us"
                              : "We pay LOTO"}
                          </p>
                          <p
                            className={`text-sm font-bold ${
                              uncheckedActivity.net >= 0
                                ? "text-green-400"
                                : "text-red-400"
                            }`}
                          >
                            {Math.abs(uncheckedActivity.net).toLocaleString()}{" "}
                            LBP
                          </p>
                        </div>
                      </div>

                      {/* Details */}
                      <div className="grid grid-cols-3 gap-3 text-xs mb-4">
                        <div>
                          <span className="text-slate-400">Sales:</span>{" "}
                          <span className="text-green-400 font-medium">
                            {uncheckedActivity.sales.toLocaleString()} LBP
                          </span>
                        </div>
                        <div>
                          <span className="text-slate-400">Commission:</span>{" "}
                          <span className="text-blue-400 font-medium">
                            {uncheckedActivity.commission.toLocaleString()} LBP
                          </span>
                        </div>
                        {uncheckedActivity.cashPrizes > 0 && (
                          <div>
                            <span className="text-slate-400">Cash Prizes:</span>{" "}
                            <span className="text-yellow-400 font-medium">
                              {uncheckedActivity.cashPrizes.toLocaleString()}{" "}
                              LBP
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Create Checkpoint Button */}
                      <button
                        onClick={async () => {
                          try {
                            const today = new Date()
                              .toISOString()
                              .split("T")[0];
                            const result =
                              await api.loto.checkpoint.createScheduled(today);
                            if (result.success) {
                              // Reload data
                              loadSettlementData();
                            } else {
                              alert(
                                "Failed to create checkpoint: " + result.error,
                              );
                            }
                          } catch (err) {
                            alert(
                              "Failed to create checkpoint: " +
                                (err instanceof Error
                                  ? err.message
                                  : "Unknown error"),
                            );
                          }
                        }}
                        className="w-full py-2 px-4 bg-amber-600 hover:bg-amber-700 text-white rounded-lg transition-colors flex items-center justify-center gap-2 text-sm"
                      >
                        <Calculator className="w-4 h-4" />
                        Create Checkpoint for These Sales
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* Payment Method Selection */}
              <div className="mb-6">
                <h4 className="text-sm font-semibold text-slate-400 uppercase tracking-wide mb-3">
                  Payment Method
                </h4>
                <div className="bg-slate-900/50 border border-slate-700 rounded-lg p-4">
                  <p className="text-xs text-slate-400 mb-3">
                    {totals.net >= 0
                      ? "How LOTO pays you:"
                      : "How you pay LOTO:"}
                  </p>
                  <MultiPaymentInput
                    totalAmount={Math.abs(totals.net)}
                    totalAmountCurrency="LBP"
                    currency="LBP"
                    onChange={setPaymentLines}
                    showPmFee={false}
                    paymentMethods={methods}
                    currencies={[
                      { code: "USD", symbol: "$" },
                      { code: "LBP", symbol: "LBP" },
                    ]}
                    exchangeRate={exchangeRate}
                  />
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-3 pt-4 border-t border-slate-700">
                <button
                  onClick={closeDialog}
                  disabled={isProcessing}
                  className="flex-1 py-3 px-4 bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 text-white rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSettle}
                  disabled={
                    isProcessing ||
                    (unsettledCheckpoints.length === 0 && !uncheckedActivity)
                  }
                  className="flex-1 py-3 px-4 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 text-white rounded-lg transition-colors flex items-center justify-center gap-2"
                >
                  {isProcessing ? (
                    <span className="flex items-center gap-2">
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                      Processing...
                    </span>
                  ) : unsettledCheckpoints.length === 0 && uncheckedActivity ? (
                    <span className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5" />
                      <span>Create Checkpoint & Settle</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <CheckCircle className="w-5 h-5" />
                      <span>Settle All ({unsettledCheckpoints.length})</span>
                    </span>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
