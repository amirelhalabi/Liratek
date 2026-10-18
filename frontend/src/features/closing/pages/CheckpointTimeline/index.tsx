import { Fragment, useState, useEffect, useMemo, useRef } from "react";
import { PageHeader, Select, useApi, DateRangeFilter } from "@liratek/ui";
import { Clock, Eye, X, Check, AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Ltr } from "@liratek/ui/components/ui/Ltr";
import { normalizeDigits } from "@liratek/ui/i18n/digits";
import { useFormat } from "@/i18n/useFormat";
import { DataTable, appEvents } from "@liratek/ui";
import { DRAWER_ORDER } from "../../config/drawers";
import { useDrawerText } from "../../hooks/useDrawerText";
import { BrandedLabel } from "@/shared/components/BrandedLabel";
import {
  formatCurrencyAmount,
  formatDayVariance,
  getDateVarianceStatus,
  getVarianceStatus,
} from "../../utils/variance";
import { parseDbDate } from "@/shared/utils/parseDbDate";
import { localDay } from "@/shared/utils/localDay";
import type { DrawerType } from "../../types";
import {
  isOpenCheckpointDifference,
  type CarrierLineAdjustmentRecord,
  type CheckpointCurrency,
  type CheckpointDifferenceView,
  type CheckpointFilters as CoreCheckpointFilters,
  type CheckpointRecord as CoreCheckpointRecord,
} from "@liratek/core";
import { useOptionalAuth } from "@/features/auth/context/AuthContext";
import {
  DifferenceResolutionBlock,
  DifferenceStatusLine,
} from "../../components/DifferenceStatusLine";
import {
  CloseDifferenceDialog,
  ReopenDifferenceButton,
} from "../../components/CloseDifferenceDialog";

/**
 * The timeline's read shapes are core's own (rule 21): `CheckpointCurrency`,
 * `CheckpointCarrierLineRecord` and `CarrierLineAdjustmentRecord` are used
 * as is. Two page-only differences, both derived from core rather than
 * copied:
 *   - `CheckpointRecord` keeps `carrier_lines` / `differences` optional, as
 *     this page always read them (`?? []`), so a payload without them
 *     (older rows, a test fixture) still renders today's look (FR-022).
 *   - `CheckpointFilters` is the filter bar's form state, so its four
 *     inputs are always set; it stays assignable to core's filters.
 */
type CheckpointRecord = Omit<
  CoreCheckpointRecord,
  "carrier_lines" | "differences"
> &
  Partial<Pick<CoreCheckpointRecord, "carrier_lines" | "differences">>;

type CheckpointFilters = Required<
  Pick<CoreCheckpointFilters, "date_from" | "date_to" | "type" | "drawer_name">
> &
  Pick<CoreCheckpointFilters, "user_id" | "open_only">;

/** Only the fields this page reads out of a `CARRIER_LINE_ADJUSTMENT` row's
 *  `metadata_json` (see `postCarrierDrawerAdjustment`'s stamp). Defensive
 *  parse — a malformed/absent payload degrades to nulls rather than
 *  throwing, same as every other `metadata_json` reader in this codebase. */
function parseAdjustmentMeta(metaJson: string | null): {
  drawerName: string | null;
  phoneNumber: string | null;
  reason: string | null;
} {
  if (!metaJson) return { drawerName: null, phoneNumber: null, reason: null };
  try {
    const m = JSON.parse(metaJson) as {
      drawer_name?: string;
      phone_number?: string;
      reason?: string;
    };
    return {
      drawerName: m.drawer_name ?? null,
      phoneNumber: m.phone_number ?? null,
      reason: m.reason ?? null,
    };
  } catch {
    return { drawerName: null, phoneNumber: null, reason: null };
  }
}

/** One merged, time-sortable timeline row — a checkpoint OR a manual
 *  carrier-line drawer adjustment, interleaved by `created_at` so the
 *  operator can see why the NEXT checkpoint's "expected" moved (owner
 *  decision, LIRA-252). */
type TimelineRow =
  | { kind: "checkpoint"; created_at: string; checkpoint: CheckpointRecord }
  | {
      kind: "adjustment";
      created_at: string;
      adjustment: CarrierLineAdjustmentRecord;
    };

function todayISO(): string {
  return localDay();
}

/** The drawer name an all-drawers checkpoint (initial setup) is stored under. */
const ALL_DRAWERS = "AGGREGATED";

/** The counted amount. 0 is a real count; only a missing count (NULL in the
 *  database, never written by today's checkpoint) falls back to expected. */
function countedOf(c: CheckpointCurrency): number {
  return c.physical_amount ?? c.opening_amount ?? 0;
}

/** Money written the shop's way: `$8.00`, `50,000 LBP`, `10.00 USDT`. */
function formatMoney(amount: number, code: string): string {
  const value = formatCurrencyAmount(amount, code);
  return code === "USD" ? `$${value}` : `${value} ${code}`;
}

/** The drawers a checkpoint's amount lines belong to, in Dashboard order. */
function drawersOf(checkpoint: CheckpointRecord): string[] {
  const names = new Set(
    checkpoint.currencies.map((c) => c.drawer_name ?? checkpoint.drawer_name),
  );
  const ordered = DRAWER_ORDER.filter((d) => names.has(d));
  return [
    ...ordered,
    ...[...names].filter((n) => !ordered.includes(n as DrawerType)),
  ];
}

export default function CheckpointTimeline() {
  const { t } = useTranslation("closing");
  const { t: tc } = useTranslation("common");
  const fmt = useFormat();
  const drawerText = useDrawerText();
  const drawerLabel = (name: string): string =>
    name === ALL_DRAWERS ? t("timeline.initialSetup") : drawerText.label(name);
  /** counted − expected in words, e.g. "Short $3.00" / "Over 50,000 LBP". */
  const shortOrOver = (variance: number, amount: string): string =>
    t(variance < 0 ? "timeline.short" : "timeline.over", { amount });
  const auth = useOptionalAuth();
  const isAdmin = auth?.user?.role === "admin";
  const api = useApi();
  // Rule 25 — `api`'s identity is only stable because `ApiProvider` happens
  // to hand out a module-level singleton; nothing enforces that, and a test
  // mock's fresh object literal would make an `api` dependency re-fire every
  // render. Read it through a ref instead of putting `api` itself in any
  // effect's dependency array.
  const apiRef = useRef(api);
  apiRef.current = api;
  const [checkpoints, setCheckpoints] = useState<CheckpointRecord[]>([]);
  // LIRA-252 wave 2 — manual MTC/Alfa carrier-line drawer adjustments,
  // fetched alongside the checkpoints and interleaved into one timeline (see
  // `timelineRows` below) so the operator can see why the next checkpoint's
  // "expected" moved.
  const [carrierAdjustments, setCarrierAdjustments] = useState<
    CarrierLineAdjustmentRecord[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [limit, setLimit] = useState(100);
  const [filters, setFilters] = useState<CheckpointFilters>({
    date_from: todayISO(),
    date_to: todayISO(),
    type: "ALL",
    drawer_name: "",
  });
  const [viewCheckpoint, setViewCheckpoint] = useState<CheckpointRecord | null>(
    null,
  );
  // LIRA-335: how many checkpoints have an Open / Partly resolved difference
  // across the chosen filters (the server's count).
  const [openCount, setOpenCount] = useState<number | null>(null);
  const [closingDifference, setClosingDifference] =
    useState<CheckpointDifferenceView | null>(null);
  // closing_date of the initial (setup) checkpoint, for the "jump to setup" hint.
  const [initialCheckpointDate, setInitialCheckpointDate] = useState<
    string | null
  >(null);

  // Fetch the setup checkpoint date once so we can surface it when it falls
  // outside the current filter window.
  useEffect(() => {
    apiRef.current
      .getInitialCheckpointDate()
      .then(setInitialCheckpointDate)
      .catch(() => setInitialCheckpointDate(null));
  }, []);

  // Refresh the timeline after a checkpoint completes
  useEffect(() => {
    const off = appEvents.on("closing:completed", () => {
      loadCheckpoints();
    });
    return () => off();
  }, []);

  useEffect(() => {
    loadCheckpoints();
  }, [filters]);

  const loadCheckpoints = async () => {
    setLoading(true);
    try {
      // The carrier-line-adjustment companion read is MTC/Alfa only — when
      // the drawer filter already narrows to a non-carrier drawer (or to one
      // specific carrier), request exactly that; "All Drawers" fetches both
      // carriers unfiltered (the REST/IPC filter is an AND, not an OR, so a
      // non-carrier drawer_name would silently return zero rows forever —
      // this gate is what keeps that from being requested at all).
      const carrierFilter =
        filters.drawer_name === "MTC" || filters.drawer_name === "Alfa"
          ? filters.drawer_name
          : undefined;
      // An Open-differences list holds checkpoints only.
      const skipAdjustments =
        !!filters.open_only ||
        (filters.drawer_name !== "" &&
          filters.drawer_name !== "MTC" &&
          filters.drawer_name !== "Alfa");

      const [checkpointResult, adjustmentResult] = await Promise.all([
        apiRef.current.getCheckpointTimeline(filters),
        skipAdjustments
          ? Promise.resolve<{
              success: boolean;
              adjustments: CarrierLineAdjustmentRecord[];
            }>({ success: true, adjustments: [] })
          : apiRef.current.getCarrierLineAdjustments({
              date_from: filters.date_from,
              date_to: filters.date_to,
              ...(carrierFilter ? { drawer_name: carrierFilter } : {}),
            }),
      ]);
      if (checkpointResult.success && checkpointResult.checkpoints) {
        const list: CheckpointRecord[] = checkpointResult.checkpoints;
        setCheckpoints(list);
        // Keep an open details window on the fresh record (after Close /
        // Reopen, or any reload), so it never shows a stale status.
        setViewCheckpoint((prev) =>
          prev ? (list.find((c) => c.id === prev.id) ?? prev) : prev,
        );
      }
      setOpenCount(
        typeof checkpointResult.open_count === "number"
          ? checkpointResult.open_count
          : null,
      );
      if (adjustmentResult.success && adjustmentResult.adjustments) {
        setCarrierAdjustments(adjustmentResult.adjustments);
      } else {
        setCarrierAdjustments([]);
      }
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  };

  const formatTime = (iso: string) =>
    fmt.formatTime(parseDbDate(iso), { hour: "2-digit", minute: "2-digit" });

  // Same rule as the count screen: LBP whole, others to the cent.
  const formatCurrency = formatCurrencyAmount;

  const getAggregatedTotals = (checkpoint: CheckpointRecord) => {
    const totals: Record<string, number> = {};
    checkpoint.currencies.forEach((c) => {
      if (!totals[c.currency_code]) {
        totals[c.currency_code] = 0;
      }
      totals[c.currency_code] += countedOf(c);
    });
    return totals;
  };

  const CURRENCY_ORDER = ["USD", "USDT", "LBP"];

  // The row's counted amount. A currency is listed when it was counted or
  // expected at anything but zero — so a drawer counted at $0 against $205
  // still shows "$0.00". An all-zero drawer lists every currency at 0. A
  // checkpoint spanning several drawers (initial setup) says how many,
  // since one total across drawers is money no single drawer holds.
  const getAmountDisplay = (checkpoint: CheckpointRecord): string => {
    const drawers = drawersOf(checkpoint);
    if (drawers.length > 1)
      return t("timeline.drawersCount", { n: drawers.length });
    const totals = getAggregatedTotals(checkpoint);
    const nonZero = new Set(
      checkpoint.currencies
        .filter((c) => countedOf(c) !== 0 || (c.opening_amount ?? 0) !== 0)
        .map((c) => c.currency_code),
    );
    const codes = nonZero.size > 0 ? nonZero : new Set(Object.keys(totals));
    const ordered = [
      ...CURRENCY_ORDER.filter((code) => codes.has(code)),
      ...[...codes].filter((code) => !CURRENCY_ORDER.includes(code)),
    ];
    return (
      ordered
        .map((code) =>
          code === "USD"
            ? `$${formatCurrency(totals[code] ?? 0, code)}`
            : `${formatCurrency(totals[code] ?? 0, code)} ${code}`,
        )
        .join(" + ") || "—"
    );
  };

  // Currencies whose counted amount differs from expected (opening). No
  // tolerance — any difference beyond a rounding epsilon is a variance.
  const getCheckpointDiffs = (checkpoint: CheckpointRecord) =>
    checkpoint.currencies
      .map((c) => {
        const expected = c.opening_amount ?? 0;
        const counted = countedOf(c);
        const { status, variance } = getVarianceStatus(counted, expected);
        return { code: c.currency_code, status, variance };
      })
      .filter((d) => d.status === "diff");

  // SIM lines whose counted expiry differed from the stored one. Credits
  // variance already shows up through the provider drawer's USD row above —
  // the checkpoint writes the same counted figure to both — so only validity
  // needs its own line here, and only when it was actually counted.
  const getValidityDiffs = (checkpoint: CheckpointRecord) =>
    (checkpoint.carrier_lines ?? [])
      .map((l) => ({
        phone: l.phone_number,
        ...getDateVarianceStatus(l.counted_expires_at, l.expected_expires_at),
      }))
      .filter((d) => d.status === "diff");

  // Compact one-line variance summary for the timeline row.
  const getVarianceSummary = (
    diffs: ReturnType<typeof getCheckpointDiffs>,
    validityDiffs: ReturnType<typeof getValidityDiffs> = [],
  ): string => {
    const parts: string[] =
      diffs.length > 2
        ? [t("variance.inCurrencies", { n: diffs.length })]
        : diffs.map((d) =>
            shortOrOver(d.variance, formatMoney(Math.abs(d.variance), d.code)),
          );
    if (validityDiffs.length === 1) {
      parts.push(
        t("variance.validity", {
          days: formatDayVariance(validityDiffs[0].days),
        }),
      );
    } else if (validityDiffs.length > 1) {
      parts.push(t("variance.validityOnLines", { n: validityDiffs.length }));
    }
    return parts.join(t("variance.listSeparator"));
  };

  const filteredCheckpoints = useMemo(() => {
    if (!search.trim()) return checkpoints;
    const q = search.toLowerCase();
    return checkpoints.filter(
      (cp) =>
        cp.drawer_name.toLowerCase().includes(q) ||
        drawerLabel(cp.drawer_name).toLowerCase().includes(q) ||
        cp.user_name.toLowerCase().includes(q) ||
        (cp.notes ?? "").toLowerCase().includes(q),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkpoints, search, t]);

  // LIRA-252 wave 2 — the same search box also matches a manual carrier-line
  // adjustment's actor/line/reason, so narrowing the timeline by user or
  // phone number finds both kinds of row.
  const filteredAdjustments = useMemo(() => {
    if (!search.trim()) return carrierAdjustments;
    const q = search.toLowerCase();
    return carrierAdjustments.filter((a) => {
      const meta = parseAdjustmentMeta(a.metadata_json);
      return (
        a.user_name.toLowerCase().includes(q) ||
        a.summary.toLowerCase().includes(q) ||
        (meta.phoneNumber ?? "").toLowerCase().includes(q) ||
        (meta.drawerName ?? "").toLowerCase().includes(q)
      );
    });
  }, [carrierAdjustments, search]);

  // The merged, time-sorted timeline — checkpoints and manual carrier-line
  // adjustments interleaved by `created_at` (owner decision, LIRA-252:
  // "interleaved between the checkpoints they fall between", so the operator
  // can see why the next checkpoint's expected amount moved).
  const timelineRows: TimelineRow[] = useMemo(() => {
    const rows: TimelineRow[] = [
      ...filteredCheckpoints.map(
        (checkpoint): TimelineRow => ({
          kind: "checkpoint",
          created_at: checkpoint.created_at,
          checkpoint,
        }),
      ),
      ...filteredAdjustments.map(
        (adjustment): TimelineRow => ({
          kind: "adjustment",
          created_at: adjustment.created_at,
          adjustment,
        }),
      ),
    ];
    return rows.sort(
      (a, b) =>
        parseDbDate(b.created_at).getTime() -
        parseDbDate(a.created_at).getTime(),
    );
  }, [filteredCheckpoints, filteredAdjustments]);

  const displayedRows = useMemo(
    () => timelineRows.slice(0, limit),
    [timelineRows, limit],
  );

  // The setup checkpoint exists but sits before the current from-date, so it is
  // not in the table. Offer to move the from-date back to it (to-date untouched).
  const showInitialSetupHint =
    !!initialCheckpointDate && initialCheckpointDate < filters.date_from;

  const jumpToInitialSetup = () => {
    if (initialCheckpointDate) {
      setFilters((f) => ({ ...f, date_from: initialCheckpointDate }));
    }
  };

  // A range of more than one day shows which day each row belongs to: a
  // heading row before each day while the table is in time order, else the
  // day under each row's time (a heading would split apart once rows from
  // different days interleave, e.g. sorted by drawer). The details window
  // always shows the full date.
  const multiDay = filters.date_from !== filters.date_to;
  // The table's visible order, as it reports it — the page cannot see the
  // column the cashier sorted by, only the resulting order. Kept identical
  // (same array) when nothing moved, so this never feeds a render loop.
  const [visibleOrder, setVisibleOrder] = useState<TimelineRow[]>([]);
  const onVisibleRowsChange = (rows: TimelineRow[]) =>
    setVisibleOrder((prev) =>
      prev.length === rows.length && prev.every((r, i) => r === rows[i])
        ? prev
        : rows,
    );
  const timeOf = (row: TimelineRow) => parseDbDate(row.created_at).getTime();
  const isTimeOrdered = (rows: TimelineRow[]) =>
    rows.every((r, i) => i === 0 || timeOf(rows[i - 1]) >= timeOf(r)) ||
    rows.every((r, i) => i === 0 || timeOf(rows[i - 1]) <= timeOf(r));
  const dayHeadings =
    multiDay && visibleOrder.length > 0 && isTimeOrdered(visibleOrder);
  // A comparison key, never shown: the local calendar day (rule 27).
  const dayKey = (iso: string) => localDay(parseDbDate(iso));
  const formatDayHeading = (iso: string) =>
    fmt.formatDate(parseDbDate(iso), {
      weekday: "short",
      year: "numeric",
      month: "short",
      day: "numeric",
    }) + (dayKey(iso) === todayISO() ? ` · ${t("timeline.today")}` : "");
  const formatDay = (iso: string) =>
    fmt.formatDate(parseDbDate(iso), { month: "short", day: "numeric" });
  const formatFullDate = (iso: string) =>
    fmt.formatDate(parseDbDate(iso), {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  const renderTimeCell = (iso: string, dayUnderTime: boolean) => (
    <td className="p-2 text-slate-300 font-mono">
      {formatTime(iso)}
      {dayUnderTime && (
        <>
          {" "}
          <div className="text-[11px] text-slate-500">{formatDay(iso)}</div>
        </>
      )}
    </td>
  );

  // One timeline row (a checkpoint or a carrier-line adjustment) as a <tr>.
  const renderLine = (row: TimelineRow, dayUnderTime: boolean) => {
    // LIRA-252 wave 2 — a manual carrier-line drawer adjustment
    // interleaved into the same timeline (time, actor, line,
    // ±amount, reason) so the operator can see why the NEXT
    // checkpoint's "expected" moved.
    if (row.kind === "adjustment") {
      const { adjustment } = row;
      const meta = parseAdjustmentMeta(adjustment.metadata_json);
      const lineDrawerLabel = meta.drawerName
        ? drawerLabel(meta.drawerName)
        : "—";
      const signed = adjustment.amount_usd;
      return (
        <tr
          key={`adjustment-${adjustment.id}`}
          data-testid={`carrier-line-adjustment-row-${adjustment.id}`}
          className="border-t border-slate-800 text-xs hover:bg-slate-700/50 transition-colors bg-violet-500/5"
        >
          {renderTimeCell(adjustment.created_at, dayUnderTime)}
          <td className="p-2 text-slate-300">
            <span className="inline-flex items-center gap-1">
              {lineDrawerLabel}
              <span className="text-[10px] uppercase tracking-wide text-violet-300 bg-violet-500/10 px-1.5 py-0.5 rounded">
                {t("timeline.lineEdit")}
              </span>
            </span>
            {meta.phoneNumber && (
              <div className="text-[11px] text-slate-500 font-mono">
                <Ltr>{meta.phoneNumber}</Ltr>
              </div>
            )}
          </td>
          <td className="p-2">
            <Ltr
              className={`font-mono font-medium ${signed >= 0 ? "text-emerald-400" : "text-red-400"}`}
            >
              {signed >= 0 ? "+$" : "-$"}
              {formatCurrencyAmount(Math.abs(signed), "USD")}
            </Ltr>
          </td>
          <td className="p-2 text-slate-300">{adjustment.user_name}</td>
          <td className="p-2 text-slate-400 italic max-w-xs truncate">
            {adjustment.summary || meta.reason || "—"}
          </td>
          <td className="p-2 text-end" />
        </tr>
      );
    }

    const checkpoint = row.checkpoint;
    const differences = checkpoint.differences ?? [];
    // LIRA-335: a checkpoint saved with recorded differences shows each
    // one's server status; older ones keep today's computed summary.
    const diffs = differences.length > 0 ? [] : getCheckpointDiffs(checkpoint);
    const validityDiffs = getValidityDiffs(checkpoint);
    return (
      <tr
        key={`checkpoint-${checkpoint.id}`}
        className="border-t border-slate-800 text-xs hover:bg-slate-700/50 transition-colors"
      >
        {renderTimeCell(checkpoint.created_at, dayUnderTime)}
        <td className="p-2 text-slate-300">
          <span className="inline-flex items-center gap-1">
            <BrandedLabel
              code={checkpoint.drawer_name}
              label={drawerLabel(checkpoint.drawer_name)}
            />
            {checkpoint.drawer_name === ALL_DRAWERS && (
              <span className="text-[10px] uppercase tracking-wide text-violet-300 bg-violet-500/10 px-1.5 py-0.5 rounded">
                {t("timeline.allDrawersBadge")}
              </span>
            )}
          </span>
        </td>
        <td className="p-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-white font-mono font-medium">
              {getAmountDisplay(checkpoint)}
            </span>
            {differences.map((d) => (
              <DifferenceStatusLine key={d.id} difference={d} />
            ))}
            {diffs.length > 0 || validityDiffs.length > 0 ? (
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-400 font-mono">
                <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                {getVarianceSummary(diffs, validityDiffs)}
              </span>
            ) : differences.length > 0 ? null : (
              checkpoint.currencies.length > 0 && (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                  <Check className="w-3 h-3 flex-shrink-0" />
                  {t("timeline.balanced")}
                </span>
              )
            )}
          </div>
        </td>
        <td className="p-2 text-slate-300">{checkpoint.user_name}</td>
        <td className="p-2 text-slate-400 italic max-w-xs truncate">
          {checkpoint.notes || "—"}
        </td>
        <td className="p-2 text-end">
          <div className="flex items-center justify-end gap-1">
            <button
              onClick={() => setViewCheckpoint(checkpoint)}
              className="p-1.5 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white"
              title={t("timeline.viewDetails")}
            >
              <Eye size={14} />
            </button>
          </div>
        </td>
      </tr>
    );
  };

  const formatDateLabel = (iso: string) =>
    fmt.formatDate(new Date(`${iso}T00:00:00`), {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col gap-6 overflow-auto animate-in fade-in duration-500">
      <PageHeader title={t("timeline.title")} />

      {/* Timeline Filters */}
      <div>
        <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex gap-4 flex-wrap items-center">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t("timeline.searchPlaceholder")}
            className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white text-sm focus:ring-2 focus:ring-violet-600 w-56"
          />

          <Select
            value={filters.drawer_name}
            onChange={(v) => setFilters({ ...filters, drawer_name: v })}
            options={[
              { value: "", label: t("timeline.allDrawersOption") },
              ...DRAWER_ORDER.map((d) => ({
                value: d,
                label: drawerText.label(d),
              })),
            ]}
          />

          <DateRangeFilter
            from={filters.date_from}
            to={filters.date_to}
            onFromChange={(v) => setFilters({ ...filters, date_from: v })}
            onToChange={(v) => setFilters({ ...filters, date_to: v })}
          />

          <label className="inline-flex items-center gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-200 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={!!filters.open_only}
              onChange={(e) => {
                const { open_only: _off, ...rest } = filters;
                setFilters(
                  e.target.checked ? { ...rest, open_only: true } : rest,
                );
              }}
              className="w-3.5 h-3.5 rounded accent-amber-500"
            />
            {t("timeline.openOnly")}
            {openCount !== null && (
              <span className="rounded-full bg-amber-500/20 px-1.5 text-[11px] font-mono text-amber-300">
                {openCount}
              </span>
            )}
          </label>

          <div className="flex items-center gap-2 ms-auto">
            <label className="text-sm text-slate-400">
              {t("timeline.rows")}
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={limit}
              onChange={(e) =>
                setLimit(Number(normalizeDigits(e.target.value)) || 100)
              }
              className="bg-slate-900 border border-slate-700 rounded-lg px-4 py-2 text-white text-sm focus:ring-2 focus:ring-violet-600 w-20"
            />
          </div>
        </div>
      </div>

      {/* Initial-setup hint — the setup checkpoint is older than the from-date */}
      {showInitialSetupHint && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-violet-500/10 border border-violet-500/30 rounded-xl">
          <Clock className="w-4 h-4 text-violet-300 shrink-0" />
          <p className="text-xs text-violet-200 flex-1 min-w-0">
            {t("timeline.setupHintBefore")}{" "}
            <span className="font-semibold">
              {formatDateLabel(initialCheckpointDate!)}
            </span>{" "}
            {t("timeline.setupHintAfter")}
          </p>
          <button
            onClick={jumpToInitialSetup}
            className="text-xs font-medium text-violet-100 bg-violet-600/40 hover:bg-violet-600/60 px-3 py-1.5 rounded-lg transition-colors shrink-0"
          >
            {t("timeline.showFromSetup")}
          </button>
        </div>
      )}

      {/* Timeline Table */}
      <div className="min-h-0 bg-slate-800 rounded-xl border border-slate-700 overflow-auto">
        {loading ? (
          <div className="p-8 text-center text-slate-400 animate-pulse">
            {t("timeline.loading")}
          </div>
        ) : checkpoints.length === 0 && carrierAdjustments.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            <Clock size={48} className="mx-auto mb-4 opacity-50" />
            <p>
              {t("timeline.noneFor", {
                range:
                  filters.date_from === filters.date_to
                    ? filters.date_from
                    : `${filters.date_from} – ${filters.date_to}`,
              })}
            </p>
          </div>
        ) : (
          <DataTable
            columns={[
              {
                header: t("timeline.colTime"),
                sortKey: "created_at",
                width: "100px",
                className: "p-2 text-xs font-semibold uppercase text-slate-400",
              },
              {
                header: t("timeline.colDrawer"),
                sortKey: "drawer_name",
                width: "140px",
                className: "p-2 text-xs font-semibold uppercase text-slate-400",
              },
              {
                header: t("timeline.colCounted"),
                sortKey: "amount",
                className: "p-2 text-xs font-semibold uppercase text-slate-400",
              },
              {
                header: t("timeline.colUser"),
                sortKey: "user_name",
                width: "120px",
                className: "p-2 text-xs font-semibold uppercase text-slate-400",
              },
              {
                header: t("timeline.colNotes"),
                sortKey: "notes",
                className: "p-2 text-xs font-semibold uppercase text-slate-400",
              },
              {
                header: "",
                width: "80px",
                className: "p-2 text-xs font-semibold uppercase text-slate-400",
              },
            ]}
            data={displayedRows}
            loading={loading}
            emptyMessage={t("timeline.empty")}
            exportExcel
            exportPdf
            exportFilename="checkpoints"
            exportDefaultColumns={[
              t("timeline.colTime"),
              t("timeline.colDrawer"),
              t("timeline.colCounted"),
              t("timeline.colUser"),
              t("timeline.colNotes"),
            ]}
            showRowCount
            totalRowCount={timelineRows.length}
            defaultSortKey="created_at"
            defaultSortDirection="desc"
            className="w-full text-start"
            theadClassName="bg-slate-900 text-slate-400 text-xs uppercase"
            getSortValue={(row, key) => {
              if (key === "created_at")
                return parseDbDate(row.created_at).getTime();
              if (row.kind === "adjustment") {
                const meta = parseAdjustmentMeta(row.adjustment.metadata_json);
                if (key === "drawer_name") return meta.drawerName ?? "";
                if (key === "user_name") return row.adjustment.user_name;
                if (key === "notes") return row.adjustment.summary;
                if (key === "amount") return row.adjustment.amount_usd;
                return "";
              }
              const checkpoint = row.checkpoint;
              if (key === "drawer_name") return checkpoint.drawer_name;
              if (key === "user_name") return checkpoint.user_name;
              if (key === "notes") return checkpoint.notes ?? "";
              if (key === "amount") {
                const totals = getAggregatedTotals(checkpoint);
                return totals["USD"] ?? totals["USDT"] ?? 0;
              }
              return "";
            }}
            onVisibleRowsChange={onVisibleRowsChange}
            // Export carries the day in the Time cell, never heading rows.
            exportRow={(row) => renderLine(row, multiDay)}
            renderRow={(row, index) => {
              const line = renderLine(row, multiDay && !dayHeadings);
              if (!dayHeadings || visibleOrder[index] !== row) return line;
              const prev = visibleOrder[index - 1];
              if (prev && dayKey(prev.created_at) === dayKey(row.created_at))
                return line;
              return (
                <Fragment key={`day-${dayKey(row.created_at)}-${index}`}>
                  <tr data-testid="timeline-day-heading">
                    <td
                      colSpan={6}
                      className="px-2 py-1.5 bg-slate-900/70 text-[11px] font-semibold uppercase tracking-wide text-slate-300"
                    >
                      {formatDayHeading(row.created_at)}
                    </td>
                  </tr>
                  {line}
                </Fragment>
              );
            }}
          />
        )}
      </div>

      {/* View Checkpoint Details Modal — header and footer stay pinned;
          only the amounts scroll, so a long all-drawers checkpoint never
          pushes its title off the screen. */}
      {viewCheckpoint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
            <div className="p-6 pb-4 border-b border-slate-700 space-y-2">
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-lg font-semibold text-white">
                  {t(
                    viewCheckpoint.drawer_name === ALL_DRAWERS
                      ? "details.titleAll"
                      : "details.title",
                    { drawer: drawerLabel(viewCheckpoint.drawer_name) },
                  )}
                </h2>
                <button
                  onClick={() => setViewCheckpoint(null)}
                  className="p-1 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-white"
                  aria-label={t("details.closeAria")}
                >
                  <X size={18} />
                </button>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">{t("timeline.colTime")}</span>
                <span className="text-white">
                  {formatFullDate(viewCheckpoint.created_at)} ·{" "}
                  {formatTime(viewCheckpoint.created_at)}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-slate-400">{t("timeline.colUser")}</span>
                <span className="text-white">{viewCheckpoint.user_name}</span>
              </div>
              {viewCheckpoint.notes && (
                <div className="flex justify-between text-sm gap-4">
                  <span className="text-slate-400">
                    {t("timeline.colNotes")}
                  </span>
                  <span className="text-white italic text-end">
                    {viewCheckpoint.notes}
                  </span>
                </div>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-6 pt-4">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs text-slate-400 uppercase tracking-wide">
                  {t("details.amounts")}
                </p>
                <p className="text-[11px] text-slate-500">
                  {t("details.expectedToCounted")}
                </p>
              </div>
              {(() => {
                // Every amount line, counted zeros included. Lines at 0 → 0
                // are left out only when other lines hold money, so an
                // empty drawer still shows its balanced zeros.
                const all = viewCheckpoint.currencies.map((c) => ({
                  drawer: c.drawer_name ?? viewCheckpoint.drawer_name,
                  code: c.currency_code,
                  amount: countedOf(c),
                  expected: c.opening_amount ?? 0,
                }));
                const nonZero = all.filter(
                  (e) => e.amount !== 0 || e.expected !== 0,
                );
                const entries = nonZero.length > 0 ? nonZero : all;

                if (entries.length === 0) {
                  return (
                    <p className="text-sm text-slate-500 italic">
                      {t("details.noAmounts")}
                    </p>
                  );
                }

                const drawers = drawersOf(viewCheckpoint).filter((d) =>
                  entries.some((e) => e.drawer === d),
                );
                const grouped = drawers.length > 1;
                const currencyRank = (code: string) => {
                  const i = CURRENCY_ORDER.indexOf(code);
                  return i === -1 ? CURRENCY_ORDER.length : i;
                };

                return (
                  <div className="space-y-4">
                    {drawers.map((drawer) => (
                      <div key={drawer} className="space-y-2">
                        {grouped && (
                          <p className="text-xs font-semibold text-slate-300">
                            {drawerLabel(drawer)}
                          </p>
                        )}
                        {entries
                          .filter((e) => e.drawer === drawer)
                          .sort(
                            (a, b) =>
                              currencyRank(a.code) - currencyRank(b.code),
                          )
                          .map(({ code, amount, expected }) => {
                            const { status, variance } = getVarianceStatus(
                              amount,
                              expected,
                            );
                            const matched = status === "match";
                            const difference = viewCheckpoint.differences?.find(
                              (d) =>
                                d.drawer_name === drawer &&
                                d.currency_code === code,
                            );
                            const line = (
                              <div
                                key={`${drawer}-${code}`}
                                className={
                                  difference
                                    ? "flex items-center gap-3"
                                    : "flex items-center gap-3 rounded-lg bg-slate-900/50 border border-slate-700/50 px-3 py-2.5"
                                }
                              >
                                {/* Currency pill */}
                                <span className="flex-shrink-0 w-12 text-center text-xs font-bold text-slate-300 bg-slate-800 border border-slate-700 rounded-md py-1">
                                  {code}
                                </span>

                                {/* Expected → Counted */}
                                <div className="flex-1 min-w-0 flex items-baseline gap-2 font-mono">
                                  <span className="text-sm text-slate-500 truncate">
                                    {formatCurrencyAmount(expected, code)}
                                  </span>
                                  <span className="inline-block text-slate-600 rtl:-scale-x-100">
                                    →
                                  </span>
                                  <span className="text-base text-white font-semibold truncate">
                                    {formatCurrencyAmount(amount, code)}
                                  </span>
                                </div>

                                {/* Variance badge */}
                                {matched ? (
                                  <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                                    <Check className="w-3.5 h-3.5" />{" "}
                                    {t("details.matched")}
                                  </span>
                                ) : (
                                  <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-bold font-mono text-amber-400">
                                    <AlertTriangle className="w-3.5 h-3.5" />
                                    {shortOrOver(
                                      variance,
                                      formatCurrencyAmount(
                                        Math.abs(variance),
                                        code,
                                      ),
                                    )}
                                  </span>
                                )}
                              </div>
                            );
                            if (!difference) return line;
                            // LIRA-335: only a currency with a recorded
                            // difference gets the resolution block.
                            return (
                              <div
                                key={`${drawer}-${code}`}
                                className="rounded-lg bg-slate-900/50 border border-slate-700/50 px-3 py-2.5 space-y-2"
                              >
                                {line}
                                <DifferenceResolutionBlock
                                  difference={difference}
                                />
                              </div>
                            );
                          })}
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* Counted SIM lines — credits + validity expiry (plan Phase 3) */}
              {(viewCheckpoint.carrier_lines?.length ?? 0) > 0 && (
                <div className="border-t border-slate-700 pt-4 mt-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs text-slate-400 uppercase tracking-wide">
                      {t("details.carrierLines")}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {t("details.expectedToCounted")}
                    </p>
                  </div>
                  <div className="space-y-2">
                    {viewCheckpoint.carrier_lines!.map((line) => {
                      const credits = getVarianceStatus(
                        line.counted_credits,
                        line.expected_credits,
                      );
                      const validity = getDateVarianceStatus(
                        line.counted_expires_at,
                        line.expected_expires_at,
                      );
                      return (
                        <div
                          key={line.carrier_line_id}
                          className="rounded-lg bg-slate-900/50 border border-slate-700/50 px-3 py-2.5 space-y-1.5"
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold text-slate-300 uppercase">
                              {line.carrier}
                            </span>
                            <Ltr className="text-xs text-slate-400 font-mono">
                              {line.phone_number}
                            </Ltr>
                            {line.label && (
                              <span className="text-[11px] text-slate-500 truncate">
                                {line.label}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3">
                            <span className="flex-shrink-0 w-16 text-[11px] text-slate-500">
                              {t("card.credits")}
                            </span>
                            <div className="flex-1 min-w-0 flex items-baseline gap-2 font-mono">
                              <span className="text-sm text-slate-500 truncate">
                                {formatCurrencyAmount(
                                  line.expected_credits,
                                  "USD",
                                )}
                              </span>
                              <span className="inline-block text-slate-600 rtl:-scale-x-100">
                                →
                              </span>
                              <span className="text-sm text-white font-semibold truncate">
                                {formatCurrencyAmount(
                                  line.counted_credits,
                                  "USD",
                                )}
                              </span>
                            </div>
                            {credits.status === "match" ? (
                              <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                                <Check className="w-3.5 h-3.5" />{" "}
                                {t("details.matched")}
                              </span>
                            ) : (
                              <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-bold font-mono text-amber-400">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                {credits.variance > 0 ? "+" : ""}
                                {formatCurrencyAmount(credits.variance, "USD")}
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-3">
                            <span className="flex-shrink-0 w-16 text-[11px] text-slate-500">
                              {t("card.validity")}
                            </span>
                            <div className="flex-1 min-w-0 flex items-baseline gap-2 font-mono">
                              <span className="text-sm text-slate-500 truncate">
                                {line.expected_expires_at ??
                                  t("details.notSet")}
                              </span>
                              <span className="inline-block text-slate-600 rtl:-scale-x-100">
                                →
                              </span>
                              <span className="text-sm text-white font-semibold truncate">
                                {line.counted_expires_at ??
                                  t("details.notCounted")}
                              </span>
                            </div>
                            {validity.status === "match" ? (
                              <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-medium text-emerald-400">
                                <Check className="w-3.5 h-3.5" />{" "}
                                {t("details.matched")}
                              </span>
                            ) : (
                              <span className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-bold font-mono text-amber-400">
                                <AlertTriangle className="w-3.5 h-3.5" />
                                {formatDayVariance(validity.days)}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-slate-700 flex items-center justify-end gap-3 flex-wrap">
              {(viewCheckpoint.differences?.length ?? 0) > 0 && (
                <>
                  {viewCheckpoint.differences!.some(
                    isOpenCheckpointDifference,
                  ) && (
                    <span className="text-xs text-slate-400 me-auto">
                      {t("details.footerHint", {
                        time: formatTime(viewCheckpoint.created_at),
                      })}
                    </span>
                  )}
                  {isAdmin &&
                    viewCheckpoint.differences!.map((d) => {
                      const many = viewCheckpoint.differences!.length > 1;
                      const tag = many && (
                        <span className="text-[11px] font-bold text-slate-400">
                          {d.currency_code}
                        </span>
                      );
                      if (isOpenCheckpointDifference(d)) {
                        return (
                          <span
                            key={d.id}
                            className="inline-flex items-center gap-1.5"
                          >
                            {tag}
                            <button
                              type="button"
                              onClick={() => setClosingDifference(d)}
                              className="px-3 py-1.5 rounded-lg text-sm font-medium text-amber-100 bg-amber-600/30 hover:bg-amber-600/50 border border-amber-500/40 whitespace-nowrap transition-colors"
                            >
                              {t("details.closeButton")}
                            </button>
                          </span>
                        );
                      }
                      if (d.status === "CLOSED") {
                        return (
                          <span
                            key={d.id}
                            className="inline-flex items-center gap-1.5"
                          >
                            {tag}
                            <ReopenDifferenceButton
                              differenceId={d.id}
                              onDone={() => loadCheckpoints()}
                            />
                          </span>
                        );
                      }
                      return null;
                    })}
                </>
              )}
              <button
                onClick={() => setViewCheckpoint(null)}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white text-sm rounded-lg transition-colors"
              >
                {tc("actions.close")}
              </button>
            </div>
          </div>
        </div>
      )}

      {closingDifference && viewCheckpoint && (
        <CloseDifferenceDialog
          difference={closingDifference}
          checkpointLabel={`${drawerLabel(closingDifference.drawer_name)} · ${formatFullDate(
            viewCheckpoint.created_at,
          )}, ${formatTime(viewCheckpoint.created_at)}`}
          onCancel={() => setClosingDifference(null)}
          onDone={() => {
            setClosingDifference(null);
            loadCheckpoints();
          }}
        />
      )}
    </div>
  );
}
