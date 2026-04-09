import { useState, useEffect } from "react";
import logger from "@/utils/logger";
import { Wrench, Plus, DollarSign, History } from "lucide-react";
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
  const { activeSession, linkTransaction } = useSession();
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

    const result = await api.saveMaintenanceJob(jobData);
    if (result.success) {
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
        }
      }

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
      <div className="flex-1 min-h-0">
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
                ref={(el) => {
                  el?.focus();
                }}
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
