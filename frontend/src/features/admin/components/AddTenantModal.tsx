import { useState } from "react";
import type { FormEvent } from "react";
import { X } from "lucide-react";
import type { AdminCreateTenantPayload } from "@/api/backendApi";

interface AddTenantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (payload: AdminCreateTenantPayload) => Promise<void>;
  isSubmitting: boolean;
  error: string | null;
}

const SLUG_PATTERN = /^[a-z0-9-]+$/;

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "Add tenant" form (plan §5) — name/slug/contact/notes + the first tenant
 * admin's credentials, all created transactionally server-side. */
export function AddTenantModal({
  isOpen,
  onClose,
  onSubmit,
  isSubmitting,
  error,
}: AddTenantModalProps) {
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [notes, setNotes] = useState("");
  const [adminUsername, setAdminUsername] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  if (!isOpen) return null;

  const slugValid = slug.length > 0 && SLUG_PATTERN.test(slug);
  const canSubmit =
    name.trim().length > 0 &&
    slugValid &&
    adminUsername.trim().length > 0 &&
    adminPassword.length > 0 &&
    !isSubmitting;

  const handleNameChange = (value: string) => {
    setName(value);
    if (!slugTouched) setSlug(slugify(value));
  };

  const reset = () => {
    setName("");
    setSlug("");
    setSlugTouched(false);
    setContactName("");
    setContactPhone("");
    setNotes("");
    setAdminUsername("");
    setAdminPassword("");
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    await onSubmit({
      name: name.trim(),
      slug,
      ...(contactName.trim() ? { contactName: contactName.trim() } : {}),
      ...(contactPhone.trim() ? { contactPhone: contactPhone.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      adminUsername: adminUsername.trim(),
      adminPassword,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h3 className="text-lg font-bold text-white">Add tenant</h3>
          <button
            type="button"
            onClick={handleClose}
            className="text-slate-500 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form
          onSubmit={handleSubmit}
          className="p-6 space-y-4 overflow-y-auto"
        >
          {error && (
            <div className="p-3 rounded-lg bg-red-500/15 border border-red-500/40 text-red-300 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Name *
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
              placeholder="Acme Retail"
              required
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Slug *
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
              placeholder="acme-retail"
              required
            />
            <p className="text-[11px] text-slate-500 mt-1">
              Lowercase letters, numbers, and hyphens only — this becomes the
              tenant&apos;s future subdomain and can&apos;t be changed later.
            </p>
            {slug.length > 0 && !slugValid && (
              <p className="text-[11px] text-red-400 mt-1">
                Only lowercase letters, numbers, and hyphens are allowed.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Contact name
              </label>
              <input
                type="text"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Contact phone
              </label>
              <input
                type="text"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">
              Notes
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
            />
          </div>

          <div className="border-t border-slate-700 pt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Admin username *
              </label>
              <input
                type="text"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                required
              />
            </div>
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                Admin password *
              </label>
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
          >
            {isSubmitting ? "Creating..." : "Create tenant"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default AddTenantModal;
