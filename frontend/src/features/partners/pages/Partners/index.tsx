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
  Wallet,
  ArrowDownLeft,
  ArrowUpRight,
  RefreshCw,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  AlertCircle,
  ToggleLeft,
  Eraser,
} from "lucide-react";
import { useShopBase } from "@/hooks/useShopBase";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useSellRate } from "@/hooks/useSellRate";
import type {
  Partner,
  PartnerLedgerEntry,
  PartnerBalance,
  PartnerBalanceBreakdown,
  LedgerFilters,
  PartnerWithBalance,
} from "@/types/electron";
import {
  appEvents,
  BALANCE_BORDER_COLOR,
  BALANCE_EPS,
  BALANCE_TEXT_COLOR,
  balanceTextColor,
  combinedBalanceBucket,
  CounterpartySettleModal,
  PageHeader,
  DecimalInput,
  Select,
  useApi,
  type PaymentLine,
  type PaymentMethod,
  type ServiceProviderEntity,
} from "@liratek/ui";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { formatCurrency } from "@/utils/currency";
import {
  capSettlementDiscount,
  discountRoomAfterSettlement,
  isDiscountClippedBySettlement,
} from "../../utils/settlementDiscount";

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

/**
 * USDT — `partner_ledger.currency` and `financial_services.currency` both
 * carry USDT as a real third currency (neither column has a CHECK
 * constraint; the Binance flow writes it explicitly, e.g. `CryptoForm.tsx`'s
 * `currency: "USDT"` on `addOMTTransaction`). Reuses the existing generic
 * `formatCurrency` (rule 14) — the SAME "N.NN USDT" suffix convention
 * already displayed inline for USDT elsewhere in the app (`CryptoForm.tsx`,
 * `CompactStats.tsx`) — rather than inventing a new one.
 */
function fmtUSDT(n: number) {
  return formatCurrency(n, "USDT");
}

/**
 * Single named dispatcher (rule 14) for a ledger amount's USD/LBP/USDT
 * formatter choice. Before this fix, `LedgerRow` had TWO copies of a
 * two-way `currency === "USD" ? fmtUSD(...) : fmtLBP(...)` ternary (its own
 * amount cell, and the expanded financial-service detail row's amount) —
 * both silently ran a USDT amount through `fmtLBP`, which is not just the
 * wrong symbol but also the wrong rounding (`fmtLBP` has
 * `maximumFractionDigits: 0`): a 45.50 USDT entry rendered "LBP 46".
 * Unrecognized/null currency falls through to `fmtLBP`, matching the prior
 * ternaries' behaviour for anything that wasn't literally "USD".
 */
function fmtByCurrency(amount: number, currency: string | null): string {
  if (currency === "USD") return fmtUSD(amount);
  if (currency === "USDT") return fmtUSDT(amount);
  return fmtLBP(amount);
}

function fmtDate(iso: string) {
  return parseDbDate(iso).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * `usd`/`lbp` = `SUM(DEBIT) - SUM(CREDIT)` (`PartnerRepository.getBalance`):
 * DEBIT = partner owes the shop (positive), CREDIT = shop owes the partner
 * (negative) — see the ledger comment above `LedgerRow`. So POSITIVE here
 * means the OPPOSITE of the owner's rule ("positive = shop owes"); the
 * normalized "shop owes" amount is `-usd`/`-lbp`, which is what gets handed
 * to the shared `@liratek/ui` bucket/colour helpers. Two bugs fixed
 * together (Balance Pages colour audit, 2026-08-11):
 *   1. Polarity — CREDIT (negative usd/lbp, shop owes) is now GREEN, DEBIT
 *      (positive, partner owes shop) is now RED. Was the reverse.
 *   2. OR-across-currency — the old `usd > 0 || lbp > 0` colored a partner
 *      owed +$5 USD but owing 100,000 LBP an all-green card off the USD
 *      alone. `combinedBalanceBucket` buckets each currency independently
 *      and only agrees on a colour when both currencies agree (or one is
 *      zero) — a genuine mixed-sign row renders NEUTRAL, not a guess.
 * Callers that already zero-pad one side (`balanceColor(partner.usd, 0)`,
 * `balanceColor(0, partner.lbp)`) get a plain per-currency decision, same as
 * before except for polarity + epsilon; only `PartnerCard`'s combined calls
 * (passing both real values) are affected by the OR-bug fix.
 */
function balanceColor(usd: number, lbp: number) {
  return BALANCE_TEXT_COLOR[combinedBalanceBucket(-usd, -lbp, BALANCE_EPS)];
}

function balanceBorderColor(usd: number, lbp: number) {
  return BALANCE_BORDER_COLOR[combinedBalanceBucket(-usd, -lbp, BALANCE_EPS)];
}

function BalanceIcon({ usd, lbp }: { usd: number; lbp: number }) {
  const bucket = combinedBalanceBucket(-usd, -lbp, BALANCE_EPS);
  if (bucket === "SHOP_OWES")
    return <TrendingUp className="w-4 h-4 text-emerald-400" />;
  if (bucket === "COUNTERPARTY_OWES")
    return <TrendingDown className="w-4 h-4 text-red-400" />;
  return <Minus className="w-4 h-4 text-slate-400" />;
}

// CQ-11 — split-leg settlement methods (MultiPaymentInput). Deliberately a
// FIXED local list, not the DB-driven `usePaymentMethods()` (which carries
// CUSTOMER_ACCOUNT/GIFT_CARD — methods with no meaning for a partner
// settlement) — and deliberately WITHOUT "CLIENT_ACCOUNT": that value settles
// no money (partner_ledger.settlement_method CHECK constraint keeps it
// legacy-field-only) and can never appear as a split-leg method (core
// PartnerService.settle rejects it outright). CLIENT_ACCOUNT stays reachable
// only via the modal's separate "Cash moved" checkbox below (unticked).
const PARTNER_LEG_METHODS: PaymentMethod[] = [
  { code: "CASH", label: "Cash" },
  { code: "OMT", label: "OMT" },
  { code: "WHISH", label: "Whish" },
  { code: "BINANCE", label: "Binance" },
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
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
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
  // FOR_PARTNER_AND_COST_UNIFICATION_PLAN.md §5b phase 4a — the real,
  // tenant-scoped provider list from `service_providers`, replacing the
  // hardcoded `{None, <shop's non-owned system>}` pair. `partnerSystem`
  // (OMT/WHISH) is still a valid provider `code` in this list, so the
  // default selection above keeps working unchanged once it loads.
  const [providers, setProviders] = useState<ServiceProviderEntity[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const api = useApi();

  useEffect(() => {
    api
      .getActiveServiceProviders()
      .then(setProviders)
      .catch(() => setProviders([]));
  }, [api]);

  async function handleSubmit() {
    if (!name.trim()) {
      appEvents.emit("notification:show", "Partner name is required.", "error");
      return;
    }
    setSubmitting(true);
    try {
      let result;
      if (partner) {
        result = await api.partners.update(partner.id, {
          name: name.trim(),
          ...(phone.trim() ? { phone: phone.trim() } : {}),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
          system_association: systemAssociation || null,
        });
      } else {
        result = await api.partners.create({
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
              ...providers.map((p) => ({ value: p.code, label: p.label })),
            ]}
            buttonClassName="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
          />
          <p className="text-xs text-slate-500 mt-1">
            Associate this partner with a provider system. Only OMT and Whish
            currently gate transactions on their own page — other systems are
            for record-keeping only.
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
  const [currency, setCurrency] = useState<"USD" | "LBP">("USD");
  // CQ-11: split-leg settlement (MultiPaymentInput) is the default path —
  // legs are locked to `currency` (the `currencies` prop below offers only
  // the one selected currency, so the operator can never build a
  // cross-currency leg the backend would reject).
  //
  // LIRA-080 convention (matches the Suppliers / Accounts "Add Credit/Debt"
  // modals): a "Cash moved" checkbox, default TICKED — ticked keeps today's
  // default split-leg cash settlement; unticked swaps to a plain manual
  // amount with no legs, settling the partner balance on paper only (no
  // drawer change). `useClientAccount` is kept as the internal flag the rest
  // of this component already branches on; CLIENT_ACCOUNT settles no money
  // at all (partner_ledger.settlement_method CHECK + PartnerService both
  // keep it legacy-field-only) — it's the WIRE value the paper path still
  // sends (see the settlementMethod comment in handleSettle below), even
  // though the UI no longer calls it "Client Account" (no client is ever
  // involved).
  const [cashMoved, setCashMoved] = useState(true);
  const useClientAccount = !cashMoved;
  const [clientAccountAmount, setClientAccountAmount] = useState("");
  const [settleLines, setSettleLines] = useState<PaymentLine[]>([]);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // CQ-10: bundled discount — forgives part of what the partner owes,
  // alongside the settlement. Denominated in the SAME currency as the
  // settlement itself (the settle API is single-amount/single-currency), and
  // capped at that currency's balance.
  const [discountAmount, setDiscountAmount] = useState("");
  const [discountReason, setDiscountReason] = useState("");
  const api = useApi();
  // Settlements convert at the BUY side (owner decision 2026-07-06), same as
  // every other MultiPaymentInput in the app — inert here in practice since
  // legs are locked to one currency, but kept real (not the 89000 fallback)
  // for consistency and safety if that ever changes.
  const { buyRate: exchangeRate } = useSellRate();

  const validLines = settleLines.filter((l) => l.amount > 0);
  const legsAmount = validLines.reduce((s, l) => s + l.amount, 0);
  const parsedAmount = useClientAccount
    ? parseFloat(clientAccountAmount) || 0
    : legsAmount;
  const isValid = parsedAmount > 0;
  const balanceInCurrency = Math.max(
    0,
    currency === "USD" ? partner.usd : partner.lbp,
  );
  // CQ-10: PartnerService.settle posts the settlement `amount` and the
  // `discount` as two INDEPENDENT ledger rows with no combined validation
  // (unlike Debts, where the reduction math is capped against the
  // discount-adjusted due) — settle() doesn't even cap `amount` alone
  // against the balance. capSettlementDiscount caps the discount at what's
  // left AFTER the settlement amount, so "owed X, paid Y, discount Z" can
  // never post Y + Z > X against this partner's balance.
  const maxDiscountInCurrency = discountRoomAfterSettlement(
    balanceInCurrency,
    parsedAmount,
  );
  // Raw (uncapped) value the operator has actually typed — shown in the
  // discount field itself so it doesn't silently rubber-band back to a
  // smaller number every keystroke (see isDiscountClippedBySettlement).
  const requestedDiscountRaw = Math.max(0, parseFloat(discountAmount) || 0);
  const parsedDiscount = capSettlementDiscount(
    balanceInCurrency,
    parsedAmount,
    requestedDiscountRaw,
  );
  // UX fix (COUNTERPARTY_CONSOLIDATION_PLAN follow-up): MultiPaymentInput
  // auto-fills the settlement leg to the FULL balance by default, so a
  // discount typed before the operator manually shrinks that leg has zero
  // room and gets capped to 0 with no explanation — reads as a broken
  // input rather than an over-the-cap discount. The persistent "Up to $X"
  // label below already switches to explicit guidance when
  // maxDiscountInCurrency is 0 (the resting/no-room case); this flag
  // additionally drives a "only $X will apply" hint for the PARTIAL-room
  // case, where some room exists but the typed amount still overshoots it.
  // Money semantics are unchanged either way: parsedDiscount (capped) is
  // still the only value submitted.
  const discountClipped = isDiscountClippedBySettlement(
    balanceInCurrency,
    parsedAmount,
    requestedDiscountRaw,
  );
  const fmtCur = (n: number) => (currency === "USD" ? fmtUSD(n) : fmtLBP(n));
  // Netted out of what MultiPaymentInput is fed as "owed" — otherwise a
  // partial settle + a discount covering the rest would show a false
  // "Remaining (Debt)" warning inside the split-leg form (the discount isn't
  // debt, it's being forgiven).
  const nettedBalance = Math.max(0, balanceInCurrency - parsedDiscount);

  async function handleSettle() {
    if (!isValid) {
      appEvents.emit("notification:show", "Enter a valid amount.", "error");
      return;
    }
    setSubmitting(true);
    try {
      // partner_ledger.settlement_method is CHECK-constrained to
      // CASH/OMT/WHISH/BINANCE/CLIENT_ACCOUNT — never "SPLIT". A true
      // multi-method split still needs ONE value for that column; the first
      // leg's method is as good a "primary method" tag as any (the legs
      // themselves, not this field, drive the actual money movement).
      // CLIENT_ACCOUNT is a legacy wire value (CHECK-constrained column,
      // changing it needs a migration) — the UI says "Cash moved" / paper.
      const settlementMethod = useClientAccount
        ? "CLIENT_ACCOUNT"
        : (validLines[0]?.method ?? "CASH");
      const result = await api.partners.settle({
        partnerId: partner.id,
        amount: parsedAmount,
        currency,
        settlementMethod,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(!useClientAccount && validLines.length > 0
          ? {
              payments: validLines.map((l) => ({
                method: l.method,
                currency_code: l.currencyCode,
                amount: l.amount,
              })),
            }
          : {}),
        ...(parsedDiscount > 0
          ? {
              discount: {
                amount_usd: currency === "USD" ? parsedDiscount : 0,
                amount_lbp: currency === "LBP" ? parsedDiscount : 0,
                ...(discountReason.trim()
                  ? { reason: discountReason.trim() }
                  : {}),
              },
            }
          : {}),
      });
      if (result.success) {
        appEvents.emit(
          "notification:show",
          parsedDiscount > 0
            ? `Settlement recorded (discount ${currency === "USD" ? "$" : ""}${parsedDiscount.toFixed(currency === "USD" ? 2 : 0)}${currency === "LBP" ? " LBP" : ""})`
            : "Settlement recorded.",
          "success",
        );
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
    <CounterpartySettleModal
      title={`Settle – ${partner.name}`}
      showCloseButton
      panelClassName="max-w-md"
      onCancel={onClose}
      onConfirm={handleSettle}
      confirmLabel="Confirm Settlement"
      confirmColor="emerald"
      confirmDisabled={!isValid}
      isSubmitting={submitting}
      beforeContent={
        <>
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

          <div className="flex items-end gap-3">
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

          {/* LIRA-080 convention: "Cash moved" toggle — default ON (today's
              split-leg cash settlement). OFF = paper-only settlement, no
              drawer change. */}
          <label
            className="flex items-start gap-2 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 cursor-pointer"
            data-testid="partner-settle-cash-moved-toggle"
          >
            <input
              type="checkbox"
              checked={cashMoved}
              onChange={(e) => setCashMoved(e.target.checked)}
              className="mt-0.5 w-4 h-4 rounded border-slate-600 bg-slate-900 accent-violet-500"
            />
            <span className="text-xs text-slate-300">
              <span className="font-medium text-white">Cash moved</span> — this
              settlement moves the drawer via the payment legs below. Untick for
              a paper-only settlement (no drawer change).
            </span>
          </label>

          {useClientAccount && (
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Amount
              </label>
              <DecimalInput
                value={parseFloat(clientAccountAmount) || 0}
                onChange={(n) => setClientAccountAmount(n ? String(n) : "")}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
                placeholder="0.00"
                autoFocus
              />
            </div>
          )}
        </>
      }
      multiPaymentInputKey={currency}
      // CLIENT_ACCOUNT settles no cash — no legs make sense there, so the
      // split-leg form is skipped entirely (not just visually hidden) in
      // that mode; only the plain manual amount above applies.
      multiPaymentInput={
        useClientAccount
          ? undefined
          : {
              totals: [{ amount: nettedBalance, currency }],
              totalAmountCurrency: currency,
              currency,
              onChange: setSettleLines,
              showPmFee: false,
              showDiscount: false,
              // Locked to the single selected currency — the operator can
              // never build a leg in the OTHER currency (the backend rejects
              // a mixed-currency settle outright; this keeps the constraint
              // visible in the UI itself, not just enforced post-submit).
              paymentMethods: PARTNER_LEG_METHODS,
              currencies: [
                currency === "USD"
                  ? { code: "USD", symbol: "$" }
                  : { code: "LBP", symbol: "LBP" },
              ],
              exchangeRate,
            }
      }
      discountSlot={
        // CQ-10: bundled discount — forgives part of what the partner
        // owes, in the same currency as the settlement above.
        balanceInCurrency > 0 && (
          <div className="bg-emerald-950/20 border border-emerald-800/40 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">
                Discount / Forgive ({currency})
              </span>
              <span
                className="text-[11px] text-emerald-400/70"
                data-testid="partner-settle-discount-room-label"
              >
                {maxDiscountInCurrency > 0
                  ? `Up to ${fmtCur(maxDiscountInCurrency)} (after settlement)`
                  : "Lower the payment amount to make room for a discount"}
              </span>
            </div>
            <DecimalInput
              value={requestedDiscountRaw}
              onChange={(n) => setDiscountAmount(n ? String(n) : "")}
              className="w-full bg-slate-900 border border-emerald-700/40 rounded-lg px-3 py-2 text-emerald-100 text-sm focus:outline-none focus:border-emerald-500"
              placeholder="0.00"
            />
            {/* Only for the PARTIAL-room case — when there's no room at
                all the label above already says so; this avoids repeating
                the same guidance twice. */}
            {discountClipped && maxDiscountInCurrency > 0 && (
              <p
                className="text-[11px] text-amber-400/90"
                data-testid="partner-settle-discount-room-hint"
              >
                {`Only ${fmtCur(maxDiscountInCurrency)} will be applied — lower the payment amount above to free up more room.`}
              </p>
            )}
            {parsedDiscount > 0 && (
              <input
                type="text"
                value={discountReason}
                onChange={(e) => setDiscountReason(e.target.value)}
                className="w-full bg-slate-900 border border-emerald-700/40 rounded-lg px-3 py-2 text-emerald-100 text-xs focus:outline-none focus:border-emerald-500"
                placeholder="Reason (optional)..."
              />
            )}
          </div>
        )
      }
    >
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
    </CounterpartySettleModal>
  );
}

// ─── Record Transaction Modal ─────────────────────────────────────────────────

interface RecordTxModalProps {
  partner: PartnerWithBalance;
  onClose: () => void;
  onRecorded: () => void;
  /**
   * PFT-7 "Add credit / debt" mode — a focused manual partner_ledger
   * adjustment (DEBIT = partner owes shop, CREDIT = shop owes partner).
   * Locks the transaction type to ADJUSTMENT and hides the type picker so
   * the modal reads as a simple credit/debt entry, like the Accounts page's
   * "Add Credit / Debt". Uses the SAME `recordTransaction` IPC/REST call as
   * the general "Record Tx" button — no new backend path.
   */
  adjustmentOnly?: boolean;
}

function RecordTxModal({
  partner,
  onClose,
  onRecorded,
  adjustmentOnly = false,
}: RecordTxModalProps) {
  const [txType, setTxType] = useState("ADJUSTMENT");
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"USD" | "LBP">("USD");
  const [direction, setDirection] = useState<"DEBIT" | "CREDIT">("DEBIT");
  const [notes, setNotes] = useState("");
  // PFT-7b: "cash moved" — the entry records a physical cash event, so the
  // drawer moves with it (add debt = cash OUT to the partner, add credit =
  // cash IN), like the Accounts-page cash-in/cash-out buttons. Unticked =
  // paper-style tab correction (no drawer change).
  const [moveCash, setMoveCash] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const api = useApi();

  const parsedAmount = parseFloat(amount) || 0;
  const isValid = parsedAmount > 0;

  async function handleRecord() {
    if (!isValid) {
      appEvents.emit("notification:show", "Enter a valid amount.", "error");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.partners.recordTransaction({
        partnerId: partner.id,
        transactionType: txType,
        amount: parsedAmount,
        currency,
        direction,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        ...(adjustmentOnly && moveCash ? { moveCash: true } : {}),
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
    <Modal
      title={
        adjustmentOnly
          ? `Add Credit / Debt – ${partner.name}`
          : `Record Transaction – ${partner.name}`
      }
      onClose={onClose}
    >
      <div className="space-y-4">
        {!adjustmentOnly && (
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
        )}

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
          {/* Colour flipped (owner's rule, 2026-08-11): DEBIT = "they owe
              us" = counterparty owes = RED; CREDIT = "we owe them" = shop
              owes = GREEN. Labels/meaning unchanged. */}
          <div className="flex gap-2">
            <button
              onClick={() => setDirection("DEBIT")}
              className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-sm font-medium transition-colors border ${
                direction === "DEBIT"
                  ? "bg-red-900/40 border-red-600 text-red-300"
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
                  ? "bg-emerald-900/40 border-emerald-600 text-emerald-300"
                  : "bg-slate-700 border-slate-600 text-slate-400 hover:text-white"
              }`}
            >
              <ArrowDownLeft className="w-3.5 h-3.5" />
              CREDIT (we owe them)
            </button>
          </div>
        </div>

        {adjustmentOnly && (
          <label
            className="flex items-start gap-2 bg-slate-900/60 border border-slate-700 rounded-lg px-3 py-2 cursor-pointer"
            data-testid="partner-cash-moved-toggle"
          >
            <input
              type="checkbox"
              checked={moveCash}
              onChange={(e) => setMoveCash(e.target.checked)}
              className="mt-0.5 accent-violet-500"
            />
            <span className="text-xs text-slate-300">
              <span className="font-medium text-white">Cash moved</span> — this
              entry records physical cash:{" "}
              {direction === "DEBIT"
                ? "cash OUT of the drawer to the partner (advance)"
                : "cash IN from the partner"}
              . Leave unticked for a paper-style correction (no drawer change).
            </span>
          </label>
        )}

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
            {submitting
              ? "Recording..."
              : adjustmentOnly
                ? "Add Credit / Debt"
                : "Record Transaction"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Write-off Modal (CQ-10, D4: admin-only) ──────────────────────────────────
//
// Standalone pure forgiveness — WE forgive part of what the PARTNER owes us
// (mirrors Debts' "Write off debt"). No cash movement. Applies only when the
// partner has a positive balance in a currency (balance.usd/lbp > 0 = "they
// owe us" per the DetailPanel's own labels) — there is nothing to forgive
// on the side we owe them.
//
// SINGLE currency per call (unlike Debts/Suppliers): partner_ledger is
// one-currency-per-row, so PartnerService.writeOff rejects a call supplying
// both amount_usd AND amount_lbp — reconciled against the sibling's landed
// core (packages/core/src/services/PartnerService.ts writeOff) after this
// modal was first drafted as a dual-currency row like Debts'. A currency
// picker (mirroring SettleModal) keeps this single-amount/single-currency.

interface WriteOffModalProps {
  partner: PartnerWithBalance;
  onClose: () => void;
  onWrittenOff: () => void;
}

function WriteOffModal({ partner, onClose, onWrittenOff }: WriteOffModalProps) {
  const [amount, setAmount] = useState("");
  const [currency, setCurrency] = useState<"USD" | "LBP">("USD");
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const api = useApi();

  const owedInCurrency = Math.max(
    0,
    currency === "USD" ? partner.usd : partner.lbp,
  );
  const parsedAmount = Math.min(
    Math.max(0, parseFloat(amount) || 0),
    owedInCurrency,
  );
  const isValid = parsedAmount > 0;

  async function handleWriteOff() {
    if (!isValid) {
      appEvents.emit("notification:show", "Enter a valid amount.", "error");
      return;
    }
    setSubmitting(true);
    try {
      const result = await api.partners.writeOff({
        partnerId: partner.id,
        amount_usd: currency === "USD" ? parsedAmount : 0,
        amount_lbp: currency === "LBP" ? parsedAmount : 0,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      if (result.success) {
        appEvents.emit("notification:show", "Balance written off.", "success");
        onWrittenOff();
        onClose();
      } else {
        appEvents.emit(
          "notification:show",
          result.error ?? "Failed to write off.",
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
    <Modal title={`Write off – ${partner.name}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-slate-400">
          We forgive part of what {partner.name} owes us — no cash movement.
        </p>
        {/* Current balance reference (same layout as SettleModal). */}
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
            <label className="text-xs text-slate-400 block mb-1">
              Amount — owed{" "}
              {currency === "USD"
                ? fmtUSD(owedInCurrency)
                : fmtLBP(owedInCurrency)}
            </label>
            <DecimalInput
              value={parsedAmount}
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
              onChange={(v) => {
                setCurrency(v as "USD" | "LBP");
                setAmount("");
              }}
              options={[
                { value: "USD", label: "USD" },
                { value: "LBP", label: "LBP" },
              ]}
              buttonClassName="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
            />
          </div>
        </div>

        <div>
          <label className="text-xs text-slate-400 block mb-1">Reason</label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500"
            placeholder="Optional reason..."
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
            onClick={handleWriteOff}
            disabled={submitting || !isValid}
            className="flex-1 py-2.5 bg-orange-600 hover:bg-orange-700 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors text-sm"
          >
            {submitting ? "Processing..." : "Write off"}
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
  const api = useApi();

  async function handleDeactivate() {
    setSubmitting(true);
    try {
      const result = await api.partners.deactivate(partner.id);
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
  // `entry.amount` is UNSIGNED (partner_ledger's `direction` enum carries the
  // sign) — normalize to "positive = shop owes" so the badge, hover, and
  // amount cell all derive from the SAME value (rule 14, and the exact class
  // of bug LIRA-129 fixed on Suppliers: a badge coloured off `direction`
  // alone and an amount coloured off a separate sign can silently disagree).
  // DEBIT = partner owes shop (counterparty owes) = negative normalized;
  // CREDIT = shop owes partner = positive normalized.
  const normalizedAmount = isDebit ? -entry.amount : entry.amount;
  const amountColor = balanceTextColor(normalizedAmount, BALANCE_EPS);
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
          isDebit ? "hover:bg-red-900/10" : "hover:bg-emerald-900/10"
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
            <span
              className={`inline-flex items-center gap-1 text-xs font-medium ${amountColor}`}
            >
              <ArrowUpRight className="w-3 h-3" />
              DEBIT
            </span>
          ) : (
            <span
              className={`inline-flex items-center gap-1 text-xs font-medium ${amountColor}`}
            >
              <ArrowDownLeft className="w-3 h-3" />
              CREDIT
            </span>
          )}
        </td>
        <td className="px-4 py-3 text-right font-mono font-semibold whitespace-nowrap">
          <span className={amountColor}>
            {fmtByCurrency(entry.amount, entry.currency)}
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
                  <span className="text-slate-200">
                    {entry.fs_phone_number}
                  </span>
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
                    {fmtByCurrency(entry.fs_amount, entry.fs_currency)}
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
  onAddCredit: () => void;
  onDeactivate: () => void;
  onActivate: () => void;
  /** CQ-10 (D4): standalone write-off (admin-only, pure forgiveness). */
  onWriteOff: () => void;
}

function DetailPanel({
  partner,
  onEdit,
  onSettle,
  onRecordTx,
  onAddCredit,
  onDeactivate,
  onActivate,
  onWriteOff,
}: DetailPanelProps) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  // CQ-10 (D4): only when the partner has something left to forgive — a
  // positive balance means "they owe us" (see the USD/LBP balance cards
  // below), the same sign the write-off applies to.
  const canWriteOff = partner.usd > 0.01 || partner.lbp > 0.5;
  const [entries, setEntries] = useState<PartnerLedgerEntry[]>([]);
  const [balance, setBalance] = useState<PartnerBalance>({
    usd: partner.usd,
    lbp: partner.lbp,
    usdt: partner.usdt,
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
  const api = useApi();

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
      const result = await api.partners.getLedger(
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
    api,
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
            <button
              onClick={onAddCredit}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-700 hover:bg-amber-600 text-amber-100 rounded-lg text-xs font-medium transition-colors"
            >
              <Wallet className="w-3.5 h-3.5" />
              Add Credit / Debt
            </button>
            {/* CQ-10 (D4): standalone write-off — admin-only, pure
                forgiveness with no cash movement. */}
            {isAdmin && canWriteOff && (
              <button
                onClick={onWriteOff}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded-lg text-xs font-medium transition-colors"
                title="Forgive part of what the partner owes us"
              >
                <Eraser className="w-3.5 h-3.5" />
                Write off
              </button>
            )}
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
              // Same DEBIT-positive/CREDIT-negative convention as `balance.usd`
              // (`PartnerRepository.getBalanceBreakdown` — a FOR/THROUGH/other
              // split of the identical SUM(DEBIT)-SUM(CREDIT)), so each
              // component gets the SAME owner's-rule polarity as the parent
              // card above it (negated -> shared helper): a positive
              // component means "they owe us for this slice" (RED), negative
              // means "we owe them" (GREEN). Left unflipped, a mixed FOR/
              // THROUGH split could show a green sub-line inside a card
              // whose own (correctly red) total says the opposite.
              <div className="mt-2 pt-2 border-t border-slate-700/50 space-y-0.5">
                {breakdown.usd.for !== 0 && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-violet-400">FOR (our system)</span>
                    <span
                      className={balanceTextColor(
                        -breakdown.usd.for,
                        BALANCE_EPS,
                      )}
                    >
                      {fmtUSD(breakdown.usd.for)}
                    </span>
                  </div>
                )}
                {breakdown.usd.through !== 0 && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-sky-400">THROUGH (their system)</span>
                    <span
                      className={balanceTextColor(
                        -breakdown.usd.through,
                        BALANCE_EPS,
                      )}
                    >
                      {fmtUSD(breakdown.usd.through)}
                    </span>
                  </div>
                )}
                {breakdown.usd.other !== 0 && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-500">Settlements / Adj.</span>
                    <span
                      className={balanceTextColor(
                        -breakdown.usd.other,
                        BALANCE_EPS,
                      )}
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
              // Same polarity note as the USD breakdown above.
              <div className="mt-2 pt-2 border-t border-slate-700/50 space-y-0.5">
                {breakdown.lbp.for !== 0 && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-violet-400">FOR (our system)</span>
                    <span
                      className={balanceTextColor(
                        -breakdown.lbp.for,
                        BALANCE_EPS,
                      )}
                    >
                      {fmtLBP(breakdown.lbp.for)}
                    </span>
                  </div>
                )}
                {breakdown.lbp.through !== 0 && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-sky-400">THROUGH (their system)</span>
                    <span
                      className={balanceTextColor(
                        -breakdown.lbp.through,
                        BALANCE_EPS,
                      )}
                    >
                      {fmtLBP(breakdown.lbp.through)}
                    </span>
                  </div>
                )}
                {breakdown.lbp.other !== 0 && (
                  <div className="flex justify-between text-[10px]">
                    <span className="text-slate-500">Settlements / Adj.</span>
                    <span
                      className={balanceTextColor(
                        -breakdown.lbp.other,
                        BALANCE_EPS,
                      )}
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
          onChange={(v) =>
            setFilterProvider(v as "" | "OMT" | "WHISH" | "BINANCE")
          }
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
      {/* Each currency's own text is coloured off ITS OWN sign only — zero-
          padding the other side (`balanceColor(p.usd, 0)` / `(0, p.lbp)`),
          same pattern the detail panel and settle modal already use below.
          This is the fix for the OR-across-currency bug at the AMOUNT level
          (latent bug #3): previously both spans shared ONE combined call
          with both real values, so a +$5 USD / -100,000 LBP partner showed
          BOTH numbers in green off the USD alone. The border/icon above
          still need ONE shared verdict for the whole card — that's what
          `balanceBorderColor`/`BalanceIcon`'s `combinedBalanceBucket` fix is
          for (neutral on genuine disagreement, never a same-currency-only
          guess). */}
      <div className="flex gap-2">
        <span
          className={`text-xs font-mono font-medium ${balanceColor(p.usd, 0)}`}
        >
          {fmtUSD(p.usd)}
        </span>
        <span className="text-slate-600 text-xs">·</span>
        <span
          className={`text-xs font-mono font-medium ${balanceColor(0, p.lbp)}`}
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
  const [addingCreditPartner, setAddingCreditPartner] =
    useState<PartnerWithBalance | null>(null);
  const [deactivatingPartner, setDeactivatingPartner] =
    useState<PartnerWithBalance | null>(null);
  // CQ-10 (D4): standalone write-off (admin-only, pure forgiveness).
  const [writingOffPartner, setWritingOffPartner] =
    useState<PartnerWithBalance | null>(null);
  const api = useApi();

  const selectedPartner = partners.find((p) => p.id === selectedId) ?? null;

  const loadPartners = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.partners.getAllBalances(true);
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
  }, [includeInactive, api]); // eslint-disable-line react-hooks/exhaustive-deps

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

      {/* ── Summary Cards ──
          Third polarity bug found in this same audit pass, not named in the
          original audit doc: these two cards are each FIXED to one meaning
          ("Partners owe us" only ever sums the counterparty-owes side;
          "We owe partners" only ever sums the shop-owes side — see
          `totalOwedToUs`/`totalWeOwe` above), so unlike `balanceColor` their
          colour never depended on a live sign — it was just the wrong
          colour hard-coded per card. Per the owner's rule, "Partners owe
          us" (counterparty owes) is RED and "We owe partners" (shop owes)
          is GREEN — the reverse of what was here. Icon SHAPES (trending
          up/down = money-flow direction) are unchanged; only their colour
          and the card colours flip, matching `balanceColor` elsewhere on
          this page. */}
      <div className="shrink-0">
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-800 border border-red-700/30 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <TrendingUp className="w-4 h-4 text-red-400" />
              <span className="text-xs text-slate-400">Partners owe us</span>
            </div>
            <div className="flex items-baseline gap-3">
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                  USD
                </span>
                <p className="text-lg font-bold text-red-400">
                  {fmtUSD(totalOwedToUs.usd)}
                </p>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                  LBP
                </span>
                <p className="text-lg font-bold text-red-400">
                  {fmtLBP(totalOwedToUs.lbp)}
                </p>
              </div>
            </div>
          </div>
          <div className="bg-slate-800 border border-emerald-700/30 rounded-xl p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <TrendingDown className="w-4 h-4 text-emerald-400" />
              <span className="text-xs text-slate-400">We owe partners</span>
            </div>
            <div className="flex items-baseline gap-3">
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                  USD
                </span>
                <p className="text-lg font-bold text-emerald-400">
                  {fmtUSD(totalWeOwe.usd)}
                </p>
              </div>
              <div>
                <span className="text-[10px] text-slate-500 uppercase tracking-wide">
                  LBP
                </span>
                <p className="text-lg font-bold text-emerald-400">
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
              onAddCredit={() => setAddingCreditPartner(selectedPartner)}
              onDeactivate={() => setDeactivatingPartner(selectedPartner)}
              onWriteOff={() => setWritingOffPartner(selectedPartner)}
              onActivate={async () => {
                const result = await api.partners.activate(selectedPartner.id);
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
      {addingCreditPartner && (
        <RecordTxModal
          partner={addingCreditPartner}
          onClose={() => setAddingCreditPartner(null)}
          onRecorded={loadPartners}
          adjustmentOnly
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
      {writingOffPartner && (
        <WriteOffModal
          partner={writingOffPartner}
          onClose={() => setWritingOffPartner(null)}
          onWrittenOff={loadPartners}
        />
      )}
    </div>
  );
}

export default PartnersPage;
