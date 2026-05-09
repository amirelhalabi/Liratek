import { useState, useEffect, useRef } from "react";
import logger from "@/utils/logger";
import {
  Wrench,
  Plus,
  DollarSign,
  History,
  Clock,
  ChevronRight,
} from "lucide-react";
import CheckoutModal from "@/features/sales/pages/POS/components/CheckoutModal";
import { PageHeader, useApi } from "@liratek/ui";
import { useSession } from "@/features/sessions/context/SessionContext";
import { HistoryModal } from "./components/HistoryModal";

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
  const { activeSession, addToCart: addToSessionCart } = useSession();
  const deviceNameRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<MaintenanceJob[]>([]);
  const [filter, _setFilter] = useState("All");

  // Form State
  const [editingJob, setEditingJob] = useState<MaintenanceJob | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  const [deviceName, setDeviceName] = useState("");
  const [issue, setIssue] = useState("");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");

  // Checkout State
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);

  // Focus device name input on mount and when form resets
  useEffect(() => {
    deviceNameRef.current?.focus();
  }, [editingJob]);

  // Autofill client name/phone from active customer session, clear when session closes
  useEffect(() => {
    if (!editingJob && activeSession?.customer_name) {
      setClientName(activeSession.customer_name);
      if (activeSession.customer_phone) {
        setClientPhone(activeSession.customer_phone);
      }
    } else if (!activeSession && !editingJob) {
      setClientName("");
      setClientPhone("");
    }
  }, [activeSession, editingJob]);

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
  };

  const handleEdit = (job: MaintenanceJob) => {
    setEditingJob(job);
    setDeviceName(job.device_name);
    setIssue(job.issue_description);
    setCost(job.cost_usd?.toString() || "");
    setPrice(job.price_usd?.toString() || "");
    setClientName(job.client_name || "");
    setClientPhone(job.client_phone || "");
  };

  const handleStatusTransition = async (
    job: MaintenanceJob,
    e: React.MouseEvent,
  ) => {
    e.stopPropagation();
    const nextStatus: Record<string, Status> = {
      Received: "In_Progress",
      In_Progress: "Ready",
      Ready: "Ready",
    };
    const newStatus = nextStatus[job.status];
    if (!newStatus || newStatus === job.status) return;

    const result = await api.saveMaintenanceJob({
      id: job.id,
      device_name: job.device_name,
      issue_description: job.issue_description,
      cost_usd: job.cost_usd ?? 0,
      price_usd: job.price_usd ?? 0,
      client_name: job.client_name || "",
      client_phone: job.client_phone || "",
      status: newStatus,
      paid_usd: job.paid_usd || 0,
      paid_lbp: job.paid_lbp || 0,
      discount_usd: job.discount_usd || 0,
      final_amount_usd: job.price_usd ?? 0,
    });
    if (result.success) {
      const data = await api.getMaintenanceJobs(filter);
      setJobs(data);
    }
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
    const jobData = {
      ...(editingJob?.id != null ? { id: editingJob.id } : {}),
      device_name: deviceName,
      issue_description: issue,
      cost_usd: parseFloat(cost) || 0,
      price_usd: parseFloat(price) || 0,
      client_name: clientName,
      client_phone: clientPhone,
      status: (editingJob?.status as Status) || "Received",
      paid_usd: editingJob?.paid_usd || 0,
      paid_lbp: editingJob?.paid_lbp || 0,
      discount_usd: editingJob?.discount_usd || 0,
      final_amount_usd: parseFloat(price) || 0,
    };

    const result = await api.saveMaintenanceJob(jobData);
    if (result.success) {
      handleNewJob();
      const data = await api.getMaintenanceJobs(filter);
      setJobs(data);
    } else {
      alert("Error: " + result.error);
    }
  };

  const handleCheckoutComplete = async (paymentData: any) => {
    const jobData = {
      ...(editingJob?.id != null ? { id: editingJob.id } : {}),
      device_name: deviceName,
      issue_description: issue,
      cost_usd: parseFloat(cost) || 0,
      price_usd: parseFloat(price) || 0,
      ...(paymentData.client_id != null
        ? { client_id: paymentData.client_id }
        : {}),
      client_name: paymentData.client_name || clientName,
      client_phone: paymentData.client_phone || clientPhone,
      discount_usd: paymentData.discount,
      final_amount_usd: paymentData.final_amount,
      paid_usd: paymentData.payment_usd,
      paid_lbp: paymentData.payment_lbp,
      exchange_rate: paymentData.exchange_rate,
      payments: paymentData.payments || [],
      change_given_usd: paymentData.change_given_usd || 0,
      change_given_lbp: paymentData.change_given_lbp || 0,
      status: "Delivered_Paid" as Status,
    };

    // If session is active, add to cart instead of submitting
    if (activeSession) {
      const label = `Maintenance: ${deviceName || "Device"} - $${(paymentData.final_amount || parseFloat(price) || 0).toFixed(2)}`;

      addToSessionCart({
        module: "maintenance",
        label,
        amount: paymentData.final_amount || parseFloat(price) || 0,
        currency: "USD",
        ipcChannel: "maintenance:save",
        formData: jobData,
      });

      setIsCheckoutOpen(false);
      handleNewJob();
      return;
    }

    const result = await api.saveMaintenanceJob(jobData);
    if (result.success) {
      setIsCheckoutOpen(false);
      handleNewJob();
      const data = await api.getMaintenanceJobs(filter);
      setJobs(data);
    } else {
      alert("Error: " + result.error);
    }
  };

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 min-h-0 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500">
      <PageHeader
        icon={Wrench}
        title="Maintenance"
        actions={
          <button
            onClick={() => setShowHistoryModal(true)}
            className="px-4 py-2 rounded-lg font-medium text-sm transition-all flex items-center gap-2 bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 hover:text-white"
          >
            <History size={16} />
            <span className="font-medium">History</span>
          </button>
        }
      />

      {/* Main Content: Form */}
      <div className="flex-1 min-h-0 overflow-auto">
        {/* Ongoing Jobs List */}
        {(() => {
          const ongoingJobs = jobs.filter((j) =>
            ["Received", "In_Progress", "Ready"].includes(j.status),
          );
          if (ongoingJobs.length === 0) return null;
          return (
            <div className="w-full max-w-2xl mx-auto mb-4">
              <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
                <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
                  <Clock size={14} className="text-amber-400" />
                  Ongoing Jobs ({ongoingJobs.length})
                </h3>
                <div className="space-y-2 max-h-48 overflow-auto custom-scrollbar">
                  {ongoingJobs.map((job) => (
                    <button
                      key={job.id}
                      onClick={() => handleEdit(job)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-all hover:bg-slate-700/70 ${
                        editingJob?.id === job.id
                          ? "bg-violet-600/20 border border-violet-500/50"
                          : "bg-slate-900/50 border border-slate-700/40"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white truncate">
                            {job.device_name}
                          </span>
                          <span
                            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                              job.status === "Ready"
                                ? "bg-emerald-500/20 text-emerald-400"
                                : job.status === "In_Progress"
                                  ? "bg-amber-500/20 text-amber-400"
                                  : "bg-blue-500/20 text-blue-400"
                            }`}
                          >
                            {job.status.replace("_", " ")}
                          </span>
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          {job.client_name && (
                            <span className="text-xs text-slate-500 truncate">
                              {job.client_name}
                            </span>
                          )}
                          {job.created_at && (
                            <span className="text-[10px] text-slate-600">
                              {new Date(job.created_at).toLocaleDateString()}
                            </span>
                          )}
                        </div>
                        {job.issue_description && (
                          <p className="text-[11px] text-slate-500 mt-0.5 truncate">
                            {job.issue_description.length > 60
                              ? job.issue_description.slice(0, 60) + "..."
                              : job.issue_description}
                          </p>
                        )}
                      </div>
                      {job.status !== "Ready" && (
                        <button
                          onClick={(e) => handleStatusTransition(job, e)}
                          className="text-[10px] px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-slate-300 transition-colors whitespace-nowrap"
                          title={
                            job.status === "Received"
                              ? "Mark In Progress"
                              : "Mark Ready"
                          }
                        >
                          {job.status === "Received" ? "Start" : "Ready"}
                        </button>
                      )}
                      {(job.price_usd ?? 0) > 0 && (
                        <span className="text-xs font-mono text-emerald-400">
                          ${job.price_usd?.toFixed(2)}
                        </span>
                      )}
                      <ChevronRight size={14} className="text-slate-600" />
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })()}
        {/* New/Edit Job Form */}
        <div className="w-full max-w-2xl mx-auto bg-slate-800 rounded-xl border border-slate-700/50 shadow-xl p-5 flex flex-col overflow-hidden">
          <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <Plus className="text-violet-400" size={20} />
            {editingJob ? "Edit Job" : "New Repair Job"}
          </h2>

          <div className="space-y-4 flex-1 overflow-auto pr-1 custom-scrollbar">
            {/* Device Info */}
            <div>
              <label
                htmlFor="maintenance-device-name"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
              >
                Device Name / Model *
              </label>
              <input
                id="maintenance-device-name"
                type="text"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:border-violet-500 focus:ring-2 focus:ring-violet-500/50 outline-none transition-all"
                placeholder="e.g., iPhone 13 Pro Max"
                ref={deviceNameRef}
              />
            </div>

            {/* Issue Description */}
            <div>
              <label
                htmlFor="maintenance-issue"
                className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
              >
                Issue Description *
              </label>
              <textarea
                id="maintenance-issue"
                value={issue}
                onChange={(e) => setIssue(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-lg px-4 py-2.5 text-white focus:border-violet-500 focus:ring-2 focus:ring-violet-500/50 outline-none transition-all resize-none h-24"
                placeholder="e.g., Broken Screen, Battery Replacement..."
              />
            </div>

            {/* Cost & Price */}
            <div className="grid grid-cols-2 gap-3 p-4 rounded-xl bg-slate-900/50 border border-slate-700/50">
              <div>
                <label
                  htmlFor="maintenance-cost"
                  className="block text-xs font-medium text-slate-400 mb-1.5 uppercase tracking-wider"
                >
                  Repair Cost (Internal)
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 font-bold">
                    $
                  </span>
                  <input
                    id="maintenance-cost"
                    type="number"
                    value={cost}
                    onChange={(e) => setCost(e.target.value)}
                    className="w-full bg-slate-800 border border-slate-600 rounded-lg pl-8 pr-4 py-2.5 text-white font-mono text-sm focus:outline-none focus:border-violet-500 transition-all"
                    placeholder="0.00"
                  />
                </div>
              </div>
              <div>
                <label
                  htmlFor="maintenance-price"
                  className="block text-xs font-medium text-emerald-400 mb-1.5 uppercase tracking-wider"
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
                    className="w-full bg-slate-800 border border-emerald-500/50 rounded-lg pl-8 pr-4 py-2.5 text-white font-bold font-mono text-sm focus:outline-none focus:border-emerald-500 transition-all"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>

            {/* Client Info */}
            <div className="p-4 rounded-xl bg-slate-900/50 border border-slate-700/50 space-y-3">
              <span className="block text-xs font-medium text-slate-400 uppercase tracking-wider">
                Client Details
              </span>
              <div>
                <label
                  htmlFor="maintenance-client-name"
                  className="block text-[10px] text-slate-500 mb-1 uppercase"
                >
                  Name
                </label>
                <input
                  id="maintenance-client-name"
                  type="text"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all"
                  placeholder="Walk-in Client"
                />
              </div>
              <div>
                <label
                  htmlFor="maintenance-client-phone"
                  className="block text-[10px] text-slate-500 mb-1 uppercase"
                >
                  Phone Number
                </label>
                <input
                  id="maintenance-client-phone"
                  type="text"
                  value={clientPhone}
                  onChange={(e) => setClientPhone(e.target.value)}
                  className="w-full bg-slate-900/80 border border-slate-700 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-violet-500 transition-all"
                  placeholder="Optional"
                />
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3 mt-6">
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

      {/* Checkout Modal */}
      {isCheckoutOpen && (
        <div className="fixed inset-0 z-[60]">
          <CheckoutModal
            totalAmount={parseFloat(price) || 0}
            onClose={() => setIsCheckoutOpen(false)}
            onComplete={handleCheckoutComplete}
            onSaveDraft={async (data) => {
              await handleCheckoutComplete(data);
            }}
            onRestoreDraftComplete={() => {}}
          />
        </div>
      )}

      {/* History Modal */}
      {showHistoryModal && (
        <HistoryModal
          jobs={jobs}
          loading={false}
          onClose={() => setShowHistoryModal(false)}
          onRefresh={async () => {
            const data = await api.getMaintenanceJobs(filter);
            setJobs(data);
          }}
          onVoid={handleVoid}
          onEdit={(job) => {
            setShowHistoryModal(false);
            handleEdit(job);
          }}
        />
      )}
    </div>
  );
}
