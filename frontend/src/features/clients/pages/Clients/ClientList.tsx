import { useState, useEffect, useCallback } from "react";
import logger from "@/utils/logger";
import {
  Plus,
  Search,
  Users,
  Edit2,
  Trash2,
  MessageCircle,
  Clock,
} from "lucide-react";
import { PageHeader, useApi } from "@liratek/ui";
import ClientForm from "./ClientForm";
import CustomerSessionsView from "./CustomerSessionsView";
import type { Client } from "@liratek/ui";
import { DataTable } from "@/shared/components/DataTable";

export default function ClientList() {
  const api = useApi();
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [viewingSessionsClient, setViewingSessionsClient] =
    useState<Client | null>(null);

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      if (window.api) {
        const data = await window.api.clients.getAll(search);
        setClients(data);
      } else {
        const data = await api.getClients(search);
        setClients(data as any);
      }
    } catch (error) {
      logger.error("Failed to load clients", { error });
    } finally {
      setLoading(false);
    }
  }, [search]);

  useEffect(() => {
    const timer = setTimeout(() => {
      loadClients();
    }, 300);
    return () => clearTimeout(timer);
  }, [search, loadClients]);

  const handleEdit = (client: Client) => {
    setEditingClient(client);
    setIsFormOpen(true);
  };

  const handleDelete = async (id: number) => {
    if (
      !confirm(
        "Are you sure you want to delete this client? Cannot be undone if they have sales.",
      )
    )
      return;
    try {
      if (window.api) {
        const result = await window.api.clients.delete(id);
        if (result.success) {
          loadClients();
        } else {
          alert(result.error);
        }
      } else {
        try {
          const result = await api.deleteClient(id);
          if (result.success) loadClients();
          else alert(result.error || "Delete failed");
        } catch (e: any) {
          alert(e?.message || "Delete failed");
        }
      }
    } catch (error) {
      logger.error("Failed to delete client", { error });
    }
  };

  const handleSave = () => {
    setIsFormOpen(false);
    setEditingClient(null);
    loadClients();
  };

  const handleClose = () => {
    setIsFormOpen(false);
    setEditingClient(null);
  };

  const handleViewSessions = (client: Client) => {
    setViewingSessionsClient(client);
  };

  return (
    <div className="h-full bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 p-6 flex flex-col gap-6 overflow-hidden animate-in fade-in duration-500">
      <PageHeader
        icon={Users}
        title="Clients"
        actions={
          <button
            onClick={() => setIsFormOpen(true)}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-500 text-white px-4 py-2 rounded-lg font-medium transition-all shadow-lg shadow-violet-900/20"
          >
            <Plus size={20} />
            Add Client
          </button>
        }
      />

      {/* Toolbar */}
      <div className="bg-slate-800 p-4 rounded-xl border border-slate-700 flex gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-2.5 text-slate-500 h-5 w-5" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or phone..."
            className="w-full bg-slate-900 border border-slate-700 rounded-lg pl-10 pr-4 py-2 text-white focus:ring-2 focus:ring-violet-600"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 min-h-0 bg-slate-800 rounded-xl border border-slate-700 overflow-auto shadow-xl">
        <DataTable
          columns={[
            {
              header: "Client Info",
              className: "p-4 border-b border-slate-700",
              sortKey: "full_name",
            },
            {
              header: "Phone",
              className: "p-4 border-b border-slate-700",
              sortKey: "phone_number",
            },
            { header: "WhatsApp", className: "p-4 border-b border-slate-700" },
            { header: "Notes", className: "p-4 border-b border-slate-700" },
            {
              header: "Actions",
              className: "p-4 border-b border-slate-700 text-right",
            },
          ]}
          data={clients}
          loading={loading}
          emptyMessage="No clients found."
          exportExcel
          exportPdf
          exportFilename="clients"
          className="w-full text-left border-collapse"
          theadClassName="bg-slate-800/50 text-slate-400 text-xs uppercase font-semibold"
          tbodyClassName="divide-y divide-slate-700 text-sm"
          renderRow={(client) => (
            <tr
              key={client.id}
              className="hover:bg-slate-700/50 transition-colors"
            >
              <td className="p-4">
                <div className="font-medium text-white">{client.full_name}</div>
                <div className="text-slate-500 text-xs">ID: #{client.id}</div>
              </td>
              <td className="p-4 text-slate-300 font-mono">
                {client.phone_number}
              </td>
              <td className="p-4">
                {client.whatsapp_opt_in === 1 ? (
                  <span className="flex items-center gap-1 text-green-400 text-xs bg-green-400/10 px-2 py-1 rounded w-fit">
                    <MessageCircle size={12} /> Yes
                  </span>
                ) : (
                  <span className="text-slate-600 text-xs">No</span>
                )}
              </td>
              <td className="p-4 text-slate-400 italic">
                {client.notes || "-"}
              </td>
              <td className="p-4 text-right">
                <div className="flex items-center justify-end gap-2">
                  <button
                    onClick={() => handleViewSessions(client)}
                    className="p-2 text-slate-400 hover:text-violet-400 hover:bg-violet-400/10 rounded transition-colors"
                    title="View customer sessions"
                  >
                    <Clock size={16} />
                  </button>
                  <button
                    onClick={() => handleEdit(client)}
                    className="p-2 text-slate-400 hover:text-blue-400 hover:bg-blue-400/10 rounded transition-colors"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(client.id)}
                    className="p-2 text-slate-400 hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </td>
            </tr>
          )}
        />
      </div>

      {isFormOpen && (
        <ClientForm
          onClose={handleClose}
          onSave={handleSave}
          client={editingClient}
        />
      )}

      {viewingSessionsClient && (
        <CustomerSessionsView
          customerName={viewingSessionsClient.full_name}
          customerPhone={viewingSessionsClient.phone_number}
          onClose={() => setViewingSessionsClient(null)}
        />
      )}
    </div>
  );
}
