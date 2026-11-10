/**
 * LIRA-377 T048 — the body of a `restore_removed` review item: the records
 * the shop restore removed (so the admin can re-enter the work by hand) and
 * the restore it came from. When every removed record is a client (the item
 * offers "apply"), the admin picks another client or books it as a walk-in;
 * the choice is handed to the page as the core `ReviewApplyInput` (rule 21),
 * which asks to confirm before calling the adapter.
 */
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type {
  RemovedReference,
  RestoreRemovedDetails,
  ReviewApplyInput,
} from "@liratek/core";
import { ClientAutocompleteInput } from "@/shared/components/ClientAutocompleteInput";

function isRemovedReference(v: unknown): v is RemovedReference {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.table === "string" &&
    typeof r.id === "number" &&
    typeof r.label === "string" &&
    typeof r.path === "string"
  );
}

/** Reads `details` defensively: anything malformed shows as "nothing removed". */
function readRestoreRemovedDetails(
  details: Record<string, unknown> | null | undefined,
): RestoreRemovedDetails {
  const raw: unknown = details?.removed;
  const removed = Array.isArray(raw) ? raw.filter(isRemovedReference) : [];
  return {
    restoreId: typeof details?.restoreId === "number" ? details.restoreId : 0,
    restoredTo:
      typeof details?.restoredTo === "string" ? details.restoredTo : null,
    removed,
  };
}

export interface RestoreRemovedPanelProps {
  itemId: number;
  details: Record<string, unknown> | null | undefined;
  /** true when the item offers "apply" (every removed record is a client) */
  canBook: boolean;
  busy: boolean;
  /** formats a UTC instant in local time */
  when: (iso: string | null) => string;
  onBook: (body: ReviewApplyInput, confirmText: string) => void;
}

export function RestoreRemovedPanel({
  itemId,
  details,
  canBook,
  busy,
  when,
  onBook,
}: RestoreRemovedPanelProps) {
  const { t } = useTranslation("offline");
  const d = readRestoreRemovedDetails(details);
  const [clientText, setClientText] = useState("");
  const [client, setClient] = useState<{ id: number; name: string } | null>(
    null,
  );
  const fieldId = `restore-removed-client-${itemId}`;

  return (
    <div className="mt-2 rounded-lg border border-slate-700/50 bg-slate-900/50 p-3 text-sm">
      <p className="text-slate-300">{t("review.removed.title")}</p>
      <ul className="mt-1 list-disc ps-5 text-amber-200">
        {d.removed.map((r) => (
          <li key={`${r.table}-${r.id}`}>
            {t("review.removed.record", {
              label: r.label,
              table: r.table,
              id: r.id,
            })}
          </li>
        ))}
      </ul>
      <p className="mt-1 text-xs text-slate-400">
        {d.restoredTo
          ? t("review.removed.fromRestoreTo", { when: when(d.restoredTo) })
          : t("review.removed.fromFile")}
      </p>

      {details?.payload !== undefined && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs text-slate-400">
            {t("review.removed.recorded")}
          </summary>
          <pre
            dir="ltr"
            className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-slate-950 p-2 text-xs text-slate-300"
          >
            {JSON.stringify(details.payload, null, 2)}
          </pre>
        </details>
      )}

      {canBook && (
        <div className="mt-3 space-y-2">
          <label htmlFor={fieldId} className="text-xs text-slate-400 block">
            {t("review.removed.pickClient")}
          </label>
          <ClientAutocompleteInput
            id={fieldId}
            value={clientText}
            onChange={(v) => {
              setClientText(v);
              // typing again un-picks the client until one is chosen
              setClient(null);
            }}
            onClientSelect={(c) => setClient({ id: c.id, name: c.full_name })}
            placeholder={t("review.removed.pickClientPlaceholder")}
            className="w-full bg-slate-900 border border-slate-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-orange-500"
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy || client === null}
              onClick={() => {
                if (!client) return;
                onBook(
                  { replacementClientId: client.id },
                  t("review.removed.confirmClient", { name: client.name }),
                );
              }}
              className="px-3 py-1 rounded-lg bg-slate-700 text-sm text-white hover:bg-slate-600 disabled:opacity-50"
            >
              {t("review.removed.bookWithClient")}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                onBook({ walkIn: true }, t("review.removed.confirmWalkIn"))
              }
              className="px-3 py-1 rounded-lg bg-slate-700 text-sm text-white hover:bg-slate-600 disabled:opacity-50"
            >
              {t("review.removed.bookWalkIn")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

export default RestoreRemovedPanel;
