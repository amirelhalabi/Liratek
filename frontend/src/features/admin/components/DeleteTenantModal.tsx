/**
 * Type-the-slug confirmation for deleting a tenant.
 *
 * The dialog is a courtesy, not the protection — the server checks the same
 * slug and refuses tenant 1 outright. It exists because this is the only
 * operation in the product with no undo, and a Yes/No prompt is something
 * people click through without reading. Typing the name is the smallest
 * friction that forces you to look at WHICH shop you are deleting.
 */

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useDeleteTenantMutation } from "../hooks/useTenants";
import type { AdminTenant } from "@/api/backendApi";
import logger from "@/utils/logger";

interface Props {
  tenant: AdminTenant;
  onClose: () => void;
  onDeleted: () => void;
}

export function DeleteTenantModal({ tenant, onClose, onDeleted }: Props) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);
  const del = useDeleteTenantMutation();

  const matches = typed === tenant.slug;

  const confirm = async () => {
    setError(null);
    try {
      await del.mutateAsync({ id: tenant.id, confirmSlug: typed });
      onDeleted();
    } catch (err) {
      logger.error("delete tenant failed:", err);
      setError(err instanceof Error ? err.message : "Failed to delete tenant");
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-md bg-slate-800 rounded-xl border border-red-500/40 shadow-xl">
        <div className="flex items-start justify-between p-5 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-white flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            Delete {tenant.name}?
          </h2>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-slate-400 hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-300">
            This permanently removes the shop and{" "}
            <strong>everything it owns</strong> — sales, clients, debts,
            drawers, users and settings. Its subdomain is removed too. There is
            no undo and no backup taken.
          </p>
          <p className="text-sm text-slate-400">
            If you only want to stop them logging in, close this and use{" "}
            <strong>Suspend</strong> instead — that keeps the data.
          </p>

          <div>
            <label
              className="text-xs text-slate-400 block mb-1"
              htmlFor="confirm-slug"
            >
              Type <span className="font-mono text-white">{tenant.slug}</span>{" "}
              to confirm
            </label>
            <input
              id="confirm-slug"
              data-testid="delete-confirm-slug"
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-red-500"
            />
          </div>

          {error && (
            <div role="alert" className="text-sm text-red-400">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm text-slate-300 hover:bg-slate-700 rounded-lg"
            >
              Cancel
            </button>
            <button
              onClick={confirm}
              disabled={!matches || del.isPending}
              data-testid="delete-confirm-button"
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:bg-slate-700 disabled:text-slate-500 text-white text-sm font-medium rounded-lg"
            >
              {del.isPending ? "Deleting..." : "Delete permanently"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DeleteTenantModal;
