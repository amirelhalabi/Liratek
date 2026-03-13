import { useState, useEffect } from "react";
import { DataTable } from "@/shared/components/DataTable";
import { requestJson } from "@/api/httpClient";
import {
  Users,
  RefreshCw,
  Search,
  Eye,
  AlertCircle,
  CheckCircle,
  Clock,
  PauseCircle,
} from "lucide-react";

interface Client {
  shop_name: string;
  plan: "essentials" | "professional";
  status: "active" | "expired" | "grace_period" | "paused";
  contact_email?: string;
  contact_phone?: string;
  created_at: string;
  last_login_at?: string;
  billing_cycle?: string;
  notes?: string;
}

interface SyncStatus {
  isSyncing: boolean;
  isRunning: boolean;
  intervalHours: number;
  cacheSize: number;
}

export default function AdminClients() {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // Fetch clients on mount
  useEffect(() => {
    fetchClients();
    fetchSyncStatus();
  }, []);

  const fetchClients = async () => {
    try {
      setLoading(true);
      const data = await requestJson<{ clients: Client[] }>(
        "/api/admin/subscriptions/clients",
      );
      setClients(data.clients || []);
    } catch (error) {
      console.error("Failed to fetch clients:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchSyncStatus = async () => {
    try {
      const data = await requestJson<SyncStatus>(
        "/api/admin/subscriptions/sync/status",
      );
      setSyncStatus(data);
    } catch (error) {
      console.error("Failed to fetch sync status:", error);
    }
  };

  const handleSync = async () => {
    try {
      setSyncing(true);
      await requestJson("/api/admin/subscriptions/sync/trigger", {
        method: "POST",
      });
      await fetchClients();
      await fetchSyncStatus();
    } catch (error) {
      console.error("Sync failed:", error);
    } finally {
      setSyncing(false);
    }
  };

  const handleViewClient = (client: Client) => {
    setSelectedClient(client);
    setShowDetailModal(true);
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "active":
        return <CheckCircle size={18} className="text-emerald-500" />;
      case "expired":
        return <AlertCircle size={18} className="text-red-500" />;
      case "grace_period":
        return <Clock size={18} className="text-amber-500" />;
      case "paused":
        return <PauseCircle size={18} className="text-slate-500" />;
      default:
        return null;
    }
  };

  const getPlanBadge = (plan: string) => {
    const isProfessional = plan === "professional";
    return (
      <span
        className={`px-2 py-1 rounded-full text-xs font-medium ${
          isProfessional
            ? "bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400"
            : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-400"
        }`}
      >
        {isProfessional ? "🥇 Professional" : "🥉 Essentials"}
      </span>
    );
  };

  // Filter clients by search term
  const filteredClients = clients.filter(
    (client) =>
      client.shop_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      client.contact_email?.toLowerCase().includes(searchTerm.toLowerCase()),
  );

  // Table columns
  const columns = [
    {
      header: "Shop Name",
      width: "200",
    },
    {
      header: "Plan",
      width: "120",
    },
    {
      header: "Contact Email",
      width: "200",
    },
    {
      header: "Phone",
      width: "150",
    },
    {
      header: "Created",
      width: "120",
    },
    {
      header: "Actions",
      width: "80",
      className: "text-right",
    },
  ];

  return (
    <div className="min-h-screen bg-slate-900 p-6">
      {/* Top Bar */}
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-violet-500/10 border border-violet-500/30">
            <Users className="w-8 h-8 text-violet-400" />
          </div>
          <div>
            <h1 className="text-3xl font-bold text-white">Client Management</h1>
            <p className="text-slate-400 mt-1">
              View and manage client subscriptions
            </p>
          </div>
        </div>
        <a
          href="/"
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors"
        >
          ← Back to App
        </a>
      </div>

      {/* Stats & Actions */}

      {/* Stats & Actions */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {/* Total Clients */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Total Clients
              </p>
              <p className="text-2xl font-bold text-slate-800 dark:text-white">
                {clients.length}
              </p>
            </div>
            <Users size={32} className="text-violet-500" />
          </div>
        </div>

        {/* Cache Size */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Cached Clients
              </p>
              <p className="text-2xl font-bold text-slate-800 dark:text-white">
                {syncStatus?.cacheSize || 0}
              </p>
            </div>
            <RefreshCw size={32} className="text-blue-500" />
          </div>
        </div>

        {/* Sync Button */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Sync Status
              </p>
              <p className="text-sm font-medium text-slate-800 dark:text-white">
                {syncStatus?.isRunning ? "Auto-sync ON" : "Auto-sync OFF"}
              </p>
            </div>
            <button
              onClick={handleSync}
              disabled={syncing}
              className="p-2 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-400 text-white rounded-lg transition-colors"
              title="Sync from Google Sheets"
            >
              <RefreshCw size={20} className={syncing ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </div>

      {/* Search */}
      <div className="mb-4">
        <div className="relative">
          <Search
            size={20}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            type="text"
            placeholder="Search by shop name or email..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-violet-500 text-slate-800 dark:text-white"
          />
        </div>
      </div>

      {/* Clients Table */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <RefreshCw size={32} className="animate-spin text-violet-500" />
            <span className="ml-3 text-slate-600 dark:text-slate-400">
              Loading clients...
            </span>
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-12">
            <Users
              size={48}
              className="text-slate-300 dark:text-slate-600 mb-4"
            />
            <p className="text-slate-600 dark:text-slate-400">
              {searchTerm
                ? "No clients found matching your search"
                : "No clients found"}
            </p>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={filteredClients}
            renderRow={(client) => (
              <tr
                key={client.shop_name}
                className="border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
              >
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    {getStatusIcon(client.status)}
                    <span className="font-medium text-slate-800 dark:text-white">
                      {client.shop_name}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">{getPlanBadge(client.plan)}</td>
                <td className="px-4 py-3">
                  <span className="text-slate-600 dark:text-slate-400">
                    {client.contact_email || "-"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-slate-600 dark:text-slate-400">
                    {client.contact_phone || "-"}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-slate-600 dark:text-slate-400">
                    {new Date(client.created_at).toLocaleDateString()}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <button
                    onClick={() => handleViewClient(client)}
                    className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
                    title="View details"
                  >
                    <Eye
                      size={16}
                      className="text-slate-600 dark:text-slate-400"
                    />
                  </button>
                </td>
              </tr>
            )}
          />
        )}
      </div>

      {/* Client Detail Modal */}
      {showDetailModal && selectedClient && (
        <ClientDetailModal
          client={selectedClient}
          onClose={() => setShowDetailModal(false)}
          onSync={async () => {
            await requestJson(
              `/api/admin/subscriptions/clients/${selectedClient.shop_name}/sync`,
              { method: "POST" },
            );
            await fetchClients();
            setShowDetailModal(false);
          }}
        />
      )}
    </div>
  );
}

// Client Detail Modal Component
interface ClientDetailModalProps {
  client: Client;
  onClose: () => void;
  onSync: () => Promise<void>;
}

function ClientDetailModal({
  client,
  onClose,
  onSync,
}: ClientDetailModalProps) {
  const [syncing, setSyncing] = useState(false);

  const handleSync = async () => {
    setSyncing(true);
    try {
      await requestJson(
        `/api/admin/subscriptions/clients/${client.shop_name}/sync`,
        { method: "POST" },
      );
      await onSync();
    } catch (error) {
      console.error("Failed to sync client:", error);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl w-full max-w-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 dark:border-slate-700">
          <h2 className="text-xl font-bold text-slate-800 dark:text-white">
            {client.shop_name}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg transition-colors"
          >
            <Eye size={20} className="text-slate-600 dark:text-slate-400" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 space-y-4">
          {/* Plan & Status */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">Plan</p>
              <p className="text-lg font-semibold text-slate-800 dark:text-white capitalize">
                {client.plan}
              </p>
            </div>
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Status
              </p>
              <p className="text-lg font-semibold text-slate-800 dark:text-white capitalize">
                {client.status}
              </p>
            </div>
          </div>

          {/* Contact Info */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Contact Information
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Email
                </p>
                <p className="text-slate-800 dark:text-white">
                  {client.contact_email || "-"}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Phone
                </p>
                <p className="text-slate-800 dark:text-white">
                  {client.contact_phone || "-"}
                </p>
              </div>
            </div>
          </div>

          {/* Dates */}
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Subscription Details
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Created
                </p>
                <p className="text-slate-800 dark:text-white">
                  {new Date(client.created_at).toLocaleDateString()}
                </p>
              </div>
              <div>
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Billing Cycle
                </p>
                <p className="text-slate-800 dark:text-white capitalize">
                  {client.billing_cycle || "-"}
                </p>
              </div>
              {client.last_login_at && (
                <div>
                  <p className="text-sm text-slate-500 dark:text-slate-400">
                    Last Login
                  </p>
                  <p className="text-slate-800 dark:text-white">
                    {new Date(client.last_login_at).toLocaleString()}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Notes */}
          {client.notes && (
            <div>
              <h3 className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Notes
              </h3>
              <p className="text-slate-600 dark:text-slate-400 text-sm">
                {client.notes}
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
          <button
            onClick={onClose}
            className="px-4 py-2 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-lg transition-colors"
          >
            Close
          </button>
          <button
            onClick={handleSync}
            disabled={syncing}
            className="flex items-center gap-2 px-4 py-2 bg-violet-600 hover:bg-violet-700 disabled:bg-slate-400 text-white rounded-lg transition-colors"
          >
            <RefreshCw size={16} className={syncing ? "animate-spin" : ""} />
            {syncing ? "Syncing..." : "Sync Now"}
          </button>
        </div>
      </div>
    </div>
  );
}
