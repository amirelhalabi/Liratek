/**
 * Partners Module – LIRA-037
 * Full partner management: balances, ledger, settlements, transactions.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Users,
  Plus,
  Phone,
  FileText,
  TrendingUp,
  TrendingDown,
  Minus,
  X,
  Edit2,
  DollarSign,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  ToggleLeft,
} from "lucide-react";
import { useShopBase } from "@/hooks/useShopBase";
import type {
  Partner,
  PartnerLedgerEntry,
  PartnerBalance,
  PartnerBalanceBreakdown,
  LedgerFilters,
  PartnerWithBalance,
} from "@/types/electron";
import { appEvents, PageHeader, DecimalInput, Select } from "@liratek/ui";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";

// ─── helpers ─────────────────────────────────────────────────────────────────

function fmtUSD(n: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(n);
}

function fmtLBP(n: number) {
  return new Intl.NumberFormat("en-LB", {
    style: "currency",
    currency: "LBP",
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function balanceColor(usd: number, lbp: number) {
  if (usd > 0 || lbp > 0) return "text-emerald-400";
  if (usd < 0 || lbp < 0) return "text-red-400";
  return "text-slate-400";
}

function balanceBorderColor(usd: number, lbp: number) {
  if (usd > 0 || lbp > 0) return "border-emerald-500/30 bg-emerald-900/10";
  if (usd < 0 || lbp < 0) return "border-red-500/30 bg-red-900/10";
  return "border-slate-700/50 bg-slate-800";
}

function BalanceIcon({ usd, lbp }: { usd: number; lbp: number }) {
  if (usd > 0 || lbp > 0)
    return <TrendingUp className="w-4 h-4 text-emerald-400" />;
  if (usd < 0 || lbp < 0)
    return <TrendingDown className="w-4 h-4 text-red-400" />;
  return <Minus className="w-4 h-4 text-slate-400" />;
}

const SETTLEMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "OMT", label: "OMT" },
  { value: "WHISH", label: "Whish" },
  { value: "BINANCE", label: "Binance" },
  { value: "CLIENT_ACCOUNT", label: "Client Account" },
];

/**
 * Manual "Record Transaction" types — LIRA-051.
 *
 * Grouped logically for readability. Only the plain types below are accepted by
 * the manual record path (handler `RecordTransactionInput` / backend
 * `CreateLedgerEntryData`). The `THROUGH_*` / `FOR_*` variants are written
 * automatically by real OMT/Whish transactions (FinancialServiceRepository) and
 * are intentionally NOT offered here — historical entries of those types still
 * display correctly in the ledger table (see LedgerRow).
 */
const TRANSACTION_TYPE_GROUPS: {
  label: string;
  options: { value: string; label: string }[];
}[] = [
  {
    label: "General",
    options: [
      { value: "ADJUSTMENT", label: "Adjustment" },
      { value: "SETTLEMENT", label: "Settlement" },
    ],
  },
  {
    label: "OMT",
    options: [
      { value: "OMT_SEND", label: "OMT Send" },
      { value: "OMT_RECEIVE", label: "OMT Receive" },
    ],
  },
  {
    label: "Whish",
    options: [
      { value: "WHISH_SEND", label: "Whish Send" },
      { value: "WHISH_RECEIVE", label: "Whish Receive" },
    ],
  },
  {
    label: "Other",
    options: [{ value: "CUSTOM_SERVICE", label: "Custom Service" }],
  },
];

// ─── Modal shell ──────────────────────────────────────────────────────────────

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useModalFocusFix(true);
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <h2 className="text-white font-semibold text-base">{title}</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ─── Add/Edit Partner Modal ───────────────────────────────────────────────────

interface PartnerFormModalProps {
  partner: Partner | null; // null = add mode
  onClose: () => void;
  onSaved: () => void;
}

function PartnerFormModal({
  partner,
  onClose,
  onSaved,
}: PartnerFormModalProps) {
  const { partnerSystem } = useShopBase();
  const [name, setName] = useState(partner?.name ?? "");
  const [phone, setPhone] = useState(partner?.phone ?? "");
  const [notes, setNotes] = useState(partner?.notes ?? "");
  const [systemAssociation, setSystemAssociation] = useState<string>(
    partner?.system_association ?? partnerSystem,
  );
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    if (!name.trim()) {
      appEvents.emit("notification:show", "Partner name is required.", "error");
      return;
    }
    setSubmitting(true);
    try {
      let result;
      if (partner) {
        result = await window.api.partners.update(partner.id, {
          name: name.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          system_association: systemAssociation || null,
        });
      } else {
        result = await window.api.partners.create({
          name: name.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          system_association: systemAssociation || null,
        });
      }
      if (result.success) {
        appEvents.emit(
          "notification:show",
          partner ? "Partner updated." : "Partner created.",
          "success",
        );
        onSaved();
        onClose();
      } else {
        appEvents.emit(
          "notification:show",
          result.error ?? "Failed to save partner.",
          "error",
        );
      }
    } catch {
      appEvents.emit(
        "notification:show",
        "Unexpected error saving partner.",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={partner ? "Edit Partner" : "Add Partner"} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="text-xs text-slate-400 block mb-1">
            Name <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
            placeholder="Partner name"
            autoFocus
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Phone</label>
          <input
            type="text"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
            placeholder="+961 XX XXX XXX"
          />
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">
            System Association
          </label>
          <Select
            value={systemAssociation}
            onChange={(v) => setSystemAssociation(v)}
            options={[
              { value: "", label: "None" },
              {
                value: partnerSystem,
                label: partnerSystem === "WHISH" ? "Whish System" : "OMT System",
              },
            ]}
            buttonClassName="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
          />
          <p className="text-xs text-slate-500 mt-1">
            Associate this partner with a system to access transactions on that
            system's page.
          </p>
        </div>
        <div>
          <label className="text-xs text-slate-400 block mb-1">Notes</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500 resize-none"
            placeholder="Optional notes..."
          />
        </div>
        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium rounded-lg transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !name.trim()}
            className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors text-sm"
          >
            {submitting ? "Saving..." : partner ? "Update" : "Create"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Settlement Modal ─────────────────────────────────────────────────────────

interface SettleModalProps {
  partner: PartnerWithBalance;
  onClose: () => void;
  onSettled: () => void;
}

function SettleModal({ partner, onClose, onSettled }: SettleModalProps) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"USD" | "LBP">("USD");
  const [method, setMethod] = useState("CASH");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const parsedAmount = parseFloat(amount) || 0;
  const isValid = parsedAmount > 0;

  async function handleSettle() {
    if (!isValid) {
      appEvents.emit("notification:show", "Enter a valid amount.", "error");
      return;
    }
    setSubmitting(true);
    try {
      const result = await window.api.partners.settle({
        partnerId: partner.id,
        amount: parsedAmount,
        currency,
        settlementMethod: method,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      if (result.success) {
        appEvents.emit("notification:show", "Settlement recorded.", "success");
        onSettled();
        onClose();
      } else {
        appEvents.emit(
          "notification:show",
          result.error ?? "Failed to settle.",
          "error",
        );
      }
    } catch {
      appEvents.emit(
        "notification:show",
        "Unexpected error during settlement.",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Settle – ${partner.name}`} onClose={onClose}>
      <div className="space-y-4">
        {/* Current balance reference */}
        <div className="bg-slate-900 rounded-lg p-3 flex gap-4 text-sm">
          <div>
            <span className="text-slate-400 text-xs block">Balance USD</span>
            <span className={`font-semibold ${balanceColor(partner.usd, 0)}`}>
              {fmtUSD(partner.usd)}
            </span>
          </div>
          <div>
            <span className="text-slate-400 text-xs block">Balance LBP</span>
            <span className={`font-semibold ${balanceColor(0, partner.lbp)}`}>
              {fmtLBP(partner.lbp)}
            </span>
          </div>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs text-slate-400 block mb-1">Amount</label>
            <DecimalInput
              value={parseFloat(amount) || 0}
              onChange={(n) => setAmount(n ? String(n) : "")}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
              placeholder="0.00"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Currency
            </label>
            <Select
              value={currency}
              onChange={(v) => setCurrency(v as "USD" | "LBP")}
              options={[
                { value: "USD", label: "USD" },
                { value: "LBP", label: "LBP" },
              ]}
              buttonClassName="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">
            Settlement Method
          </label>
          <Select
            value={method}
            onChange={(v) => setMethod(v)}
            options={SETTLEMENT_METHODS.map((m) => ({
              value: m.value,
              label: m.label,
            }))}
            buttonClassName="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
          />
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">Notes</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
            placeholder="Optional notes..."
          />
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium rounded-lg transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleSettle}
            disabled={submitting || !isValid}
            className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors text-sm"
          >
            {submitting ? "Processing..." : "Confirm Settlement"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Record Transaction Modal ─────────────────────────────────────────────────

interface RecordTxModalProps {
  partner: PartnerWithBalance;
  onClose: () => void;
  onRecorded: () => void;
}

function RecordTxModal({ partner, onClose, onRecorded }: RecordTxModalProps) {
  const [txType, setTxType] = useState("ADJUSTMENT");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"USD" | "LBP">("USD");
  const [direction, setDirection] = useState<"DEBIT" | "CREDIT">("DEBIT");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const parsedAmount = parseFloat(amount) || 0;
  const isValid = parsedAmount > 0;

  async function handleRecord() {
    if (!isValid) {
      appEvents.emit("notification:show", "Enter a valid amount.", "error");
      return;
    }
    setSubmitting(true);
    try {
      const result = await window.api.partners.recordTransaction({
        partnerId: partner.id,
        transactionType: txType,
        amount: parsedAmount,
        currency,
        direction,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      });
      if (result.success) {
        appEvents.emit("notification:show", "Transaction recorded.", "success");
        onRecorded();
        onClose();
      } else {
        appEvents.emit(
          "notification:show",
          result.error ?? "Failed to record transaction.",
          "error",
        );
      }
    } catch {
      appEvents.emit(
        "notification:show",
        "Unexpected error recording transaction.",
        "error",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Record Transaction – ${partner.name}`} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className="text-xs text-slate-400 block mb-1">
            Transaction Type
          </label>
          <select
            value={txType}
            onChange={(e) => setTxType(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
          >
            {TRANSACTION_TYPE_GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.options.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        <div className="flex gap-3">
          <div className="flex-1">
            <label className="text-xs text-slate-400 block mb-1">Amount</label>
            <DecimalInput
              value={parseFloat(amount) || 0}
              onChange={(n) => setAmount(n ? String(n) : "")}
              className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
              placeholder="0.00"
              autoFocus
            />
          </div>
          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Currency
            </label>
            <Select
              value={currency}
              onChange={(v) => setCurrency(v as "USD" | "LBP")}
              options={[
                { value: "USD", label: "USD" },
                { value: "LBP", label: "LBP" },
              ]}
              buttonClassName="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">Direction</label>
          <div className="flex gap-2">
            <button
              onClick={() => setDirection("DEBIT")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors border ${
                direction === "DEBIT"
                  ? "bg-emerald-900/40 border-emerald-600 text-emerald-300"
                  : "bg-slate-700 border-slate-600 text-slate-400 hover:text-white"
              }`}
            >
              <ArrowUpRight className="w-3.5 h-3.5" />
              DEBIT (they owe us)
            </button>
            <button
              onClick={() => setDirection("CREDIT")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors border ${
                direction === "CREDIT"
                  ? "bg-red-900/40 border-red-600 text-red-300"
                  : "bg-slate-700 border-slate-600 text-slate-400 hover:text-white"
              }`}
            >
              <ArrowDownLeft className="w-3.5 h-3.5" />
              CREDIT (we owe them)
            </button>
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">Notes</label>
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
            placeholder="Optional notes..."
          />
        </div>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium rounded-lg transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleRecord}
            disabled={submitting || !isValid}
            className="flex-1 py-2.5 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors text-sm"
          >
            {submitting ? "Recording..." : "Record Transaction"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Deactivate Confirm Modal ─────────────────────────────────────────────────

function DeactivateModal({
  partner,
  onClose,
  onDeactivated,
}: {
  partner: PartnerWithBalance;
  onClose: () => void;
  onDeactivated: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  async function handleDeactivate() {
    setSubmitting(true);
    try {
      const result = await window.api.partners.deactivate(partner.id);
      if (result.success) {
        appEvents.emit("notification:show", "Partner deactivated.", "success");
        onDeactivated();
        onClose();
      } else {
        appEvents.emit(
          "notification:show",
          result.error ?? "Failed to deactivate.",
          "error",
        );
      }
    } catch {
      appEvents.emit("notification:show", "Unexpected error.", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Deactivate Partner" onClose={onClose}>
      <div className="space-y-4">
        <p className="text-slate-300 text-sm">
          Are you sure you want to deactivate{" "}
          <span className="text-white font-semibold">{partner.name}</span>? They
          will be hidden from the active list but their history will be
          preserved.
        </p>
        <div className="flex gap-3 pt-1">
          <button
            onClick={onClose}
            className="flex-1 py-2.5 bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium rounded-lg transition-colors text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleDeactivate}
            disabled={submitting}
            className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors text-sm"
          >
            {submitting ? "Deactivating..." : "Deactivate"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Ledger Table Row ─────────────────────────────────────────────────────────

function parseTransactionType(raw: string | null): {
  modeBadge: string | null;
  modeColor: string;
  typeLabel: string;
} {
  if (!raw) return { modeBadge: null, modeColor: "", typeLabel: "—" };
  if (raw.startsWith("FOR_")) {
    return {
      modeBadge: "FOR",
      modeColor: "bg-violet-900/50 text-violet-300 border-violet-700/50",
      typeLabel: raw.slice(4).replace(/_/g, " "),
    };
  }
  if (raw.startsWith("THROUGH_")) {
    return {
      modeBadge: "THROUGH",
      modeColor: "bg-sky-900/50 text-sky-300 border-sky-700/50",
      typeLabel: raw.slice(8).replace(/_/g, " "),
    };
  }
  return { modeBadge: null, modeColor: "", typeLabel: raw.replace(/_/g, " ") };
}

function LedgerRow({ entry }: { entry: PartnerLedgerEntry }) {
  const [expanded, setExpanded] = useState(false);
  const isDebit = entry.direction === "DEBIT";
  const { modeBadge, modeColor, typeLabel } = parseTransactionType(
    entry.transaction_type,
  );
  const hasDetails =
    entry.reference_table === "financial_services" &&
    entry.reference_id != null;

  return (
    <>
      <tr
        className={`transition-colors ${
          isDebit ? "hover:bg-emerald-900/10" : "hover:bg-red-900/10"
        } ${hasDetails ? "cursor-pointer" : ""}`}
        onClick={() => hasDetails && setExpanded((v) => !v)}
      >
        <td className="px-4 py-3 text-slate-300 whitespace-nowrap text-xs">
          {fmtDate(entry.created_at)}
        </td>
        <td className="px-4 py-3">
          <div className="flex items-center gap-1.5 flex-wrap">
            {modeBadge && (
              <span
                className={`inline-block text-[10px] px-1.5 py-0.5 rounded border font-semibold ${modeColor}`}
              >
                {modeBadge}
              </span>
            )}
            <span className="text-slate-300 text-xs font-medium">
              {typeLabel}
            </span>
            {entry.settlement_method && (
              <span className="text-xs text-slate-500">
                via {entry.settlement_method}
              </span>
            )}
          </div>
        </td>
        <td className="px-4 py-3">
          {isDebit ? (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-400 font-medium">
              <ArrowUpRight className="w-3 h-3" />
              DEBIT
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-xs text-red-400 font-medium">
              <ArrowDownLeft className="w-3 h-3" />
              CREDIT
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-right font-mono font-semibold whitespace-nowrap">
          <span className={isDebit ? "text-emerald-400" : "text-red-400"}>
            {entry.currency === "USD"
              ? fmtUSD(entry.amount)
              : fmtLBP(entry.amount)}
          </span>
        </td>
        <td className="px-4 py-3 text-slate-400 text-xs max-w-[180px] truncate">
          {entry.notes ?? "—"}
        </td>
        <td className="px-3 py-3 text-center w-8">
          {hasDetails ? (
            expanded ? (
              <ChevronUp className="w-3.5 h-3.5 text-slate-400 mx-auto" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5 text-slate-400 mx-auto" />
            )
          ) : null}
        </td>
      </tr>
      {expanded && hasDetails && (
        <tr className="bg-slate-900/60">
          <td colSpan={6} className="px-6 py-3">
            <div className="grid grid-cols-2 gap-x-8 gap-y-1 text-xs">
              {entry.fs_customer && (
                <div className="flex gap-2">
                  <span className="text-slate-500 w-20 shrink-0">Customer</span>
                  <span className="text-slate-200 font-medium">
                    {entry.fs_customer}
                  </span>
                </div>
              )}
              {entry.fs_reference_number && (
                <div className="flex gap-2">
                  <span className="text-slate-500 w-20 shrink-0">Ref #</span>
                  <span className="text-slate-200 font-medium">
                    {entry.fs_reference_number}
                  </span>
                </div>
              )}
              {entry.fs_phone_number && (
                <div className="flex gap-2">
                  <span className="text-slate-500 w-20 shrink-0">Phone</span>
                  <span className="text-slate-200">{entry.fs_phone_number}</span>
                </div>
              )}
              {entry.fs_provider && (
                <div className="flex gap-2">
                  <span className="text-slate-500 w-20 shrink-0">Provider</span>
                  <span className="text-slate-200">
                    {entry.fs_provider} {entry.fs_service_type}
                  </span>
                </div>
              )}
              {entry.fs_amount != null && (
                <div className="flex gap-2">
                  <span className="text-slate-500 w-20 shrink-0">Amount</span>
                  <span className="text-slate-200">
                    {entry.fs_currency === "USD"
                      ? fmtUSD(entry.fs_amount)
                      : fmtLBP(entry.fs_amount)}
                    {entry.fs_fee != null && entry.fs_fee > 0 && (
                      <span className="text-slate-400 ml-1">
                        + {fmtUSD(entry.fs_fee)} fee
                      </span>
                    )}
                  </span>
                </div>
              )}
              <div className="flex gap-2">
                <span className="text-slate-500 w-20 shrink-0">Txn ID</span>
                <span className="text-slate-400">#{entry.reference_id}</span>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Partner Detail Panel ─────────────────────────────────────────────────────

interface DetailPanelProps {
  partner: PartnerWithBalance;
  onEdit: () => void;
  onSettle: () => void;
  onRecordTx: () => void;
  onDeactivate: () => void;
  onActivate: () => void;
}

function DetailPanel({
  partner,
  onEdit,
  onSettle,
  onRecordTx,
  onDeactivate,
  onActivate,
}: DetailPanelProps) {
  const [entries, setEntries] = useState<PartnerLedgerEntry[]>([]);
  const [balance, setBalance] = useState<PartnerBalance>({
    usd: partner.usd,
    lbp: partner.lbp,
  });
  const [breakdown, setBreakdown] = useState<PartnerBalanceBreakdown | null>(
    null,
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filterFrom, setFilterFrom] = useState("");
  const [filterTo, setFilterTo] = useState("");
  const [filterMode, setFilterMode] = useState<"" | "FOR" | "THROUGH">("");
  const [filterProvider, setFilterProvider] = useState<
    "" | "OMT" | "WHISH" | "BINANCE"
  >("");
  const [filterDirection, setFilterDirection] = useState<
    "" | "DEBIT" | "CREDIT"
  >("");

  const loadLedger = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const filters: LedgerFilters = {};
      if (filterFrom) filters.startDate = filterFrom;
      if (filterTo) filters.endDate = filterTo;
      if (filterMode) filters.mode = filterMode;
      if (filterProvider) filters.provider = filterProvider;
      if (filterDirection) filters.direction = filterDirection;
      const result = await window.api.partners.getLedger(
        partner.id,
        Object.keys(filters).length ? filters : undefined,
      );
      setEntries(result.entries);
      setBalance(result.balance);
      setBreakdown(result.breakdown ?? null);
    } catch {
      setError("Failed to load ledger.");
    } finally {
      setLoading(false);
    }
  }, [
    partner.id,
    filterFrom,
    filterTo,
    filterMode,
    filterProvider,
    filterDirection,
  ]);

  useEffect(() => {
    loadLedger();
  }, [loadLedger]);

  return (
    <div className="flex flex-col h-full">
      {/* Partner Info Header */}
      <div className="bg-slate-800 border border-slate-700/50 rounded-xl p-4 mb-4">
        <div className="flex items-start justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-white text-lg font-bold">{partner.name}</h2>
              {!partner.is_active && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-400 border border-slate-600">
                  Inactive
                </span>
              )}
              {partner.system_association && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-[#ff0a46]/15 text-[#ff0a46] border border-[#ff0a46]/30 font-semibold">
                  {partner.system_association} System
                </span>
              )}
            </div>
            {partner.phone && (
              <div className="flex items-center gap-1.5 mt-1 text-slate-400 text-sm">
                <Phone className="w-3.5 h-3.5" />
                <span>{partner.phone}</span>
              </div>
            )}
            {partner.notes && (
              <div className="flex items-start gap-1.5 mt-1 text-slate-400 text-sm">
                <FileText className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>{partner.notes}</span>
              </div>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onEdit}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 hover:text-white rounded-lg text-xs font-medium transition-colors"
            >
              <Edit2 className="w-3.5 h-3.5" />
              Edit
            </button>
            <button
              onClick={onSettle}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-700 hover:bg-emerald-600 text-emerald-100 rounded-lg text-xs font-medium transition-colors"
            >
              <DollarSign className="w-3.5 h-3.5" />
              Settle
            </button>
            <button
              onClick={onRecordTx}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-violet-700 hover:bg-violet-600 text-violet-100 rounded-lg text-xs font-medium transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              Record Tx
            </button>
            {partner.is_active === 1 && (
              <button
                onClick={onDeactivate}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-900/60 hover:bg-red-700 text-red-300 hover:text-red-100 rounded-lg text-xs font-medium transition-colors"
              >
                <ToggleLeft className="w-3.5 h-3.5" />
                Deactivate
              </button>
            )}
            {partner.is_active === 0 && (
              <button
                onClick={onActivate}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-900/60 hover:bg-emerald-700 text-emerald-300 hover:text-emerald-100 rounded-lg text-xs font-medium transition-colors"
              >
                <ToggleLeft className="w-3.5 h-3.5" />
                Activate
              </button>
            )}
          </div>
        </div>

        {/* Balances */}
        <div className="grid grid-cols-2 gap-3">
          <div
            className={`rounded-lg border p-3 ${balanceBorderColor(balance.usd, 0)}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <BalanceIcon usd={balance.usd} lbp={0} />
              <span className="text-xs text-slate-400">USD Balance</span>
            </div>
            <p className={`text-xl font-bold ${balanceColor(balance.usd, 0)}`}>
              {fmtUSD(balance.usd)}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {balance.usd > 0
                ? "They owe us"
                : balance.usd < 0
                  ? "We owe them"
                  : "Settled"}
            </p>
            {breakdown && (
              <div className="mt-2 pt-2 border-t border-slate-700/50 space-y-0.5">
                {breakdown.usd.for !== 0 && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-violet-400">FOR (our system)</span>
                    <span
                      className={
                        breakdown.usd.for > 0
                          ? "text-emerald-400"
                          : "text-red-400"
                      }
                    >
                      {fmtUSD(breakdown.usd.for)}
                    </span>
                  </div>
                )}
                {breakdown.usd.through !== 0 && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-sky-400">THROUGH (their system)</span>
                    <span
                      className={
                        breakdown.usd.through > 0
                          ? "text-emerald-400"
                          : "text-red-400"
                      }
                    >
                      {fmtUSD(breakdown.usd.through)}
                    </span>
                  </div>
                )}
                {breakdown.usd.other !== 0 && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-500">Settlements / Adj.</span>
                    <span
                      className={
                        breakdown.usd.other > 0
                          ? "text-emerald-400"
                          : "text-red-400"
                      }
                    >
                      {fmtUSD(breakdown.usd.other)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
          <div
            className={`rounded-lg border p-3 ${balanceBorderColor(0, balance.lbp)}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <BalanceIcon usd={0} lbp={balance.lbp} />
              <span className="text-xs text-slate-400">LBP Balance</span>
            </div>
            <p className={`text-xl font-bold ${balanceColor(0, balance.lbp)}`}>
              {fmtLBP(balance.lbp)}
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
              {balance.lbp > 0
                ? "They owe us"
                : balance.lbp < 0
                  ? "We owe them"
                  : "Settled"}
            </p>
            {breakdown && (
              <div className="mt-2 pt-2 border-t border-slate-700/50 space-y-0.5">
                {breakdown.lbp.for !== 0 && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-violet-400">FOR (our system)</span>
                    <span
                      className={
                        breakdown.lbp.for > 0
                          ? "text-emerald-400"
                          : "text-red-400"
                      }
                    >
                      {fmtLBP(breakdown.lbp.for)}
                    </span>
                  </div>
                )}
                {breakdown.lbp.through !== 0 && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-sky-400">THROUGH (their system)</span>
                    <span
                      className={
                        breakdown.lbp.through > 0
                          ? "text-emerald-400"
                          : "text-red-400"
                      }
                    >
                      {fmtLBP(breakdown.lbp.through)}
                    </span>
                  </div>
                )}
                {breakdown.lbp.other !== 0 && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-500">Settlements / Adj.</span>
                    <span
                      className={
                        breakdown.lbp.other > 0
                          ? "text-emerald-400"
                          : "text-red-400"
                      }
                    >
                      {fmtLBP(breakdown.lbp.other)}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Ledger Filters */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <input
          type="date"
          value={filterFrom}
          onChange={(e) => setFilterFrom(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-violet-500"
        />
        <span className="text-slate-500 text-xs">–</span>
        <input
          type="date"
          value={filterTo}
          onChange={(e) => setFilterTo(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-violet-500"
        />
        <Select
          value={filterMode}
          onChange={(v) => setFilterMode(v as "" | "FOR" | "THROUGH")}
          options={[
            { value: "", label: "All modes" },
            { value: "FOR", label: "FOR (our system)" },
            { value: "THROUGH", label: "THROUGH (their system)" },
          ]}
          buttonClassName="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-violet-500"
        />
        <Select
          value={filterProvider}
          onChange={(v) => setFilterProvider(v as "" | "OMT" | "WHISH" | "BINANCE")}
          options={[
            { value: "", label: "All providers" },
            { value: "OMT", label: "OMT" },
            { value: "WHISH", label: "Whish" },
            { value: "BINANCE", label: "Binance" },
          ]}
          buttonClassName="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-violet-500"
        />
        <Select
          value={filterDirection}
          onChange={(v) => setFilterDirection(v as "" | "DEBIT" | "CREDIT")}
          options={[
            { value: "", label: "All directions" },
            { value: "DEBIT", label: "Debit (they owe us)" },
            { value: "CREDIT", label: "Credit (we owe them)" },
          ]}
          buttonClassName="bg-slate-800 border border-slate-700 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-violet-500"
        />
        {(filterFrom ||
          filterTo ||
          filterMode ||
          filterProvider ||
          filterDirection) && (
          <button
            onClick={() => {
              setFilterFrom("");
              setFilterTo("");
              setFilterMode("");
              setFilterProvider("");
              setFilterDirection("");
            }}
            className="text-xs text-slate-400 hover:text-white transition-colors"
          >
            Clear all
          </button>
        )}
        <button
          onClick={loadLedger}
          className="ml-auto flex items-center gap-1.5 text-xs text-slate-400 hover:text-white transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Ledger Table */}
      <div className="flex-1 overflow-auto rounded-xl border border-slate-700/50">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-slate-400 text-sm gap-2">
            <div className="w-5 h-5 border-2 border-slate-600 border-t-violet-500 rounded-full animate-spin" />
            Loading ledger...
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-32 text-red-400 text-sm gap-2">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        ) : entries.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 text-slate-500 text-sm gap-2">
            <FileText className="w-8 h-8 opacity-30" />
            No transactions found
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-900 sticky top-0 z-10">
              <tr>
                <th className="text-left text-xs text-slate-400 px-4 py-3 font-medium">
                  Date
                </th>
                <th className="text-left text-xs text-slate-400 px-4 py-3 font-medium">
                  Type
                </th>
                <th className="text-left text-xs text-slate-400 px-4 py-3 font-medium">
                  Direction
                </th>
                <th className="text-right text-xs text-slate-400 px-4 py-3 font-medium">
                  Amount
                </th>
                <th className="text-left text-xs text-slate-400 px-4 py-3 font-medium">
                  Notes
                </th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-700/60">
              {entries.map((entry) => (
                <LedgerRow key={entry.id} entry={entry} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Partner List Card ────────────────────────────────────────────────────────

function PartnerCard({
  partner: p,
  isSelected,
  onToggle,
}: {
  partner: PartnerWithBalance;
  isSelected: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      className={`w-full text-left rounded-xl border p-3 transition-all ${
        isSelected
          ? "border-violet-500/60 bg-violet-900/20"
          : `${balanceBorderColor(p.usd, p.lbp)} hover:border-slate-600`
      }`}
    >
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          <span className="text-white text-sm font-semibold truncate max-w-[130px]">
            {p.name}
          </span>
          {!p.is_active && (
            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-slate-500">
              off
            </span>
          )}
          {p.system_association && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-[#ff0a46]/15 text-[#ff0a46] font-semibold">
              {p.system_association}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <BalanceIcon usd={p.usd} lbp={p.lbp} />
          <ChevronRight
            className={`w-3.5 h-3.5 transition-transform text-slate-500 ${
              isSelected ? "rotate-90 text-violet-400" : ""
            }`}
          />
        </div>
      </div>
      {p.phone && (
        <div className="flex items-center gap-1 text-slate-500 text-xs mb-1.5">
          <Phone className="w-3 h-3" />
          {p.phone}
        </div>
      )}
      <div className="flex gap-2">
        <span
          className={`text-xs font-mono font-medium ${balanceColor(p.usd, p.lbp)}`}
        >
          {fmtUSD(p.usd)}
        </span>
        <span className="text-slate-600 text-xs">·</span>
        <span
          className={`text-xs font-mono font-medium ${balanceColor(p.usd, p.lbp)}`}
        >
          {fmtLBP(p.lbp)}
        </span>
      </div>
    </button>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export function PartnersPage() {
  const [partners, setPartners] = useState<PartnerWithBalance[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeInactive, setIncludeInactive] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  // Modal visibility
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingPartner, setEditingPartner] = useState<Partner | null>(null);
  const [settlingPartner, setSettlingPartner] =
    useState<PartnerWithBalance | null>(null);
  const [recordingTxPartner, setRecordingTxPartner] =
    useState<PartnerWithBalance | null>(null);
  const [deactivatingPartner, setDeactivatingPartner] =
    useState<PartnerWithBalance | null>(null);

  const selectedPartner = partners.find((p) => p.id === selectedId) ?? null;

  const loadPartners = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.api.partners.getAllBalances(true);
      const filtered = includeInactive
        ? data
        : data.filter((p) => p.is_active === 1);
      setPartners(filtered);
      // If currently selected is no longer in list, clear selection
      if (selectedId && !filtered.find((p) => p.id === selectedId)) {
        setSelectedId(null);
      }
    } catch {
      appEvents.emit("notification:show", "Failed to load partners.", "error");
    } finally {
      setLoading(false);
    }
  }, [includeInactive]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    loadPartners();
  }, [loadPartners]);

  // Summary stats
  const totalOwedToUs = partners.reduce(
    (acc, p) => ({
      usd: acc.usd + Math.max(0, p.usd),
      lbp: acc.lbp + Math.max(0, p.lbp),
    }),
    { usd: 0, lbp: 0 },
  );
  const totalWeOwe = partners.reduce(
    (acc, p) => ({
      usd: acc.usd + Math.abs(Math.min(0, p.usd)),
      lbp: acc.lbp + Math.abs(Math.min(0, p.lbp)),
    }),
    { usd: 0, lbp: 0 },
  );

  return (
    <div className="h-full flex flex-col gap-6 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 min-h-0 overflow-hidden animate-in fade-in duration-500">
      {/* ── Header ── */}
      <PageHeader
        icon={Users}
        title="Partners"
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(e) => setIncludeInactive(e.target.checked)}
                className="rounded border-slate-600 bg-slate-700 text-violet-500"
              />
              Show inactive
            </label>
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 text-white text-sm font-semibold rounded-lg transition-colors"
            >
              <Plus className="w-4 h-4" />
              Add Partner
            </button>
          </div>
        }
      />

      {/* ── Summary Cards ── */}
      <div className="shrink-0">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-800 border border-emerald-700/30 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <TrendingUp className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-slate-400">Partners owe us</span>
            </div>
            <div className="flex items-baseline gap-3">
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                  USD
                </span>
                <p className="text-lg font-bold text-emerald-400">
                  {fmtUSD(totalOwedToUs.usd)}
                </p>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                  LBP
                </span>
                <p className="text-lg font-bold text-emerald-400">
                  {fmtLBP(totalOwedToUs.lbp)}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-slate-800 border border-red-700/30 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <TrendingDown className="w-4 h-4 text-red-400" />
              <span className="text-xs text-slate-400">We owe partners</span>
            </div>
            <div className="flex items-baseline gap-3">
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                  USD
                </span>
                <p className="text-lg font-bold text-red-400">
                  {fmtUSD(totalWeOwe.usd)}
                </p>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                  LBP
                </span>
                <p className="text-lg font-bold text-red-400">
                  {fmtLBP(totalWeOwe.lbp)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Main Body: Partner List + Detail ── */}
      <div className="flex flex-1 gap-4 px-6 pb-6 overflow-hidden min-h-0">
        {/* Left: Partner List */}
        <div className="w-72 shrink-0 flex flex-col gap-2 overflow-y-auto">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-32 text-slate-400 text-sm gap-2">
              <div className="w-6 h-6 border-2 border-slate-600 border-t-violet-500 rounded-full animate-spin" />
              Loading...
            </div>
          ) : partners.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 text-slate-500 text-sm gap-2">
              <Users className="w-8 h-8 opacity-30" />
              No partners yet
            </div>
          ) : (
            partners.map((p) => (
              <PartnerCard
                key={p.id}
                partner={p}
                isSelected={selectedId === p.id}
                onToggle={() =>
                  setSelectedId(p.id === selectedId ? null : p.id)
                }
              />
            ))
          )}
        </div>

        {/* Right: Detail Panel */}
        <div className="flex-1 min-w-0">
          {selectedPartner ? (
            <DetailPanel
              key={selectedPartner.id}
              partner={selectedPartner}
              onEdit={() => setEditingPartner(selectedPartner)}
              onSettle={() => setSettlingPartner(selectedPartner)}
              onRecordTx={() => setRecordingTxPartner(selectedPartner)}
              onDeactivate={() => setDeactivatingPartner(selectedPartner)}
              onActivate={async () => {
                const result = await window.api.partners.activate(
                  selectedPartner.id,
                );
                if (result.success) {
                  appEvents.emit(
                    "notification:show",
                    "Partner activated.",
                    "success",
                  );
                  loadPartners();
                } else {
                  appEvents.emit(
                    "notification:show",
                    result.error ?? "Failed to activate.",
                    "error",
                  );
                }
              }}
            />
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-slate-500 gap-3">
              <div className="p-4 bg-slate-800 rounded-2xl border border-slate-700">
                <Users className="w-10 h-10 opacity-30" />
              </div>
              <p className="text-sm">Select a partner to view details</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Modals ── */}
      {showAddModal && (
        <PartnerFormModal
          partner={null}
          onClose={() => setShowAddModal(false)}
          onSaved={loadPartners}
        />
      )}
      {editingPartner && (
        <PartnerFormModal
          partner={editingPartner}
          onClose={() => setEditingPartner(null)}
          onSaved={loadPartners}
        />
      )}
      {settlingPartner && (
        <SettleModal
          partner={settlingPartner}
          onClose={() => setSettlingPartner(null)}
          onSettled={loadPartners}
        />
      )}
      {recordingTxPartner && (
        <RecordTxModal
          partner={recordingTxPartner}
          onClose={() => setRecordingTxPartner(null)}
          onRecorded={loadPartners}
        />
      )}
      {deactivatingPartner && (
        <DeactivateModal
          partner={deactivatingPartner}
          onClose={() => setDeactivatingPartner(null)}
          onDeactivated={() => {
            setSelectedId(null);
            loadPartners();
          }}
        />
      )}
    </div>
  );
}

export default PartnersPage;
