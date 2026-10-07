import { useState, useEffect, useRef } from "react";
import logger from "@/utils/logger";
import { Plus, History, Package, X } from "lucide-react";
import type {
  CreateExpenseRequest,
  CreateStockExpenseInput,
} from "@liratek/core";
import {
  appEvents,
  PageHeader,
  Select,
  useApi,
  MultiPaymentInput,
  type PaymentLine,
} from "@liratek/ui";
import { HistoryModal } from "./components/HistoryModal";
import { StockUsePicker, type StockPick } from "./components/StockUsePicker";
import { StatsCards } from "../../components/StatsCards";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { useSellRate } from "@/hooks/useSellRate";
import { localDay } from "@/shared/utils/localDay";
import { getApiErrorMessage } from "@/shared/utils/apiErrorMessage";

interface Expense {
  id?: number;
  description: string;
  category: string;
  paid_by_method?: string;
  amount_usd: number;
  amount_lbp: number;
  expense_date: string;
  /** 1 when voided from the Transactions page (LIRA-131 returns the row so
   *  the History window can badge it). */
  is_refunded?: number;
}

// LIRA-145: `CarrierLineRepository.recordUsage` writes this category itself
// (`Line_Usage`, `paid_by_method` `LINE_CREDIT`) from the Recharge tab's
// "Record usage" action. It stays in this list so an existing `Line_Usage`
// row still resolves a label wherever the page displays a category — it is
// deliberately withheld from the manual create form below: a hand-booked one
// would move a cash drawer instead of the carrier's credit drawer, and no
// carrier line at all.
const LINE_USAGE_CATEGORY = "Line_Usage";

const EXPENSE_CATEGORIES = [
  "Shop_Supply",
  "Bill",
  "Inventory_Loss",
  "Refund_Damaged",
  LINE_USAGE_CATEGORY,
  "Other",
];

// What the manual create-form's category picker actually offers.
const MANUAL_EXPENSE_CATEGORIES = EXPENSE_CATEGORIES.filter(
  (cat) => cat !== LINE_USAGE_CATEGORY,
);

export default function Expenses() {
  const api = useApi();
  // Expenses are a Money-OUT flow (shop pays out) — buy rate.
  const { buyRate: exchangeRate } = useSellRate();
  // An expense is the shop paying out of one of its drawers, so the payment
  // method picks WHICH drawer the money leaves. Offer every drawer-affecting
  // method (DB-driven, real labels — no emojis, no phantom "Credit Card").
  // CUSTOMER_ACCOUNT / GIFT_CARD are excluded by affects_drawer=0: an expense
  // has no customer, so neither is a source of shop funds (lira-093).
  const { drawerAffectingMethods } = usePaymentMethods();
  const descriptionRef = useRef<HTMLInputElement>(null);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [paymentLines, setPaymentLines] = useState<PaymentLine[]>([
    {
      id: crypto.randomUUID(),
      method: "CASH",
      currencyCode: "USD",
      amount: 0,
    },
  ]);
  // Owner decision 2026-10-07 (payer = "shop"): the BILL is typed on its
  // own; the payment lines are the cash HANDED. When the cash handed is more
  // than the bill, the change the vendor gives back comes INTO the drawer
  // (`returnLegs`, OUT direction) and change NOT given back is added to the
  // cost (`keptChange`) — never profit. Paying exactly works as before.
  const [billAmount, setBillAmount] = useState("");
  const [billCurrency, setBillCurrency] = useState<"USD" | "LBP">("USD");
  const [returnLegs, setReturnLegs] = useState<PaymentLine[]>([]);
  const [keptChange, setKeptChange] = useState<{
    usd: number;
    lbp: number;
  } | null>(null);
  // The rate the operator converted at on the sheet (rule 27) — sent as
  // tender_exchange_rate so the server reconciles at the same rate.
  const [tenderRate, setTenderRate] = useState<number | undefined>();
  // Remounts the payment sheet on reset so its internal lines / "amount
  // touched" state start fresh with the next bill.
  const [paymentFormKey, setPaymentFormKey] = useState(0);
  const [formData, setFormData] = useState<Expense>({
    description: "",
    category: "Shop_Supply",
    paid_by_method: "CASH",
    amount_usd: 0,
    amount_lbp: 0,
    expense_date: localDay(),
  });
  // LIRA-262 — "the shop uses its own stock": an item picked from the search
  // bar replaces the payment section (no cash moves; the server books the
  // item's cost).
  const [stockPick, setStockPick] = useState<StockPick | null>(null);
  const [stockQty, setStockQty] = useState("1");

  useEffect(() => {
    loadTodayExpenses();
    descriptionRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadTodayExpenses = async () => {
    try {
      const data = await api.getTodayExpenses();
      setExpenses(data);
    } catch (error) {
      logger.error("Failed to load expenses:", error);
    }
  };

  const resetForm = () => {
    setFormData({
      description: "",
      category: "Shop_Supply",
      paid_by_method: "CASH",
      amount_usd: 0,
      amount_lbp: 0,
      expense_date: localDay(),
    });
    setPaymentLines([
      {
        id: crypto.randomUUID(),
        method: "CASH",
        currencyCode: "USD",
        amount: 0,
      },
    ]);
    setBillAmount("");
    setReturnLegs([]);
    setKeptChange(null);
    setPaymentFormKey((k) => k + 1);
    setStockPick(null);
    setStockQty("1");
    setTransactionTime(undefined);
  };

  // LIRA-262 — record using an item from stock. ONE payload (rule 22), typed
  // by the core schema's input (rule 21); no amount — the server derives it.
  const handleAddStockExpense = async (pick: StockPick) => {
    const quantity = Number(stockQty);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      alert("Please enter a whole quantity of 1 or more.");
      return;
    }
    const payload: CreateStockExpenseInput = {
      source: pick.source,
      item_id: pick.item_id,
      quantity,
      category: formData.category,
      description: formData.description.trim() || undefined,
      expense_date: new Date(formData.expense_date).toISOString(),
      transaction_time: transactionTime,
    };
    try {
      const result = await api.addStockExpense(payload);
      if (result.success) {
        appEvents.emit(
          "notification:show",
          "Shop use recorded — taken out at cost",
          "success",
        );
        resetForm();
        loadTodayExpenses();
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      logger.error("Operation failed", { error });
      alert(getApiErrorMessage(error, "Failed to record shop use"));
    }
  };

  const handleAddExpense = async () => {
    if (stockPick) {
      await handleAddStockExpense(stockPick);
      return;
    }
    if (!formData.description.trim()) {
      alert("Please fill in description.");
      return;
    }

    const bill = Number(billAmount);
    if (!Number.isFinite(bill) || bill <= 0) {
      alert("Please enter the bill amount.");
      return;
    }

    // Single-mode sheet: one handed line (see allowSplit below).
    const firstLine = paymentLines[0];
    const handedLines = paymentLines.filter((line) => line.amount > 0);
    if (!firstLine || handedLines.length === 0) {
      alert("Please enter the cash handed.");
      return;
    }
    const rate = tenderRate ?? exchangeRate;
    const toUsd = (amount: number, currency: string) =>
      currency === "LBP" ? (rate > 0 ? amount / rate : 0) : amount;
    const handedUsd = handedLines.reduce(
      (sum, line) => sum + toUsd(line.amount, line.currencyCode),
      0,
    );
    if (handedUsd < toUsd(bill, billCurrency) - 0.05) {
      alert("The cash handed is less than the bill.");
      return;
    }

    // ONE payload for both transports (rule 22), typed by the core schema's
    // input (rule 21). amount_* is the bill; the server derives the stored
    // cost from the lines (handed − change back) and checks the
    // not-returned claim.
    const payload: CreateExpenseRequest = {
      category: formData.category,
      description: formData.description,
      paid_by_method: firstLine.method,
      amount_usd: billCurrency === "USD" ? bill : 0,
      amount_lbp: billCurrency === "LBP" ? bill : 0,
      expense_date: new Date(formData.expense_date).toISOString(),
      transaction_time: transactionTime,
      payments: [
        ...handedLines.map((line) => ({
          method: line.method,
          currencyCode: line.currencyCode,
          amount: line.amount,
        })),
        ...returnLegs
          .filter((leg) => leg.amount > 0)
          .map((leg) => ({
            method: leg.method,
            currencyCode: leg.currencyCode,
            amount: leg.amount,
            direction: "OUT" as const,
          })),
      ],
      ...(keptChange && (keptChange.usd > 0 || keptChange.lbp > 0)
        ? {
            kept_change_usd: keptChange.usd,
            kept_change_lbp: keptChange.lbp,
          }
        : {}),
      ...(rate > 0 ? { tender_exchange_rate: rate } : {}),
    };

    try {
      const result = await api.addExpense(payload);

      if (result.success) {
        appEvents.emit(
          "notification:show",
          "Expense recorded successfully",
          "success",
        );
        resetForm();
        loadTodayExpenses();
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      logger.error("Operation failed", { error });
      // LIRA-242 fallout: a thrown ApiError (e.g. requestJson's web 403,
      // `{status,message,details}` — NOT an `Error` instance) used to be
      // discarded here in favor of this hardcoded string, hiding the real
      // reason (a role refusal, a business-rule error, anything).
      alert(getApiErrorMessage(error, "Failed to add expense"));
    }
  };

  const handleVoid = async (id: number) => {
    if (!confirm("Void this expense? Drawer balance will be restored.")) return;
    try {
      const result = await api.deleteExpense(id);
      if (result.success) {
        loadTodayExpenses();
      } else {
        // Rule 19c: a server refusal is a resolved { success: false, error }
        // envelope on BOTH transports, not a thrown error — mirrors
        // handleAddExpense's existing failure branch above so a refusal
        // (e.g. an already-voided expense) is surfaced instead of silently
        // leaving the row in the list with no feedback.
        alert("Error: " + result.error);
      }
    } catch (error) {
      logger.error("Operation failed", { error });
      // LIRA-247: a thrown ApiError (e.g. a web 403 role refusal) used to be
      // discarded here in favor of this hardcoded string, mirroring the same
      // fix already applied to handleAddExpense above.
      alert(getApiErrorMessage(error, "Failed to void expense"));
    }
  };

  // LIRA-185 expenses lead 1: a row voided from the Transactions page comes
  // back flagged is_refunded (the History window badges it) — its money was
  // already returned, so the header total leaves it out, matching Profits
  // and the closing report.
  const activeExpenses = expenses.filter((e) => !e.is_refunded);
  const totalUSD = activeExpenses.reduce(
    (sum, e) => sum + (e.amount_usd || 0),
    0,
  );
  const totalLBP = activeExpenses.reduce(
    (sum, e) => sum + (e.amount_lbp || 0),
    0,
  );
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [transactionTime, setTransactionTime] = useState<string | undefined>();

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 min-h-0 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500">
      {/* Header with Stats and History */}
      <PageHeader
        title="Expenses"
        actions={
          <div className="flex items-center gap-2">
            <StatsCards totalUSD={totalUSD} totalLBP={totalLBP} />
            <button
              onClick={() => setShowHistoryModal(true)}
              className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white"
            >
              <History size={16} />
              <span className="font-medium">History</span>
            </button>
          </div>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col">
        {/* Add Expense Form */}
        <div className="w-full bg-slate-800 rounded-xl border border-slate-700/50 shadow-xl p-5 flex flex-col overflow-hidden flex-1 min-h-0">
          <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <Plus className="text-orange-500" size={20} />
            Add New Expense
          </h2>

          <div className="space-y-4 flex-1 overflow-auto pr-2 custom-scrollbar">
            {/* LIRA-262 — use an item from the shop's own stock */}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider">
                <Package size={12} className="inline mr-1" />
                Use an item from stock (optional)
              </label>
              {stockPick ? (
                <div
                  data-testid="expense-stock-pick"
                  className="space-y-3 bg-orange-500/10 border border-orange-500/30 rounded-lg px-4 py-3"
                >
                  <div className="flex items-center gap-2">
                    <Package size={14} className="text-orange-400" />
                    <span className="text-white font-medium text-sm flex-1">
                      {stockPick.name}
                    </span>
                    <span className="text-xs text-slate-400">
                      {stockPick.sourceLabel}
                    </span>
                    <button
                      type="button"
                      aria-label="Remove item"
                      onClick={() => {
                        setStockPick(null);
                        setStockQty("1");
                      }}
                      className="text-slate-400 hover:text-white transition-colors"
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <div className="flex items-center gap-3">
                    <label
                      htmlFor="expense-stock-qty"
                      className="text-xs text-slate-400 uppercase tracking-wider"
                    >
                      Quantity
                    </label>
                    <input
                      id="expense-stock-qty"
                      type="number"
                      min={1}
                      step={1}
                      value={stockQty}
                      onChange={(e) => setStockQty(e.target.value)}
                      className="w-24 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white text-sm focus:border-orange-500 outline-none"
                    />
                    <span className="text-xs text-slate-400">
                      Approx. cost{" "}
                      {stockPick.currency === "USD"
                        ? `$${(stockPick.unitCost * (Number(stockQty) || 0)).toFixed(2)}`
                        : `${(stockPick.unitCost * (Number(stockQty) || 0)).toLocaleString()} LBP`}
                    </span>
                  </div>
                  <p className="text-xs text-slate-400">
                    {stockPick.source === "INVENTORY"
                      ? "Comes out of stock at its cost. No cash moves."
                      : `Comes out of the ${stockPick.sourceLabel} balance at its cost. No cash moves.`}
                  </p>
                </div>
              ) : (
                <StockUsePicker
                  onPick={(pick) => {
                    setStockPick(pick);
                    setStockQty("1");
                  }}
                />
              )}
            </div>

            {/* Description */}
            <div>
              <label
                htmlFor="expense-description"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
              >
                {stockPick ? "Description (optional)" : "Description *"}
              </label>
              <input
                id="expense-description"
                ref={descriptionRef}
                type="text"
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:border-orange-500 focus:ring-2 focus:ring-orange-500/50 outline-none transition-all"
                placeholder="e.g., Shop rent, Coffee, Repair"
              />
            </div>

            {/* Category */}
            <div>
              <label
                htmlFor="expense-category"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
              >
                Category
              </label>
              <Select
                value={formData.category}
                onChange={(value) =>
                  setFormData({ ...formData, category: value })
                }
                options={MANUAL_EXPENSE_CATEGORIES.map((cat) => ({
                  value: cat,
                  label: cat.replace(/_/g, " "),
                }))}
                ringColor="ring-orange-500"
                buttonClassName="text-sm"
              />
            </div>

            {/* Bill amount — the cost. Hidden for shop use (no cash moves). */}
            {!stockPick && (
              <div>
                <label
                  htmlFor="expense-bill-amount"
                  className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
                >
                  Bill amount *
                </label>
                <div className="flex gap-2">
                  <input
                    id="expense-bill-amount"
                    data-testid="expense-bill-amount"
                    type="text"
                    inputMode="decimal"
                    value={billAmount}
                    onChange={(e) =>
                      setBillAmount(e.target.value.replace(/[^0-9.]/g, ""))
                    }
                    className="flex-1 bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white font-mono focus:border-orange-500 focus:ring-2 focus:ring-orange-500/50 outline-none transition-all"
                    placeholder={billCurrency === "USD" ? "0.00" : "0"}
                  />
                  <div
                    role="group"
                    aria-label="Bill currency"
                    className="flex rounded-lg border border-slate-700 overflow-hidden"
                  >
                    {(["USD", "LBP"] as const).map((code) => (
                      <button
                        key={code}
                        type="button"
                        data-testid={`expense-bill-currency-${code}`}
                        aria-pressed={billCurrency === code}
                        onClick={() => setBillCurrency(code)}
                        className={`px-3 text-sm font-medium transition-colors ${
                          billCurrency === code
                            ? "bg-orange-600 text-white"
                            : "bg-slate-900 text-slate-400 hover:text-white"
                        }`}
                      >
                        {code === "USD" ? "$" : "LBP"}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* Cash handed — hidden for shop use (no cash moves) */}
            {!stockPick && (
              <MultiPaymentInput
                key={paymentFormKey}
                payer="shop"
                totals={[
                  { amount: Number(billAmount) || 0, currency: billCurrency },
                ]}
                currency={billCurrency}
                totalAmountCurrency={billCurrency}
                onChange={setPaymentLines}
                onReturnChange={setReturnLegs}
                onKeptChange={(kept) =>
                  setKeptChange(kept ? { usd: kept.usd, lbp: kept.lbp } : null)
                }
                onExchangeRateChange={setTenderRate}
                // The vendor hands change back in cash, into the drawer.
                cashOnlyReturn
                paymentMethods={drawerAffectingMethods.map((m) => ({
                  code: m.code,
                  label: m.label,
                }))}
                currencies={[
                  { code: "USD", symbol: "$" },
                  { code: "LBP", symbol: "LBP" },
                ]}
                exchangeRate={exchangeRate}
                label="Cash handed"
                showDiscount={false}
                showPmFee={false}
                // LIRA-185: split stays off — an expense is paid with ONE
                // method (the server refuses a handed line with a different
                // method than paid_by_method). The bill above is now the
                // total the sheet reconciles against.
                allowSplit={false}
              />
            )}

            {/* Date */}
            <div>
              <label
                htmlFor="expense-date"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
              >
                Date
              </label>
              <input
                id="expense-date"
                type="date"
                value={formData.expense_date}
                onChange={(e) =>
                  setFormData({ ...formData, expense_date: e.target.value })
                }
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:ring-2 focus:ring-orange-500 outline-none transition-all"
              />
            </div>
          </div>

          <TransactionTimeOverride
            value={transactionTime}
            onChange={setTransactionTime}
          />

          <button
            onClick={handleAddExpense}
            className="w-full py-4 mt-6 rounded-xl font-bold text-lg bg-orange-600 hover:bg-orange-500 text-white shadow-lg shadow-orange-900/20 active:scale-95 transition-all flex items-center justify-center gap-2"
          >
            Record Expense
          </button>
        </div>
      </div>

      {/* History Modal */}
      {showHistoryModal && (
        <HistoryModal
          expenses={expenses}
          loading={false}
          onClose={() => setShowHistoryModal(false)}
          onRefresh={loadTodayExpenses}
          onVoid={handleVoid}
        />
      )}
    </div>
  );
}
