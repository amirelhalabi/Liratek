import { useState, useEffect } from "react";
import { X, Save, MessageCircle } from "lucide-react";
import type { Client } from "../../../../types";

interface ClientFormProps {
  onClose: () => void;
  onSave: () => void;
  client?: Client | null;
}

export default function ClientForm({
  onClose,
  onSave,
  client,
}: ClientFormProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [formData, setFormData] = useState({
    full_name: "",
    phone_number: "",
    notes: "",
    whatsapp_opt_in: true,
  });

  useEffect(() => {
    if (client) {
      setFormData({
        full_name: client.full_name,
        phone_number: client.phone_number,
        notes: client.notes || "",
        whatsapp_opt_in: client.whatsapp_opt_in === 1,
      });
    }
  }, [client]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    const { name, value, type } = e.target;

    if (type === "checkbox") {
      setFormData((prev) => ({
        ...prev,
        [name]: (e.target as HTMLInputElement).checked,
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [name]: value,
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setIsLoading(true);

    try {
      let result;
      if (client) {
        const updatePayload = {
          id: client.id,
          full_name: formData.full_name,
          phone_number: formData.phone_number,
          ...(formData.notes ? { notes: formData.notes } : {}),
          whatsapp_opt_in: formData.whatsapp_opt_in ? 1 : 0,
        };
        result = await window.api.updateClient(updatePayload);
      } else {
        const createPayload = {
          full_name: formData.full_name,
          phone_number: formData.phone_number,
          ...(formData.notes ? { notes: formData.notes } : {}),
          whatsapp_opt_in: formData.whatsapp_opt_in ? 1 : 0,
        };
        result = await window.api.createClient(createPayload);
      }

      if (result.success) {
        onSave();
      } else {
        setError(result.error || "Failed to save client");
      }
    } catch (err) {
      console.error(err);
      setError("An unexpected error occurred");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg overflow-hidden shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-6 border-b border-slate-700 bg-slate-800">
          <h2 className="text-xl font-bold text-white">
            {client ? "Edit Client" : "New Client"}
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="bg-red-500/10 text-red-400 p-3 rounded-lg text-sm border border-red-500/50">
              {error}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">
              Full Name
            </label>
            <input
              name="full_name"
              type="text"
              value={formData.full_name}
              onChange={handleChange}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-violet-600"
              required
              placeholder="John Doe"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">
              Phone Number
            </label>
            <input
              name="phone_number"
              type="text"
              value={formData.phone_number}
              onChange={handleChange}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-violet-600"
              required
              placeholder="03 123 456"
            />
          </div>

          <div className="flex items-center gap-3 py-2">
            <div
              className={`w-10 h-6 rounded-full p-1 cursor-pointer transition-colors ${formData.whatsapp_opt_in ? "bg-green-500" : "bg-slate-600"}`}
              onClick={() =>
                setFormData((prev) => ({
                  ...prev,
                  whatsapp_opt_in: !prev.whatsapp_opt_in,
                }))
              }
            >
              <div
                className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${formData.whatsapp_opt_in ? "translate-x-4" : ""}`}
              ></div>
            </div>
            <span className="text-slate-300 text-sm flex items-center gap-2">
              <MessageCircle
                size={16}
                className={
                  formData.whatsapp_opt_in ? "text-green-400" : "text-slate-500"
                }
              />
              Receive updates via WhatsApp
            </span>
            {/* Hidden checkbox for form completeness if needed, but state handles it */}
            <input
              type="checkbox"
              name="whatsapp_opt_in"
              checked={formData.whatsapp_opt_in}
              onChange={handleChange}
              className="hidden"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-400 mb-1">
              Notes (Optional)
            </label>
            <textarea
              name="notes"
              value={formData.notes}
              onChange={handleChange}
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-4 py-2 text-white focus:ring-2 focus:ring-violet-600 min-h-[100px]"
              placeholder="Customer preferences, loyalty status..."
            />
          </div>

          <div className="flex justify-end gap-3 mt-6 pt-4 border-t border-slate-700">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isLoading}
              className="flex items-center gap-2 px-6 py-2 bg-violet-600 hover:bg-violet-500 text-white rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              <Save size={18} />
              {isLoading ? "Saving..." : "Save Client"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
