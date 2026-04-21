import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import logger from "@/utils/logger";
import * as XLSX from "xlsx";
import {
  Search,
  User,
  ArrowDownLeft,
  ChevronDown,
  ChevronUp,
  BookOpen,
  Eye,
  Briefcase,
  Clock,
  X as CloseIcon,
  Zap,
  Upload,
} from "lucide-react";
import {
  PageHeader,
  Select,
  useApi,
  type DebtorSummary,
  type DebtLedgerEntity,
} from "@liratek/ui";
import { useAuth } from "@/features/auth/context/AuthContext";
import { useExchangeRate } from "@/hooks/useExchangeRate";
import { usePaymentMethods } from "@/hooks/usePaymentMethods";
import { DataTable } from "@liratek/ui";
import { MultiPaymentInput, type PaymentLine } from "@liratek/ui";
import {
  ServiceDebtDetailModal,
  type FinancialServiceData,
  type PaymentRowData,
} from "../../components/ServiceDebtDetailModal";
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
  const isAdmin = user?.role === "admin";
  const { allMethods: methods } = usePaymentMethods();
  const { rate: EXCHANGE_RATE } = useExchangeRate("USD", "LBP");
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
  };

  type SaleDetail = {
    id: number;
    final_amount_usd?: number;
    total_amount_usd?: number;
    paid_usd?: number;
    paid_lbp?: number;
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
  const [totalDebt, setTotalDebt] = useState(0);
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
    debtAmount: number;
  } | null>(null);

  // Repayment State
  const [repayPaymentLines, setRepayPaymentLines] = useState<PaymentLine[]>([]);
  const [repayNote, setRepayNote] = useState("");

  useEffect(() => {
    loadDebtors();
  }, []);

  useEffect(() => {
    if (selectedClient) {
      loadHistory(selectedClient.id);
      loadClientTotal(selectedClient.id);
      getDebtAging(selectedClient.id)
        .then(setAging)
        .catch(() => setAging(null));
    } else {
      setAging(null);
    }
  }, [selectedClient]);

  const loadDebtors = async () => {
    try {
      // Now getDebtors returns all clients with debt history
      const data = window.api
        ? await window.api.debt.getDebtors()
        : await api.getDebtors();
      setDebtors(data);
    } catch (error) {
      logger.error("Failed to load debtors:", error);
    }
  };

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
            (item.amount_usd > 0 || item.amount_lbp > 0)
          ) {
            try {
              const items = await api.getSaleItems(item.transaction_id);
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

  // Split history into debts (purchases) and payments (repayments)
  // Use transaction_type to properly categorize entries (handles edge cases with inconsistent amounts)
  const debtEntries = useMemo(() => {
    return [...history]
      .filter((item) => item.transaction_type !== "Repayment")
      .sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return dateSortOrder === "desc" ? dateB - dateA : dateA - dateB;
      });
  }, [history, dateSortOrder]);

  const paymentEntries = useMemo(() => {
    return [...history]
      .filter((item) => item.transaction_type === "Repayment")
      .sort((a, b) => {
        const dateA = new Date(a.created_at).getTime();
        const dateB = new Date(b.created_at).getTime();
        return dateSortOrder === "desc" ? dateB - dateA : dateA - dateB;
      });
  }, [history, dateSortOrder]);

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

  const loadClientTotal = async (clientId: number) => {
    try {
      const total = window.api
        ? await window.api.debt.getClientTotal(clientId)
        : await api.getClientDebtTotal(clientId);
      setTotalDebt(total || 0);
    } catch (error) {
      logger.error("Failed to load client total:", error);
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
    debtAmount: number,
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

      setServiceDetail({ fs, payments, debtAmount });
      setShowServiceDetail(true);
    } catch (error) {
      logger.error("Failed to load service debt details:", error);
    }
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

    // Debt reduction: USD lines reduce debt directly; LBP lines are converted
    // using the fractional-debt logic (preserving the rounding behaviour).
    const integerDebt = Math.floor(totalDebt);
    const fractionalDebt = totalDebt - integerDebt;
    const fractionalLBP = fractionalDebt * EXCHANGE_RATE;

    let debtReductionUSD = paidUSD;

    if (paidLBP > 0) {
      const roundedFractionalLBP = Math.ceil(fractionalLBP / 5000) * 5000;
      if (Math.abs(paidLBP - roundedFractionalLBP) < 1000) {
        debtReductionUSD += fractionalDebt;
      } else {
        debtReductionUSD += paidLBP / EXCHANGE_RATE;
      }
    }

    // Map frontend PaymentLine[] → backend leg format
    const paymentLegs = validLines.map((l) => ({
      method: l.method,
      currencyCode: l.currencyCode,
      amount: l.amount,
    }));

    try {
      const result = window.api
        ? await window.api.debt.addRepayment({
            clientId: selectedClient.id,
            amountUSD: debtReductionUSD,
            amountLBP: 0,
            payments: paymentLegs,
            note: repayNote,
            ...(user?.id != null ? { userId: user.id } : {}),
          })
        : await api.addRepayment({
            client_id: selectedClient.id,
            amount_usd: debtReductionUSD,
            amount_lbp: 0,
            payments: paymentLegs,
            note: repayNote,
            ...(user?.id != null ? { user_id: user.id } : {}),
          });

      if (result.success) {
        alert("Repayment processed!");
        setShowRepaymentModal(false);
        setRepayPaymentLines([]);
        setRepayNote("");

        // Reload debtors list
        await loadDebtors();

        // Check if client still has debt after repayment
        const updatedTotal = window.api
          ? await window.api.debt.getClientTotal(selectedClient.id)
          : await api.getClientDebtTotal(selectedClient.id);

        if (updatedTotal > 0.01) {
          // Client still has debt, reload their history
          loadHistory(selectedClient.id);
          loadClientTotal(selectedClient.id);
        } else {
          // Client's debt is fully closed, deselect them
          setSelectedClient(null);
          setHistory([]);
          setTotalDebt(0);
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
   * Try to parse a date value from an Excel cell.
   * SheetJS gives us a JS serial number or a string depending on format.
   */
  const parseExcelDate = (val: unknown): string | null => {
    if (val == null || val === "") return null;
    if (val instanceof Date) {
      return val.toISOString();
    }
    if (typeof val === "number") {
      const date = XLSX.SSF.parse_date_code(val);
      if (date) {
        const d = new Date(date.y, date.m - 1, date.d);
        return d.toISOString();
      }
    }
    if (typeof val === "string") {
      const parsed = new Date(val);
      if (!isNaN(parsed.getTime())) return parsed.toISOString();
    }
    return null;
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

            if (leftUsdVal > 0 || leftLbpVal > 0) {
              entries.push({
                date: parseExcelDate(leftDate),
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

            if (rightUsdVal > 0 || rightLbpVal > 0) {
              entries.push({
                date: parseExcelDate(rightDate),
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

    if (debtFilter === "ongoing") {
      return d.total_debt > 0.01;
    } else if (debtFilter === "closed") {
      return d.total_debt <= 0.01;
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
        title="Debts"
        actions={
          isAdmin ? (
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={isImporting}
              className="flex items-center gap-2 bg-slate-700 hover:bg-slate-600 text-white px-4 py-2 rounded-lg font-medium transition-all disabled:opacity-50"
            >
              <Upload size={18} />
              {isImporting ? "Importing..." : "Import Excel"}
            </button>
          ) : undefined
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
              <label
                htmlFor="debts-filter"
                className="block text-sm font-medium text-slate-400 mb-2"
              >
                Show Debts:
              </label>
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
            {filteredDebtors.map((client) => (
              <button
                key={client.id}
                onClick={() => setSelectedClient(client)}
                className={`w-full text-left p-3 rounded-lg border transition-all ${
                  selectedClient?.id === client.id
                    ? "bg-red-500/10 border-red-500/50 shadow-md"
                    : "bg-slate-700/30 border-transparent hover:bg-slate-700/50"
                }`}
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="font-bold text-slate-200">
                      {client.full_name}
                    </div>
                    <div className="text-xs text-slate-500">
                      {client.phone_number || "No Phone"}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-red-400 font-bold text-sm">
                      ${client.total_debt_usd.toFixed(2)}
                    </div>
                    {client.total_debt_lbp !== 0 && (
                      <div className="text-red-400/70 text-xs font-medium">
                        {client.total_debt_lbp.toLocaleString()} LBP
                      </div>
                    )}
                  </div>
                </div>
              </button>
            ))}
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
              <div className="px-5 py-3 border-b border-slate-700 flex justify-between items-center bg-slate-800/50">
                <div>
                  <h2 className="text-xl font-bold text-white">
                    {selectedClient.full_name}
                  </h2>
                  <p className="text-slate-400 text-sm">
                    Total Debt:{" "}
                    <span className="text-red-400 font-bold">
                      ${(debtTotals.usd - paymentTotals.usd).toFixed(2)}
                    </span>
                    <span className="text-slate-500 mx-1.5">|</span>
                    <span className="text-red-400 font-bold">
                      {(debtTotals.lbp - paymentTotals.lbp).toLocaleString()}{" "}
                      LBP
                    </span>
                  </p>
                </div>
                <button
                  onClick={() => {
                    setRepayPaymentLines([]);
                    setShowRepaymentModal(true);
                  }}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white px-6 py-2 rounded-lg font-bold shadow-lg shadow-emerald-900/20 active:scale-95 transition-all flex items-center gap-2"
                >
                  <ArrowDownLeft size={20} />
                  Settle Debt
                </button>
              </div>

              {/* Debt Aging Buckets */}
              {aging &&
                (aging.current.usd > 0 ||
                  aging.days_31_60.usd > 0 ||
                  aging.days_61_90.usd > 0 ||
                  aging.over_90.usd > 0) && (
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
                      Purchases
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
                      renderRow={(item) => (
                        <tr key={item.id} className="hover:bg-slate-800/50">
                          <td className="px-4 py-2.5 text-slate-300 text-sm whitespace-nowrap">
                            {new Date(item.created_at).toLocaleDateString()}
                            <div className="text-[10px] text-slate-500">
                              {new Date(item.created_at).toLocaleTimeString()}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-slate-400 text-sm">
                            <div className="flex flex-col gap-1">
                              {item.transaction_type &&
                                item.transaction_type !== "Sale Debt" && (
                                  <span
                                    className={`inline-flex items-center self-start px-1.5 py-0.5 rounded text-[10px] font-medium ${
                                      item.transaction_type === "Service Debt"
                                        ? "bg-sky-400/10 text-sky-400"
                                        : item.transaction_type ===
                                            "Recharge Debt"
                                          ? "bg-cyan-400/10 text-cyan-400"
                                          : item.transaction_type ===
                                              "Custom Service Debt"
                                            ? "bg-teal-400/10 text-teal-400"
                                            : "bg-slate-700 text-slate-400"
                                    }`}
                                  >
                                    {item.transaction_type ===
                                      "Custom Service Debt" && (
                                      <Briefcase size={10} className="mr-1" />
                                    )}
                                    {item.transaction_type}
                                  </span>
                                )}
                              <div className="flex items-center gap-1.5">
                                {item.itemNames && item.itemNames.length > 0 ? (
                                  <div className="flex flex-col gap-0.5 text-xs leading-tight max-w-[140px]">
                                    {item.itemNames.map((name) => (
                                      <div key={name} className="truncate">
                                        • {name}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className="truncate max-w-[120px]">
                                    {item.note || "-"}
                                  </span>
                                )}
                                {item.transaction_id &&
                                  item.transaction_type === "Sale Debt" && (
                                    <button
                                      onClick={() =>
                                        loadSaleDetails(item.transaction_id!)
                                      }
                                      className="shrink-0 p-1 rounded bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 transition-all"
                                      title="View Sale Details"
                                    >
                                      <Eye size={13} />
                                    </button>
                                  )}
                                {item.transaction_id &&
                                  item.transaction_type === "Service Debt" && (
                                    <button
                                      onClick={() =>
                                        loadServiceDebtDetails(
                                          item.transaction_id!,
                                          item.amount_usd,
                                        )
                                      }
                                      className="shrink-0 p-1 rounded bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 transition-all"
                                      title="View Transaction Details"
                                    >
                                      <Eye size={13} />
                                    </button>
                                  )}
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-sm font-bold text-red-400">
                            {item.amount_usd > 0 ? (
                              `$${item.amount_usd.toFixed(2)}`
                            ) : (
                              <span className="text-slate-600">-</span>
                            )}
                          </td>
                          <td className="px-3 py-2.5 text-right font-mono text-sm font-bold text-red-400">
                            {item.amount_lbp > 0 ? (
                              `${item.amount_lbp.toLocaleString()}`
                            ) : (
                              <span className="text-slate-600">-</span>
                            )}
                          </td>
                        </tr>
                      )}
                    />
                  </div>
                  {/* Footer total */}
                  <div className="px-4 py-2.5 border-t border-slate-700/50 bg-slate-900/80 flex justify-between items-center">
                    <span className="text-xs font-bold text-slate-400 uppercase">
                      Total Owed
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
                      Payments
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
                      renderRow={(item) => (
                        <tr key={item.id} className="hover:bg-slate-800/50">
                          <td className="px-4 py-2.5 text-slate-300 text-sm whitespace-nowrap">
                            {new Date(item.created_at).toLocaleDateString()}
                            <div className="text-[10px] text-slate-500">
                              {new Date(item.created_at).toLocaleTimeString()}
                            </div>
                          </td>
                          <td className="px-3 py-2.5 text-slate-400 text-sm">
                            {item.note || "-"}
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
                      )}
                    />
                  </div>
                  {/* Footer total */}
                  <div className="px-4 py-2.5 border-t border-slate-700/50 bg-slate-900/80 flex justify-between items-center">
                    <span className="text-xs font-bold text-slate-400 uppercase">
                      Total Paid
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
            debtAmount={serviceDetail.debtAmount}
            onClose={() => {
              setShowServiceDetail(false);
              setServiceDetail(null);
            }}
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

        {/* Repayment Modal */}
        {showRepaymentModal && (
          <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            role="presentation"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) {
                setShowRepaymentModal(false);
              }
            }}
          >
            <div
              className="bg-slate-900 border border-slate-700 rounded-2xl p-6 w-full max-w-md shadow-2xl overflow-hidden"
              role="presentation"
              onMouseDown={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-bold text-white mb-4">
                Process Repayment
              </h3>

              <div className="space-y-4">
                {/* Quick Fill — full debt in USD */}
                <div>
                  <label className="block text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">
                    Quick Fill
                  </label>
                  <button
                    type="button"
                    onClick={() => {
                      setRepayPaymentLines([
                        {
                          id: crypto.randomUUID(),
                          method: "CASH",
                          currencyCode: "USD",
                          amount: totalDebt,
                        },
                      ]);
                    }}
                    className="w-full px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-sm font-medium transition-colors flex items-center justify-center gap-1"
                  >
                    <Zap size={14} />
                    Full debt — ${totalDebt.toFixed(2)}
                  </button>
                </div>

                {/* Multi-payment input */}
                <MultiPaymentInput
                  totalAmount={totalDebt}
                  currency="USD"
                  onChange={setRepayPaymentLines}
                  showPmFee={false}
                  paymentMethods={methods}
                  currencies={[
                    { code: "USD", symbol: "$" },
                    { code: "LBP", symbol: "LBP" },
                  ]}
                  exchangeRate={EXCHANGE_RATE}
                />

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

                <div className="pt-4 flex gap-3">
                  <button
                    onClick={() => setShowRepaymentModal(false)}
                    className="flex-1 py-3 rounded-xl font-bold text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleProcessRepayment}
                    className="flex-1 py-3 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20 active:scale-95 transition-all"
                  >
                    Confirm Payment
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
                    {new Date(selectedSale.created_at).toLocaleString()}
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
                    ${(selectedSale.paid_usd || 0).toFixed(2)}
                    {selectedSale.paid_lbp &&
                      selectedSale.paid_lbp > 0 &&
                      ` + ${selectedSale.paid_lbp.toLocaleString()} LBP`}
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
                    exportExcel
                    exportPdf
                    exportFilename="sale-items"
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
                    ${(selectedSale.paid_usd || 0).toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-between text-lg font-bold border-t border-slate-700 pt-2">
                  <span className="text-white">Outstanding Debt:</span>
                  <span className="text-red-400">
                    $
                    {(
                      (selectedSale.final_amount_usd ||
                        selectedSale.total_amount_usd ||
                        0) - (selectedSale.paid_usd || 0)
                    ).toFixed(2)}
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
