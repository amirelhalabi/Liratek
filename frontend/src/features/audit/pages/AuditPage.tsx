import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Shield, ArrowLeftRight, Banknote } from "lucide-react";
import { PageHeader, Select, MultiSelect, useDayRange } from "@liratek/ui";
import type { EN_RESOURCES } from "@liratek/ui/i18n/resources";
import AuditLogViewer from "./AuditLogViewer";
import TransactionsViewer from "./TransactionsViewer";
import CashReportModal from "../components/CashReportModal";
import {
  ACTION_OPTIONS,
  ENTITY_TYPE_OPTIONS,
  ALL_FILTER_OPTIONS,
  FILTER_GROUPS,
} from "../auditConstants";
import { translateTitle } from "../typeTitleText";

type TabKey = "audit" | "transactions";

const selectClass =
  "bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white text-sm focus:ring-2 focus:ring-violet-600";
const inputClass =
  "bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white text-sm focus:ring-2 focus:ring-violet-600";

// Flat label list for the Type MultiSelect — stable module-level reference
// (FILTER_GROUPS never changes at runtime) so it's safe to hand straight to
// MultiSelect's `options` prop without re-deriving it every render. These
// English labels are the option VALUES (the filter matches on them, and the
// e2e test ids carry them); the shown text comes from `getOptionLabel`.
const TYPE_FILTER_LABELS = ALL_FILTER_OPTIONS.map((o) => o.label);

type GroupKey = keyof (typeof EN_RESOURCES)["audit"]["filterGroups"];

/** LIRA-348 — both tables show 50 rows at a time and load the next 50 as
 *  the operator scrolls (the old free "Rows" box is gone). */
const PAGE_SIZE = 50;

export default function AuditPage() {
  const { t, i18n } = useTranslation("audit");
  const language = i18n.language;
  const [active, setActive] = useState<TabKey>("transactions");
  // The same options, in their FILTER_GROUPS sections, for the grouped list.
  // Only the section headings are translated; the options stay the keys.
  const typeFilterGroups = useMemo(
    () =>
      FILTER_GROUPS.map((g) => ({
        label: t(`filterGroups.${g.group as GroupKey}`, {
          defaultValue: g.group,
        }),
        options: g.options.map((o) => o.label),
      })),
    [t],
  );
  const typeOptionLabel = useMemo(
    () => (option: string) => translateTitle(option, t, language),
    [t, language],
  );

  // Transaction filters
  // Multi-select Type filter: a UNION (OR) of every selected option's tuple.
  // Empty array is the cleared "All types" state.
  const [txSelectedFilters, setTxSelectedFilters] = useState<string[]>([]);
  const [txSearchInput, setTxSearchInput] = useState("");
  const [txSearch, setTxSearch] = useState("");
  const [showCashReport, setShowCashReport] = useState(false);
  // LIRA-348 — each tab opens on today; the day filter is on the table.
  const txDays = useDayRange("today");

  // Audit filters
  const [auditAction, setAuditAction] = useState("");
  const [auditEntityType, setAuditEntityType] = useState("");
  const [auditSearch, setAuditSearch] = useState("");
  const auditDays = useDayRange("today");

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col gap-4 overflow-auto animate-in fade-in duration-500">
      <PageHeader title={t("page.title")} />

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
            {t("tabs.transactions")}
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
            {t("tabs.auditLog")}
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
                placeholder={t("filters.searchTransactions")}
                className={`${inputClass} w-64`}
              />
              <MultiSelect
                label={t("filters.allTypes")}
                testId="transactions-type-filter"
                className="w-56"
                values={txSelectedFilters}
                onChange={setTxSelectedFilters}
                options={TYPE_FILTER_LABELS}
                getOptionLabel={typeOptionLabel}
                groups={typeFilterGroups}
                optionsClassName="min-w-[18rem] max-h-[70vh]"
              />
              <button
                data-testid="open-cash-report"
                onClick={() => setShowCashReport(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium bg-slate-900 border border-slate-700 text-emerald-300 hover:bg-slate-800 hover:text-emerald-200 transition-colors"
              >
                <Banknote size={15} /> {t("filters.cashReport")}
              </button>
            </div>
          </div>
        )}

        {/* Audit filters */}
        {active === "audit" && (
          <div className="flex flex-wrap items-center gap-2">
            <input
              placeholder={t("filters.searchAudit")}
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              className={`${inputClass} w-48`}
            />
            <Select
              value={auditAction}
              onChange={(v) => setAuditAction(v)}
              options={[
                { value: "", label: t("filters.allActions") },
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
                { value: "", label: t("filters.allEntities") },
                ...ENTITY_TYPE_OPTIONS.map((et) => ({
                  value: et,
                  label: et.replace(/_/g, " "),
                })),
              ]}
              buttonClassName={selectClass}
            />
          </div>
        )}
      </div>

      {/* Card 2: Table */}
      <div className="flex-1 min-h-0 bg-slate-800 rounded-xl border border-slate-700 overflow-auto">
        {active === "transactions" && (
          <TransactionsViewer
            limit={String(PAGE_SIZE)}
            selectedFilters={txSelectedFilters}
            search={txSearch}
            from={txDays.from}
            to={txDays.to}
            onDayRangeChange={txDays.setRange}
          />
        )}
        {active === "audit" && (
          <AuditLogViewer
            action={auditAction}
            entityType={auditEntityType}
            search={auditSearch}
            from={auditDays.from}
            to={auditDays.to}
            limit={PAGE_SIZE}
            onDayRangeChange={auditDays.setRange}
          />
        )}
      </div>
      {showCashReport && (
        <CashReportModal onClose={() => setShowCashReport(false)} />
      )}
    </div>
  );
}
