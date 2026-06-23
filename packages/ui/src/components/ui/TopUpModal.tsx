import { useState, useEffect } from "react";
import type { ReactNode } from "react";
import {
  Wallet,
  X,
  AlertTriangle,
  Info,
  ArrowRightLeft,
  PlusCircle,
  UserRound,
  Users,
} from "lucide-react";

function fmtCommas(value: string): string {
  if (!value) return value;
  const parts = value.split(".");
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return parts.join(".");
}

function isPartialDecimal(value: string): boolean {
  return /^[0-9]*\.?[0-9]*$/.test(value);
}

export type TopUpProvider =
  | "MTC"
  | "Alfa"
  | "OMT_APP"
  | "WHISH_APP"
  | "OMT_SYSTEM"
  | "WHISH_SYSTEM"
  | "iPick"
  | "Katsh";

export type TopUpCurrency = "USD" | "LBP";

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
    currency: TopUpCurrency;
    sourceDrawer: string;
  }) => void;
  /** When provided, shows the External (Cash In) / From Drawer mode toggle */
  onConfirmExternal?: (data: {
    amount: number;
    currency: TopUpCurrency;
  }) => Promise<void>;
  /**
   * When provided for MTC/Alfa, replaces the from-drawer layout with the
   * customer top-up layout: the customer transfers credits to the shop's
   * line and is paid cash out of the General drawer. Amounts are USD only.
   */
  onConfirmCustomer?: (data: {
    creditsAmount: number;
    cashPaid: number;
    cashPaidCurrency: "USD" | "LBP";
  }) => Promise<void>;
  /**
   * When provided for Katsh/iPick, replaces the from-drawer layout with a
   * supplier credit layout: the supplier extends credit, no cash leaves any
   * drawer. The operator settles with the supplier later via the Suppliers page.
   */
  onConfirmSupplier?: (data: {
    amount: number;
    currency: TopUpCurrency;
  }) => Promise<void>;
  /**
   * When provided for WHISH_APP, enables the "Via Partner" sub-mode: the
   * Whish App balance is topped up from a partner's credit line.
   */
  onConfirmPartner?: (data: {
    partnerId: number;
    amount: number;
    currency: TopUpCurrency;
  }) => Promise<void>;
  /**
   * When provided for WHISH_APP, enables the "From Client" sub-mode: a client
   * transfers credits to the shop line, the shop keeps an optional fee and pays
   * out the remainder as cash.
   */
  onConfirmClient?: (data: {
    amount: number;
    cashPaid: number;
    currency: TopUpCurrency;
    clientName?: string;
  }) => Promise<void>;
  /** Rendered inside the modal for the "Via Partner" sub-mode (the page passes a PartnerSelector). */
  partnerSelector?: ReactNode;
  /** The partner id currently selected in `partnerSelector` (the page owns this state). */
  selectedPartnerId?: number | null;
  provider: TopUpProvider;
  allDrawers: DrawerBalanceWithBalance[];
  destinationDrawer: string;
  defaultSourceDrawer: string;
}

export default function TopUpModal({
  isOpen,
  onClose,
  onConfirm,
  onConfirmExternal,
  onConfirmCustomer,
  onConfirmSupplier,
  onConfirmPartner,
  onConfirmClient,
  partnerSelector,
  selectedPartnerId,
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

  // MTC/Alfa credits can't be moved between drawers — they're bought from a
  // customer: credits arrive on the shop line, cash is paid out of General.
  const isCustomerTopUp =
    (provider === "MTC" || provider === "Alfa") && !!onConfirmCustomer;

  // Katsh/iPick: the supplier extends credit — no cash leaves any drawer.
  const isSupplierCredit =
    (provider === "iPick" || provider === "Katsh") && !!onConfirmSupplier;

  // Whish App: top up either from a partner credit line or by buying credits
  // from a client (client transfers credits, shop keeps a fee, pays out cash).
  const isWhishTopUp =
    provider === "WHISH_APP" && (!!onConfirmPartner || !!onConfirmClient);

  const [mode, setMode] = useState<"external" | "from_drawer">(
    onConfirmExternal ? "external" : "from_drawer",
  );
  const [whishMode, setWhishMode] = useState<"partner" | "client">("partner");
  const [amount, setAmount] = useState<string>("");
  const [cashPaid, setCashPaid] = useState<string>("");
  const [cashPaidCurrency, setCashPaidCurrency] = useState<"USD" | "LBP">(
    "USD",
  );
  const [currency, setCurrency] = useState<TopUpCurrency>("USD");
  const [sourceDrawer, setSourceDrawer] = useState<string>(defaultSourceDrawer);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Whish "From Client" fee + optional client name (mirrors OmtWhishAppTransferForm)
  const [manualFee, setManualFee] = useState<string>("");
  const [includingFees, setIncludingFees] = useState<boolean>(false);
  const [clientName, setClientName] = useState<string>("");

  const providerLabels: Record<TopUpProvider, string> = {
    MTC: "MTC",
    Alfa: "Alfa",
    OMT_APP: "OMT App",
    WHISH_APP: "Whish App",
    OMT_SYSTEM: "OMT System",
    WHISH_SYSTEM: "Whish System",
    iPick: "iPick",
    Katsh: "Katsh",
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

  // Customer top-up pays the customer out of the General drawer
  const generalDrawer = allDrawers.find((d) => d.name === "General");
  const generalBalance =
    cashPaidCurrency === "LBP"
      ? (generalDrawer?.lbpBalance ?? 0)
      : (generalDrawer?.usdBalance ?? 0);
  const cashPaidNum = parseFloat(cashPaid) || 0;

  // Whish "From Client" fee math (replicates OmtWhishAppTransferForm RECEIVE):
  // 1% auto fee on USD amounts, overridable by a manual fee. The client
  // transfers `parsedAmount` credits, the shop keeps `providerFee`, and pays
  // out the remainder as cash.
  const whishParsedAmount = parseFloat(amount) || 0;
  const whishAutoFee =
    currency === "USD" && whishParsedAmount > 0 ? whishParsedAmount * 0.01 : 0;
  const whishManualFee = parseFloat(manualFee) || 0;
  const whishProviderFee = whishManualFee > 0 ? whishManualFee : whishAutoFee;
  const whishCashPaid = Math.max(0, whishParsedAmount - whishProviderFee);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      setAmount("");
      setCashPaid("");
      setCashPaidCurrency("USD");
      setCurrency("USD");
      setSourceDrawer(defaultSourceDrawer);
      setIsSubmitting(false);
      setMode(onConfirmExternal ? "external" : "from_drawer");
      setWhishMode("partner");
      setManualFee("");
      setIncludingFees(false);
      setClientName("");
    }
  }, [isOpen, defaultSourceDrawer]);

  const handleSubmit = async () => {
    const amountNum = parseFloat(amount);
    if (isNaN(amountNum) || amountNum <= 0) {
      alert("Please enter a valid amount greater than 0");
      return;
    }

    if (isWhishTopUp) {
      if (whishMode === "partner") {
        if (!onConfirmPartner) return;
        if (!selectedPartnerId) {
          alert("Please select a partner");
          return;
        }
        setIsSubmitting(true);
        try {
          await onConfirmPartner({
            partnerId: selectedPartnerId,
            amount: amountNum,
            currency,
          });
          onClose();
        } catch (error) {
          alert(error instanceof Error ? error.message : "Top-up failed");
        } finally {
          setIsSubmitting(false);
        }
        return;
      }

      // whishMode === "client"
      if (!onConfirmClient) return;
      setIsSubmitting(true);
      try {
        const trimmedClientName = clientName.trim();
        await onConfirmClient({
          amount: amountNum,
          cashPaid: whishCashPaid,
          currency,
          ...(trimmedClientName ? { clientName: trimmedClientName } : {}),
        });
        onClose();
      } catch (error) {
        alert(error instanceof Error ? error.message : "Top-up failed");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (isSupplierCredit && onConfirmSupplier) {
      setIsSubmitting(true);
      try {
        await onConfirmSupplier({ amount: amountNum, currency });
        onClose();
      } catch (error) {
        alert(error instanceof Error ? error.message : "Top-up failed");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (isCustomerTopUp && onConfirmCustomer) {
      const cashNum = parseFloat(cashPaid) || 0;
      if (cashNum < 0) {
        alert("Cash paid cannot be negative");
        return;
      }
      if (cashNum > generalBalance) {
        alert("Insufficient balance in General drawer");
        return;
      }
      setIsSubmitting(true);
      try {
        await onConfirmCustomer({
          creditsAmount: amountNum,
          cashPaid: cashNum,
          cashPaidCurrency,
        });
        onClose();
      } catch (error) {
        alert(error instanceof Error ? error.message : "Top-up failed");
      } finally {
        setIsSubmitting(false);
      }
      return;
    }

    if (mode === "from_drawer" && amountNum > sourceBalance) {
      alert("Insufficient balance in source drawer");
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === "external" && onConfirmExternal) {
        await onConfirmExternal({ amount: amountNum, currency });
      } else {
        await onConfirm({ amount: amountNum, currency, sourceDrawer });
      }
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
          {isWhishTopUp && (
            <>
              {/* Sub-mode toggle: Via Partner / From Client */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setWhishMode("partner")}
                  disabled={isSubmitting || !onConfirmPartner}
                  className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                    whishMode === "partner"
                      ? "bg-violet-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  } disabled:opacity-50`}
                >
                  <Users size={14} />
                  Via Partner
                </button>
                <button
                  type="button"
                  onClick={() => setWhishMode("client")}
                  disabled={isSubmitting || !onConfirmClient}
                  className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                    whishMode === "client"
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  } disabled:opacity-50`}
                >
                  <UserRound size={14} />
                  From Client
                </button>
              </div>

              {/* Currency selector (shared by both whish sub-modes) */}
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">
                  Currency
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCurrency("USD");
                      setAmount("");
                    }}
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
                    onClick={() => {
                      setCurrency("LBP");
                      setAmount("");
                    }}
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

              {/* Via Partner sub-mode */}
              {whishMode === "partner" && (
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    Partner
                  </label>
                  {partnerSelector}
                  {!selectedPartnerId && (
                    <p className="text-xs text-slate-500 mt-1">
                      Select the partner whose credit line funds this top-up.
                    </p>
                  )}
                </div>
              )}

              {/* Amount input (shared) */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">
                  {whishMode === "client"
                    ? "Credits Received from Client"
                    : "Amount"}
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={fmtCommas(amount)}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/,/g, "");
                      if (isPartialDecimal(cleaned)) setAmount(cleaned);
                    }}
                    placeholder={currency === "LBP" ? "0" : "0.00"}
                    disabled={isSubmitting}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white text-lg font-mono focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 disabled:opacity-50"
                    autoFocus
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                    {currency}
                  </span>
                </div>
              </div>

              {/* From Client sub-mode — fee + client name */}
              {whishMode === "client" && (
                <>
                  <div className="rounded-xl bg-slate-900/50 border border-slate-700/50 p-4 space-y-3">
                    <h3 className="text-sm font-semibold text-slate-300 uppercase tracking-wider">
                      Fee Breakdown
                    </h3>

                    {/* Manual Fee Input */}
                    <div>
                      <label className="block text-xs text-slate-400 mb-1">
                        Fee Amount (USD)
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold">
                          $
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={fmtCommas(manualFee)}
                          onChange={(e) => {
                            const cleaned = e.target.value.replace(/,/g, "");
                            if (isPartialDecimal(cleaned))
                              setManualFee(cleaned);
                          }}
                          disabled={isSubmitting}
                          placeholder={
                            whishAutoFee > 0
                              ? whishAutoFee.toFixed(2) + " (auto)"
                              : "0.00"
                          }
                          className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-8 pr-4 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all disabled:opacity-50"
                        />
                      </div>
                      {whishAutoFee > 0 && !manualFee && (
                        <p className="text-xs text-slate-400 mt-1">
                          Auto-calculated fee:{" "}
                          <span className="text-white font-medium">
                            ${whishAutoFee.toFixed(2)}
                          </span>{" "}
                          (1% of amount)
                        </p>
                      )}
                    </div>

                    {/* Fee kept by shop */}
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Fee kept by shop:</span>
                      <span className="text-white font-mono">
                        ${whishProviderFee.toFixed(2)}
                      </span>
                    </div>

                    {/* Fee included in amount checkbox + breakdown */}
                    <div className="rounded-lg bg-slate-900/60 border border-slate-700 p-3 space-y-2">
                      <label className="flex items-center gap-2 text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={includingFees}
                          onChange={(e) => setIncludingFees(e.target.checked)}
                          disabled={isSubmitting}
                          className="w-4 h-4 rounded border-slate-600 bg-slate-900 text-violet-600 focus:ring-violet-500"
                        />
                        <span className="text-sm font-medium">
                          Fee included in amount
                        </span>
                      </label>
                      {whishParsedAmount > 0 && includingFees && (
                        <div className="text-xs space-y-0.5 pl-6 border-l border-slate-600 ml-2">
                          <p className="text-slate-400">
                            Credits in:{" "}
                            <span className="text-white font-mono font-medium">
                              {currency === "LBP"
                                ? `${whishParsedAmount.toLocaleString()} LBP`
                                : `$${whishParsedAmount.toFixed(2)}`}
                            </span>
                          </p>
                          <p className="text-slate-400">
                            Fee kept:{" "}
                            <span className="text-amber-400 font-mono font-medium">
                              -${whishProviderFee.toFixed(2)}
                            </span>
                          </p>
                          <p className="text-slate-400">
                            Cash paid to client:{" "}
                            <span className="text-emerald-400 font-mono font-medium">
                              {currency === "LBP"
                                ? `${whishCashPaid.toLocaleString()} LBP`
                                : `$${whishCashPaid.toFixed(2)}`}
                            </span>
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Optional client name */}
                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-2">
                      Client Name (optional)
                    </label>
                    <input
                      type="text"
                      autoComplete="off"
                      value={clientName}
                      onChange={(e) => setClientName(e.target.value)}
                      disabled={isSubmitting}
                      placeholder="Client name"
                      className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 disabled:opacity-50"
                    />
                  </div>
                </>
              )}
            </>
          )}

          {!isWhishTopUp && isSupplierCredit && (
            /* Supplier credit explainer */
            <div className="flex items-center gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
              <Info className="w-4 h-4 flex-shrink-0 text-amber-400" />
              <p className="text-xs leading-snug text-slate-300">
                The supplier credits your {getProviderLabel()} balance. No cash
                leaves any drawer — settle the amount with your supplier via the
                Suppliers page.
              </p>
            </div>
          )}

          {isCustomerTopUp && (
            <>
              {/* Customer purchase explainer */}
              <div className="flex items-center gap-2 p-3 rounded-lg bg-violet-500/10 border border-violet-500/30">
                <UserRound className="w-4 h-4 flex-shrink-0 text-violet-400" />
                <p className="text-xs leading-snug text-slate-300">
                  Buy credits from a customer: they transfer credits to your{" "}
                  {getProviderLabel()} line and you pay them cash from the
                  General drawer.
                </p>
              </div>

              {/* Credits Received */}
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-2">
                  Credits Received from Customer
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={fmtCommas(amount)}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/,/g, "");
                      if (isPartialDecimal(cleaned)) setAmount(cleaned);
                    }}
                    placeholder="0.00"
                    disabled={isSubmitting}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white text-lg font-mono focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 disabled:opacity-50"
                    autoFocus
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                    USD
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Added to the {getProviderLabel()} drawer
                </p>
              </div>

              {/* Cash Paid to Customer */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-medium text-slate-400">
                    Cash Paid to Customer
                  </label>
                  {/* Currency toggle */}
                  <div className="flex gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setCashPaidCurrency("USD");
                        setCashPaid("");
                      }}
                      disabled={isSubmitting}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                        cashPaidCurrency === "USD"
                          ? "bg-violet-600 text-white"
                          : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                      } disabled:opacity-50`}
                    >
                      USD
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCashPaidCurrency("LBP");
                        setCashPaid("");
                      }}
                      disabled={isSubmitting}
                      className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                        cashPaidCurrency === "LBP"
                          ? "bg-violet-600 text-white"
                          : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                      } disabled:opacity-50`}
                    >
                      LBP
                    </button>
                  </div>
                </div>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={fmtCommas(cashPaid)}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/,/g, "");
                      if (isPartialDecimal(cleaned)) setCashPaid(cleaned);
                    }}
                    placeholder={cashPaidCurrency === "LBP" ? "0" : "0.00"}
                    disabled={isSubmitting}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white text-lg font-mono focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 disabled:opacity-50"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                    {cashPaidCurrency}
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-1">
                  Deducted from the General drawer — balance:{" "}
                  <span className="text-white font-medium">
                    {cashPaidCurrency === "LBP"
                      ? `${generalBalance.toLocaleString()} LBP`
                      : `$${generalBalance.toFixed(2)}`}
                  </span>
                </p>
                {cashPaid && cashPaidNum > generalBalance && (
                  <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                    <AlertTriangle size={12} />
                    Cash paid exceeds General drawer balance
                  </p>
                )}
              </div>
            </>
          )}

          {/* Mode Toggle — only shown when external top-up is supported and not a supplier credit */}
          {!isWhishTopUp &&
            !isCustomerTopUp &&
            !isSupplierCredit &&
            onConfirmExternal && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode("external")}
                  disabled={isSubmitting}
                  className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                    mode === "external"
                      ? "bg-emerald-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  } disabled:opacity-50`}
                >
                  <PlusCircle size={14} />
                  External (Cash In)
                </button>
                <button
                  type="button"
                  onClick={() => setMode("from_drawer")}
                  disabled={isSubmitting}
                  className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
                    mode === "from_drawer"
                      ? "bg-violet-600 text-white"
                      : "bg-slate-700 text-slate-300 hover:bg-slate-600"
                  } disabled:opacity-50`}
                >
                  <ArrowRightLeft size={14} />
                  From Drawer
                </button>
              </div>
            )}

          {!isWhishTopUp && !isCustomerTopUp && (
            <>
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
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    value={fmtCommas(amount)}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/,/g, "");
                      if (isPartialDecimal(cleaned)) setAmount(cleaned);
                    }}
                    placeholder={currency === "LBP" ? "0" : "0.00"}
                    disabled={isSubmitting}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white text-lg font-mono focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500/30 disabled:opacity-50"
                    autoFocus
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                    {currency}
                  </span>
                </div>
                {mode === "from_drawer" &&
                  !isSupplierCredit &&
                  amount &&
                  parseFloat(amount) > sourceBalance && (
                    <p className="text-xs text-red-400 mt-1 flex items-center gap-1">
                      <AlertTriangle size={12} />
                      Amount exceeds source drawer balance
                    </p>
                  )}
              </div>

              {/* Source Drawer Selector — only in from_drawer mode (hidden for supplier credit) */}
              {mode === "from_drawer" && !isSupplierCredit && (
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
              )}
            </>
          )}

          {/* Info Alert */}
          <div>
            <div className="p-2 rounded bg-slate-800/50 border border-slate-700">
              <div className="flex items-center gap-1.5">
                <Info className="w-3.5 h-3.5 flex-shrink-0 text-slate-400" />
                <p className="text-[10px] leading-tight text-slate-400">
                  {isWhishTopUp
                    ? whishMode === "partner"
                      ? `${getProviderLabel()} balance will be increased from the selected partner's credit line. Settle with the partner via the Partners page.`
                      : `The client transfers credits to your ${getProviderLabel()} line; the shop keeps the fee and pays out the remainder as cash.`
                    : isCustomerTopUp
                      ? `Credits are added to the ${getProviderLabel()} drawer; the cash you pay the customer is deducted from the General drawer.`
                      : isSupplierCredit
                        ? `${getProviderLabel()} balance will be increased. Your supplier will be credited — settle with them via the Suppliers page.`
                        : mode === "external"
                          ? `Add cash from an external source to your ${getProviderLabel()} drawer. No drawer deducted.`
                          : `Transfer funds to your ${getProviderLabel()} drawer. No fees.`}
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
                (isWhishTopUp
                  ? whishMode === "partner" && !selectedPartnerId
                  : isCustomerTopUp
                    ? cashPaidNum < 0 || cashPaidNum > generalBalance
                    : !isSupplierCredit &&
                      mode === "from_drawer" &&
                      parseFloat(amount) > sourceBalance)
              }
              className={`flex-1 px-4 py-2.5 text-white rounded-lg font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg ${
                isWhishTopUp && whishMode === "client"
                  ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20"
                  : !isWhishTopUp && !isCustomerTopUp && mode === "external"
                    ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-500/20"
                    : "bg-violet-600 hover:bg-violet-500 shadow-violet-500/20"
              }`}
            >
              {isSubmitting
                ? "Processing..."
                : isWhishTopUp
                  ? whishMode === "partner"
                    ? "Top Up via Partner"
                    : "Buy Credits from Client"
                  : isCustomerTopUp
                    ? "Confirm Top-Up"
                    : isSupplierCredit
                      ? "Confirm Supplier Credit"
                      : mode === "external"
                        ? "Add Cash"
                        : "Confirm Top-Up"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
