import { useState, useEffect, useCallback } from "react";
import {
  Plus,
  Search,
  Users,
  Edit2,
  Trash2,
  MessageCircle,
} from "lucide-react";
import { PageHeader } from "@liratek/ui";
import ClientForm from "./ClientForm";
import type { Client } from "@liratek/ui";
import * as api from "../../../../api/backendApi";

export default function ClientList() {
  const [clients, setClients] = useState<Client[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);

  const loadClients = useCallback(async () => {
    setLoading(true);
    try {
      if (window.api) {
        const data = await window.api.getClients(search);
        setClients(data);
      } else {
        const data = await api.getClients(search);
        setClients(data as any);
      }
    } catch (error) {
      console.error("Failed to load clients:", error);
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
        const result = await window.api.deleteClient(id);
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
      console.error("Failed to delete:", error);
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

  return (
    <div className="space-y-6">
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
      <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden shadow-xl">
        <table className="w-full text-left border-collapse">
          <thead className="bg-slate-800/50 text-slate-400 text-xs uppercase font-semibold">
            <tr>
              <th className="p-4 border-b border-slate-700">Client Info</th>
              <th className="p-4 border-b border-slate-700">Phone</th>
              <th className="p-4 border-b border-slate-700">WhatsApp</th>
              <th className="p-4 border-b border-slate-700">Notes</th>
              <th className="p-4 border-b border-slate-700 text-right">
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-700 text-sm">
            {loading ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-500">
                  Loading clients...
                </td>
              </tr>
            ) : clients.length === 0 ? (
              <tr>
                <td colSpan={5} className="p-8 text-center text-slate-500">
                  No clients found.
                </td>
              </tr>
            ) : (
              clients.map((client) => (
                <tr
                  key={client.id}
                  className="hover:bg-slate-700/50 transition-colors"
                >
                  <td className="p-4">
                    <div className="font-medium text-white">
                      {client.full_name}
                    </div>
                    <div className="text-slate-500 text-xs">
                      ID: #{client.id}
                    </div>
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
              ))
            )}
          </tbody>
        </table>
      </div>

      {isFormOpen && (
        <ClientForm
          onClose={handleClose}
          onSave={handleSave}
          client={editingClient}
        />
      )}
    </div>
  );
}
