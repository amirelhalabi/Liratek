import { useState, useEffect } from "react";
import logger from "../../../../utils/logger";
import { Wrench, Plus, DollarSign, Ban } from "lucide-react";
import CheckoutModal from "../../../sales/pages/POS/components/CheckoutModal";
import { useApi } from "@liratek/ui";
import { useSession } from "../../../sessions/context/SessionContext";
import { DataTable } from "@/shared/components/DataTable";

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

export default function Maintenance() {
  const api = useApi();
  const { activeSession, linkTransaction } = useSession();
  const [jobs, setJobs] = useState<MaintenanceJob[]>([]);
  const [filter, setFilter] = useState("All");

  // Form State
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingJob, setEditingJob] = useState<MaintenanceJob | null>(null);

  const [deviceName, setDeviceName] = useState("");
  const [issue, setIssue] = useState("");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");

  // Checkout State
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const data = await api.getMaintenanceJobs(filter);
        if (!cancelled) {
          setJobs(data);
        }
      } catch (error) {
        if (!cancelled) {
          logger.error("Failed to load jobs:", error);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [filter]);

  const handleNewJob = () => {
    setEditingJob(null);
    setDeviceName("");
    setIssue("");
    setCost("");
    setPrice("");
    setClientName("");
    setClientPhone("");
    setIsFormOpen(true);
  };

  const handleEdit = (job: MaintenanceJob) => {
    setEditingJob(job);
    setDeviceName(job.device_name);
    setIssue(job.issue_description);
    setCost(job.cost_usd?.toString() || "");
    setPrice(job.price_usd?.toString() || "");
    setClientName(job.client_name || "");
    // Phone might not be in job directly if joined, but let's assume we might not have it or it's in client object
    // For simplicity, we might not pre-fill phone if it's not stored in maintenance table directly
    setIsFormOpen(true);
  };

  const handleVoid = async (id: number) => {
    if (confirm("Are you sure you want to void this job?")) {
      await api.deleteMaintenanceJob(id);
      const data = await api.getMaintenanceJobs(filter);
      setJobs(data);
    }
  };

  type Status = "Received" | "In_Progress" | "Ready" | "Delivered";

  const handleSaveDraft = async () => {
    // Save without checkout (Status: Received)
    const jobData = {
      ...(editingJob?.id != null ? { id: editingJob.id } : {}),
      device_name: deviceName,
      issue_description: issue,
      cost_usd: parseFloat(cost) || 0,
      price_usd: parseFloat(price) || 0,
      client_name: clientName,
      client_phone: clientPhone,
      status: (editingJob?.status as Status) || "Received",
      // No payment details yet
      paid_usd: editingJob?.paid_usd || 0,
      paid_lbp: editingJob?.paid_lbp || 0,
      discount_usd: editingJob?.discount_usd || 0,
      final_amount_usd: parseFloat(price) || 0,
    };

    const result = await api.saveMaintenanceJob(jobData);
    if (result.success) {
      setIsFormOpen(false);
      const data = await api.getMaintenanceJobs(filter);
      setJobs(data);
    } else {
      alert("Error: " + result.error);
    }
  };

  const handleCheckoutComplete = async (paymentData: any) => {
    // Save with payment details — forward the full payments array
    const jobData = {
      ...(editingJob?.id != null ? { id: editingJob.id } : {}),
      device_name: deviceName,
      issue_description: issue,
      cost_usd: parseFloat(cost) || 0,
      price_usd: parseFloat(price) || 0,

      // Client info from checkout (might override form)
      ...(paymentData.client_id != null
        ? { client_id: paymentData.client_id }
        : {}),
      client_name: paymentData.client_name || clientName,
      client_phone: paymentData.client_phone || clientPhone,

      // Payment
      discount_usd: paymentData.discount,
      final_amount_usd: paymentData.final_amount,
      paid_usd: paymentData.payment_usd,
      paid_lbp: paymentData.payment_lbp,
      exchange_rate: paymentData.exchange_rate,

      // Split-method payment lines + change
      payments: paymentData.payments || [],
      change_given_usd: paymentData.change_given_usd || 0,
      change_given_lbp: paymentData.change_given_lbp || 0,

      status: "Delivered_Paid" as Status,
    };

    const result = await api.saveMaintenanceJob(jobData);
    if (result.success) {
      // Link to active session if exists
      if (activeSession && result.id) {
        try {
          await linkTransaction({
            transactionType: "maintenance",
            transactionId: result.id,
            amountUsd: paymentData.final_amount || 0,
            amountLbp: 0,
          });
        } catch (err) {
          logger.error("Failed to link maintenance to session:", err);
          // Don't block the job completion
        }
      }

      setIsCheckoutOpen(false);
      setIsFormOpen(false);
      const data = await api.getMaintenanceJobs(filter);
      setJobs(data);
    } else {
      alert("Error: " + result.error);
    }
  };

  const getStatusColor = (status: string) => {
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
  };

  return (
    <div className="h-full min-h-0 flex flex-col gap-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white flex items-center gap-2">
          <Wrench className="text-amber-500" />
          Maintenance & Repairs
        </h1>
        <button
          onClick={handleNewJob}
          className="bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 transition-colors"
        >
          <Plus size={18} />
          New Job
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {["All", "Received", "In_Progress", "Ready", "Delivered"].map((s) => (
          <button
            key={s}
            onClick={async () => {
              setFilter(s);
              const data = await api.getMaintenanceJobs(s);
              setJobs(data);
            }}
            className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
              filter === s
                ? "bg-slate-700 text-white"
                : "bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700"
            }`}
          >
            {s.replace("_", " ")}
          </button>
        ))}
      </div>

      {/* List */}
      <div className="flex-1 bg-slate-800 rounded-xl border border-slate-700/50 shadow-lg overflow-hidden flex flex-col">
        <div className="overflow-auto flex-1">
          <DataTable
            columns={[
              { header: "Date", className: "px-6 py-3", sortKey: "created_at" },
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
              { header: "Status", className: "px-6 py-3", sortKey: "status" },
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
            exportFilename="maintenance-jobs"
            className="w-full"
            theadClassName="bg-slate-900/50 text-left text-xs font-medium text-slate-400 uppercase tracking-wider sticky top-0 z-10"
            tbodyClassName="divide-y divide-slate-700/50"
            emptyContent={
              <>
                <Wrench className="mx-auto h-12 w-12 text-slate-600 mb-3" />
                <p>No maintenance jobs found.</p>
              </>
            }
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
                  <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleEdit(job)}
                      className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded"
                    >
                      <Wrench size={16} />
                    </button>
                    <button
                      onClick={() => handleVoid(job.id)}
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
        </div>
      </div>

      {/* New/Edit Job Modal */}
      {isFormOpen && (
        <div
          className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
          role="presentation"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setIsFormOpen(false);
            }
          }}
        >
          <div
            className="bg-slate-800 rounded-xl border border-slate-700 shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]"
            role="presentation"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-slate-700 flex items-center justify-between bg-slate-900/50">
              <h2 className="text-lg font-bold text-white flex items-center gap-2">
                <Wrench className="text-amber-500" size={20} />
                {editingJob ? "Edit Job" : "New Repair Job"}
              </h2>
              <button
                onClick={() => setIsFormOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <Plus size={24} className="rotate-45" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-6">
              {/* Device Info */}
              <div className="grid grid-cols-2 gap-4">
                <div className="col-span-2">
                  <label
                    htmlFor="maintenance-device-name"
                    className="block text-xs font-medium text-slate-400 mb-1 uppercase"
                  >
                    Device Name / Model
                  </label>
                  <input
                    id="maintenance-device-name"
                    type="text"
                    value={deviceName}
                    onChange={(e) => setDeviceName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500"
                    placeholder="e.g. iPhone 13 Pro Max"
                    ref={(el) => {
                      el?.focus();
                    }}
                  />
                </div>
                <div className="col-span-2">
                  <label
                    htmlFor="maintenance-issue"
                    className="block text-xs font-medium text-slate-400 mb-1 uppercase"
                  >
                    Issue Description
                  </label>
                  <textarea
                    id="maintenance-issue"
                    value={issue}
                    onChange={(e) => setIssue(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500 h-24 resize-none"
                    placeholder="e.g. Broken Screen, Battery Replacement..."
                  />
                </div>
              </div>

              {/* Financials */}
              <div className="grid grid-cols-2 gap-4 p-4 bg-slate-900/50 rounded-xl border border-slate-700/50">
                <div>
                  <label
                    htmlFor="maintenance-cost"
                    className="block text-xs font-medium text-slate-400 mb-1 uppercase"
                  >
                    Repair Cost (Internal)
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">
                      $
                    </span>
                    <input
                      id="maintenance-cost"
                      type="number"
                      value={cost}
                      onChange={(e) => setCost(e.target.value)}
                      className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-8 pr-4 py-2 text-white focus:outline-none focus:border-violet-500"
                      placeholder="0.00"
                    />
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="maintenance-price"
                    className="block text-xs font-medium text-emerald-400 mb-1 uppercase"
                  >
                    Price to Client
                  </label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500 font-bold">
                      $
                    </span>
                    <input
                      id="maintenance-price"
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="w-full bg-slate-800 border border-emerald-500/50 rounded-lg pl-8 pr-4 py-2 text-white font-bold focus:outline-none focus:border-emerald-500"
                      placeholder="0.00"
                    />
                  </div>
                </div>
              </div>

              {/* Client Info (Optional if using Checkout) */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label
                    htmlFor="maintenance-client-name"
                    className="block text-xs font-medium text-slate-400 mb-1 uppercase"
                  >
                    Client Name
                  </label>
                  <input
                    id="maintenance-client-name"
                    type="text"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500"
                    placeholder="Walk-in Client"
                  />
                </div>
                <div>
                  <label
                    htmlFor="maintenance-client-phone"
                    className="block text-xs font-medium text-slate-400 mb-1 uppercase"
                  >
                    Phone Number
                  </label>
                  <input
                    id="maintenance-client-phone"
                    type="text"
                    value={clientPhone}
                    onChange={(e) => setClientPhone(e.target.value)}
                    className="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-3 text-white focus:outline-none focus:border-violet-500"
                    placeholder="Optional"
                  />
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-slate-700 bg-slate-900/50 flex gap-3">
              <button
                onClick={handleSaveDraft}
                className="flex-1 py-3 rounded-xl font-bold text-slate-300 hover:text-white hover:bg-slate-700 transition-colors border border-slate-600"
              >
                Save as Draft
              </button>
              <button
                onClick={() => setIsCheckoutOpen(true)}
                className="flex-[2] py-3 rounded-xl font-bold text-white bg-violet-600 hover:bg-violet-500 shadow-lg shadow-violet-900/20 transition-all flex items-center justify-center gap-2"
              >
                <DollarSign size={18} />
                Proceed to Checkout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Checkout Modal */}
      {isCheckoutOpen && (
        <div className="fixed inset-0 z-[60]">
          <CheckoutModal
            totalAmount={parseFloat(price) || 0}
            onClose={() => setIsCheckoutOpen(false)}
            onComplete={handleCheckoutComplete}
            onSaveDraft={async (data) => {
              // Handle draft from checkout (e.g. if they added client info there)
              await handleCheckoutComplete(data);
            }}
            onRestoreDraftComplete={() => {}}
          />
        </div>
      )}
    </div>
  );
}
