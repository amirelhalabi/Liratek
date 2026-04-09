import { Wrench, RefreshCw, X, Ban } from "lucide-react";
import { DataTable } from "@liratek/ui";

type MaintenanceJob = {
  id: number;
  device_name: string;
  issue_description: string;
  created_at?: string;
  cost_usd?: number;
  price_usd?: number;
  client_name?: string | null;
  client_phone?: string | null;
  status: string;
  paid_usd?: number;
  paid_lbp?: number;
  discount_usd?: number;
  final_amount_usd?: number;
};

interface HistoryModalProps {
  jobs: MaintenanceJob[];
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onVoid: (id: number) => void;
  onEdit: (job: MaintenanceJob) => void;
}

function getStatusColor(status: string) {
  switch (status) {
    case "Received":
      return "text-blue-400 bg-blue-400/10";
    case "In_Progress":
      return "text-amber-400 bg-amber-400/10";
    case "Ready":
      return "text-emerald-400 bg-emerald-400/10";
    case "Delivered":
      return "text-slate-400 bg-slate-400/10";
    default:
      return "text-slate-400 bg-slate-400/10";
  }
}

export function HistoryModal({
  jobs,
  loading,
  onClose,
  onRefresh,
  onVoid,
  onEdit,
}: HistoryModalProps) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-6xl max-h-[85vh] bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Wrench className="text-slate-400" size={18} />
            Maintenance History
            <span className="text-xs text-slate-500 font-normal ml-1">
              ({jobs.length} records)
            </span>
          </h2>
          <div className="flex items-center gap-2">
            <button
              onClick={onRefresh}
              className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              title="Refresh"
            >
              <RefreshCw size={14} />
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              title="Close"
            >
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <RefreshCw size={20} className="animate-spin mr-2" />
              Loading...
            </div>
          ) : (
            <DataTable<MaintenanceJob>
              columns={[
                {
                  header: "Date",
                  className: "px-6 py-3",
                  sortKey: "created_at",
                },
                {
                  header: "Client",
                  className: "px-6 py-3",
                  sortKey: "client_name",
                },
                {
                  header: "Device / Issue",
                  className: "px-6 py-3",
                  sortKey: "device_name",
                },
                {
                  header: "Status",
                  className: "px-6 py-3",
                  sortKey: "status",
                },
                {
                  header: "Price",
                  className: "px-6 py-3 text-right",
                  sortKey: "price_usd",
                },
                { header: "Paid", className: "px-6 py-3 text-right" },
                { header: "Actions", className: "px-6 py-3 text-right" },
              ]}
              data={jobs}
              exportExcel
              exportPdf
              exportFilename="maintenance-history"
              className="w-full"
              theadClassName="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0"
              tbodyClassName="divide-y divide-slate-700/50"
              emptyMessage="No maintenance jobs found."
              renderRow={(job) => (
                <tr
                  key={job.id}
                  className="hover:bg-slate-700/20 transition-colors group"
                >
                  <td className="px-6 py-4 text-sm text-slate-400 whitespace-nowrap">
                    {job.created_at
                      ? new Date(job.created_at).toLocaleDateString()
                      : ""}
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-medium text-white">
                      {job.client_name || "Unknown"}
                    </div>
                    {job.client_phone && (
                      <div className="text-xs text-slate-500">
                        {job.client_phone}
                      </div>
                    )}
                  </td>
                  <td className="px-6 py-4">
                    <div className="text-sm font-bold text-white">
                      {job.device_name}
                    </div>
                    <div className="text-xs text-slate-400 truncate max-w-[200px]">
                      {job.issue_description}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getStatusColor(job.status || "")}`}
                    >
                      {(job.status || "").replace("_", " ")}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm font-bold text-white text-right">
                    ${job.price_usd?.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-sm text-emerald-400 text-right">
                    ${job.paid_usd?.toFixed(2)}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <button
                        onClick={() => onEdit(job)}
                        className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded"
                      >
                        <Wrench size={16} />
                      </button>
                      <button
                        onClick={() => onVoid(job.id)}
                        className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-slate-700 rounded"
                        title="Void job"
                      >
                        <Ban size={16} />
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            />
          )}
        </div>
      </div>
    </div>
  );
}
