import { useState, useEffect } from "react";
import { X, PlusCircle, ArrowRightLeft, Plus, Landmark } from "lucide-react";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { appEvents, DecimalInput, Select, useApi } from "@liratek/ui";

interface SourceDrawer {
  drawer_name: string;
  balance_usd: number;
  balance_lbp: number;
}

interface AvailableCurrency {
  code: string;
  name: string;
  symbol?: string;
}

interface ExtraCurrencyRow {
  currency_code: string;
  amount: string;
}

type TopUpMode = "external" | "from_drawer" | "fund_system";

type SystemFloatDrawer = "OMT_System" | "Whish_System";
type FundCurrency = "USD" | "LBP";

const SYSTEM_FLOAT_DRAWERS: { value: SystemFloatDrawer; label: string }[] = [
  { value: "OMT_System", label: "OMT System" },
  { value: "Whish_System", label: "Whish System" },
];

function formatFundBalance(amount: number, currency: FundCurrency): string {
  return currency === "LBP"
    ? `${Math.round(amount).toLocaleString()} LBP`
    : `$${amount.toLocaleString()}`;
}

interface DrawerTopUpModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function DrawerTopUpModal({
  isOpen,
  onClose,
  onSuccess,
}: DrawerTopUpModalProps) {
  const api = useApi();
  useModalFocusFix(isOpen);
  const [mode, setMode] = useState<TopUpMode>("external");
  const [amountUsd, setAmountUsd] = useState("");
  const [amountLbp, setAmountLbp] = useState("");
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sourceDrawers, setSourceDrawers] = useState<SourceDrawer[]>([]);
  const [selectedDrawer, setSelectedDrawer] = useState("");
  const [extraCurrencies, setExtraCurrencies] = useState<ExtraCurrencyRow[]>(
    [],
  );
  const [availableExtraCurrencies, setAvailableExtraCurrencies] = useState<
    AvailableCurrency[]
  >([]);

  // Fund System Float mode — operator hands real money to the OMT/Whish
  // provider so the shop's spendable float goes up (owner-confirmed
  // 2026-07-29 float model). Every drawer holding a spendable balance is a
  // valid funding source, so this loads ALL drawers, not just OMT_System.
  const [fundTargetDrawer, setFundTargetDrawer] =
    useState<SystemFloatDrawer>("OMT_System");
  const [fundFundingDrawer, setFundFundingDrawer] = useState("");
  const [fundCurrency, setFundCurrency] = useState<FundCurrency>("USD");
  const [fundAmount, setFundAmount] = useState(0);
  const [fundingDrawerBalances, setFundingDrawerBalances] = useState<
    Record<string, Record<string, number>>
  >({});

  useEffect(() => {
    if (isOpen && mode === "from_drawer") {
      loadSourceDrawers();
    }
    if (isOpen && mode === "fund_system") {
      loadFundingDrawerBalances();
    }
  }, [isOpen, mode]);

  useEffect(() => {
    if (isOpen) {
      loadExtraCurrencies();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  async function loadSourceDrawers() {
    const result = await api.drawerTopUp.getSourceDrawers();
    if (result.success && result.data) {
      setSourceDrawers(result.data);
      if (result.data.length > 0 && !selectedDrawer) {
        setSelectedDrawer(result.data[0].drawer_name);
      }
    }
  }

  async function loadExtraCurrencies() {
    try {
      const currencies = await api.getFullCurrenciesByDrawer("General");
      setAvailableExtraCurrencies(
        (currencies ?? [])
          .filter((c) => c.code !== "USD" && c.code !== "LBP")
          .map((c) => ({ code: c.code, name: c.name, symbol: c.symbol })),
      );
    } catch {
      setAvailableExtraCurrencies([]);
    }
  }

  async function loadFundingDrawerBalances() {
    try {
      const balances = await api.getSystemExpectedBalancesDynamic();
      setFundingDrawerBalances(balances ?? {});
      const names = Object.keys(balances ?? {}).filter(
        (name) => name !== fundTargetDrawer,
      );
      if (names.length > 0 && !fundFundingDrawer) {
        setFundFundingDrawer(names.includes("General") ? "General" : names[0]);
      }
    } catch {
      setFundingDrawerBalances({});
    }
  }

  if (!isOpen) return null;

  function handleClose() {
    setAmountUsd("");
    setAmountLbp("");
    setNotes("");
    setMode("external");
    setSelectedDrawer("");
    setExtraCurrencies([]);
    setFundTargetDrawer("OMT_System");
    setFundFundingDrawer("");
    setFundCurrency("USD");
    setFundAmount(0);
    setFundingDrawerBalances({});
    onClose();
  }

  function addCurrencyRow() {
    const used = new Set(extraCurrencies.map((row) => row.currency_code));
    const next = availableExtraCurrencies.find((c) => !used.has(c.code));
    if (!next) return;
    setExtraCurrencies((prev) => [
      ...prev,
      { currency_code: next.code, amount: "" },
    ]);
  }

  function removeCurrencyRow(index: number) {
    setExtraCurrencies((prev) => prev.filter((_, i) => i !== index));
  }

  function updateCurrencyRow(index: number, patch: Partial<ExtraCurrencyRow>) {
    setExtraCurrencies((prev) =>
      prev.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    );
  }

  async function handleSubmit() {
    if (mode === "fund_system") {
      await handleFundSystemSubmit();
      return;
    }

    const usd = parseFloat(amountUsd) || 0;
    const lbp = parseFloat(amountLbp) || 0;
    const extraLegs =
      mode === "external"
        ? extraCurrencies
            .filter(
              (row) => row.currency_code && (parseFloat(row.amount) || 0) > 0,
            )
            .map((row) => ({
              currency_code: row.currency_code,
              amount: parseFloat(row.amount) || 0,
            }))
        : [];

    if (usd <= 0 && lbp <= 0 && extraLegs.length === 0) {
      alert("Please enter at least one amount greater than 0.");
      return;
    }

    if (mode === "from_drawer" && !selectedDrawer) {
      alert("Please select a source drawer.");
      return;
    }

    setIsSubmitting(true);
    try {
      const trimmedNotes = notes.trim();

      let result;
      if (mode === "from_drawer") {
        result = await api.drawerTopUp.createFromDrawer({
          amount_usd: usd,
          amount_lbp: lbp,
          source_drawer: selectedDrawer,
          ...(trimmedNotes ? { notes: trimmedNotes } : {}),
        });
      } else {
        result = await api.drawerTopUp.create({
          amount_usd: usd,
          amount_lbp: lbp,
          ...(trimmedNotes ? { notes: trimmedNotes } : {}),
          ...(extraLegs.length > 0 ? { extra_currencies: extraLegs } : {}),
        });
      }

      if (result.success) {
        appEvents.emit(
          "notification:show",
          "Drawer topped up successfully.",
          "success",
        );
        setAmountUsd("");
        setAmountLbp("");
        setNotes("");
        setExtraCurrencies([]);
        onSuccess();
      } else {
        alert(result.error ?? "Failed to top up drawer.");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleFundSystemSubmit() {
    if (!(fundAmount > 0)) {
      alert("Please enter an amount greater than 0.");
      return;
    }
    if (!fundFundingDrawer) {
      alert("Please select a funding drawer.");
      return;
    }
    if (fundFundingDrawer === fundTargetDrawer) {
      alert("The funding drawer must be different from the target float.");
      return;
    }

    setIsSubmitting(true);
    try {
      const trimmedNotes = notes.trim();
      const result = await api.drawerTopUp.fundSystem({
        targetDrawer: fundTargetDrawer,
        fundingDrawer: fundFundingDrawer,
        amount_usd: fundCurrency === "USD" ? fundAmount : 0,
        amount_lbp: fundCurrency === "LBP" ? fundAmount : 0,
        ...(trimmedNotes ? { notes: trimmedNotes } : {}),
      });

      if (result.success) {
        appEvents.emit(
          "notification:show",
          `${formatFundBalance(fundAmount, fundCurrency)} moved from ${fundFundingDrawer.replace(/_/g, " ")} into ${fundTargetDrawer.replace(/_/g, " ")}.`,
          "success",
        );
        setFundAmount(0);
        setNotes("");
        onSuccess();
      } else {
        alert(result.error ?? "Failed to fund the system float.");
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Unexpected error.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const currentDrawer = sourceDrawers.find(
    (d) => d.drawer_name === selectedDrawer,
  );

  const fundingDrawerOptions = Object.keys(fundingDrawerBalances)
    .filter((name) => name !== fundTargetDrawer)
    .map((name) => ({ value: name, label: name.replace(/_/g, " ") }));
  const fundFundingBalance =
    fundingDrawerBalances[fundFundingDrawer]?.[fundCurrency] ?? 0;
  const fundInsufficient =
    fundAmount > 0 && fundFundingDrawer !== "" && fundAmount > fundFundingBalance;

  const modalTitle =
    mode === "fund_system" ? "Fund System Float" : "Top Up General Drawer";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md bg-slate-800 border border-slate-700 rounded-xl shadow-2xl p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2">
            {mode === "fund_system" ? (
              <Landmark className="w-5 h-5 text-amber-400" />
            ) : (
              <PlusCircle className="w-5 h-5 text-emerald-400" />
            )}
            <h2 className="text-lg font-bold text-white">{modalTitle}</h2>
          </div>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
          >
            <X size={18} />
          </button>
        </div>

        {/* Mode Toggle */}
        <div className="flex gap-2 mb-5">
          <button
            onClick={() => setMode("external")}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors ${
              mode === "external"
                ? "bg-emerald-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            External (Cash In)
          </button>
          <button
            onClick={() => setMode("from_drawer")}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
              mode === "from_drawer"
                ? "bg-violet-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            <ArrowRightLeft size={14} />
            From Drawer
          </button>
          <button
            data-testid="fund-system-mode-toggle"
            onClick={() => setMode("fund_system")}
            className={`flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-1.5 ${
              mode === "fund_system"
                ? "bg-amber-600 text-white"
                : "bg-slate-700 text-slate-300 hover:bg-slate-600"
            }`}
          >
            <Landmark size={14} />
            Fund System Float
          </button>
        </div>

        {mode === "fund_system" ? (
          <div className="space-y-4">
            <p className="text-xs text-slate-400">
              Hand real money to the OMT/Whish provider so the shop&apos;s
              spendable float goes up. This moves cash between two of the
              shop&apos;s own drawers — it earns no profit.
            </p>

            {/* Target float (fixed two options) */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Target Float
              </label>
              <div data-testid="fund-system-target-drawer-select">
                <Select
                  value={fundTargetDrawer}
                  onChange={(v) => {
                    const next = v as SystemFloatDrawer;
                    setFundTargetDrawer(next);
                    if (fundFundingDrawer === next) {
                      setFundFundingDrawer("");
                    }
                  }}
                  options={SYSTEM_FLOAT_DRAWERS}
                  buttonClassName="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors"
                />
              </div>
            </div>

            {/* Funding drawer (any drawer with a spendable balance) */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Funding Drawer
              </label>
              <div data-testid="fund-system-funding-drawer-select">
                <Select
                  value={fundFundingDrawer}
                  onChange={(v) => setFundFundingDrawer(v)}
                  options={
                    fundingDrawerOptions.length === 0
                      ? [{ value: "", label: "No drawers available" }]
                      : fundingDrawerOptions
                  }
                  buttonClassName="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors"
                />
              </div>
              {fundFundingDrawer && (
                <p className="mt-1.5 text-xs text-slate-500">
                  Balance: {formatFundBalance(fundFundingBalance, fundCurrency)}
                </p>
              )}
            </div>

            {/* Currency */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Currency
              </label>
              <div data-testid="fund-system-currency-select">
                <Select
                  value={fundCurrency}
                  onChange={(v) => setFundCurrency(v as FundCurrency)}
                  options={[
                    { value: "USD", label: "USD" },
                    { value: "LBP", label: "LBP" },
                  ]}
                  buttonClassName="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 transition-colors"
                />
              </div>
            </div>

            {/* Amount */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Amount ({fundCurrency})
              </label>
              <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-amber-500 transition-colors">
                <span className="px-3 text-sm text-slate-400 border-r border-slate-700">
                  {fundCurrency === "USD" ? "$" : "LBP"}
                </span>
                <DecimalInput
                  value={fundAmount}
                  onChange={setFundAmount}
                  decimals={fundCurrency === "LBP" ? 0 : 2}
                  placeholder={fundCurrency === "USD" ? "0.00" : "0"}
                  data-testid="fund-system-amount-input"
                  className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white focus:outline-none placeholder:text-slate-600"
                />
              </div>
              {fundInsufficient && (
                <p className="mt-1.5 text-xs text-red-400">
                  {fundFundingDrawer.replace(/_/g, " ")} only has{" "}
                  {formatFundBalance(fundFundingBalance, fundCurrency)}{" "}
                  available.
                </p>
              )}
            </div>

            {/* Before-you-confirm preview — make the money movement unambiguous */}
            {fundAmount > 0 && fundFundingDrawer && (
              <div
                data-testid="fund-system-preview"
                className="bg-slate-900/60 border border-amber-500/30 rounded-lg px-3 py-2.5 text-xs text-slate-300 space-y-1"
              >
                <p>
                  <span className="text-red-400 font-semibold">−</span>{" "}
                  {formatFundBalance(fundAmount, fundCurrency)} from{" "}
                  <span className="text-white font-medium">
                    {fundFundingDrawer.replace(/_/g, " ")}
                  </span>
                </p>
                <p>
                  <span className="text-emerald-400 font-semibold">+</span>{" "}
                  {formatFundBalance(fundAmount, fundCurrency)} into{" "}
                  <span className="text-white font-medium">
                    {fundTargetDrawer.replace(/_/g, " ")}
                  </span>{" "}
                  float
                </p>
              </div>
            )}

            {/* Notes */}
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Notes <span className="text-slate-600">(optional)</span>
              </label>
              <textarea
                rows={3}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add a note..."
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-amber-500 placeholder:text-slate-600 resize-none transition-colors"
              />
            </div>
          </div>
        ) : (
        <div className="space-y-4">
          {/* Source Drawer Selector (only in from_drawer mode) */}
          {mode === "from_drawer" && (
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Source Drawer
              </label>
              <Select
                value={selectedDrawer}
                onChange={(v) => setSelectedDrawer(v)}
                options={
                  sourceDrawers.length === 0
                    ? [{ value: "", label: "No drawers available" }]
                    : sourceDrawers.map((d) => ({
                        value: d.drawer_name,
                        label: d.drawer_name.replace("_", " "),
                      }))
                }
                buttonClassName="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-colors"
              />
              {currentDrawer && (
                <p className="mt-1.5 text-xs text-slate-500">
                  Balance: ${currentDrawer.balance_usd.toLocaleString()} USD
                  {currentDrawer.balance_lbp > 0 &&
                    ` / ${currentDrawer.balance_lbp.toLocaleString()} LBP`}
                </p>
              )}
            </div>
          )}

          {/* USD Amount */}
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              USD Amount
            </label>
            <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-violet-500 transition-colors">
              <span className="px-3 text-sm text-slate-400 border-r border-slate-700">
                $
              </span>
              <DecimalInput
                value={parseFloat(amountUsd) || 0}
                onChange={(n) => setAmountUsd(n ? String(n) : "")}
                placeholder="0.00"
                className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white focus:outline-none placeholder:text-slate-600"
              />
            </div>
          </div>

          {/* LBP Amount */}
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              LBP Amount
            </label>
            <div className="flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-violet-500 transition-colors">
              <span className="px-3 text-sm text-slate-400 border-r border-slate-700">
                LBP
              </span>
              <DecimalInput
                value={parseFloat(amountLbp) || 0}
                onChange={(n) => setAmountLbp(n ? String(n) : "")}
                placeholder="0"
                className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white focus:outline-none placeholder:text-slate-600"
              />
            </div>
          </div>

          {/* Extra currencies (External mode only) */}
          {mode === "external" && (
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Other Currencies{" "}
                <span className="text-slate-600">(optional)</span>
              </label>

              {availableExtraCurrencies.length === 0 ? (
                <p className="text-xs text-slate-500 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2.5">
                  No additional currencies enabled for the General drawer — add
                  and enable them in Settings → Currencies.
                </p>
              ) : (
                <div className="space-y-2">
                  {extraCurrencies.map((row, index) => {
                    const usedElsewhere = new Set(
                      extraCurrencies
                        .filter((_, i) => i !== index)
                        .map((r) => r.currency_code),
                    );
                    const rowOptions = availableExtraCurrencies
                      .filter((c) => !usedElsewhere.has(c.code))
                      .map((c) => ({
                        value: c.code,
                        label: c.symbol ? `${c.code} (${c.symbol})` : c.code,
                      }));

                    return (
                      <div key={index} className="flex items-center gap-2">
                        <Select
                          value={row.currency_code}
                          onChange={(v) =>
                            updateCurrencyRow(index, { currency_code: v })
                          }
                          options={rowOptions}
                          className="w-28 shrink-0"
                          buttonClassName="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
                        />
                        <div className="flex-1 flex items-center bg-slate-900 border border-slate-700 rounded-lg overflow-hidden focus-within:border-emerald-500 transition-colors">
                          <DecimalInput
                            value={parseFloat(row.amount) || 0}
                            onChange={(n) =>
                              updateCurrencyRow(index, {
                                amount: n ? String(n) : "",
                              })
                            }
                            placeholder="0.00"
                            className="flex-1 bg-transparent px-3 py-2.5 text-sm text-white focus:outline-none placeholder:text-slate-600"
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => removeCurrencyRow(index)}
                          className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 transition-colors"
                          aria-label="Remove currency"
                        >
                          <X size={16} />
                        </button>
                      </div>
                    );
                  })}

                  <button
                    type="button"
                    onClick={addCurrencyRow}
                    disabled={
                      extraCurrencies.length >= availableExtraCurrencies.length
                    }
                    className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 disabled:text-slate-600 disabled:cursor-not-allowed transition-colors"
                  >
                    <Plus size={14} />
                    Add currency
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Notes <span className="text-slate-600">(optional)</span>
            </label>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Add a note..."
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 placeholder:text-slate-600 resize-none transition-colors"
            />
          </div>
        </div>
        )}

        {/* Footer */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={handleClose}
            disabled={isSubmitting}
            className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            data-testid="fund-system-submit"
            onClick={handleSubmit}
            disabled={
              isSubmitting ||
              (mode === "fund_system" &&
                (!(fundAmount > 0) || !fundFundingDrawer))
            }
            className={`flex-1 py-2.5 ${
              mode === "fund_system"
                ? "bg-amber-600 hover:bg-amber-500"
                : mode === "from_drawer"
                  ? "bg-violet-600 hover:bg-violet-500"
                  : "bg-emerald-600 hover:bg-emerald-500"
            } disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-semibold rounded-lg transition-colors`}
          >
            {isSubmitting
              ? "Processing..."
              : mode === "fund_system"
                ? "Fund Float"
                : mode === "from_drawer"
                  ? "Transfer"
                  : "Top Up"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default DrawerTopUpModal;
