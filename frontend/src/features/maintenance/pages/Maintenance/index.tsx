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
import { useSaveAsClient } from "@/shared/hooks/useSaveAsClient";
import { SaveAsClientCheckbox } from "@/shared/components/SaveAsClientCheckbox";
import { TransactionTimeOverride } from "@/shared/components/TransactionTimeOverride";

type MaintenanceJob = {
  id: number;
  device_name: string;
  issue_description: string;
  created_at?: string;
  cost_usd?: number;
  price_usd?: number;
  cost_lbp?: number;
  price_lbp?: number;
  currency?: string;
  client_name?: string | null;
  client_phone?: string | null;
  status: string;
  paid_usd?: number;
  paid_lbp?: number;
  discount_usd?: number;
  final_amount_usd?: number;
  final_amount_lbp?: number;
};

/** Status tabs for the jobs list (client-side filtered). */
const STATUS_TABS: {
  key: string;
  label: string;
  match: (status: string) => boolean;
}[] = [
  { key: "All", label: "All", match: () => true },
  { key: "Received", label: "Received", match: (s) => s === "Received" },
  {
    key: "In_Progress",
    label: "In Progress",
    match: (s) => s === "In_Progress",
  },
  { key: "Ready", label: "Ready", match: (s) => s === "Ready" },
  {
    key: "Delivered",
    label: "Delivered",
    match: (s) => s === "Delivered" || s === "Delivered_Paid",
  },
];

/** Display label + badge styling for a maintenance status. */
function statusBadge(status: string): { label: string; className: string } {
  switch (status) {
    case "Received":
      return { label: "Received", className: "bg-blue-500/20 text-blue-400" };
    case "In_Progress":
      return {
        label: "In Progress",
        className: "bg-amber-500/20 text-amber-400",
      };
    case "Ready":
      return { label: "Ready", className: "bg-emerald-500/20 text-emerald-400" };
    case "Delivered":
      return {
        label: "Delivered",
        className: "bg-slate-500/20 text-slate-300",
      };
    case "Delivered_Paid":
      return {
        label: "Delivered & Paid",
        className: "bg-violet-500/20 text-violet-300",
      };
    default:
      return {
        label: status.replace("_", " "),
        className: "bg-slate-500/20 text-slate-400",
      };
  }
}

export default function Maintenance() {
  const api = useApi();
  const { activeSession, addToCart: addToSessionCart } = useSession();
  const deviceNameRef = useRef<HTMLInputElement>(null);
  const [jobs, setJobs] = useState<MaintenanceJob[]>([]);
  const [filter, _setFilter] = useState("All");
  const [statusTab, setStatusTab] = useState("All");

  // Form State
  const [editingJob, setEditingJob] = useState<MaintenanceJob | null>(null);
  const [showHistoryModal, setShowHistoryModal] = useState(false);

  const [deviceName, setDeviceName] = useState("");
  const [issue, setIssue] = useState("");
  const [cost, setCost] = useState("");
  const [price, setPrice] = useState("");
  // Active pricing currency for the job ("USD" or "LBP").
  const [currency, setCurrency] = useState<"USD" | "LBP">("USD");
  const [clientName, setClientName] = useState("");
  const [clientPhone, setClientPhone] = useState("");
  const {
    saveAsClient,
    setSaveAsClient,
    showCheckbox: showSaveAsClient,
    trySaveAsClient,
    resetSaveAsClient,
  } = useSaveAsClient(clientName, clientPhone);

  // Checkout State
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [transactionTime, setTransactionTime] = useState<string | undefined>();

  // Focus device name input on mount and when form resets
  useEffect(() => {
    deviceNameRef.current?.focus();
  }, [editingJob]);

  // Autofill client name/phone from active customer session, clear when session closes
  useEffect(() => {
    if (!editingJob && activeSession?.customer_name) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  /**
   * Build the currency-scoped pricing fields for a save payload.
   * The unselected currency's columns are zeroed so a job is priced in
   * exactly one currency at a time.
   */
  const buildPricing = (
    costStr: string,
    priceStr: string,
    cur: "USD" | "LBP",
    finalAmount?: number,
  ) => {
    const c = parseFloat(costStr) || 0;
    const p = parseFloat(priceStr) || 0;
    const final = finalAmount ?? p;
    if (cur === "LBP") {
      return {
        currency: "LBP" as const,
        cost_usd: 0,
        price_usd: 0,
        cost_lbp: c,
        price_lbp: p,
        final_amount_usd: 0,
        final_amount_lbp: final,
      };
    }
    return {
      currency: "USD" as const,
      cost_usd: c,
      price_usd: p,
      cost_lbp: 0,
      price_lbp: 0,
      final_amount_usd: final,
      final_amount_lbp: 0,
    };
  };

  const handleNewJob = () => {
    setEditingJob(null);
    setDeviceName("");
    setIssue("");
    setCost("");
    setPrice("");
    setCurrency("USD");
    setClientName("");
    setClientPhone("");
    setTransactionTime(undefined);
    resetSaveAsClient();
  };

  const handleEdit = (job: MaintenanceJob) => {
    const cur: "USD" | "LBP" = job.currency === "LBP" ? "LBP" : "USD";
    setEditingJob(job);
    setDeviceName(job.device_name);
    setIssue(job.issue_description);
    setCurrency(cur);
    if (cur === "LBP") {
      setCost(job.cost_lbp?.toString() || "");
      setPrice(job.price_lbp?.toString() || "");
    } else {
      setCost(job.cost_usd?.toString() || "");
      setPrice(job.price_usd?.toString() || "");
    }
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

    const cur: "USD" | "LBP" = job.currency === "LBP" ? "LBP" : "USD";
    const result = await api.saveMaintenanceJob({
      id: job.id,
      device_name: job.device_name,
      issue_description: job.issue_description,
      currency: cur,
      cost_usd: job.cost_usd ?? 0,
      price_usd: job.price_usd ?? 0,
      cost_lbp: job.cost_lbp ?? 0,
      price_lbp: job.price_lbp ?? 0,
      client_name: job.client_name || "",
      client_phone: job.client_phone || "",
      status: newStatus,
      paid_usd: job.paid_usd || 0,
      paid_lbp: job.paid_lbp || 0,
      discount_usd: job.discount_usd || 0,
      final_amount_usd: cur === "USD" ? (job.price_usd ?? 0) : 0,
      final_amount_lbp: cur === "LBP" ? (job.price_lbp ?? 0) : 0,
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
    await trySaveAsClient();

    const jobData = {
      ...(editingJob?.id != null ? { id: editingJob.id } : {}),
      device_name: deviceName,
      issue_description: issue,
      ...buildPricing(cost, price, currency),
      client_name: clientName,
      client_phone: clientPhone,
      status: (editingJob?.status as Status) || "Received",
      paid_usd: editingJob?.paid_usd || 0,
      paid_lbp: editingJob?.paid_lbp || 0,
      discount_usd: editingJob?.discount_usd || 0,
      transaction_time: transactionTime,
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
    await trySaveAsClient();

    // The checkout total (final_amount/discount) is expressed in the job's
    // currency — fall back to the form's currency if the modal omitted it.
    const cur: "USD" | "LBP" =
      paymentData.currency === "LBP" || paymentData.currency === "USD"
        ? paymentData.currency
        : currency;

    const jobData = {
      ...(editingJob?.id != null ? { id: editingJob.id } : {}),
      device_name: deviceName,
      issue_description: issue,
      ...buildPricing(cost, price, cur, paymentData.final_amount),
      ...(paymentData.client_id != null
        ? { client_id: paymentData.client_id }
        : {}),
      client_name: paymentData.client_name || clientName,
      client_phone: paymentData.client_phone || clientPhone,
      // Only USD discounts have a dedicated column; LBP net is captured in
      // final_amount_lbp.
      discount_usd: cur === "USD" ? paymentData.discount || 0 : 0,
      paid_usd: paymentData.payment_usd,
      paid_lbp: paymentData.payment_lbp,
      exchange_rate: paymentData.exchange_rate,
      payments: paymentData.payments || [],
      paid_by: paymentData.payments?.[0]?.method || "CASH",
      change_given_usd: paymentData.change_given_usd || 0,
      change_given_lbp: paymentData.change_given_lbp || 0,
      status: "Delivered_Paid" as Status,
      transaction_time: transactionTime,
    };

    // If session is active, add to cart instead of submitting
    if (activeSession) {
      const finalAmt =
        paymentData.final_amount || parseFloat(price) || 0;
      const amountLabel =
        cur === "LBP"
          ? `${Math.round(finalAmt).toLocaleString()} LBP`
          : `$${finalAmt.toFixed(2)}`;
      const label = `Maintenance: ${deviceName || "Device"} - ${amountLabel}`;

      addToSessionCart({
        module: "maintenance",
        label,
        amount: finalAmt,
        currency: cur,
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

  const activeTab =
    STATUS_TABS.find((t) => t.key === statusTab) ?? STATUS_TABS[0];
  const filteredJobs = jobs.filter((job) => activeTab.match(job.status));

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

      {/* Main Content: form (left) + jobs/status (right) */}
      <div className="flex-1 min-h-0 overflow-auto">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          {/* Right: Jobs list with status tabs */}
          <div className="order-2 lg:col-span-2">
          <div className="bg-slate-800/60 rounded-xl border border-slate-700/50 p-4">
            <h3 className="text-sm font-semibold text-slate-300 mb-3 flex items-center gap-2">
              <Clock size={14} className="text-amber-400" />
              Jobs ({filteredJobs.length})
            </h3>

            {/* Status tabs */}
            <div className="flex flex-wrap gap-2 mb-3">
              {STATUS_TABS.map((tab) => {
                const count = jobs.filter((j) => tab.match(j.status)).length;
                return (
                  <button
                    key={tab.key}
                    onClick={() => setStatusTab(tab.key)}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                      statusTab === tab.key
                        ? "bg-violet-600 text-white"
                        : "bg-slate-900/60 text-slate-400 border border-slate-700 hover:text-slate-200 hover:border-slate-600"
                    }`}
                  >
                    {tab.label}
                    <span className="ml-1.5 opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>

            {/* Jobs list */}
            {filteredJobs.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-500">
                No jobs in this status
              </div>
            ) : (
              <div className="space-y-2 max-h-64 overflow-auto custom-scrollbar">
                {filteredJobs.map((job) => {
                  const badge = statusBadge(job.status);
                  const canTransition =
                    job.status === "Received" || job.status === "In_Progress";
                  return (
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
                            className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${badge.className}`}
                          >
                            {badge.label}
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
                      {canTransition && (
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
                      {job.currency === "LBP"
                        ? (job.price_lbp ?? 0) > 0 && (
                            <span className="text-xs font-mono text-emerald-400">
                              {(job.price_lbp ?? 0).toLocaleString()} LBP
                            </span>
                          )
                        : (job.price_usd ?? 0) > 0 && (
                            <span className="text-xs font-mono text-emerald-400">
                              ${job.price_usd?.toFixed(2)}
                            </span>
                          )}
                      <ChevronRight size={14} className="text-slate-600" />
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
          {/* Left: New/Edit Job Form */}
          <div className="order-1 lg:col-span-1 bg-slate-800 rounded-xl border border-slate-700/50 shadow-xl p-5 flex flex-col overflow-hidden">
          <h2 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
            <Plus className="text-violet-400" size={20} />
            {editingJob ? "Edit Job" : "New Repair Job"}
          </h2>

          <div className="space-y-3 flex-1 overflow-auto pr-1 custom-scrollbar">
            {/* Device Info */}
            <div>
              <label
                htmlFor="maintenance-device-name"
                className="text-xs text-slate-400 block mb-1"
              >
                Device Name / Model *
              </label>
              <input
                id="maintenance-device-name"
                type="text"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                placeholder="e.g., iPhone 13 Pro Max"
                ref={deviceNameRef}
              />
            </div>

            {/* Issue Description */}
            <div>
              <label
                htmlFor="maintenance-issue"
                className="text-xs text-slate-400 block mb-1"
              >
                Issue Description *
              </label>
              <textarea
                id="maintenance-issue"
                value={issue}
                onChange={(e) => setIssue(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500 resize-none h-24"
                placeholder="e.g., Broken Screen, Battery Replacement..."
              />
            </div>

            {/* Cost & Price — single currency (USD/LBP toggle) */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs text-slate-400">Repair Cost / Price</span>
                {/* Currency toggle */}
                <div className="flex items-center gap-1 bg-slate-900 rounded-lg border border-slate-600 p-0.5">
                  {(["USD", "LBP"] as const).map((cur) => (
                    <button
                      key={cur}
                      type="button"
                      onClick={() => {
                        if (cur === currency) return;
                        setCurrency(cur);
                        // One currency at a time — clear amounts on switch.
                        setCost("");
                        setPrice("");
                      }}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-md transition-all ${
                        currency === cur
                          ? "bg-violet-600 text-white"
                          : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {cur}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label
                    htmlFor="maintenance-cost"
                    className="text-[10px] text-slate-500 block mb-1 uppercase"
                  >
                    Repair Cost ({currency})
                  </label>
                  <div className="relative">
                    {currency === "USD" && (
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500 text-sm">
                        $
                      </span>
                    )}
                    <input
                      id="maintenance-cost"
                      type="number"
                      value={cost}
                      onChange={(e) => setCost(e.target.value)}
                      className={`w-full bg-slate-900 border border-slate-600 rounded-lg ${currency === "USD" ? "pl-7" : "pl-3"} pr-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-orange-500`}
                      placeholder={currency === "USD" ? "0.00" : "0"}
                      min="0"
                      step={currency === "USD" ? "0.01" : "1000"}
                    />
                  </div>
                </div>
                <div>
                  <label
                    htmlFor="maintenance-price"
                    className="text-[10px] text-emerald-400 block mb-1 uppercase"
                  >
                    Price to Client ({currency})
                  </label>
                  <div className="relative">
                    {currency === "USD" && (
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-emerald-500 text-sm">
                        $
                      </span>
                    )}
                    <input
                      id="maintenance-price"
                      type="number"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className={`w-full bg-slate-900 border border-emerald-500/50 rounded-lg ${currency === "USD" ? "pl-7" : "pl-3"} pr-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-emerald-500`}
                      placeholder={currency === "USD" ? "0.00" : "0"}
                      min="0"
                      step={currency === "USD" ? "0.01" : "1000"}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Client Info */}
            <div>
              <label
                htmlFor="maintenance-client-name"
                className="text-xs text-slate-400 block mb-1"
              >
                Client Name
              </label>
              <input
                id="maintenance-client-name"
                type="text"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                placeholder="Walk-in Client"
              />
            </div>
            <div>
              <label
                htmlFor="maintenance-client-phone"
                className="text-xs text-slate-400 block mb-1"
              >
                Phone Number
              </label>
              <input
                id="maintenance-client-phone"
                type="text"
                value={clientPhone}
                onChange={(e) => setClientPhone(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                placeholder="Optional"
              />
            </div>
            <SaveAsClientCheckbox
              checked={saveAsClient}
              onChange={setSaveAsClient}
              hidden={!showSaveAsClient}
            />
          </div>

          <TransactionTimeOverride
            value={transactionTime}
            onChange={setTransactionTime}
          />

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
      </div>

      {/* Checkout Modal */}
      {isCheckoutOpen && (
        <div className="fixed inset-0 z-[60]">
          <CheckoutModal
            totalAmount={parseFloat(price) || 0}
            currency={currency}
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
