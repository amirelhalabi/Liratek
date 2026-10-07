import { useState } from "react";
import type { FormEvent } from "react";
import { X } from "lucide-react";
import type { CreateSignupInvitationInput } from "@liratek/core";
import { messageFrom } from "@/api/apiError";
import { useCreateSignupInvitationMutation } from "../hooks/useSignupInvitations";

interface SendInviteModalProps {
  isOpen: boolean;
  onClose: () => void;
}

/**
 * "Send invite" (LIRA-267 US1) — email a single-use sign-up link.
 *
 * The link itself never reaches this page: the server returns the invite
 * without its token, which travels only by email. Errors (409 email not
 * configured / address already has a shop) are shown inline in the server's
 * words; requestJson throws them as a plain object, so they are read with
 * `messageFrom`, never `instanceof Error`.
 */
export function SendInviteModal({ isOpen, onClose }: SendInviteModalProps) {
  const createInvite = useCreateSignupInvitationMutation();
  const [email, setEmail] = useState("");
  const [shopNameHint, setShopNameHint] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const isSubmitting = createInvite.isPending;
  const canSubmit = email.trim().length > 0 && !isSubmitting;

  const handleClose = () => {
    setEmail("");
    setShopNameHint("");
    setError(null);
    onClose();
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    // Built once; an empty hint is omitted rather than sent as "".
    const payload: CreateSignupInvitationInput = {
      email: email.trim(),
      ...(shopNameHint.trim() ? { shopNameHint: shopNameHint.trim() } : {}),
    };
    try {
      await createInvite.mutateAsync(payload);
      handleClose();
    } catch (err) {
      setError(messageFrom(err, "Failed to send the invitation"));
    }
  };

  const inputClass =
    "w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500";

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[100] p-4">
      <div
        role="dialog"
        aria-label="Send invite"
        className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden flex flex-col"
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-700">
          <h3 className="text-lg font-bold text-white">Send invite</h3>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            className="text-slate-500 hover:text-white transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <p className="text-sm text-slate-400">
            We&apos;ll email a sign-up link that works once and expires in 72
            hours. The shop will use this email as its contact address.
          </p>

          {error && (
            <div
              role="alert"
              className="p-3 rounded-lg bg-red-500/15 border border-red-500/40 text-red-300 text-sm"
            >
              {error}
            </div>
          )}

          <div>
            <label
              className="text-xs text-slate-400 block mb-1"
              htmlFor="send-invite-email"
            >
              Email *
            </label>
            <input
              id="send-invite-email"
              data-testid="send-invite-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="owner@shop.com"
              autoComplete="off"
              autoFocus
            />
          </div>

          <div>
            <label
              className="text-xs text-slate-400 block mb-1"
              htmlFor="send-invite-shop"
            >
              Shop name (optional)
            </label>
            <input
              id="send-invite-shop"
              data-testid="send-invite-shop"
              type="text"
              value={shopNameHint}
              onChange={(e) => setShopNameHint(e.target.value)}
              className={inputClass}
              placeholder="Prefills the sign-up form"
              maxLength={100}
            />
          </div>

          <button
            type="submit"
            data-testid="send-invite-submit"
            disabled={!canSubmit}
            className="w-full py-3 bg-orange-500 hover:bg-orange-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-semibold rounded-lg transition-colors"
          >
            {isSubmitting ? "Sending..." : "Send invite"}
          </button>
        </form>
      </div>
    </div>
  );
}

export default SendInviteModal;
