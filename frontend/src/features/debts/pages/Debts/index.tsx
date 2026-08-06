import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import logger from "@/utils/logger";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import * as XLSX from "xlsx";
import {
  Search,
  User,
  ArrowDownLeft,
  ArrowUpRight,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Eye,
  Briefcase,
  Clock,
  X as CloseIcon,
  Upload,
  Plus,
  Eraser,
} from "lucide-react";
import {
  appEvents,
  CounterpartySettleModal,
  PageHeader,
  Select,
  ServiceTypeTabs,
  useApi,
  type DebtorSummary,
  type DebtLedgerEntity,
} from "@liratek/ui";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useSellRate } from "@/hooks/useSellRate";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { DataTable } from "@liratek/ui";
import { type PaymentLine } from "@liratek/ui";
import { toCamelLegs } from "@/utils/paymentUtils";
import {
  computeRepaymentReduction,
  applyDebtDiscount,
} from "../../utils/repaymentReduction";
import {
  formatPaidAmount,
  saleOutstandingUsd,
} from "../../utils/salePaidFormat";
import {
  ServiceDebtDetailModal,
  type FinancialServiceData,
  type PaymentRowData,
} from "../../components/ServiceDebtDetailModal";
import { SessionDebtDetailModal } from "../../components/SessionDebtDetailModal";
import {
  ImportCleanupModal,
  type ImportClient,
} from "../../components/ImportCleanupModal";
import {
  ImportValidationModal,
  type ListNameEntry,
  type ParsedClientPage,
} from "../../components/ImportValidationModal";
import { getDebtAging } from "@/api/backendApi";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";
import { ClientAutocompleteInput } from "@/shared/components/ClientAutocompleteInput";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import type { Client } from "@liratek/ui";

type DebtAgingBuckets = {
  client_id: number;
  current: { usd: number; lbp: number };
  days_31_60: { usd: number; lbp: number };
  days_61_90: { usd: number; lbp: number };
  over_90: { usd: number; lbp: number };
};

type DebtFilter = "ongoing" | "closed" | "all";
type SortOrder = "desc" | "asc";

export default function Debts() {
  const api = useApi();
  const { user } = useAuth();
  // CQ-10: standalone write-off is admin-only (D4) — bundled repayment
  // discounts stay admin+staff, same as the flow they're attached to.
  const isAdmin = user?.role === "admin";
  const { allMethods: methods } = usePaymentMethods();
  // Debt repayment converts LBP↔USD at the BUY rate (owner decision
  // 2026-07-06): payments/repayments use buyRate across every
  // MultiPaymentInput, consistent with TelecomForm / SessionCheckout / Loto.
  const { buyRate: EXCHANGE_RATE } = useSellRate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [parsedClients, setParsedClients] = useState<ImportClient[] | null>(
    null,
  );
  const [showCleanup, setShowCleanup] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  const [validationListNames, setValidationListNames] = useState<
    ListNameEntry[] | null
  >(null);
  const [validationPages, setValidationPages] = useState<
    ParsedClientPage[] | null
  >(null);

  type DebtHistoryItem = DebtLedgerEntity & {
    itemNames?: string[];
    is_refunded?: number;
    refunded_at?: string | null;
  };

  type SaleDetail = {
    id: number;
    final_amount_usd?: number;
    total_amount_usd?: number;
    discount_usd?: number;
    paid_usd?: number;
    paid_lbp?: number;
    exchange_rate_snapshot?: number;
    status: string;
    created_at: string;
    items: Array<{
      product_name: string;
      quantity: number;
      price_per_unit: number;
      subtotal: number;
    }>;
  };
  const [debtors, setDebtors] = useState<DebtorSummary[]>([]);
  const [selectedClient, setSelectedClient] = useState<DebtorSummary | null>(
    null,
  );
  const [history, setHistory] = useState<DebtHistoryItem[]>([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showRepaymentModal, setShowRepaymentModal] = useState(false);
  useModalFocusFix(showRepaymentModal);
  const [showCreditModal, setShowCreditModal] = useState(false);
  useModalFocusFix(showCreditModal);
  const [creditClientSearch, setCreditClientSearch] = useState("");
  const [creditSelectedClient, setCreditSelectedClient] = useState<{
    id: number;
    full_name: string;
  } | null>(null);
  const [creditAmountUsd, setCreditAmountUsd] = useState("");
  const [creditAmountLbp, setCreditAmountLbp] = useState("");
  const [creditNote, setCreditNote] = useState("");
  // Credit = customer hands the shop cash (drawer IN, shop owes them);
  // Debt = shop gives the customer cash (drawer OUT, they owe the shop).
  const [creditDirection, setCreditDirection] = useState<"credit" | "debt">(
    "credit",
  );
  // LIRA-080: "Cash moved" toggle — default ON, preserving today's
  // always-moves-the-drawer behavior. When OFF the entry posts a paper
  // (no-cash) ACCOUNT_ADJUSTMENT: the debt_ledger row is written exactly as
  // today, but with no payments row / drawer delta.
  const [creditMoveCash, setCreditMoveCash] = useState(true);

  const [debtFilter, setDebtFilter] = useState<DebtFilter>("ongoing");
  const [selectedSale, setSelectedSale] = useState<SaleDetail | null>(null);
  const [showSaleDetails, setShowSaleDetails] = useState(false); // New state for filter
  const [dateSortOrder, setDateSortOrder] = useState<SortOrder>("desc"); // Default: most recent first
  const [aging, setAging] = useState<DebtAgingBuckets | null>(null);

  // Service Debt detail modal state
  const [showServiceDetail, setShowServiceDetail] = useState(false);
  const [serviceDetail, setServiceDetail] = useState<{
    fs: FinancialServiceData;
    payments: PaymentRowData[];
    debtAmountUsd: number;
    debtAmountLbp: number;
  } | null>(null);

  // Session Debt detail modal state. `mode` selects which side of the basket
  // the modal shows: "charges" for the Purchases-side eye, "payouts" for the
  // Payments-side eye (a session cash-out settled to the account).
  const [sessionDetail, setSessionDetail] = useState<{
    sessionId: number;
    amountUsd: number;
    amountLbp: number;
    mode: "charges" | "payouts" | "all";
  } | null>(null);

  // Repayment State
  const [repayPaymentLines, setRepayPaymentLines] = useState<PaymentLine[]>([]);
  const [repayReturnLegs, setRepayReturnLegs] = useState<PaymentLine[]>([]);
  // The rate the repayment modal actually displays/converts with (seeded from
  // EXCHANGE_RATE on mount, updated when the operator edits it in the split
  // header). LBP legs MUST convert at this rate — using a different one books
  // a reduction the operator never saw.
  const [repayModalRate, setRepayModalRate] = useState<number | null>(null);
  // T3 keep-change: change the operator chose to KEEP as shop profit rather
  // than return. Excluded from the debt reduction (it is NOT the client's
  // credit) and stamped on the DEBT_REPAYMENT transaction as profit.
  const [repayKeptChange, setRepayKeptChange] = useState<{
    usd: number;
    lbp: number;
  } | null>(null);
  const [repayNote, setRepayNote] = useState("");
  const [repayTransactionTime, setRepayTransactionTime] = useState<
    string | undefined
  >();
  // CQ-10: bundled discount on the repayment modal — "repay" mode only
  // (forgiving part of a credit the shop is CASHING OUT has no defined
  // semantics). Raw text state mirrors the Credit modal's amount inputs.
  const [repayDiscountUsd, setRepayDiscountUsd] = useState("");
  const [repayDiscountLbp, setRepayDiscountLbp] = useState("");
  const [repayDiscountReason, setRepayDiscountReason] = useState("");

  // CQ-10: standalone "Write off debt" modal (admin-only, pure forgiveness).
  const [showWriteOffModal, setShowWriteOffModal] = useState(false);
  useModalFocusFix(showWriteOffModal);
  const [writeOffAmountUsd, setWriteOffAmountUsd] = useState("");
  const [writeOffAmountLbp, setWriteOffAmountLbp] = useState("");
  const [writeOffReason, setWriteOffReason] = useState("");
  const [writeOffSubmitting, setWriteOffSubmitting] = useState(false);

  const loadDebtors = useCallback(async () => {
    try {
      const data = window.api
        ? await window.api.debt.getDebtors()
        : await api.getDebtors();
      setDebtors(data);
    } catch (error) {
      logger.error("Failed to load debtors:", error);
    }
  }, []);

  useEffect(() => {
    loadDebtors();
  }, [loadDebtors]);

  useEffect(() => {
    window.addEventListener("debt-ledger-changed", loadDebtors);
    return () => window.removeEventListener("debt-ledger-changed", loadDebtors);
  }, [loadDebtors]);

  useEffect(() => {
    if (selectedClient) {
      setLedgerBalance(null);
      loadHistory(selectedClient.id);
      loadLedgerBalance(selectedClient.id);
      getDebtAging(selectedClient.id)
        .then(setAging)
        .catch(() => setAging(null));
    } else {
      setAging(null);
      setLedgerBalance(null);
    }
  }, [selectedClient]);

  const loadHistory = async (clientId: number) => {
    try {
      const data = window.api
        ? await window.api.debt.getClientHistory(clientId)
        : await api.getClientDebtHistory(clientId);

      // Fetch item names for each debt entry with a transaction_id
      const enrichedData = await Promise.all(
        data.map(async (item: DebtHistoryItem) => {
          if (
            item.transaction_id &&
            item.transaction_type === "Sale Debt" &&
            // Enriched notes ("Sale #5: 1× Case — $4 (discounted …)") already
            // name the items and carry the discount — show them verbatim so
            // the row matches the transaction summary. The per-row item fetch
            // below is only a fallback for legacy bare notes ("Balance from
            // Sale").
            !item.note?.startsWith("Sale #") &&
            (item.amount_usd > 0 || item.amount_lbp > 0)
          ) {
            try {
              // item.transaction_id is a unified transactions.id, NOT a
              // sales.id — resolve through getTransactionById first (same
              // pattern as loadSaleDetails below) before calling getSaleItems.
              const transaction = await api.getTransactionById(
                item.transaction_id,
              );
              if (!transaction || transaction.source_table !== "sales") {
                return item;
              }
              const saleId = transaction.source_id;
              const items = await api.getSaleItems(saleId);
              const itemNames = items
                .slice(0, 3)
                .map((saleItem: any) => saleItem.name || "Unknown Product");
              return { ...item, itemNames };
            } catch (error) {
              logger.error(
                `Failed to load items for sale ${item.transaction_id}:`,
                error,
              );
              return item;
            }
          }
          // Fetch custom service description for Custom Service Debt entries
          if (
            item.transaction_id &&
            item.transaction_type === "Custom Service Debt" &&
            (item.amount_usd > 0 || item.amount_lbp > 0)
          ) {
            try {
              const service = await api.getCustomServiceById(
                item.transaction_id,
              );
              if (service?.description) {
                return { ...item, itemNames: [service.description] };
              }
            } catch (error) {
              logger.error(
                `Failed to load custom service ${item.transaction_id}:`,
                error,
              );
            }
          }
          return item;
        }),
      );

      setHistory(enrichedData);
      // Reset sort to default (desc) when loading new client
      setDateSortOrder("desc");
    } catch (error) {
      logger.error("Failed to load history:", error);
    }
  };

  // Split history into debts (purchases) and payments (repayments + credit deposits)
  // CREDIT_DEPOSIT reduces what client owes (or increases shop's debt to client) → payment side
  // CREDIT_USED charges against credit balance → purchase side
  const PAYMENT_TYPES = new Set(["Repayment", "CREDIT_DEPOSIT"]);

  const debtEntries = useMemo(() => {
    return [...history]
      .filter((item) => !PAYMENT_TYPES.has(item.transaction_type))
      .sort((a, b) => {
        const dateA = parseDbDate(a.created_at).getTime();
        const dateB = parseDbDate(b.created_at).getTime();
        return dateSortOrder === "desc" ? dateB - dateA : dateA - dateB;
      });
  }, [history, dateSortOrder]);

  const paymentEntries = useMemo(() => {
    return [...history]
      .filter((item) => PAYMENT_TYPES.has(item.transaction_type))
      .sort((a, b) => {
        const dateA = parseDbDate(a.created_at).getTime();
        const dateB = parseDbDate(b.created_at).getTime();
        return dateSortOrder === "desc" ? dateB - dateA : dateA - dateB;
      });
  }, [history, dateSortOrder]);

  // Sessions that booked an on-account credit (a session-linked CREDIT_DEPOSIT
  // on the Payments side). For those the cash-out payout lives on the Payments
  // side, so the Purchases-side "Session Debt" eye shows CHARGES only. A session
  // with no such credit settled its payout in cash — that payout has nowhere
  // else to surface, so its basket eye shows the FULL basket (both signs).
  const sessionsWithOnAccountCredit = useMemo(
    () =>
      new Set(
        history
          .filter(
            (item) =>
              item.transaction_type === "CREDIT_DEPOSIT" &&
              item.session_id != null,
          )
          .map((item) => item.session_id),
      ),
    [history],
  );

  const debtTotals = useMemo(() => {
    return debtEntries.reduce(
      (acc, item) => ({
        usd: acc.usd + (item.amount_usd > 0 ? item.amount_usd : 0),
        lbp: acc.lbp + (item.amount_lbp > 0 ? item.amount_lbp : 0),
      }),
      { usd: 0, lbp: 0 },
    );
  }, [debtEntries]);

  const paymentTotals = useMemo(() => {
    return paymentEntries.reduce(
      (acc, item) => ({
        usd: acc.usd + Math.abs(item.amount_usd < 0 ? item.amount_usd : 0),
        lbp: acc.lbp + Math.abs(item.amount_lbp < 0 ? item.amount_lbp : 0),
      }),
      { usd: 0, lbp: 0 },
    );
  }, [paymentEntries]);

  const toggleDateSort = () => {
    setDateSortOrder((prev) => (prev === "desc" ? "asc" : "desc"));
  };

  // Raw per-currency ledger sums for the selected client (debt:client-balance).
  const [ledgerBalance, setLedgerBalance] = useState<{
    usd: number;
    lbp: number;
  } | null>(null);
  // Per-currency NET position: positive = client owes shop, negative = shop
  // owes client. A client can be mixed — e.g. a USD credit AND an LBP debt
  // that net to ~0 converted — so the currencies are tracked independently.
  //
  // Source of truth is the raw LEDGER SUM (debt:client-balance) — the same
  // number the backend cash-out guard enforces. The history-derived sums
  // below filter rows by type AND sign, so any row with an unexpected sign
  // (imports, voids, legacy fixes) silently diverges from the ledger: the
  // panel once showed a credit the service refused to cash out. The filtered
  // sums remain only as a fallback while the ledger balance loads (web mode).
  const netUsd = ledgerBalance?.usd ?? debtTotals.usd - paymentTotals.usd;
  const netLbp = ledgerBalance?.lbp ?? debtTotals.lbp - paymentTotals.lbp;
  const dueUsd = Math.max(0, netUsd);
  const dueLbp = Math.max(0, netLbp);
  const creditUsd = Math.max(0, -netUsd);
  const creditLbp = Math.max(0, -netLbp);

  // CQ-10: bundled repayment discount — "repay" mode only (a cash-OUT has no
  // discount concept). The MultiPaymentInput totals AND the reduction math
  // both consume `repayRemainingDue*` (never the raw `dueUsd/dueLbp`) so
  // "owed − paid − discount = remaining" holds structurally — see
  // applyDebtDiscount's header comment.
  const repayDiscountUsdNum =
    parseFloat(repayDiscountUsd.replace(/,/g, "")) || 0;
  const repayDiscountLbpNum =
    parseFloat(repayDiscountLbp.replace(/,/g, "")) || 0;
  const {
    appliedDiscountUsd: repayAppliedDiscountUsd,
    appliedDiscountLbp: repayAppliedDiscountLbp,
    remainingDueUsd: repayRemainingDueUsd,
    remainingDueLbp: repayRemainingDueLbp,
  } = applyDebtDiscount({
    dueUsd,
    dueLbp,
    discountUsd: repayDiscountUsdNum,
    discountLbp: repayDiscountLbpNum,
  });

  // CQ-10: standalone write-off amounts, capped at the outstanding balance
  // per currency (same clamp helper as the bundled discount above).
  const {
    appliedDiscountUsd: writeOffAppliedUsd,
    appliedDiscountLbp: writeOffAppliedLbp,
  } = applyDebtDiscount({
    dueUsd,
    dueLbp,
    discountUsd: parseFloat(writeOffAmountUsd.replace(/,/g, "")) || 0,
    discountLbp: parseFloat(writeOffAmountLbp.replace(/,/g, "")) || 0,
  });

  // Per-SIDE outstanding flags — never reduce the two currencies to one sign:
  // a mixed client (USD credit + LBP debt, or the reverse) is a creditor AND
  // a debtor at once, and each side needs its own action button. Keying the
  // single button (and the table framing) off netUsd alone made one whole
  // side of a mixed position unreachable. Epsilons match the list filter
  // (USD cents; LBP has no sub-unit).
  const hasDebt = dueUsd > 0.01 || dueLbp > 0.5;
  const hasCredit = creditUsd > 0.01 || creditLbp > 0.5;
  // Table framing: a mixed account gets combined labels because its tables
  // genuinely contain both kinds of rows (charges AND purchases).
  const accountFraming: "creditor" | "debtor" | "mixed" =
    hasCredit && hasDebt ? "mixed" : hasCredit ? "creditor" : "debtor";
  // What the repayment modal is doing: collecting a debt or paying out credit.
  // Set by the panel button that opened it — never inferred from a converted
  // net total (a mixed position nets to ~0 and would misclassify).
  const [repayMode, setRepayMode] = useState<"repay" | "cashout">("repay");

  const loadLedgerBalance = async (clientId: number) => {
    try {
      const res = await api.getClientBalance(clientId);
      if (res.success && res.data) {
        setLedgerBalance({
          usd: res.data.balance_usd,
          lbp: res.data.balance_lbp,
        });
      }
    } catch (error) {
      logger.error("Failed to load ledger balance:", error);
    }
  };

  const loadSaleDetails = async (transactionId: number) => {
    try {
      logger.debug("Loading sale details for transaction ID:", {
        transactionId,
      });

      // First, get the transaction to find the actual sale ID
      const transaction = await api.getTransactionById(transactionId);
      logger.debug("Transaction data received:", { transaction });

      if (!transaction || transaction.source_table !== "sales") {
        alert(`Transaction #${transactionId} is not a sale or was not found.`);
        return;
      }

      const saleId = transaction.source_id;
      logger.debug("Sale ID from transaction:", { saleId });

      const sale = await api.getSale(saleId);
      logger.debug("Sale data received:", { sale });

      if (!sale) {
        alert(
          `Sale #${saleId} not found. This debt entry may reference a deleted or non-existent sale.`,
        );
        return;
      }

      const items = await api.getSaleItems(saleId);
      logger.debug("Sale items received:", { items });

      setSelectedSale({
        ...sale,
        items: items.map((item: any) => ({
          product_name: item.name || "Unknown Product",
          quantity: item.quantity || 0,
          price_per_unit: item.sold_price_usd || 0,
          subtotal: (item.sold_price_usd || 0) * (item.quantity || 0),
        })),
      });
      setShowSaleDetails(true);
    } catch (error) {
      logger.error("Failed to load sale details:", error);
      console.error("Sale details error:", error);
      alert(
        "Failed to load sale details. The data might be corrupted or the transaction ID is invalid.",
      );
    }
  };

  const loadServiceDebtDetails = async (
    transactionId: number,
    debtAmountUsd: number,
    debtAmountLbp: number,
  ) => {
    try {
      if (!window.api) return;
      // 1. Get the unified transaction to find source_id
      const txn = await window.api.transactions.getById(transactionId);
      if (!txn || txn.source_table !== "financial_services") return;

      // 2. Load the financial service record
      const fs = (await window.api.omt.getById(
        txn.source_id as number,
      )) as FinancialServiceData | null;
      if (!fs) return;

      // 3. Load all payment rows for this transaction
      const payments = (await window.api.omt.getPaymentsByTransaction(
        transactionId,
      )) as PaymentRowData[];

      setServiceDetail({ fs, payments, debtAmountUsd, debtAmountLbp });
      setShowServiceDetail(true);
    } catch (error) {
      logger.error("Failed to load service debt details:", error);
    }
  };

  const loadSessionDebtDetails = (
    sessionId: number,
    amountUsd: number,
    amountLbp: number,
    mode: "charges" | "payouts" | "all" = "charges",
  ) => {
    setSessionDetail({ sessionId, amountUsd, amountLbp, mode });
  };

  const handleProcessRepayment = async () => {
    if (!selectedClient) return;

    const validLines = repayPaymentLines.filter((l) => l.amount > 0);
    if (validLines.length === 0) {
      alert("Please enter a repayment amount.");
      return;
    }

    // Compute USD and LBP totals from payment lines
    const paidUSD = validLines
      .filter((l) => l.currencyCode === "USD")
      .reduce((s, l) => s + l.amount, 0);
    const paidLBP = validLines
      .filter((l) => l.currencyCode === "LBP")
      .reduce((s, l) => s + l.amount, 0);

    // Map frontend PaymentLine[] → backend leg format (include OUT return leg if present)
    const paymentLegs = toCamelLegs(validLines, repayReturnLegs);

    // CASH OUT (opened via the panel's Cash Out button): the shop pays the
    // client their credit. Books a POSITIVE ledger entry PER CURRENCY and
    // DEBITS the drawers (debt:cash-out). Routing it through addRepayment
    // doubled the credit and moved the till the wrong way; deciding by the
    // converted net total misclassified mixed positions (USD credit + LBP
    // debt nets to ~0).
    if (repayMode === "cashout") {
      // `api.cashOut` (the dual-mode adapter below) already branches IPC vs
      // REST internally via `ipcOrHttp` — no transport gate needed here
      // (rule 19; BIDIRECTIONAL_PAYMENT_LEGS_PLAN.md §2 bug 10). A raw
      // `window.api` truthiness check blocked cash-out in the browser even
      // though the REST route (`POST /api/debts/cash-out`) is live.
      // Allocate the payout against the PER-CURRENCY credit; a remainder in
      // one currency settles the other's credit at the modal rate (paying an
      // LBP credit out in USD is legitimate). The payout may never exceed the
      // total credit — the excess would leave cash out of the till unbooked.
      const cashOutRate = repayModalRate ?? EXCHANGE_RATE;
      const rateNeeded = paidLBP > 0 || creditLbp > 0;
      if (rateNeeded && !(Number.isFinite(cashOutRate) && cashOutRate > 0)) {
        alert(
          "Exchange rate unavailable — set today's USD/LBP rate before a cash out involving LBP.",
        );
        return;
      }
      const paidConv = paidUSD + (paidLBP > 0 ? paidLBP / cashOutRate : 0);
      const creditConv =
        creditUsd + (creditLbp > 0 ? creditLbp / cashOutRate : 0);
      if (paidConv > creditConv + 0.05) {
        alert(
          `Cash out ($${paidConv.toFixed(2)}) exceeds the client's credit ($${creditConv.toFixed(2)}).`,
        );
        return;
      }
      let outUsd = Math.min(paidUSD, creditUsd);
      let outLbp = Math.min(paidLBP, creditLbp);
      const leftUsd = paidUSD - outUsd;
      const leftLbp = paidLBP - outLbp;
      if (leftUsd > 0) {
        outLbp = Math.min(creditLbp, outLbp + leftUsd * cashOutRate);
      }
      if (leftLbp > 0) {
        outUsd = Math.min(creditUsd, outUsd + leftLbp / cashOutRate);
      }
      try {
        const result = await api.cashOut({
          clientId: selectedClient.id,
          amountUSD: outUsd,
          amountLBP: outLbp,
          payments: paymentLegs,
          note: repayNote,
          ...(repayTransactionTime
            ? { transaction_time: repayTransactionTime }
            : {}),
        });
        if (result.success) {
          appEvents.emit("notification:show", "Cash out processed!", "success");
          setShowRepaymentModal(false);
          setRepayPaymentLines([]);
          setRepayKeptChange(null);
          setRepayReturnLegs([]);
          setRepayNote("");
          setRepayTransactionTime(undefined);
          await loadDebtors();
          loadHistory(selectedClient.id);
          loadLedgerBalance(selectedClient.id);
        } else {
          alert("Error: " + result.error);
        }
      } catch (error) {
        logger.error("Cash out failed", { error });
        alert("Failed to process cash out");
      }
      return;
    }

    // REPAYMENT — reduce the debt PER CURRENCY: USD paid settles USD debt,
    // LBP paid settles LBP debt, and only the cross-currency remainder is
    // converted (LBP→USD keeps the documented smart-rounding). Converting
    // everything into one USD figure used to leave offsetting USD-credit /
    // LBP-debt residues on clients who paid across currencies.
    const conversionRate = repayModalRate ?? EXCHANGE_RATE;
    // CQ-10: gate on the DISCOUNT-ADJUSTED remaining due — the reduction call
    // below uses the same adjusted figures, so this must match.
    const needsConversion =
      paidLBP > repayRemainingDueLbp ||
      (paidUSD > repayRemainingDueUsd && repayRemainingDueLbp > 0);
    if (
      needsConversion &&
      !(Number.isFinite(conversionRate) && conversionRate > 0)
    ) {
      alert(
        "Exchange rate unavailable — set today's USD/LBP rate before taking a cross-currency repayment.",
      );
      return;
    }

    // Change handed back to the customer (OUT/return legs) per currency. Netted
    // out of the debt reduction so an overpayment is not counted twice —
    // returned as change AND cleared from the debt (see repaymentReduction.ts).
    // Kept change (T3) behaves like a return for the REDUCTION math — the
    // kept extra must not shrink the debt (it is shop profit, not client
    // credit) — but no OUT legs exist, so the drawer keeps it.
    const keptUsd = repayKeptChange?.usd ?? 0;
    const keptLbp = repayKeptChange?.lbp ?? 0;
    const returnedUsd =
      repayReturnLegs
        .filter((l) => l.currencyCode === "USD")
        .reduce((s, l) => s + l.amount, 0) + keptUsd;
    const returnedLbp =
      repayReturnLegs
        .filter((l) => l.currencyCode === "LBP")
        .reduce((s, l) => s + l.amount, 0) + keptLbp;
    // CQ-10: due passed here is the DISCOUNT-ADJUSTED remaining due, never
    // the raw dueUsd/dueLbp — see applyDebtDiscount's header comment for why
    // that seam matters (paid + discount must never be able to exceed the
    // original due).
    const { reduceUsd, reduceLbp } = computeRepaymentReduction({
      paidUsd: paidUSD,
      paidLbp: paidLBP,
      returnedUsd,
      returnedLbp,
      dueUsd: repayRemainingDueUsd,
      dueLbp: repayRemainingDueLbp,
      rate: conversionRate,
    });

    if (!Number.isFinite(reduceUsd) || !Number.isFinite(reduceLbp)) {
      alert(
        "Could not compute the repayment amount — check the entered lines.",
      );
      return;
    }

    const hasDiscount =
      repayAppliedDiscountUsd > 0 || repayAppliedDiscountLbp > 0;
    const discountFields = hasDiscount
      ? {
          discount: {
            amount_usd: repayAppliedDiscountUsd,
            amount_lbp: repayAppliedDiscountLbp,
            ...(repayDiscountReason.trim()
              ? { reason: repayDiscountReason.trim() }
              : {}),
          },
        }
      : {};

    try {
      const keptFields =
        keptUsd > 0 || keptLbp > 0
          ? { keptChangeUSD: keptUsd, keptChangeLBP: keptLbp }
          : {};
      const result = window.api
        ? await window.api.debt.addRepayment({
            clientId: selectedClient.id,
            amountUSD: reduceUsd,
            amountLBP: reduceLbp,
            payments: paymentLegs,
            note: repayNote,
            ...keptFields,
            ...discountFields,
            ...(repayTransactionTime
              ? { transaction_time: repayTransactionTime }
              : {}),
            ...(user?.id != null ? { userId: user.id } : {}),
          })
        : await api.addRepayment({
            client_id: selectedClient.id,
            amount_usd: reduceUsd,
            amount_lbp: reduceLbp,
            payments: paymentLegs,
            note: repayNote,
            ...keptFields,
            ...discountFields,
            ...(repayTransactionTime
              ? { transaction_time: repayTransactionTime }
              : {}),
            ...(user?.id != null ? { user_id: user.id } : {}),
          });

      if (result.success) {
        appEvents.emit(
          "notification:show",
          hasDiscount
            ? `Repayment processed (discount $${repayAppliedDiscountUsd.toFixed(2)}${
                repayAppliedDiscountLbp > 0
                  ? ` + ${repayAppliedDiscountLbp.toLocaleString()} LBP`
                  : ""
              })`
            : "Repayment processed!",
          "success",
        );
        setShowRepaymentModal(false);
        setRepayPaymentLines([]);
        setRepayKeptChange(null);
        setRepayReturnLegs([]);
        setRepayNote("");
        setRepayTransactionTime(undefined);
        setRepayDiscountUsd("");
        setRepayDiscountLbp("");
        setRepayDiscountReason("");

        // Reload debtors list
        await loadDebtors();

        // Keep the client selected while EITHER currency has an open balance
        // (debt or credit). The old check compared the USD-CONVERTED net
        // (getClientTotal) to 0.01, which deselected a mixed client whose
        // remaining debt was masked by the other currency's credit — and any
        // client left holding a credit — then auto-select jumped to a
        // different client right after the operator acted on this one.
        let stillOpen = true;
        if (window.api) {
          const balRes = await window.api.debt.getClientBalance(
            selectedClient.id,
          );
          if (balRes.success && balRes.data) {
            stillOpen =
              Math.abs(balRes.data.balance_usd) > 0.01 ||
              Math.abs(balRes.data.balance_lbp) > 0.5;
          }
        } else {
          stillOpen = (await api.getClientDebtTotal(selectedClient.id)) > 0.01;
        }

        if (stillOpen) {
          // Client still has an open balance, reload their history
          loadHistory(selectedClient.id);
          loadLedgerBalance(selectedClient.id);
        } else {
          // Client's account is fully closed, deselect them
          setSelectedClient(null);
          setHistory([]);
        }
      } else {
        alert("Error: " + result.error);
      }
    } catch (error) {
      logger.error("Operation failed", { error });
      alert("Failed to process repayment");
    }
  };

  // ---------------------------------------------------------------------------
  // Excel Import — execute the actual import to backend
  // ---------------------------------------------------------------------------
  const executeImport = useCallback(async (clients: ImportClient[]) => {
    setShowCleanup(false);
    setParsedClients(null);
    setIsImporting(true);

    try {
      // Filter out clients with no debt entries
      const clientsWithEntries = clients.filter((c) => c.entries.length > 0);
      const skippedEmpty = clients.length - clientsWithEntries.length;

      if (clientsWithEntries.length === 0) {
        alert("No clients with debt entries to import.");
        setIsImporting(false);
        return;
      }

      const clients_ = clientsWithEntries;
      const totalEntries = clients_.reduce((s, c) => s + c.entries.length, 0);
      const withoutPhone = clients_.filter((c) => !c.phone).length;

      if (
        !confirm(
          `Final confirmation:\n• ${clients_.length} clients (${withoutPhone} without phone)${skippedEmpty > 0 ? `\n• ${skippedEmpty} clients skipped (no entries)` : ""}\n• ${totalEntries} debt/payment entries\n\nProceed with import?`,
        )
      ) {
        setIsImporting(false);
        return;
      }

      const result = await window.api.clients.importDebts(clients_);

      if (result.success && result.result) {
        const r = result.result;
        alert(
          `Import Complete!\n\n` +
            `\u2022 Clients created: ${r.clientsCreated}\n` +
            `\u2022 Clients already existed: ${r.clientsSkipped}\n` +
            `\u2022 Clients discarded (no phone): ${r.clientsDiscarded}\n` +
            `\u2022 Debt entries imported: ${r.entriesImported}\n` +
            (r.duplicatesSkipped > 0
              ? `\u2022 Duplicates skipped (already imported): ${r.duplicatesSkipped}\n`
              : "") +
            (r.errors.length > 0
              ? `\n\u26A0\uFE0F ${r.errors.length} errors occurred. Check console for details.`
              : ""),
        );
        if (r.errors.length > 0) {
          logger.error("Import errors:", { errors: r.errors });
        }
        loadDebtors();
      } else {
        alert("Import failed: " + (result.error ?? "Unknown error"));
      }
    } catch (err) {
      logger.error("Excel import failed", { error: err });
      alert("Failed to import: " + String(err));
    } finally {
      setIsImporting(false);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Excel Import — parse file and show cleanup modal if needed
  // ---------------------------------------------------------------------------

  /** Normalise a phone string: keep digits only (strip /, spaces, etc.) */
  const normalizePhone = (raw: string): string => {
    if (!raw) return "";
    return String(raw).replace(/\D/g, "").trim();
  };

  /**
   * Footer rows in the ledger template carry summed amounts, not real
   * transactions: column A reads "TOTAL ON ACCOUNT", column F reads
   * "TOTAL PAID", and below them sit "Balance Remaining" rows. They must
   * never be imported as debts/payments. Detect them by the marker text in
   * the row's date/label cell — real entries only ever hold a date there.
   */
  const isSummaryRowLabel = (val: unknown): boolean => {
    const s = String(val ?? "")
      .toLowerCase()
      .trim();
    return s.includes("total") || s.includes("balance");
  };

  const handleImportFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;

      setIsImporting(true);
      try {
        const arrayBuffer = await file.arrayBuffer();
        const workbook = XLSX.read(arrayBuffer, {
          type: "array",
          cellDates: true,
          raw: true,
        });

        // Imported entries don't carry a trustworthy per-row date (ledger
        // sheets are handwritten and inconsistently formatted). Stamp every
        // entry with yesterday's date so bulk-imported history never shows
        // up under "today" on the dashboard.
        const importDate = new Date(
          Date.now() - 24 * 60 * 60 * 1000,
        ).toISOString();

        type ImportEntryLocal = {
          date: string | null;
          amount_usd: number;
          amount_lbp: number;
          description: string;
          type: "debt" | "payment";
        };

        // ---------------------------------------------------------------
        // Parse "list name" sheet (master client list)
        // ---------------------------------------------------------------
        const listNameClients: ListNameEntry[] = [];
        const listNameSheet =
          workbook.Sheets[
            workbook.SheetNames.find((s) => s.toLowerCase() === "list name") ??
              ""
          ];
        if (listNameSheet) {
          const listRows: unknown[][] = XLSX.utils.sheet_to_json(
            listNameSheet,
            { header: 1, defval: "", raw: true },
          );
          // Each row: col A (or B) = name, col B (or C/D) = phone
          // Skip header row if present
          const startRow =
            listRows.length > 0 &&
            String(listRows[0][0] ?? "")
              .toLowerCase()
              .includes("name")
              ? 1
              : 0;
          for (let r = startRow; r < listRows.length; r++) {
            const row = listRows[r];
            if (!row) continue;
            const name = String(row[0] ?? "").trim();
            if (!name) continue;
            // Col B = phone number
            const phoneVal = String(row[1] ?? "").trim();
            const phone =
              phoneVal && /\d/.test(phoneVal) ? normalizePhone(phoneVal) : "";
            listNameClients.push({ name, phone });
          }
        }

        // ---------------------------------------------------------------
        // Parse individual client pages
        // ---------------------------------------------------------------
        const pages: ParsedClientPage[] = [];

        for (const sheetName of workbook.SheetNames) {
          if (sheetName.toLowerCase() === "list name") continue;
          if (
            sheetName.startsWith("NAME (") ||
            sheetName === "Sheet1" ||
            sheetName === "Sheet2"
          )
            continue;

          const sheet = workbook.Sheets[sheetName];
          if (!sheet) continue;

          const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
            header: 1,
            defval: "",
            raw: true,
          });

          if (rows.length < 3) continue;

          // Row 0: fixed layout — A=label, B=client name, C="mobile #", D=phone
          let clientName = sheetName.trim();
          let clientPhone = "";

          const row0 = rows[0];
          if (row0) {
            const nameVal = String(row0[1] ?? "").trim();
            if (nameVal) clientName = nameVal;

            const phoneVal = String(row0[3] ?? "").trim();
            if (phoneVal) clientPhone = normalizePhone(phoneVal);
          }

          const entries: ImportEntryLocal[] = [];

          for (let r = 2; r < rows.length; r++) {
            const row = rows[r];
            if (!row || row.length === 0) continue;

            const leftDate = row[0];
            const leftUsd = row[1];
            const leftLbp = row[2];
            const leftDesc = row[3];

            const leftUsdVal =
              typeof leftUsd === "number"
                ? leftUsd
                : parseFloat(String(leftUsd ?? "0").replace(/,/g, "")) || 0;
            const leftLbpVal =
              typeof leftLbp === "number"
                ? leftLbp
                : parseFloat(String(leftLbp ?? "0").replace(/,/g, "")) || 0;

            if (
              (leftUsdVal > 0 || leftLbpVal > 0) &&
              !isSummaryRowLabel(leftDate)
            ) {
              entries.push({
                date: importDate,
                amount_usd: leftUsdVal,
                amount_lbp: leftLbpVal,
                description: String(leftDesc ?? "").trim(),
                type: "debt",
              });
            }

            const rightDate = row[5];
            const rightUsd = row[6];
            const rightLbp = row[7];
            const rightDesc = row[8];

            const rightUsdVal =
              typeof rightUsd === "number"
                ? rightUsd
                : parseFloat(String(rightUsd ?? "0").replace(/,/g, "")) || 0;
            const rightLbpVal =
              typeof rightLbp === "number"
                ? rightLbp
                : parseFloat(String(rightLbp ?? "0").replace(/,/g, "")) || 0;

            if (
              (rightUsdVal > 0 || rightLbpVal > 0) &&
              !isSummaryRowLabel(rightDate)
            ) {
              entries.push({
                date: importDate,
                amount_usd: rightUsdVal,
                amount_lbp: rightLbpVal,
                description: String(rightDesc ?? "").trim(),
                type: "payment",
              });
            }
          }

          pages.push({
            sheetName,
            name: clientName,
            phone: clientPhone,
            entries,
          });
        }

        logger.info("Parsed Excel file", {
          listNameCount: listNameClients.length,
          totalPages: pages.length,
          totalEntries: pages.reduce((s, p) => s + p.entries.length, 0),
        });

        if (pages.length === 0 && listNameClients.length === 0) {
          alert("No client data found in the Excel file.");
          return;
        }

        // ---------------------------------------------------------------
        // If we have a "list name" sheet, show the validation modal first
        // ---------------------------------------------------------------
        if (listNameClients.length > 0) {
          setValidationListNames(listNameClients);
          setValidationPages(pages);
          setShowValidation(true);
          setIsImporting(false);
        } else {
          // No list name sheet — use legacy flow
          const clients: ImportClient[] = pages.map((p) => ({
            name: p.name,
            phone: p.phone,
            entries: p.entries,
          }));
          const flagged = clients.filter((c) => !c.phone);
          if (flagged.length > 0) {
            setParsedClients(clients);
            setShowCleanup(true);
            setIsImporting(false);
          } else {
            setIsImporting(false);
            executeImport(clients);
          }
        }
      } catch (err) {
        logger.error("Excel import failed", { error: err });
        alert("Failed to parse Excel file: " + String(err));
        setIsImporting(false);
      } finally {
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [executeImport],
  );

  const filteredDebtors = debtors.filter((d) => {
    const matchesSearch =
      d.full_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      d.phone_number?.includes(searchTerm);

    if (!matchesSearch) return false;

    // A debt is "ongoing" if EITHER currency still has an outstanding
    // balance — a client can owe LBP only (USD 0) and must not be hidden.
    // LBP has no sub-unit, so > 0.5 is effectively >= 1.
    const hasOutstanding =
      Math.abs(d.total_debt_usd) > 0.01 || Math.abs(d.total_debt_lbp) > 0.5;
    if (debtFilter === "ongoing") {
      return hasOutstanding;
    } else if (debtFilter === "closed") {
      return !hasOutstanding;
    }
    return true; // 'all' filter
  });

  // Auto-select first client when filtered list changes
  useEffect(() => {
    if (filteredDebtors.length > 0 && !selectedClient) {
      setSelectedClient(filteredDebtors[0]);
    } else if (filteredDebtors.length === 0) {
      setSelectedClient(null);
    }
  }, [filteredDebtors, selectedClient]);

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500">
      {/* Hidden file input for Excel import */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        onChange={handleImportFile}
      />

      <PageHeader
        icon={BookOpen}
        title="Accounts"
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setCreditMoveCash(true);
                setShowCreditModal(true);
              }}
              className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-lg font-medium transition-all"
            >
              <Plus size={18} />
              Add Credit / Debt
            </button>
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg font-medium transition-all disabled:opacity-50"
            >
              <Upload size={18} />
              {isImporting ? "Importing..." : "Import Excel"}
            </button>
          </div>
        }
      />

      <div className="flex flex-1 min-h-0 gap-6 overflow-hidden">
        {/* Left: Debtors List */}
        <div className="w-[280px] min-w-[280px] flex flex-col bg-slate-800 rounded-xl border border-slate-700 shadow-xl overflow-hidden">
          <div className="p-4 border-b border-slate-700 space-y-4">
            <div className="relative">
              <Search
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
                size={18}
              />
              <input
                type="text"
                placeholder="Search client..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-10 pr-4 py-2 text-white focus:outline-none focus:border-red-500"
              />
            </div>
            {/* New filter dropdown */}
            <div className="mt-4">
              <Select
                value={debtFilter}
                onChange={(value) => {
                  setDebtFilter(value as DebtFilter);
                  setSelectedClient(null); // Reset selected client
                }}
                options={[
                  { value: "ongoing", label: "Ongoing" },
                  { value: "closed", label: "Closed" },
                  { value: "all", label: "All" },
                ]}
                ringColor="ring-red-500"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-2">
            {filteredDebtors.map((client) => {
              // Per-currency position — coloring BOTH amounts by the USD
              // sign painted a mixed client's LBP debt emerald (as credit)
              // and labeled a pure-LBP creditor "Debtor".
              const rowHasCredit =
                client.total_debt_usd < -0.01 || client.total_debt_lbp < -0.5;
              const rowHasDebt =
                client.total_debt_usd > 0.01 || client.total_debt_lbp > 0.5;
              const isMixed = rowHasCredit && rowHasDebt;
              const isSelected = selectedClient?.id === client.id;
              return (
                <button
                  key={client.id}
                  onClick={() => setSelectedClient(client)}
                  className={`w-full text-left px-3 py-4 rounded-lg border transition-all ${
                    isMixed
                      ? isSelected
                        ? "bg-slate-500/10 border-slate-400/50 shadow-md"
                        : "bg-slate-500/5 border-slate-500/20 hover:bg-slate-500/10"
                      : rowHasCredit
                        ? isSelected
                          ? "bg-emerald-500/10 border-emerald-500/50 shadow-md"
                          : "bg-emerald-500/5 border-emerald-500/20 hover:bg-emerald-500/10"
                        : isSelected
                          ? "bg-red-500/10 border-red-500/50 shadow-md"
                          : "bg-red-500/5 border-red-500/20 hover:bg-red-500/10"
                  }`}
                >
                  <div>
                    <div className="font-bold text-slate-200 truncate">
                      {client.full_name}
                    </div>
                    <div className="flex justify-between items-baseline gap-2 mt-1.5">
                      <span className="text-sm text-slate-400 truncate min-w-0">
                        {client.phone_number || "No Phone"}
                      </span>
                      <span className="flex items-baseline gap-2 shrink-0">
                        <span
                          className={`font-bold text-sm ${
                            client.total_debt_usd < -0.01
                              ? "text-emerald-400"
                              : client.total_debt_usd > 0.01
                                ? "text-red-400"
                                : "text-slate-400"
                          }`}
                        >
                          ${Math.abs(client.total_debt_usd).toFixed(2)}
                        </span>
                        {client.total_debt_lbp !== 0 && (
                          <span
                            className={`font-bold text-sm ${
                              client.total_debt_lbp < -0.5
                                ? "text-emerald-400"
                                : client.total_debt_lbp > 0.5
                                  ? "text-red-400"
                                  : "text-slate-400"
                            }`}
                          >
                            {Math.abs(client.total_debt_lbp).toLocaleString()}{" "}
                            LBP
                          </span>
                        )}
                      </span>
                    </div>
                  </div>
                </button>
              );
            })}
            {filteredDebtors.length === 0 && (
              <div className="text-center text-slate-500 py-8">
                No debtors found.
              </div>
            )}
          </div>
        </div>

        {/* Right: Details & History */}
        <div className="flex-1 flex flex-col bg-slate-800 rounded-xl border border-slate-700 shadow-xl overflow-hidden">
          {selectedClient ? (
            <>
              <div className="px-5 py-3 border-b border-slate-700 bg-slate-800/50">
                <div className="flex items-center justify-between gap-4">
                  {/* Left: Client name & phone number */}
                  <div className="flex items-baseline gap-2 shrink-0">
                    <h2 className="text-xl font-bold text-white">
                      {selectedClient.full_name}
                    </h2>
                    <span className="text-sm text-slate-400">
                      {selectedClient.phone_number || "No Phone"}
                    </span>
                  </div>

                  {/* Center: Balance — each currency carries its OWN sign
                      and color: a client can hold a USD credit AND an LBP
                      debt at the same time (forcing one sign on both once
                      displayed a mixed position as double credit). */}
                  <div
                    className={`flex items-center gap-3 px-5 py-2 rounded-xl border ${
                      netUsd < 0 && netLbp <= 0
                        ? "bg-emerald-500/5 border-emerald-500/20"
                        : netUsd >= 0 && netLbp >= 0
                          ? "bg-red-500/5 border-red-500/20"
                          : "bg-slate-500/5 border-slate-500/20"
                    }`}
                  >
                    <span className="text-xs font-medium text-slate-400 uppercase tracking-wider whitespace-nowrap">
                      Balance
                    </span>
                    <span
                      className={`font-mono text-2xl font-bold ${netUsd < 0 ? "text-emerald-400" : "text-red-400"}`}
                    >
                      {netUsd < 0 ? "+" : "-"}${Math.abs(netUsd).toFixed(2)}
                    </span>
                    {netLbp !== 0 && (
                      <>
                        <span className="text-slate-600 text-lg">|</span>
                        <span
                          className={`font-mono text-2xl font-bold ${netLbp < 0 ? "text-emerald-400" : "text-red-400"}`}
                        >
                          {netLbp < 0 ? "+" : "-"}
                          {Math.abs(netLbp).toLocaleString()} LBP
                        </span>
                      </>
                    )}
                  </div>

                  {/* Right: per-side actions. Each button is gated on ITS
                      side having an outstanding amount, so a mixed account
                      renders BOTH — the old single netUsd-picked button left
                      the other side unreachable (and offered "Settle Debt"
                      with zero due to a pure-LBP creditor, where any typed
                      amount booked a repayment that GREW the liability). */}
                  <div className="shrink-0 flex items-center gap-2">
                    {hasDebt && (
                      <button
                        onClick={() => {
                          setRepayMode("repay");
                          setRepayPaymentLines([]);
                          setRepayKeptChange(null);
                          setRepayReturnLegs([]);
                          setRepayDiscountUsd("");
                          setRepayDiscountLbp("");
                          setRepayDiscountReason("");
                          setShowRepaymentModal(true);
                        }}
                        className="px-6 py-2 rounded-lg font-bold shadow-lg active:scale-95 transition-all flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20"
                      >
                        <ArrowDownLeft size={20} />
                        Settle Debt
                      </button>
                    )}
                    {hasCredit && (
                      <button
                        onClick={() => {
                          setRepayMode("cashout");
                          setRepayPaymentLines([]);
                          setRepayKeptChange(null);
                          setRepayReturnLegs([]);
                          setShowRepaymentModal(true);
                        }}
                        className="px-6 py-2 rounded-lg font-bold shadow-lg active:scale-95 transition-all flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white shadow-red-900/20"
                      >
                        <ArrowUpRight size={20} />
                        Cash Out
                      </button>
                    )}
                    {/* CQ-10 (D4): standalone write-off — admin-only, pure
                        forgiveness with no cash movement. */}
                    {hasDebt && isAdmin && (
                      <button
                        onClick={() => {
                          setWriteOffAmountUsd("");
                          setWriteOffAmountLbp("");
                          setWriteOffReason("");
                          setShowWriteOffModal(true);
                        }}
                        className="px-4 py-2 rounded-lg font-bold shadow-lg active:scale-95 transition-all flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-slate-200"
                        title="Forgive part of the debt with no cash movement"
                      >
                        <Eraser size={18} />
                        Write off
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Debt Aging Buckets */}
              {aging &&
                (aging.current.usd > 0 ||
                  aging.current.lbp > 0 ||
                  aging.days_31_60.usd > 0 ||
                  aging.days_31_60.lbp > 0 ||
                  aging.days_61_90.usd > 0 ||
                  aging.days_61_90.lbp > 0 ||
                  aging.over_90.usd > 0 ||
                  aging.over_90.lbp > 0) && (
                  <div className="px-5 py-2 border-b border-slate-700 bg-slate-800/30">
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <Clock size={12} className="text-slate-500" />
                      <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
                        Aging
                      </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                      <div className="bg-slate-900/50 rounded-lg px-3 py-1.5 border border-green-900/30">
                        <div className="text-[10px] text-green-400 font-medium mb-0.5">
                          Current
                        </div>
                        <div className="text-xs font-bold text-white">
                          ${aging.current.usd.toFixed(2)}
                        </div>
                        {aging.current.lbp > 0 && (
                          <div className="text-[10px] text-slate-400">
                            {aging.current.lbp.toLocaleString()} LBP
                          </div>
                        )}
                      </div>
                      <div className="bg-slate-900/50 rounded-lg px-3 py-1.5 border border-yellow-900/30">
                        <div className="text-[10px] text-yellow-400 font-medium mb-0.5">
                          31–60 days
                        </div>
                        <div className="text-xs font-bold text-white">
                          ${aging.days_31_60.usd.toFixed(2)}
                        </div>
                        {aging.days_31_60.lbp > 0 && (
                          <div className="text-[10px] text-slate-400">
                            {aging.days_31_60.lbp.toLocaleString()} LBP
                          </div>
                        )}
                      </div>
                      <div className="bg-slate-900/50 rounded-lg px-3 py-1.5 border border-orange-900/30">
                        <div className="text-[10px] text-orange-400 font-medium mb-0.5">
                          61–90 days
                        </div>
                        <div className="text-xs font-bold text-white">
                          ${aging.days_61_90.usd.toFixed(2)}
                        </div>
                        {aging.days_61_90.lbp > 0 && (
                          <div className="text-[10px] text-slate-400">
                            {aging.days_61_90.lbp.toLocaleString()} LBP
                          </div>
                        )}
                      </div>
                      <div className="bg-slate-900/50 rounded-lg px-3 py-1.5 border border-red-900/30">
                        <div className="text-[10px] text-red-400 font-medium mb-0.5">
                          Over 90 days
                        </div>
                        <div className="text-xs font-bold text-white">
                          ${aging.over_90.usd.toFixed(2)}
                        </div>
                        {aging.over_90.lbp > 0 && (
                          <div className="text-[10px] text-slate-400">
                            {aging.over_90.lbp.toLocaleString()} LBP
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

              {/* Two Tables Side by Side */}
              <div className="flex-1 flex gap-4 p-4 overflow-hidden">
                {/* Left: Purchases (Debts) */}
                <div className="flex-1 flex flex-col bg-slate-900/40 rounded-lg border border-slate-700/50 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-slate-700/50 flex items-center justify-between">
                    <h3 className="text-xs font-bold text-red-400 uppercase tracking-wider">
                      {accountFraming === "mixed"
                        ? "Purchases & Charges"
                        : accountFraming === "creditor"
                          ? "Charges"
                          : "Purchases"}
                    </h3>
                    <span className="text-xs text-slate-500">
                      {debtEntries.length}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    <DataTable
                      columns={[
                        {
                          header: (
                            <button
                              onClick={toggleDateSort}
                              className="flex items-center gap-1 hover:text-slate-200 transition-colors"
                            >
                              Date
                              {dateSortOrder === "desc" ? (
                                <ChevronDown
                                  size={14}
                                  className="text-slate-500"
                                />
                              ) : (
                                <ChevronUp
                                  size={14}
                                  className="text-slate-500"
                                />
                              )}
                            </button>
                          ),
                          className: "px-4 py-2 text-xs font-medium",
                        },
                        {
                          header: "Note",
                          className: "px-3 py-2 text-xs font-medium",
                        },
                        {
                          header: "USD",
                          className: "px-3 py-2 text-xs font-medium text-right",
                        },
                        {
                          header: "LBP",
                          className: "px-3 py-2 text-xs font-medium text-right",
                        },
                      ]}
                      data={debtEntries}
                      exportExcel
                      exportPdf
                      exportFilename="debt-purchases"
                      className="w-full"
                      theadClassName="sticky top-0 bg-slate-900/95 backdrop-blur-sm text-left text-slate-400 border-b border-slate-700/50"
                      tbodyClassName="divide-y divide-slate-700/30"
                      emptyMessage="No purchases on debt"
                      renderRow={(item) => {
                        const isRefunded = Boolean(item.is_refunded);
                        return (
                          <>
                            <tr
                              key={item.id}
                              className={`hover:bg-slate-800/50${isRefunded ? " opacity-50" : ""}`}
                            >
                              <td className="px-4 py-2.5 text-slate-300 text-sm whitespace-nowrap">
                                {parseDbDate(
                                  item.created_at,
                                ).toLocaleDateString()}
                                <div className="text-[10px] text-slate-500">
                                  {parseDbDate(
                                    item.created_at,
                                  ).toLocaleTimeString()}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-slate-400 text-sm">
                                <div className="flex flex-col gap-1">
                                  {isRefunded && (
                                    <span className="inline-flex items-center self-start rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                                      Refunded
                                    </span>
                                  )}
                                  {item.transaction_type &&
                                    item.transaction_type !== "Sale Debt" && (
                                      <span
                                        className={`inline-flex items-center self-start px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                          item.transaction_type ===
                                          "Service Debt"
                                            ? "bg-sky-400/10 text-sky-400"
                                            : item.transaction_type ===
                                                "Recharge Debt"
                                              ? "bg-cyan-400/10 text-cyan-400"
                                              : item.transaction_type ===
                                                  "Custom Service Debt"
                                                ? "bg-teal-400/10 text-teal-400"
                                                : item.transaction_type ===
                                                    "Session Debt"
                                                  ? "bg-indigo-400/10 text-indigo-400"
                                                  : item.transaction_type ===
                                                      "CREDIT_DEPOSIT"
                                                    ? "bg-emerald-400/10 text-emerald-400"
                                                    : item.transaction_type ===
                                                        "CREDIT_USED"
                                                      ? "bg-orange-400/10 text-orange-400"
                                                      : item.transaction_type ===
                                                          "Manual Debt"
                                                        ? "bg-rose-400/10 text-rose-400"
                                                        : "bg-slate-700 text-slate-400"
                                        }`}
                                      >
                                        {item.transaction_type ===
                                          "Custom Service Debt" && (
                                          <Briefcase
                                            size={10}
                                            className="mr-1"
                                          />
                                        )}
                                        {item.transaction_type ===
                                        "CREDIT_DEPOSIT"
                                          ? "Credit Deposit"
                                          : item.transaction_type ===
                                              "CREDIT_USED"
                                            ? "Credit Used"
                                            : item.transaction_type}
                                      </span>
                                    )}
                                  <div className="flex items-center gap-1.5">
                                    {item.itemNames &&
                                    item.itemNames.length > 0 ? (
                                      <div className="flex flex-col gap-0.5 text-xs leading-tight max-w-[140px]">
                                        {item.itemNames.map((name) => (
                                          <div key={name} className="truncate">
                                            • {name}
                                          </div>
                                        ))}
                                      </div>
                                    ) : (
                                      <span className="whitespace-normal break-words">
                                        {item.note || "-"}
                                      </span>
                                    )}
                                    {item.transaction_id &&
                                      item.transaction_type === "Sale Debt" && (
                                        <button
                                          onClick={() =>
                                            loadSaleDetails(
                                              item.transaction_id!,
                                            )
                                          }
                                          className="shrink-0 p-1 rounded bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 transition-all"
                                          title="View Sale Details"
                                        >
                                          <Eye size={13} />
                                        </button>
                                      )}
                                    {item.transaction_id &&
                                      item.transaction_type ===
                                        "Service Debt" && (
                                        <button
                                          onClick={() =>
                                            loadServiceDebtDetails(
                                              item.transaction_id!,
                                              item.amount_usd,
                                              item.amount_lbp,
                                            )
                                          }
                                          className="shrink-0 p-1 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 transition-all"
                                          title="View Transaction Details"
                                        >
                                          <Eye size={13} />
                                        </button>
                                      )}
                                    {item.session_id &&
                                      item.transaction_type ===
                                        "Session Debt" && (
                                        <button
                                          onClick={() =>
                                            loadSessionDebtDetails(
                                              item.session_id!,
                                              item.amount_usd,
                                              item.amount_lbp,
                                              // On-account cash-out → its payout
                                              // shows on the Payments side, so
                                              // the basket eye shows CHARGES
                                              // only. A cash payout has no such
                                              // credit row, so show the FULL
                                              // basket (both signs). See
                                              // lira-session-cashout-credit /
                                              // lira-session-debt-payout-signs.
                                              sessionsWithOnAccountCredit.has(
                                                item.session_id,
                                              )
                                                ? "charges"
                                                : "all",
                                            )
                                          }
                                          className="shrink-0 p-1 rounded bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 transition-all"
                                          title="View Basket Items"
                                        >
                                          <Eye size={13} />
                                        </button>
                                      )}
                                  </div>
                                </div>
                              </td>
                              <td
                                className={`px-3 py-2.5 text-right font-mono text-sm font-bold ${item.transaction_type === "CREDIT_DEPOSIT" ? "text-emerald-400" : item.transaction_type === "CREDIT_USED" ? "text-orange-400" : "text-red-400"}`}
                              >
                                {Math.abs(item.amount_usd) > 0 ? (
                                  `$${Math.abs(item.amount_usd).toFixed(2)}`
                                ) : (
                                  <span className="text-slate-600">-</span>
                                )}
                              </td>
                              <td
                                className={`px-3 py-2.5 text-right font-mono text-sm font-bold ${item.transaction_type === "CREDIT_DEPOSIT" ? "text-emerald-400" : item.transaction_type === "CREDIT_USED" ? "text-orange-400" : "text-red-400"}`}
                              >
                                {Math.abs(item.amount_lbp) > 0 ? (
                                  `${Math.abs(item.amount_lbp).toLocaleString()}`
                                ) : (
                                  <span className="text-slate-600">-</span>
                                )}
                              </td>
                            </tr>
                          </>
                        );
                      }}
                    />
                  </div>
                  {/* Footer total */}
                  <div className="px-4 py-2.5 border-t border-slate-700/50 bg-slate-900/80 flex justify-between items-center">
                    <span className="text-xs font-bold text-slate-400 uppercase">
                      {accountFraming === "mixed"
                        ? "Total Debited"
                        : accountFraming === "creditor"
                          ? "Total Charged"
                          : "Total Owed"}
                    </span>
                    <div className="flex gap-3">
                      <span className="font-mono text-sm font-bold text-red-400">
                        ${debtTotals.usd.toFixed(2)}
                      </span>
                      {debtTotals.lbp > 0 && (
                        <span className="font-mono text-sm font-bold text-red-400">
                          {debtTotals.lbp.toLocaleString()} LBP
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right: Payments (Repayments) */}
                <div className="flex-1 flex flex-col bg-slate-900/40 rounded-lg border border-slate-700/50 overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-slate-700/50 flex items-center justify-between">
                    <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
                      {accountFraming === "mixed"
                        ? "Payments & Deposits"
                        : accountFraming === "creditor"
                          ? "Deposits"
                          : "Payments"}
                    </h3>
                    <span className="text-xs text-slate-500">
                      {paymentEntries.length}
                    </span>
                  </div>
                  <div className="flex-1 overflow-y-auto">
                    <DataTable
                      columns={[
                        {
                          header: (
                            <button
                              onClick={toggleDateSort}
                              className="flex items-center gap-1 hover:text-slate-200 transition-colors"
                            >
                              Date
                              {dateSortOrder === "desc" ? (
                                <ChevronDown
                                  size={14}
                                  className="text-slate-500"
                                />
                              ) : (
                                <ChevronUp
                                  size={14}
                                  className="text-slate-500"
                                />
                              )}
                            </button>
                          ),
                          className: "px-4 py-2 text-xs font-medium",
                        },
                        {
                          header: "Note",
                          className: "px-3 py-2 text-xs font-medium",
                        },
                        {
                          header: "USD",
                          className: "px-3 py-2 text-xs font-medium text-right",
                        },
                        {
                          header: "LBP",
                          className: "px-3 py-2 text-xs font-medium text-right",
                        },
                      ]}
                      data={paymentEntries}
                      exportExcel
                      exportPdf
                      exportFilename="debt-payments"
                      className="w-full"
                      theadClassName="sticky top-0 bg-slate-900/95 backdrop-blur-sm text-left text-slate-400 border-b border-slate-700/50"
                      tbodyClassName="divide-y divide-slate-700/30"
                      emptyMessage="No payments recorded"
                      renderRow={(item) => {
                        const isRefunded = Boolean(item.is_refunded);
                        return (
                          <>
                            <tr
                              key={item.id}
                              className={`hover:bg-slate-800/50${isRefunded ? " opacity-50" : ""}`}
                            >
                              <td className="px-4 py-2.5 text-slate-300 text-sm whitespace-nowrap">
                                {parseDbDate(
                                  item.created_at,
                                ).toLocaleDateString()}
                                <div className="text-[10px] text-slate-500">
                                  {parseDbDate(
                                    item.created_at,
                                  ).toLocaleTimeString()}
                                </div>
                              </td>
                              <td className="px-3 py-2.5 text-slate-400 text-sm">
                                <span className="flex flex-col gap-1">
                                  {item.transaction_type ===
                                    "CREDIT_DEPOSIT" && (
                                    <span className="inline-flex items-center self-start px-1.5 py-0.5 rounded text-[10px] font-medium bg-emerald-400/10 text-emerald-400">
                                      Credit Deposit
                                    </span>
                                  )}
                                  <span className="flex items-center gap-1">
                                    {item.note || "-"}
                                    {isRefunded && (
                                      <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
                                        Refunded
                                      </span>
                                    )}
                                    {item.session_id &&
                                      item.transaction_type ===
                                        "CREDIT_DEPOSIT" && (
                                        <button
                                          onClick={() =>
                                            loadSessionDebtDetails(
                                              item.session_id!,
                                              item.amount_usd,
                                              item.amount_lbp,
                                              "payouts",
                                            )
                                          }
                                          className="shrink-0 p-1 rounded bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 transition-all"
                                          title="View Basket Items"
                                        >
                                          <Eye size={13} />
                                        </button>
                                      )}
                                  </span>
                                </span>
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-sm font-bold text-emerald-400">
                                {Math.abs(item.amount_usd) > 0 ? (
                                  `$${Math.abs(item.amount_usd).toFixed(2)}`
                                ) : (
                                  <span className="text-slate-600">-</span>
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-right font-mono text-sm font-bold text-emerald-400">
                                {Math.abs(item.amount_lbp) > 0 ? (
                                  `${Math.abs(item.amount_lbp).toLocaleString()}`
                                ) : (
                                  <span className="text-slate-600">-</span>
                                )}
                              </td>
                            </tr>
                          </>
                        );
                      }}
                    />
                  </div>
                  {/* Footer total */}
                  <div className="px-4 py-2.5 border-t border-slate-700/50 bg-slate-900/80 flex justify-between items-center">
                    <span className="text-xs font-bold text-slate-400 uppercase">
                      {accountFraming === "mixed"
                        ? "Total Credited"
                        : accountFraming === "creditor"
                          ? "Total Deposited"
                          : "Total Paid"}
                    </span>
                    <div className="flex gap-3">
                      <span className="font-mono text-sm font-bold text-emerald-400">
                        ${paymentTotals.usd.toFixed(2)}
                      </span>
                      {paymentTotals.lbp > 0 && (
                        <span className="font-mono text-sm font-bold text-emerald-400">
                          {paymentTotals.lbp.toLocaleString()} LBP
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-500">
              <div className="w-16 h-16 bg-slate-700/50 rounded-full flex items-center justify-center mb-4">
                <User size={32} className="opacity-50" />
              </div>
              <p>Select a client to view details</p>
            </div>
          )}
        </div>

        {/* Service Debt Detail Modal */}
        {showServiceDetail && serviceDetail && (
          <ServiceDebtDetailModal
            financialService={serviceDetail.fs}
            payments={serviceDetail.payments}
            debtAmountUsd={serviceDetail.debtAmountUsd}
            debtAmountLbp={serviceDetail.debtAmountLbp}
            // Frame by the client's balance in the ENTRY's own currency — the
            // account's USD sign painted a genuine LBP debt entry as a sky
            // "Account Charge" whenever the client held a USD credit.
            isCreditor={
              serviceDetail.fs.currency === "LBP" ? netLbp < 0 : netUsd < 0
            }
            onClose={() => {
              setShowServiceDetail(false);
              setServiceDetail(null);
            }}
          />
        )}

        {/* Session Debt Detail Modal */}
        {sessionDetail && (
          <SessionDebtDetailModal
            sessionId={sessionDetail.sessionId}
            debtAmountUsd={sessionDetail.amountUsd}
            debtAmountLbp={sessionDetail.amountLbp}
            mode={sessionDetail.mode}
            // Same per-entry-currency framing as the service modal above.
            isCreditor={sessionDetail.amountLbp !== 0 ? netLbp < 0 : netUsd < 0}
            onClose={() => setSessionDetail(null)}
          />
        )}

        {/* Import Validation Modal */}
        {showValidation && validationListNames && validationPages && (
          <ImportValidationModal
            listNameEntries={validationListNames}
            parsedPages={validationPages}
            onConfirm={(resolvedClients) => {
              setShowValidation(false);
              setValidationListNames(null);
              setValidationPages(null);
              // Check if any resolved clients still lack phone → show cleanup modal
              const flagged = resolvedClients.filter((c) => !c.phone);
              if (flagged.length > 0) {
                setParsedClients(resolvedClients);
                setShowCleanup(true);
              } else {
                executeImport(resolvedClients);
              }
            }}
            onCancel={() => {
              setShowValidation(false);
              setValidationListNames(null);
              setValidationPages(null);
            }}
          />
        )}

        {/* Import Cleanup Modal */}
        {showCleanup && parsedClients && (
          <ImportCleanupModal
            clients={parsedClients}
            onConfirm={(cleaned) => {
              setShowCleanup(false);
              setParsedClients(null);
              executeImport(cleaned);
            }}
            onCancel={() => {
              setShowCleanup(false);
              setParsedClients(null);
            }}
          />
        )}

        {/* Repayment Modal — CQ-11: shared CounterpartySettleModal
            (MultiPaymentInput + Debts' own dual-currency discount row +
            note + TransactionTimeOverride + footer), replacing the
            hand-rolled modal shell byte-for-byte in behavior. */}
        {showRepaymentModal && (
          <CounterpartySettleModal
            title="Process Repayment"
            onCancel={() => setShowRepaymentModal(false)}
            onConfirm={handleProcessRepayment}
            confirmLabel="Confirm Payment"
            confirmColor="emerald"
            multiPaymentInput={{
              // Per-currency totals (multi-currency engine, T2 fix): the
              // debt keeps its native composition, so an LBP debt paid in
              // LBP is rate-invariant — editing the modal rate no longer
              // re-derives the LBP figure through a USD scalar
              // (docs/plans/done_plans/MULTI_CURRENCY_PAYMENT_PLAN.md, MCP-3).
              // Repay mode feeds the DISCOUNT-ADJUSTED remaining due (CQ-10)
              // — never the raw due — so "Remaining (Debt)" and the
              // auto-filled amount already reflect a bundled discount.
              totals: [
                ...((repayMode === "cashout"
                  ? creditUsd
                  : repayRemainingDueUsd) > 0
                  ? [
                      {
                        amount:
                          repayMode === "cashout"
                            ? creditUsd
                            : repayRemainingDueUsd,
                        currency: "USD",
                      },
                    ]
                  : []),
                ...((repayMode === "cashout"
                  ? creditLbp
                  : repayRemainingDueLbp) > 0
                  ? [
                      {
                        amount:
                          repayMode === "cashout"
                            ? creditLbp
                            : repayRemainingDueLbp,
                        currency: "LBP",
                      },
                    ]
                  : []),
              ],
              // Repayments convert at the BUY side (owner decision
              // 2026-07-06) — passed explicitly, never defaulted silently.
              side: "buy",
              // Seeded ONCE on mount — the discount is 0 at that point, so
              // the raw due/credit is the correct initial prefill; the
              // reactive `totals` above carries any later discount.
              initialLines: [
                ...((repayMode === "cashout" ? creditUsd : dueUsd) > 0
                  ? [
                      {
                        currencyCode: "USD",
                        amount: repayMode === "cashout" ? creditUsd : dueUsd,
                      },
                    ]
                  : []),
                ...((repayMode === "cashout" ? creditLbp : dueLbp) > 0
                  ? [
                      {
                        currencyCode: "LBP",
                        amount: repayMode === "cashout" ? creditLbp : dueLbp,
                      },
                    ]
                  : []),
              ],
              currency: "USD",
              onChange: setRepayPaymentLines,
              onReturnChange: setRepayReturnLegs,
              showPmFee: false,
              // CQ-10: MultiPaymentInput's built-in discount is a single
              // scalar normalized to ONE target currency — it doesn't map
              // cleanly onto a mixed USD+LBP debt position, so the compact
              // "Discount / forgive" row (discountSlot below) replaces it
              // (repay mode only).
              showDiscount: false,
              paymentMethods: methods,
              currencies: [
                { code: "USD", symbol: "$" },
                { code: "LBP", symbol: "LBP" },
              ],
              exchangeRate: EXCHANGE_RATE,
              onExchangeRateChange: setRepayModalRate,
              // T3 keep-change — REPAY mode only: keeping "change" on a
              // cash-out (shop pays the client) has no defined booking
              // semantics, so the button stays hidden there (opt-in).
              ...(repayMode === "repay"
                ? { onKeptChange: setRepayKeptChange }
                : {}),
            }}
            discountSlot={
              // CQ-10: bundled discount / forgive — repay mode only. Each
              // currency is capped client-side at what's still due; the
              // backend re-validates.
              repayMode === "repay" &&
              hasDebt && (
                <div className="bg-emerald-950/20 border border-emerald-800/40 rounded-xl p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-emerald-400 uppercase tracking-wider">
                      Discount / Forgive
                    </span>
                    {(repayAppliedDiscountUsd > 0 ||
                      repayAppliedDiscountLbp > 0) && (
                      <span className="text-[11px] text-emerald-400/70">
                        Remaining: ${repayRemainingDueUsd.toFixed(2)}
                        {repayRemainingDueLbp > 0 &&
                          ` + ${repayRemainingDueLbp.toLocaleString()} LBP`}
                      </span>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Amount (USD)
                      </label>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={repayDiscountUsd}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/,/g, "");
                          if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
                            setRepayDiscountUsd(raw);
                          }
                        }}
                        className="w-full bg-slate-900 border border-emerald-700/40 rounded-lg px-3 py-1.5 text-emerald-100 text-sm font-mono focus:outline-none focus:border-emerald-500"
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] text-slate-400 mb-1">
                        Amount (LBP)
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={repayDiscountLbp}
                        onChange={(e) => {
                          const raw = e.target.value.replace(/,/g, "");
                          if (raw === "" || /^\d+$/.test(raw)) {
                            setRepayDiscountLbp(raw);
                          }
                        }}
                        className="w-full bg-slate-900 border border-emerald-700/40 rounded-lg px-3 py-1.5 text-emerald-100 text-sm font-mono focus:outline-none focus:border-emerald-500"
                        placeholder="0"
                      />
                    </div>
                  </div>
                  <input
                    type="text"
                    value={repayDiscountReason}
                    onChange={(e) => setRepayDiscountReason(e.target.value)}
                    className="w-full bg-slate-900 border border-emerald-700/40 rounded-lg px-3 py-1.5 text-emerald-100 text-xs focus:outline-none focus:border-emerald-500"
                    placeholder="Reason (optional)..."
                  />
                </div>
              )
            }
          >
            <div>
              <label
                htmlFor="repay-note"
                className="block text-xs font-medium text-slate-400 mb-1 uppercase"
              >
                Note
              </label>
              <input
                id="repay-note"
                type="text"
                value={repayNote}
                onChange={(e) => setRepayNote(e.target.value)}
                className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-emerald-500"
                placeholder="Optional note..."
              />
            </div>

            <TransactionTimeOverride
              value={repayTransactionTime}
              onChange={setRepayTransactionTime}
            />
          </CounterpartySettleModal>
        )}

        {/* CQ-10 (D4): standalone "Write off debt" modal — admin-only, pure
            forgiveness with no cash movement. Capped client-side at the
            client's outstanding balance per currency; the backend
            re-validates. */}
        {showWriteOffModal && selectedClient && (
          <div
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setShowWriteOffModal(false);
            }}
          >
            <div
              className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl"
              role="presentation"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-bold text-white mb-1">
                Write off debt
              </h3>
              <p className="text-xs text-slate-400 mb-4">
                {selectedClient.full_name} — forgives part of the debt with no
                cash movement.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
                    Amount (USD) — owed ${dueUsd.toFixed(2)}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={writeOffAmountUsd}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/,/g, "");
                      if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
                        setWriteOffAmountUsd(raw);
                      }
                    }}
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500"
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
                    Amount (LBP) — owed {dueLbp.toLocaleString()}
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={writeOffAmountLbp}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/,/g, "");
                      if (raw === "" || /^\d+$/.test(raw)) {
                        setWriteOffAmountLbp(raw);
                      }
                    }}
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500"
                    placeholder="0"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
                    Reason
                  </label>
                  <input
                    type="text"
                    value={writeOffReason}
                    onChange={(e) => setWriteOffReason(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-orange-500"
                    placeholder="Optional reason..."
                  />
                </div>

                <div className="pt-2 flex gap-3">
                  <button
                    onClick={() => setShowWriteOffModal(false)}
                    className="flex-1 py-3 rounded-xl font-bold text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={
                      writeOffSubmitting ||
                      (writeOffAppliedUsd <= 0 && writeOffAppliedLbp <= 0)
                    }
                    onClick={async () => {
                      setWriteOffSubmitting(true);
                      try {
                        const result = await api.debtWriteOff({
                          clientId: selectedClient.id,
                          // camelCase — matches core's debtWriteOffSchema
                          // (reconciled against the sibling's landed schema;
                          // suppliers/partners write-off use amount_usd/
                          // amount_lbp, debt does not).
                          amountUSD: writeOffAppliedUsd,
                          amountLBP: writeOffAppliedLbp,
                          ...(writeOffReason.trim()
                            ? { reason: writeOffReason.trim() }
                            : {}),
                        });
                        if (result.success) {
                          appEvents.emit(
                            "notification:show",
                            "Debt written off.",
                            "success",
                          );
                          setShowWriteOffModal(false);
                          await loadDebtors();
                          loadHistory(selectedClient.id);
                          loadLedgerBalance(selectedClient.id);
                        } else {
                          alert("Error: " + result.error);
                        }
                      } catch (error) {
                        logger.error("Debt write-off failed", { error });
                        alert("Failed to write off debt");
                      } finally {
                        setWriteOffSubmitting(false);
                      }
                    }}
                    className="flex-1 py-3 rounded-xl font-bold disabled:bg-slate-700 disabled:text-slate-500 text-white shadow-lg active:scale-95 transition-all bg-orange-600 hover:bg-orange-500 shadow-orange-900/20"
                  >
                    {writeOffSubmitting ? "Processing..." : "Write off"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Credit Modal */}
        {showCreditModal && (
          <div
            className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setShowCreditModal(false);
            }}
          >
            <div
              className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl"
              role="presentation"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-bold text-white mb-4">
                {creditDirection === "credit" ? "Add Credit" : "Add Debt"}
              </h3>
              <div className="space-y-4">
                {/* Credit / Debt toggle */}
                <ServiceTypeTabs
                  size="sm"
                  value={creditDirection}
                  onChange={(v) => setCreditDirection(v as "credit" | "debt")}
                  customColor={
                    creditDirection === "credit" ? "#059669" : "#dc2626"
                  }
                  options={[
                    {
                      id: "credit",
                      label: "Credit",
                      iconKey: "ArrowUpCircle",
                    },
                    { id: "debt", label: "Debt", iconKey: "DollarSign" },
                  ]}
                />
                {/* Client Search */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
                    Client
                  </label>
                  {creditSelectedClient ? (
                    <div className="flex items-center justify-between bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
                      <span className="text-white text-sm font-medium">
                        {creditSelectedClient.full_name}
                      </span>
                      <button
                        onClick={() => {
                          setCreditSelectedClient(null);
                          setCreditClientSearch("");
                        }}
                        className="text-slate-400 hover:text-white"
                      >
                        <CloseIcon size={14} />
                      </button>
                    </div>
                  ) : (
                    <ClientAutocompleteInput
                      value={creditClientSearch}
                      onChange={setCreditClientSearch}
                      onClientSelect={(client: Client) =>
                        setCreditSelectedClient({
                          id: client.id,
                          full_name: client.full_name,
                        })
                      }
                      placeholder="Search client by name or phone..."
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-emerald-500"
                      showDebtBadge
                    />
                  )}
                </div>

                {/* Amount USD */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
                    Amount (USD)
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={creditAmountUsd}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/,/g, "");
                      if (raw === "" || /^\d*\.?\d*$/.test(raw)) {
                        const parts = raw.split(".");
                        parts[0] = parts[0].replace(
                          /\B(?=(\d{3})+(?!\d))/g,
                          ",",
                        );
                        setCreditAmountUsd(parts.join("."));
                      }
                    }}
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500"
                    placeholder="0.00"
                  />
                </div>

                {/* Amount LBP */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
                    Amount (LBP)
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={creditAmountLbp}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/,/g, "");
                      if (raw === "" || /^\d+$/.test(raw)) {
                        setCreditAmountLbp(
                          raw.replace(/\B(?=(\d{3})+(?!\d))/g, ","),
                        );
                      }
                    }}
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500"
                    placeholder="0"
                  />
                </div>

                {/* Note */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-1 uppercase tracking-wider">
                    Note
                  </label>
                  <input
                    type="text"
                    value={creditNote}
                    onChange={(e) => setCreditNote(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg px-4 py-2.5 text-white text-sm focus:outline-none focus:border-emerald-500"
                    placeholder="Optional note..."
                  />
                </div>

                {/* LIRA-080: "Cash moved" toggle — default ON (current
                    behavior). OFF = paper (no-cash) ledger correction. */}
                <label
                  className="flex items-start gap-2 bg-slate-800/60 border border-slate-700 rounded-lg px-3 py-2 cursor-pointer"
                  data-testid="account-cash-moved-toggle"
                >
                  <input
                    type="checkbox"
                    checked={creditMoveCash}
                    onChange={(e) => setCreditMoveCash(e.target.checked)}
                    className="mt-0.5 accent-emerald-500"
                  />
                  <span className="text-xs text-slate-300">
                    <span className="font-medium text-white">Cash moved</span> —
                    this entry moves the drawer:{" "}
                    {creditDirection === "credit"
                      ? "cash IN from the customer"
                      : "cash OUT to the customer (advance)"}
                    . Untick for a paper-only ledger correction (no drawer
                    change).
                  </span>
                </label>

                <div className="pt-2 flex gap-3">
                  <button
                    onClick={() => setShowCreditModal(false)}
                    className="flex-1 py-3 rounded-xl font-bold text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    disabled={
                      !creditSelectedClient ||
                      (parseFloat(creditAmountUsd.replace(/,/g, "")) <= 0 &&
                        parseFloat(creditAmountLbp.replace(/,/g, "")) <= 0)
                    }
                    onClick={async () => {
                      if (!creditSelectedClient) return;
                      const result = await api.addAccountEntry({
                        direction: creditDirection,
                        clientId: creditSelectedClient.id,
                        amountUSD:
                          parseFloat(creditAmountUsd.replace(/,/g, "")) || 0,
                        amountLBP:
                          parseFloat(creditAmountLbp.replace(/,/g, "")) || 0,
                        ...(creditNote ? { note: creditNote } : {}),
                        // LIRA-080: default ON preserves today's behavior;
                        // sent explicit so a future default flip can't silently
                        // change the drawer effect.
                        moveCash: creditMoveCash,
                      });
                      if (result.success) {
                        appEvents.emit(
                          "notification:show",
                          creditDirection === "credit"
                            ? "Credit added successfully!"
                            : "Debt added successfully!",
                          "success",
                        );
                        setShowCreditModal(false);
                        setCreditClientSearch("");
                        setCreditSelectedClient(null);
                        setCreditAmountUsd("");
                        setCreditAmountLbp("");
                        setCreditNote("");
                        setCreditDirection("credit");
                        setCreditMoveCash(true);
                        loadDebtors();
                        if (selectedClient) {
                          loadHistory(selectedClient.id);
                          loadLedgerBalance(selectedClient.id);
                        }
                      } else {
                        alert("Error: " + result.error);
                      }
                    }}
                    className={`flex-1 py-3 rounded-xl font-bold disabled:bg-slate-700 disabled:text-slate-500 text-white shadow-lg active:scale-95 transition-all ${
                      creditDirection === "credit"
                        ? "bg-emerald-600 hover:bg-emerald-500 shadow-emerald-900/20"
                        : "bg-red-600 hover:bg-red-500 shadow-red-900/20"
                    }`}
                  >
                    {creditDirection === "credit" ? "Add Credit" : "Add Debt"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sale Details Modal */}
      {showSaleDetails && selectedSale && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-slate-800 rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto border border-slate-700">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-slate-700">
              <h2 className="text-xl font-bold text-white">
                Sale Details - #{selectedSale.id}
              </h2>
              <button
                onClick={() => {
                  setShowSaleDetails(false);
                  setSelectedSale(null);
                }}
                className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
              >
                <CloseIcon size={20} className="text-slate-400" />
              </button>
            </div>

            {/* Content */}
            <div className="p-6 space-y-6">
              {/* Sale Info */}
              <div className="flex gap-4 p-4 bg-slate-900 rounded-lg">
                <div className="flex-[2]">
                  <p className="text-slate-500 text-sm">Date</p>
                  <p className="text-white font-medium">
                    {parseDbDate(selectedSale.created_at).toLocaleString()}
                  </p>
                </div>
                <div className="flex-1">
                  <p className="text-slate-500 text-sm">Total Amount</p>
                  <p className="text-white font-medium">
                    $
                    {(
                      selectedSale.final_amount_usd ||
                      selectedSale.total_amount_usd ||
                      0
                    ).toFixed(2)}
                  </p>
                </div>
                <div className="flex-1">
                  <p className="text-slate-500 text-sm">Amount Paid</p>
                  <p className="text-emerald-400 font-medium">
                    {formatPaidAmount(
                      selectedSale.paid_usd || 0,
                      selectedSale.paid_lbp || 0,
                    )}
                  </p>
                </div>
              </div>

              {/* Items Table */}
              <div>
                <h3 className="text-lg font-semibold text-white mb-3">Items</h3>
                <div className="overflow-x-auto">
                  <DataTable
                    columns={[
                      {
                        header: "Product",
                        className: "pb-3 text-sm font-medium",
                      },
                      {
                        header: "Qty",
                        className: "pb-3 text-sm font-medium text-center",
                      },
                      {
                        header: "Price",
                        className: "pb-3 text-sm font-medium text-right",
                      },
                      {
                        header: "Subtotal",
                        className: "pb-3 text-sm font-medium text-right",
                      },
                    ]}
                    data={selectedSale.items}
                    className="w-full"
                    theadClassName="border-b border-slate-700"
                    tbodyClassName="divide-y divide-slate-700"
                    renderRow={(item) => (
                      <tr key={`${item.product_name}-${item.price_per_unit}`}>
                        <td className="py-3 text-white">{item.product_name}</td>
                        <td className="py-3 text-slate-300 text-center">
                          {item.quantity}
                        </td>
                        <td className="py-3 text-slate-300 text-right">
                          ${item.price_per_unit.toFixed(2)}
                        </td>
                        <td className="py-3 text-white font-medium text-right">
                          ${item.subtotal.toFixed(2)}
                        </td>
                      </tr>
                    )}
                  />
                </div>
              </div>

              {/* Summary */}
              <div className="border-t border-slate-700 pt-4 space-y-2">
                {(selectedSale.discount_usd || 0) > 0 && (
                  <div className="flex justify-between text-slate-400">
                    <span>Discount:</span>
                    <span className="text-amber-400 font-medium">
                      -${(selectedSale.discount_usd || 0).toFixed(2)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between text-slate-400">
                  <span>Total Amount:</span>
                  <span className="text-white font-medium">
                    $
                    {(
                      selectedSale.final_amount_usd ||
                      selectedSale.total_amount_usd ||
                      0
                    ).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-slate-400">
                  <span>Amount Paid:</span>
                  <span className="text-emerald-400 font-medium">
                    {formatPaidAmount(
                      selectedSale.paid_usd || 0,
                      selectedSale.paid_lbp || 0,
                    )}
                  </span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t border-slate-700 pt-2">
                  <span className="text-white">Outstanding Debt:</span>
                  <span className="text-red-400">
                    ${saleOutstandingUsd(selectedSale).toFixed(2)}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
