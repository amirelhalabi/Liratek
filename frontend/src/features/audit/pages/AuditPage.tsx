import { useState } from "react";
import { Shield, ArrowLeftRight, Banknote } from "lucide-react";
import { PageHeader, Select } from "@liratek/ui";
import { DateRangeFilter } from "@/shared/components/DateRangeFilter";
import AuditLogViewer from "./AuditLogViewer";
import TransactionsViewer from "./TransactionsViewer";
import CashReportModal from "../components/CashReportModal";
import {
  ACTION_OPTIONS,
  ENTITY_TYPE_OPTIONS,
  FILTER_GROUPS,
} from "../auditConstants";

type TabKey = "audit" | "transactions";

const selectClass =
  "bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white text-sm focus:ring-2 focus:ring-violet-600";
const inputClass =
  "bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white text-sm focus:ring-2 focus:ring-violet-600";

export default function AuditPage() {
  const [active, setActive] = useState<TabKey>("transactions");

  // Shared row limit across both tabs
  const [rowsLimit, setRowsLimit] = useState(50);

  // Transaction filters
  const [txSelectedFilter, setTxSelectedFilter] = useState("");
  const [txSearchInput, setTxSearchInput] = useState("");
  const [txSearch, setTxSearch] = useState("");
  const [txFrom, setTxFrom] = useState("");
  const [showCashReport, setShowCashReport] = useState(false);
  const [txTo, setTxTo] = useState("");

  // Audit filters
  const [auditAction, setAuditAction] = useState("");
  const [auditEntityType, setAuditEntityType] = useState("");
  const [auditSearch, setAuditSearch] = useState("");
  const [auditFrom, setAuditFrom] = useState("");
  const [auditTo, setAuditTo] = useState("");

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col gap-4 overflow-auto animate-in fade-in duration-500">
      <PageHeader icon={Shield} title="Audit & Transactions" />

      {/* Card 1: Tabs + active filters */}
      <div className="bg-slate-800 rounded-xl border border-slate-700 p-4 flex flex-col gap-4 shrink-0">
        {/* Tab switcher */}
        <div className="flex gap-2">
          <button
            onClick={() => setActive("transactions")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              active === "transactions"
                ? "bg-violet-600 text-white"
                : "text-slate-300 hover:bg-slate-700"
            }`}
          >
            <ArrowLeftRight size={14} />
            Transactions
          </button>
          <button
            onClick={() => setActive("audit")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${
              active === "audit"
                ? "bg-violet-600 text-white"
                : "text-slate-300 hover:bg-slate-700"
            }`}
          >
            <Shield size={14} />
            Audit Log
          </button>
        </div>

        {/* Transaction filters */}
        {active === "transactions" && (
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="text"
                value={txSearchInput}
                onChange={(e) => setTxSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setTxSearch(txSearchInput.trim());
                }}
                placeholder="Search summary, client, user… (Enter)"
                className={`${inputClass} w-64`}
              />
              <Select
                value={txSelectedFilter}
                onChange={setTxSelectedFilter}
                options={[
                  { value: "", label: "All types" },
                  ...FILTER_GROUPS.flatMap(({ group, options }) => [
                    { value: `__group_${group}`, label: group, disabled: true },
                    ...options.map((o) => ({ value: o.label, label: o.label })),
                  ]),
                ]}
              />
              <DateRangeFilter
                from={txFrom}
                to={txTo}
                onFromChange={setTxFrom}
                onToChange={setTxTo}
              />
              <button
                data-testid="open-cash-report"
                onClick={() => setShowCashReport(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-slate-900 border border-slate-700 text-emerald-300 hover:bg-slate-800 hover:text-emerald-200 transition-colors"
              >
                <Banknote size={15} /> Cash Report
              </button>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-slate-400">Rows:</label>
              <input
                type="number"
                value={rowsLimit}
                onChange={(e) => setRowsLimit(Number(e.target.value) || 50)}
                className={`${inputClass} w-16 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
              />
            </div>
          </div>
        )}

        {/* Audit filters */}
        {active === "audit" && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              placeholder="Search summary..."
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              className={`${inputClass} w-48`}
            />
            <Select
              value={auditAction}
              onChange={(v) => setAuditAction(v)}
              options={[
                { value: "", label: "All actions" },
                ...ACTION_OPTIONS.map((a) => ({
                  value: a,
                  label: a.replace(/_/g, " "),
                })),
              ]}
              buttonClassName={selectClass}
            />
            <Select
              value={auditEntityType}
              onChange={(v) => setAuditEntityType(v)}
              options={[
                { value: "", label: "All entities" },
                ...ENTITY_TYPE_OPTIONS.map((et) => ({
                  value: et,
                  label: et.replace(/_/g, " "),
                })),
              ]}
              buttonClassName={selectClass}
            />
            <label className="text-xs text-slate-400">From:</label>
            <input
              type="date"
              value={auditFrom}
              onChange={(e) => setAuditFrom(e.target.value)}
              className={inputClass}
            />
            <label className="text-xs text-slate-400">To:</label>
            <input
              type="date"
              value={auditTo}
              onChange={(e) => setAuditTo(e.target.value)}
              className={inputClass}
            />
            <div className="flex items-center gap-2 ml-auto">
              <label className="text-sm text-slate-400">Rows:</label>
              <input
                type="number"
                value={rowsLimit}
                onChange={(e) => setRowsLimit(Number(e.target.value) || 50)}
                className={`${inputClass} w-16 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
              />
            </div>
          </div>
        )}
      </div>

      {/* Card 2: Table */}
      <div className="flex-1 min-h-0 bg-slate-800 rounded-xl border border-slate-700 overflow-auto">
        {active === "transactions" && (
          <TransactionsViewer
            limit={String(rowsLimit)}
            selectedFilter={txSelectedFilter}
            search={txSearch}
            from={txFrom}
            to={txTo}
          />
        )}
        {active === "audit" && (
          <AuditLogViewer
            action={auditAction}
            entityType={auditEntityType}
            search={auditSearch}
            from={auditFrom}
            to={auditTo}
            limit={rowsLimit}
          />
        )}
      </div>
      {showCashReport && (
        <CashReportModal onClose={() => setShowCashReport(false)} />
      )}
    </div>
  );
}
