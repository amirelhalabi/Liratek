import { useState } from "react";
import type { FormEvent } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { AdminCreateTenantPayload } from "@/api/backendApi";
import PasswordInput from "@/shared/components/PasswordInput";

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
  const { t } = useTranslation("admin");
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
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
    setContactEmail("");
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
      // Optional (LIRA-267 FR-013b). Omitted when blank: "" fails the
      // schema's email check.
      ...(contactEmail.trim() ? { contactEmail: contactEmail.trim() } : {}),
      ...(notes.trim() ? { notes: notes.trim() } : {}),
      adminUsername: adminUsername.trim(),
      adminPassword,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h3 className="text-lg font-bold text-white">{t("add.title")}</h3>
          <button
            type="button"
            onClick={handleClose}
            aria-label={t("delete.close")}
            className="text-slate-500 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {error && (
            <div className="p-3 rounded-lg bg-red-500/15 border border-red-500/40 text-red-300 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="text-xs text-slate-400 block mb-1">
              {t("add.name")}
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => handleNameChange(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
              placeholder={t("add.namePlaceholder")}
              required
            />
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">
              {t("add.slug")}
            </label>
            <input
              type="text"
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.target.value.toLowerCase());
              }}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
              placeholder={t("add.slugPlaceholder")}
              required
            />
            <p className="text-[11px] text-slate-500 mt-1">
              {t("add.slugHint")}
            </p>
            {slug.length > 0 && !slugValid && (
              <p className="text-[11px] text-red-400 mt-1">
                {t("add.slugInvalid")}
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs text-slate-400 block mb-1">
                {t("add.contactName")}
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
                {t("add.contactPhone")}
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
            <label
              className="text-xs text-slate-400 block mb-1"
              htmlFor="add-tenant-contact-email"
            >
              {t("add.contactEmail")}
            </label>
            <input
              id="add-tenant-contact-email"
              data-testid="add-tenant-contact-email"
              type="email"
              value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
              placeholder={t("add.emailPlaceholder")}
              autoComplete="off"
            />
            <p className="text-[11px] text-slate-500 mt-1">
              {t("add.emailHint")}
            </p>
          </div>

          <div>
            <label className="text-xs text-slate-400 block mb-1">
              {t("add.notes")}
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
                {t("add.adminUsername")}
              </label>
              <input
                type="text"
                data-testid="add-tenant-admin-username"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                required
              />
            </div>
            <div>
              <label
                className="text-xs text-slate-400 block mb-1"
                htmlFor="add-tenant-admin-password"
              >
                {t("add.adminPassword")}
              </label>
              <PasswordInput
                label=""
                id="add-tenant-admin-password"
                name="add-tenant-admin-password"
                testId="add-tenant-admin-password"
                value={adminPassword}
                onChange={setAdminPassword}
                placeholder=""
                autoComplete="new-password"
                inputClassName="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
                required
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={!canSubmit}
            className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
          >
            {isSubmitting ? t("add.creating") : t("add.create")}
          </button>
        </form>
      </div>
    </div>
  );
}

export default AddTenantModal;
