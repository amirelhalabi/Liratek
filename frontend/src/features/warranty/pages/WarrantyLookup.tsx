/**
 * LIRA-296 — Warranty lookup: find any warranty item without an IMEI.
 *
 * One search box (name, phone, receipt `RCP-…`, product or serial), a state
 * filter, and a table of warranty lines with their state and how many units
 * are still covered. Clicking a row opens the sale.
 *
 * Rule 19: data comes only through `useApi()` (IPC on desktop, REST on web).
 * Rule 25: `api` is read through a ref, so an unstable adapter identity can
 *          never re-fire the search effect.
 * Rule 27: every search sends the browser's own day as `client_day`.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Search, ShieldCheck } from "lucide-react";
import { PageHeader, useApi } from "@liratek/ui";
import type {
  WarrantySearchInput,
  WarrantySearchRow,
  WarrantySearchState,
} from "@liratek/core";
import { localDay } from "@/shared/utils/localDay";
import SaleDetailModal from "@/features/sales/pages/POS/components/SaleDetailModal";
import { useOptionalAuth } from "@/features/auth/context/AuthContext";
import { WarrantyStateBadge } from "../components/WarrantyStateBadge";
import { ClaimModal, type ClaimTarget } from "../components/ClaimModal";
import { ClaimHistory } from "../components/ClaimHistory";
import { DefectiveItems } from "../components/DefectiveItems";

const SEARCH_HINT = "Name, phone, receipt (RCP-…), product or serial";

type StateFilter = "" | WarrantySearchState;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Search failed";
}

export default function WarrantyLookup() {
  const api = useApi();
  const apiRef = useRef(api);
  apiRef.current = api;

  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState<StateFilter>("");
  const [rows, setRows] = useState<WarrantySearchRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openSaleId, setOpenSaleId] = useState<number | null>(null);
  // LIRA-296 P2 — act on a found warranty.
  const isAdmin = useOptionalAuth()?.user?.role === "admin";
  const [tab, setTab] = useState<"search" | "defective">("search");
  const [claimTarget, setClaimTarget] = useState<ClaimTarget | null>(null);
  const [historyFor, setHistoryFor] = useState<number | null>(null);
  const [historyKey, setHistoryKey] = useState(0);
  const requestRef = useRef(0);

  const runSearch = useCallback(async (q: string, state: StateFilter) => {
    const input: WarrantySearchInput = { client_day: localDay() };
    if (q) input.q = q;
    if (state) input.state = state;
    const request = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const found = await apiRef.current.searchWarranties(input);
      if (request === requestRef.current) setRows(found);
    } catch (err) {
      if (request === requestRef.current) {
        setRows([]);
        setError(errorText(err));
      }
    } finally {
      if (request === requestRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void runSearch(query, stateFilter);
  }, [query, stateFilter, runSearch]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const next = text.trim();
    if (next === query) void runSearch(next, stateFilter);
    else setQuery(next);
  };

  return (
    <div className="h-full overflow-auto p-6 flex flex-col gap-5">
      <PageHeader
        title="Warranty"
        subtitle="Find any item sold with a warranty — no IMEI needed."
      />

      {isAdmin && (
        <div role="tablist" className="flex gap-2">
          {(
            [
              ["search", "Find a warranty"],
              ["defective", "Defective items"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-lg text-sm ${tab === key ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white hover:bg-slate-800"}`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {tab === "defective" && isAdmin ? (
        <DefectiveItems />
      ) : (
        <>
          <form onSubmit={submit} className="flex flex-wrap gap-3 items-end">
            <div className="relative flex-1 min-w-[16rem]">
              <Search
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
              />
              <input
                type="search"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={SEARCH_HINT}
                aria-label="Search warranties"
                maxLength={100}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg pl-10 pr-3 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500"
              />
            </div>
            <div>
              <label
                htmlFor="warranty-state-filter"
                className="text-xs text-slate-400 block mb-1"
              >
                Warranty state
              </label>
              <select
                id="warranty-state-filter"
                value={stateFilter}
                onChange={(e) => setStateFilter(e.target.value as StateFilter)}
                className="bg-slate-900 border border-slate-600 rounded-lg px-3 py-2.5 text-white text-sm focus:outline-none focus:border-violet-500"
              >
                <option value="">All</option>
                <option value="COVERED">Covered</option>
                <option value="EXPIRED">Expired</option>
                <option value="VOID">Void</option>
              </select>
            </div>
            <button
              type="submit"
              className="px-5 py-2.5 bg-violet-600 hover:bg-violet-500 text-white font-semibold rounded-lg transition-colors"
            >
              Search
            </button>
          </form>

          {error && (
            <div
              role="alert"
              className="text-sm text-red-300 bg-red-900/30 border border-red-700/40 rounded-lg px-4 py-3"
            >
              {error}
            </div>
          )}

          <div className="bg-slate-800 rounded-xl border border-slate-700/50 overflow-x-auto">
            <table
              className="w-full min-w-[56rem]"
              data-testid="warranty-results"
            >
              <thead className="bg-slate-900">
                <tr>
                  <th className="text-left text-xs text-slate-400 px-4 py-3">
                    Product
                  </th>
                  <th className="text-left text-xs text-slate-400 px-4 py-3">
                    Customer
                  </th>
                  <th className="text-left text-xs text-slate-400 px-4 py-3">
                    Sold on
                  </th>
                  <th className="text-left text-xs text-slate-400 px-4 py-3">
                    Receipt
                  </th>
                  <th className="text-left text-xs text-slate-400 px-4 py-3">
                    Warranty until
                  </th>
                  <th className="text-left text-xs text-slate-400 px-4 py-3">
                    State
                  </th>
                  <th className="text-left text-xs text-slate-400 px-4 py-3">
                    Covered
                  </th>
                  <th className="text-left text-xs text-slate-400 px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-700">
                {rows.map((row) => (
                  <tr
                    key={`${row.source}-${row.saleItemId ?? row.maintenanceId}`}
                    data-testid="warranty-row"
                    onClick={() =>
                      row.saleId != null && setOpenSaleId(row.saleId)
                    }
                    className="hover:bg-slate-700/50 cursor-pointer"
                  >
                    <td className="px-4 py-3 text-sm text-white">
                      <div className="flex items-center gap-2">
                        <ShieldCheck size={14} className="text-violet-400" />
                        <span>{row.product.name}</span>
                      </div>
                      {row.units.map((u) => (
                        <div
                          key={u.id}
                          className="text-xs text-slate-400 mt-0.5"
                        >
                          {u.serial}
                        </div>
                      ))}
                    </td>
                    <td className="px-4 py-3 text-sm text-white">
                      <div>{row.customer.name || "Walk-in"}</div>
                      {row.customer.phone && (
                        <div className="text-xs text-slate-400">
                          {row.customer.phone}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {row.soldAt.slice(0, 10)}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300 font-mono">
                      {row.receiptNumber}
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {row.warrantyUntil}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <WarrantyStateBadge state={row.state} />
                    </td>
                    <td className="px-4 py-3 text-sm text-slate-300">
                      {`${row.coveredQuantity} of ${row.quantity}`}
                    </td>
                    <td
                      className="px-4 py-3 text-sm text-right whitespace-nowrap"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {row.state !== "VOID" && (
                        <button
                          onClick={() =>
                            setClaimTarget({
                              ...(row.saleItemId != null
                                ? { saleItemId: row.saleItemId }
                                : { maintenanceId: row.maintenanceId! }),
                              productId: row.product.id,
                              productName: row.product.name,
                              state: row.state,
                              units: row.units
                                .filter((u) => u.state !== "VOID")
                                .map((u) => ({ id: u.id, serial: u.serial })),
                            })
                          }
                          className="text-violet-300 hover:text-violet-100 mr-3"
                        >
                          Claim
                        </button>
                      )}
                      {row.saleItemId != null && (
                        <button
                          onClick={() =>
                            setHistoryFor(
                              historyFor === row.saleItemId
                                ? null
                                : row.saleItemId,
                            )
                          }
                          className="text-slate-400 hover:text-white"
                        >
                          History
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!loading && !error && rows.length === 0 && (
              <p className="text-sm text-slate-400 px-4 py-6 text-center">
                No warranty items found.
              </p>
            )}
            {loading && rows.length === 0 && (
              <p className="text-sm text-slate-400 px-4 py-6 text-center">
                Searching…
              </p>
            )}
          </div>

          {historyFor != null && (
            <div className="bg-slate-800 rounded-xl border border-slate-700/50 p-4">
              <h3 className="text-sm font-semibold text-slate-300 mb-2">
                Claim history
              </h3>
              <ClaimHistory
                saleItemId={historyFor}
                isAdmin={isAdmin}
                refreshKey={historyKey}
                onChanged={() => void runSearch(query, stateFilter)}
              />
            </div>
          )}
        </>
      )}

      {claimTarget && (
        <ClaimModal
          target={claimTarget}
          isAdmin={isAdmin}
          onClose={() => setClaimTarget(null)}
          onDone={() => {
            if (claimTarget.saleItemId != null) {
              setHistoryFor(claimTarget.saleItemId);
            }
            setHistoryKey((k) => k + 1);
            setClaimTarget(null);
            void runSearch(query, stateFilter);
          }}
        />
      )}

      {openSaleId != null && (
        <SaleDetailModal
          saleId={openSaleId}
          onClose={() => setOpenSaleId(null)}
          onRefunded={() => void runSearch(query, stateFilter)}
        />
      )}
    </div>
  );
}
