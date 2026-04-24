import { useState, useEffect } from "react";
import { Wallet, X, AlertTriangle, Info } from "lucide-react";

export type TopUpProvider =
  | "MTC"
  | "Alfa"
  | "OMT_APP"
  | "WHISH_APP"
  | "iPick"
  | "Katsh"
  | "BINANCE";

export interface DrawerBalanceWithBalance {
  name: string;
  usdBalance: number;
  lbpBalance: number;
}

export interface TopUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: {
    amount: number;
    currency: "USD" | "LBP";
    sourceDrawer: string;
  }) => void;
  provider: TopUpProvider;
  allDrawers: DrawerBalanceWithBalance[];
  destinationDrawer: string;
  defaultSourceDrawer: string;
}

export default function TopUpModal({
  isOpen,
  onClose,
  onConfirm,
  provider,
  allDrawers,
  destinationDrawer,
  defaultSourceDrawer,
}: TopUpModalProps) {
  // Fix Electron/Windows focus bug: nudge window focus when modal closes
  useEffect(() => {
    if (!isOpen) return;
    const isWindows = navigator.userAgent.includes("Windows");
    if (!isWindows) return;
    return () => {
      try {
        (window as any).api?.display?.fixFocus?.();
      } catch {
        /* ignore */
      }
    };
  }, [isOpen]);

  const [amount, setAmount] = useState<string>("");
  const [currency, setCurrency] = useState<"USD" | "LBP">("USD");
  const [sourceDrawer, setSourceDrawer] = useState<string>(defaultSourceDrawer);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const providerLabels: Record<TopUpProvider, string> = {
    MTC: "MTC",
    Alfa: "Alfa",
    OMT_APP: "OMT App",
    WHISH_APP: "Whish App",
    iPick: "iPick",
    Katsh: "Katsh",
    BINANCE: "Binance",
  };

  const getProviderLabel = () => {
    return providerLabels[provider] || "Provider";
  };

  // Filter out destination drawer from available sources
  const availableDrawers = allDrawers.filter(
    (drawer) => drawer.name !== destinationDrawer,
  );

  // Get source drawer balance
  const sourceDrawerData = availableDrawers.find(
    (d) => d.name === sourceDrawer,
  );
  const sourceBalance =
    currency === "USD"
      ? (sourceDrawerData?.usdBalance ?? 0)
      : (sourceDrawerData?.lbpBalance ?? 0);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setAmount("");
      setCurrency("USD");
      setSourceDrawer(defaultSourceDrawer);
      setIsSubmitting(false);
    }
  }, [isOpen, defaultSourceDrawer]);

  const handleSubmit = async () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert("Please enter a valid amount greater than 0");
      return;
    }
    if (amountNum > sourceBalance) {
      alert("Insufficient balance in source drawer");
      return;
    }

    setIsSubmitting(true);
    try {
      await onConfirm({
        amount: amountNum,
        currency,
        sourceDrawer,
      });
      onClose();
    } catch (error) {
      alert(error instanceof Error ? error.message : "Top-up failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-lg bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Wallet className="text-slate-400" size={18} />
            Top Up {getProviderLabel()} Drawer
          </h2>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-5">
          {/* Currency Selector */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">
              Currency
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setCurrency("USD")}
                disabled={isSubmitting}
                className={`flex-1 px-3 py-2 rounded-lg font-medium transition-all text-sm ${
                  currency === "USD"
                    ? "bg-violet-600 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                } disabled:opacity-50`}
              >
                USD
              </button>
              <button
                type="button"
                onClick={() => setCurrency("LBP")}
                disabled={isSubmitting}
                className={`flex-1 px-3 py-2 rounded-lg font-medium transition-all text-sm ${
                  currency === "LBP"
                    ? "bg-violet-600 text-white"
                    : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                } disabled:opacity-50`}
              >
                LBP
              </button>
            </div>
          </div>

          {/* Amount Input */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">
              Amount
            </label>
            <div className="relative">
              <input
                type="number"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                min="0"
                step="0.01"
                disabled={isSubmitting}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white text-lg font-mono focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 disabled:opacity-50"
                autoFocus
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                {currency}
              </span>
            </div>
            {amount && parseFloat(amount) > sourceBalance && (
              <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                <AlertTriangle size={12} />
                Amount exceeds source drawer balance
              </p>
            )}
          </div>

          {/* Source Drawer Selector */}
          <div>
            <label className="block text-sm font-medium text-slate-400 mb-2">
              From Drawer
            </label>
            <select
              value={sourceDrawer}
              onChange={(e) => setSourceDrawer(e.target.value)}
              disabled={isSubmitting}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 disabled:opacity-50"
            >
              {availableDrawers.map((drawer) => (
                <option key={drawer.name} value={drawer.name}>
                  {drawer.name}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500 mt-1">
              Selected drawer balance:{" "}
              <span className="text-white font-medium">
                {currency === "USD"
                  ? `$${sourceBalance.toFixed(2)}`
                  : `${sourceBalance.toLocaleString()} LBP`}
              </span>
            </p>
          </div>

          {/* Info Alert */}
          <div>
            <div className="p-2 rounded bg-slate-800/50 border border-slate-700">
              <div className="flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
                <p className="text-[10px] leading-tight text-slate-400">
                  Transfer funds to your {getProviderLabel()} drawer. No fees.
                </p>
              </div>
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 px-4 py-2.5 border border-slate-600 text-slate-300 hover:bg-slate-800 rounded-lg transition-colors font-medium text-sm disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={
                isSubmitting ||
                !amount ||
                parseFloat(amount) <= 0 ||
                parseFloat(amount) > sourceBalance
              }
              className="flex-1 px-4 py-2.5 bg-violet-600 hover:bg-violet-500 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-violet-500/20"
            >
              {isSubmitting ? "Processing..." : "Confirm Top-Up"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
