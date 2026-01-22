import { useState, useEffect } from "react";
import {
  Smartphone,
  Signal,
  Wifi,
  CreditCard,
  Hash,
  DollarSign,
  CheckCircle,
} from "lucide-react";

type Provider = "MTC" | "Alfa";
type RechargeType = "CREDIT_TRANSFER" | "VOUCHER" | "DAYS";

export default function Recharge() {
  const [activeProvider, setActiveProvider] = useState<Provider>("MTC");
  const [rechargeType, setRechargeType] =
    useState<RechargeType>("CREDIT_TRANSFER");
  const [stock, setStock] = useState({ mtc: 0, alfa: 0 });

  // Form
  const [phoneNumber, setPhoneNumber] = useState("");
  const [paidBy, setPaidBy] = useState<"CASH" | "OMT" | "WHISH" | "BINANCE">("CASH");
  const [amount, setAmount] = useState(""); // Amount of credit to send
  const [price, setPrice] = useState(""); // Price to client
  const [cost, setCost] = useState(""); // Cost to dealer (optional/auto-calc)
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    loadStock();
  }, []);

  const loadStock = async () => {
    try {
      const s = await window.api.getRechargeStock();
      setStock(s);
    } catch (error) {
      console.error("Failed to load stock", error);
    }
  };

  const handleQuickAmount = (val: number) => {
    setAmount(val.toString());
    // Simple logic: Price = Amount (just a placeholder, usually there's a margin)
    setPrice(val.toString());
    setCost((val * 0.9).toString()); // Assume 10% margin for demo
  };

  const handleSubmit = async () => {
    if (!amount || !price) {
      alert("Please enter amount and price");
      return;
    }

    setIsSubmitting(true);
    try {
      const result = await window.api.processRecharge({
        provider: activeProvider,
        type: rechargeType,
        amount: parseFloat(amount),
        cost: parseFloat(cost) || 0,
        price: parseFloat(price),
        paid_by_method: paidBy,
        phoneNumber,
      });

      if (result.success) {
        alert("Recharge Successful!");
        setAmount("");
        setPrice("");
        setCost("");
        setPhoneNumber("");
        loadStock();
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      console.error(error);
      alert("Failed to process");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Theme Colors
  const theme =
    activeProvider === "MTC"
      ? {
          primary: "bg-cyan-600",
          hover: "hover:bg-cyan-500",
          text: "text-cyan-400",
          border: "border-cyan-500/30",
          bgSoft: "bg-cyan-500/10",
          shadow: "shadow-cyan-900/20",
        }
      : {
          primary: "bg-red-600",
          hover: "hover:bg-red-500",
          text: "text-red-400",
          border: "border-red-500/30",
          bgSoft: "bg-red-500/10",
          shadow: "shadow-red-900/20",
        };

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Smartphone className={theme.text} />
          Mobile Recharge
        </h1>

        {/* Stock Display */}
        <div className="flex gap-4">
          <div className="bg-slate-800 px-4 py-2 rounded-lg border border-cyan-500/30 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse" />
            <span className="text-slate-400 text-xs uppercase font-bold">
              MTC Stock
            </span>
            <span className="text-cyan-400 font-mono font-bold">
              ${stock.mtc.toFixed(2)}
            </span>
          </div>
          <div className="bg-slate-800 px-4 py-2 rounded-lg border border-red-500/30 flex items-center gap-3">
            <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-slate-400 text-xs uppercase font-bold">
              Alfa Stock
            </span>
            <span className="text-red-400 font-mono font-bold">
              ${stock.alfa.toFixed(2)}
            </span>
          </div>
        </div>
      </div>

      <div className="flex gap-6 h-[calc(100vh-theme(spacing.48))]">
        {/* Left: Provider & Type Selection */}
        <div className="w-1/4 min-w-[250px] flex flex-col gap-4">
          {/* Provider Tabs */}
          <div className="bg-slate-800 p-2 rounded-xl border border-slate-700/50 flex gap-2">
            <button
              onClick={() => setActiveProvider("MTC")}
              className={`flex-1 py-4 rounded-lg font-bold text-lg transition-all flex flex-col items-center gap-2 ${
                activeProvider === "MTC"
                  ? "bg-cyan-600 text-white shadow-lg"
                  : "text-slate-400 hover:bg-slate-700 hover:text-white"
              }`}
            >
              <Signal size={24} />
              Touch / MTC
            </button>
            <button
              onClick={() => setActiveProvider("Alfa")}
              className={`flex-1 py-4 rounded-lg font-bold text-lg transition-all flex flex-col items-center gap-2 ${
                activeProvider === "Alfa"
                  ? "bg-red-600 text-white shadow-lg"
                  : "text-slate-400 hover:bg-slate-700 hover:text-white"
              }`}
            >
              <Wifi size={24} />
              Alfa
            </button>
          </div>

          {/* Type Selection */}
          <div className="bg-slate-800 p-4 rounded-xl border border-slate-700/50 flex-1 flex flex-col gap-2">
            <label className="text-xs font-medium text-slate-500 uppercase mb-2">
              Service Type
            </label>
            {[
              {
                id: "CREDIT_TRANSFER",
                label: "Credit Transfer",
                icon: DollarSign,
              },
              { id: "DAYS", label: "Days Validity", icon: CalendarIcon },
              { id: "VOUCHER", label: "Voucher / Card", icon: CreditCard },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setRechargeType(item.id as RechargeType)}
                className={`w-full p-4 rounded-lg text-left font-medium transition-all flex items-center gap-3 ${
                  rechargeType === item.id
                    ? `${theme.bgSoft} ${theme.text} border ${theme.border}`
                    : "bg-slate-700/30 text-slate-400 hover:bg-slate-700 hover:text-white"
                }`}
              >
                <item.icon size={20} />
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Center: Main Form */}
        <div className="flex-1 bg-slate-800 rounded-xl border border-slate-700/50 shadow-xl p-8 flex flex-col">
          <div className="max-w-md mx-auto w-full space-y-8">
            {/* Paid By */}
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2 uppercase tracking-wider">
                Paid By
              </label>
              <select
                value={paidBy}
                onChange={(e) =>
                  setPaidBy(
                    e.target.value as "CASH" | "OMT" | "WHISH" | "BINANCE",
                  )
                }
                className="w-full bg-slate-900 border border-slate-600 rounded-xl px-4 py-4 text-lg font-bold text-white focus:outline-none focus:border-orange-500 transition-colors"
              >
                <option value="CASH">Cash (General)</option>
                <option value="OMT">OMT</option>
                <option value="WHISH">Whish</option>
                <option value="BINANCE">Binance</option>
              </select>
              <p className="text-xs text-slate-500 mt-2">
                Customer payment increases the selected drawer by the full price.
              </p>
            </div>

            {/* Phone Input */}
            <div>
              <label className="block text-sm font-medium text-slate-400 mb-2 uppercase tracking-wider">
                Phone Number
              </label>
              <div className="relative">
                <div className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold flex items-center gap-2 border-r border-slate-600 pr-3">
                  <Hash size={18} />
                  +961
                </div>
                <input
                  type="text"
                  value={phoneNumber}
                  onChange={(e) => setPhoneNumber(e.target.value)}
                  className={`w-full bg-slate-900 border border-slate-600 rounded-xl pl-24 pr-4 py-4 text-2xl font-bold text-white focus:outline-none focus:border-${activeProvider === "MTC" ? "cyan" : "red"}-500 transition-colors tracking-widest`}
                  placeholder="XX XXXXXX"
                  maxLength={8}
                />
              </div>
            </div>

            {/* Quick Amounts */}
            {rechargeType === "CREDIT_TRANSFER" && (
              <div>
                <label className="block text-sm font-medium text-slate-400 mb-3 uppercase tracking-wider">
                  Quick Amount ($)
                </label>
                <div className="grid grid-cols-4 gap-3">
                  {[5, 10, 15, 20, 25, 30, 50, 100].map((amt) => (
                    <button
                      key={amt}
                      onClick={() => handleQuickAmount(amt)}
                      className={`py-3 rounded-lg font-bold text-lg transition-all border ${
                        amount === amt.toString()
                          ? `${theme.bgSoft} ${theme.text} ${theme.border} shadow-lg`
                          : "bg-slate-700/30 border-transparent text-slate-400 hover:bg-slate-700 hover:text-white"
                      }`}
                    >
                      ${amt}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Manual Amount & Price */}
            <div className="grid grid-cols-2 gap-6">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">
                  Amount / Value
                </label>
                <div className="relative">
                  <span
                    className={`absolute left-4 top-1/2 -translate-y-1/2 font-bold ${theme.text}`}
                  >
                    $
                  </span>
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl pl-10 pr-4 py-3 text-white font-bold focus:outline-none focus:border-slate-500"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-2 uppercase">
                  Price to Client
                </label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-500 font-bold">
                    $
                  </span>
                  <input
                    type="number"
                    value={price}
                    onChange={(e) => setPrice(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-xl pl-10 pr-4 py-3 text-emerald-400 font-bold focus:outline-none focus:border-emerald-500"
                  />
                </div>
              </div>
            </div>

            {/* Submit */}
            <button
              onClick={handleSubmit}
              disabled={isSubmitting}
              className={`w-full py-5 rounded-xl font-bold text-xl text-white shadow-lg active:scale-95 transition-all flex items-center justify-center gap-3 ${
                isSubmitting
                  ? "bg-slate-600 cursor-not-allowed"
                  : `${theme.primary} ${theme.hover} ${theme.shadow}`
              }`}
            >
              {isSubmitting ? (
                "Processing..."
              ) : (
                <>
                  <CheckCircle size={24} />
                  Confirm Recharge
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function CalendarIcon({ size }: { size: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
      <line x1="16" y1="2" x2="16" y2="6"></line>
      <line x1="8" y1="2" x2="8" y2="6"></line>
      <line x1="3" y1="10" x2="21" y2="10"></line>
    </svg>
  );
}
