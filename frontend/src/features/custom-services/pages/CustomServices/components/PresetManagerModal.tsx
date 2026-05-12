/**
 * PresetManagerModal
 *
 * CRUD modal for managing service presets (digital accounts, repairs, etc.).
 * Accessed from the Custom Services page via a "Manage Presets" button.
 */

import { useState, useEffect, useCallback } from "react";
import {
  X,
  Plus,
  Pencil,
  Trash2,
  Check,
  RefreshCw,
  Settings,
} from "lucide-react";
import { useModalFocusFix } from "@/shared/hooks/useModalFocusFix";
import logger from "@/utils/logger";

interface ServicePreset {
  id: number;
  name: string;
  category: string;
  cost_usd: number;
  cost_lbp: number;
  price_usd: number;
  price_lbp: number;
  is_active: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

interface PresetFormData {
  name: string;
  category: string;
  cost_usd: string;
  cost_lbp: string;
  price_usd: string;
  price_lbp: string;
}

const EMPTY_FORM: PresetFormData = {
  name: "",
  category: "digital_account",
  cost_usd: "",
  cost_lbp: "",
  price_usd: "",
  price_lbp: "",
};

interface PresetManagerModalProps {
  onClose: () => void;
  onPresetsChanged: () => void;
}

export function PresetManagerModal({
  onClose,
  onPresetsChanged,
}: PresetManagerModalProps) {
  useModalFocusFix(true);

  const [presets, setPresets] = useState<ServicePreset[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<PresetFormData>(EMPTY_FORM);
  const [showAddForm, setShowAddForm] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadPresets = useCallback(async () => {
    try {
      setLoading(true);
      const result = await window.api.servicePresets.list({
        includeInactive: true,
      });
      if (result.success && result.data) {
        setPresets(result.data);
      }
    } catch (err) {
      logger.error("Failed to load presets:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadPresets();
  }, [loadPresets]);

  const handleAdd = async () => {
    if (!form.name.trim()) {
      alert("Name is required");
      return;
    }
    setSaving(true);
    try {
      const result = await window.api.servicePresets.create({
        name: form.name.trim(),
        category: form.category,
        cost_usd: parseFloat(form.cost_usd) || 0,
        cost_lbp: parseFloat(form.cost_lbp) || 0,
        price_usd: parseFloat(form.price_usd) || 0,
        price_lbp: parseFloat(form.price_lbp) || 0,
      });
      if (result.success) {
        setForm(EMPTY_FORM);
        setShowAddForm(false);
        await loadPresets();
        onPresetsChanged();
      } else {
        alert(result.error ?? "Failed to create preset");
      }
    } catch (err) {
      logger.error("Failed to create preset:", err);
      alert("Failed to create preset");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (preset: ServicePreset) => {
    setEditingId(preset.id);
    setForm({
      name: preset.name,
      category: preset.category,
      cost_usd: preset.cost_usd > 0 ? String(preset.cost_usd) : "",
      cost_lbp: preset.cost_lbp > 0 ? String(preset.cost_lbp) : "",
      price_usd: preset.price_usd > 0 ? String(preset.price_usd) : "",
      price_lbp: preset.price_lbp > 0 ? String(preset.price_lbp) : "",
    });
  };

  const handleUpdate = async () => {
    if (editingId === null || !form.name.trim()) return;
    setSaving(true);
    try {
      const result = await window.api.servicePresets.update(editingId, {
        name: form.name.trim(),
        category: form.category,
        cost_usd: parseFloat(form.cost_usd) || 0,
        cost_lbp: parseFloat(form.cost_lbp) || 0,
        price_usd: parseFloat(form.price_usd) || 0,
        price_lbp: parseFloat(form.price_lbp) || 0,
      });
      if (result.success) {
        setEditingId(null);
        setForm(EMPTY_FORM);
        await loadPresets();
        onPresetsChanged();
      } else {
        alert(result.error ?? "Failed to update preset");
      }
    } catch (err) {
      logger.error("Failed to update preset:", err);
      alert("Failed to update preset");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number, name: string) => {
    if (!confirm(`Delete preset "${name}"? This cannot be undone.`)) return;
    try {
      const result = await window.api.servicePresets.delete(id);
      if (result.success) {
        await loadPresets();
        onPresetsChanged();
      } else {
        alert(result.error ?? "Failed to delete preset");
      }
    } catch (err) {
      logger.error("Failed to delete preset:", err);
      alert("Failed to delete preset");
    }
  };

  const handleToggleActive = async (preset: ServicePreset) => {
    try {
      const result = await window.api.servicePresets.update(preset.id, {
        is_active: preset.is_active ? 0 : 1,
      });
      if (result.success) {
        await loadPresets();
        onPresetsChanged();
      }
    } catch (err) {
      logger.error("Failed to toggle preset:", err);
    }
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const renderForm = (isNew: boolean) => (
    <div className="flex flex-wrap items-end gap-3 p-3 bg-slate-800/60 rounded-xl border border-slate-700/50">
      <div className="flex-1 min-w-[160px]">
        <label className="text-xs text-slate-400 block mb-1">Name *</label>
        <input
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500"
          placeholder="e.g. Netflix Premium 1 Month"
        />
      </div>
      <div className="w-32">
        <label className="text-xs text-slate-400 block mb-1">Category</label>
        <select
          value={form.category}
          onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-teal-500"
        >
          <option value="digital_account">Digital Account</option>
          <option value="repair">Repair</option>
          <option value="activation">Activation</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div className="w-24">
        <label className="text-xs text-slate-400 block mb-1">Cost $</label>
        <input
          type="number"
          value={form.cost_usd}
          onChange={(e) => setForm((f) => ({ ...f, cost_usd: e.target.value }))}
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-teal-500"
          placeholder="0.00"
          min="0"
          step="0.01"
        />
      </div>
      <div className="w-24">
        <label className="text-xs text-slate-400 block mb-1">Price $</label>
        <input
          type="number"
          value={form.price_usd}
          onChange={(e) =>
            setForm((f) => ({ ...f, price_usd: e.target.value }))
          }
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-teal-500"
          placeholder="0.00"
          min="0"
          step="0.01"
        />
      </div>
      <div className="w-28">
        <label className="text-xs text-slate-400 block mb-1">Cost LBP</label>
        <input
          type="number"
          value={form.cost_lbp}
          onChange={(e) => setForm((f) => ({ ...f, cost_lbp: e.target.value }))}
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-teal-500"
          placeholder="0"
          min="0"
          step="1000"
        />
      </div>
      <div className="w-28">
        <label className="text-xs text-slate-400 block mb-1">Price LBP</label>
        <input
          type="number"
          value={form.price_lbp}
          onChange={(e) =>
            setForm((f) => ({ ...f, price_lbp: e.target.value }))
          }
          className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-teal-500"
          placeholder="0"
          min="0"
          step="1000"
        />
      </div>
      <div className="flex gap-2">
        <button
          onClick={isNew ? handleAdd : handleUpdate}
          disabled={saving}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-teal-600 hover:bg-teal-500 text-white transition-all disabled:opacity-50"
        >
          {saving ? (
            <RefreshCw size={14} className="animate-spin" />
          ) : (
            <Check size={14} />
          )}
        </button>
        <button
          onClick={isNew ? () => setShowAddForm(false) : cancelEdit}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-slate-700 hover:bg-slate-600 text-slate-300 transition-all"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-4xl max-h-[80vh] bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl flex flex-col animate-in zoom-in-95 duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700/60">
          <h2 className="text-base font-semibold text-white flex items-center gap-2">
            <Settings className="text-slate-400" size={18} />
            Manage Service Presets
            <span className="text-xs text-slate-500 font-normal ml-1">
              ({presets.length} presets)
            </span>
          </h2>
          <div className="flex items-center gap-2">
            {!showAddForm && editingId === null && (
              <button
                onClick={() => {
                  setShowAddForm(true);
                  setForm(EMPTY_FORM);
                }}
                className="px-3 py-1.5 rounded-lg text-xs font-medium bg-teal-600 hover:bg-teal-500 text-white transition-all flex items-center gap-1"
              >
                <Plus size={14} />
                Add Preset
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-auto p-4 space-y-3">
          {/* Add form */}
          {showAddForm && renderForm(true)}

          {loading ? (
            <div className="flex items-center justify-center py-12 text-slate-500">
              <RefreshCw size={20} className="animate-spin mr-2" />
              Loading...
            </div>
          ) : presets.length === 0 ? (
            <div className="text-center py-12 text-slate-500">
              <p>No presets yet. Click "Add Preset" to create one.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {presets.map((preset) => (
                <div key={preset.id}>
                  {editingId === preset.id ? (
                    renderForm(false)
                  ) : (
                    <div
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all ${
                        preset.is_active
                          ? "bg-slate-800/40 border-slate-700/50"
                          : "bg-slate-800/20 border-slate-700/30 opacity-50"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium text-white truncate">
                            {preset.name}
                          </span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-purple-500/10 border border-purple-500/30 text-purple-400">
                            {preset.category === "digital_account"
                              ? "Digital Account"
                              : preset.category.charAt(0).toUpperCase() +
                                preset.category.slice(1)}
                          </span>
                          {!preset.is_active && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-red-500/10 border border-red-500/30 text-red-400">
                              Inactive
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 mt-0.5">
                          Cost: ${preset.cost_usd.toFixed(2)}
                          {preset.cost_lbp > 0 &&
                            ` + ${preset.cost_lbp.toLocaleString()} LBP`}
                          {" · "}
                          Price: ${preset.price_usd.toFixed(2)}
                          {preset.price_lbp > 0 &&
                            ` + ${preset.price_lbp.toLocaleString()} LBP`}
                          {" · "}
                          <span className="text-emerald-400 font-medium">
                            Profit: $
                            {(preset.price_usd - preset.cost_usd).toFixed(2)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => handleToggleActive(preset)}
                          className={`p-1.5 rounded-lg transition-colors text-xs ${
                            preset.is_active
                              ? "text-emerald-400 hover:bg-emerald-400/10"
                              : "text-slate-500 hover:bg-slate-700"
                          }`}
                          title={preset.is_active ? "Deactivate" : "Activate"}
                        >
                          {preset.is_active ? "Active" : "Inactive"}
                        </button>
                        <button
                          onClick={() => startEdit(preset)}
                          className="p-1.5 text-slate-500 hover:text-orange-400 hover:bg-orange-400/10 rounded-lg transition-colors"
                          title="Edit"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(preset.id, preset.name)}
                          className="p-1.5 text-slate-600 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                          title="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
