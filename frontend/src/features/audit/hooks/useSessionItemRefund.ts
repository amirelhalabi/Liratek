/**
 * LIRA-232 (SESSION_ITEM_REFUND_PLAN.md §4/§7) — the shared preview→confirm
 * orchestration behind refunding ONE (or, with `saleItemId` omitted on a
 * SALE member, every remaining) line of a customer-session basket item.
 * Both the Transactions-page session-group "Refund" action and the POS
 * session-sale refund flow drive the SAME `RefundMethodModal` off this ONE
 * hook (rule 14) — never two copies of the preview/confirm wiring.
 *
 * Deliberately reads only the preview fields that are STABLE across the
 * LIRA-232 core money-fix in flight (`accountReductionUsd/Lbp`, `defaultLegs`
 * — both unchanged by that fix): `defaultLegs`' own per-currency total IS the
 * remainder, so handing it straight to `RefundMethodModal`'s `legs` prop
 * reuses that modal's EXISTING `netByCurrency`/`buildDefaultRefundLines`/
 * `validateRefundLines` machinery (refundLegOverride.ts) for the remainder
 * pre-fill and per-currency validation — no second copy of that math here.
 */
import { useCallback, useRef, useState } from "react";
import { useApi, appEvents } from "@liratek/ui";
import type {
  SessionItemRefundInput,
  SessionItemRefundPreviewInput,
  SessionItemRefundPreview,
} from "@liratek/core";
import type { BookedRateSource } from "@/api/backendApi";
import type { TransactionPaymentLeg } from "../cashFlow";
import type {
  RefundLegOverride,
  RefundUnitExtraOverride,
} from "../refundLegOverride";
import { localDay } from "@/shared/utils/localDay";

/**
 * LIRA-236 round-2/final review, finding F11 (LOW, rule 21) — `unitExtras`
 * and `exchangeRate` used to be hand-added here via an intersection type,
 * forward-declaring fields a "concurrent core change" hadn't landed on the
 * real schema yet. Both fields are now real, schema-derived members of
 * `SessionItemRefundInput` (`sessionItemRefundSchema`,
 * `packages/core/src/validators/transaction.ts`) and
 * `SessionItemRefundPreviewInput`/`SessionItemRefundPreview`
 * (`TransactionRepository.ts`) — so `payload`/`preview` below are typed
 * DIRECTLY off the core-exported types, never a hand-copied second
 * definition of the same contract (a hand-written copy is exactly what let
 * `ApiAdapter.addRepayment` drift from its schema — see rule 21).
 */

/** Debounce window for `changeRate`'s re-preview fetch (LIRA-236) — mirrors
 *  the kind of short UI-settle delay `AUTO_SPLIT_REVEAL_MS` uses elsewhere in
 *  the payment UI; keeps a fast typist from firing a preview request per
 *  keystroke. */
const RATE_CHANGE_DEBOUNCE_MS = 400;

export interface SessionItemRefundTarget {
  sessionId: number;
  transactionId: number;
  /** Required, with `quantity`, only for a SALE member refunding ONE line;
   *  omit both to refund every remaining line of the member (owner Q2). */
  saleItemId?: number;
  quantity?: number;
  /** e.g. "amir" — the customer whose account balance drops, for the
   *  account-reduction message. */
  clientLabel?: string;
}

export interface SessionItemRefundPreviewState {
  target: SessionItemRefundTarget;
  legs: TransactionPaymentLeg[];
  accountReductionUsd: number;
  accountReductionLbp: number;
  /** LIRA-232 round-2 review (finding 4) — the name of the client whose
   *  account this refund actually credits (core's `accountClientName`,
   *  the "Session Debt" row's OWN client, which can differ from the item's
   *  buyer inside a basket — see `debtClientId` in
   *  `TransactionRepository._planSessionItemRefund`). Preferred over
   *  `target.clientLabel` (the row/sale's own client name) whenever
   *  present. */
  accountClientName?: string;
  /** LIRA-236 — the popup's default rate + its provenance, read straight off
   *  the preview (`SessionItemRefundPreview.bookedRate`, always present on a
   *  successful response — see `TransactionRepository.getSessionItemRefundPreview`). */
  bookedRate?: number;
  bookedRateSource?: BookedRateSource;
}

export function useSessionItemRefund(onRefunded: () => void) {
  const api = useApi();
  // LIRA-236 round-2/final review, finding F10 (LOW, rule 25) — read `api`
  // through a ref so `open`/`changeRate`/`confirm` keep a STABLE identity.
  // `useApi()`'s value is only stable because `ApiProvider` happens to pass a
  // module-level singleton in production — an implicit contract the provider
  // does not enforce (see `FeatureFlagContext.tsx`, the canonical pattern
  // mirrored here). Nothing in this hook puts these callbacks in an
  // automatically-firing effect's dependency array today, but a stable
  // identity costs nothing and closes off that failure mode for good — the
  // ref is reassigned every render, so `.current` is always current when a
  // callback actually runs.
  const apiRef = useRef(api);
  apiRef.current = api;
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [preview, setPreview] =
    useState<SessionItemRefundPreviewState | null>(null);
  // LIRA-236 — `changeRate`'s debounce timer, and the target the currently
  // OPEN preview belongs to (read inside the debounced callback, which fires
  // after this render's closure is stale — `preview` itself may have moved
  // on, so the timer reads through a ref, not the render's `preview`).
  const rateChangeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const previewRef = useRef<SessionItemRefundPreviewState | null>(null);
  previewRef.current = preview;

  const open = useCallback(
    async (target: SessionItemRefundTarget) => {
      setLoadingPreview(true);
      try {
        const payload: SessionItemRefundPreviewInput = {
          sessionId: target.sessionId,
          transactionId: target.transactionId,
          saleItemId: target.saleItemId,
          quantity: target.quantity,
        };
        const res = await apiRef.current.getSessionItemRefundPreview(payload);
        if (!res.success) {
          appEvents.emit(
            "notification:show",
            res.error || "Failed to load refund preview",
            "error",
          );
          return;
        }
        const preview = res as { success: true } & SessionItemRefundPreview;
        setPreview({
          target,
          legs: preview.defaultLegs ?? [],
          accountReductionUsd: preview.accountReductionUsd ?? 0,
          accountReductionLbp: preview.accountReductionLbp ?? 0,
          ...(preview.accountClientName
            ? { accountClientName: preview.accountClientName }
            : {}),
          ...(preview.bookedRate !== undefined
            ? { bookedRate: preview.bookedRate }
            : {}),
          ...(preview.bookedRateSource
            ? { bookedRateSource: preview.bookedRateSource }
            : {}),
        });
      } catch (_err) {
        appEvents.emit(
          "notification:show",
          "Failed to load refund preview",
          "error",
        );
      } finally {
        setLoadingPreview(false);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- apiRef.current is read at call time, not captured; no dep needed
    },
    [],
  );

  const cancel = useCallback(() => {
    if (rateChangeTimerRef.current) clearTimeout(rateChangeTimerRef.current);
    setPreview(null);
  }, []);

  /**
   * LIRA-236 — re-fetch the preview at a NEW rate (debounced), so the
   * "Reduces X's account by …" line and the remainder legs follow the rate
   * the operator is typing into RefundMethodModal, without firing a request
   * per keystroke. Wired as RefundMethodModal's `onRateChange` prop, which
   * itself only fires on a genuine operator edit (never on mount) — so this
   * never runs for an untouched popup. A no-op once the preview has closed
   * (`cancel`/`confirm` already ran, or nothing was ever opened).
   */
  const changeRate = useCallback(
    (rate: number) => {
      if (rateChangeTimerRef.current) clearTimeout(rateChangeTimerRef.current);
      rateChangeTimerRef.current = setTimeout(() => {
        void (async () => {
          const current = previewRef.current;
          if (!current) return;
          try {
            const payload: SessionItemRefundPreviewInput = {
              sessionId: current.target.sessionId,
              transactionId: current.target.transactionId,
              saleItemId: current.target.saleItemId,
              quantity: current.target.quantity,
              exchangeRate: rate,
            };
            const res = await apiRef.current.getSessionItemRefundPreview(payload);
            if (!res.success) return; // silent — the shown preview stays as-is
            const updated = res as { success: true } & SessionItemRefundPreview;
            // The preview may have moved on (cancelled/confirmed/reopened
            // for a different target) while this request was in flight.
            if (
              previewRef.current?.target.sessionId !== current.target.sessionId ||
              previewRef.current?.target.transactionId !==
                current.target.transactionId
            ) {
              return;
            }
            setPreview((prev) =>
              prev
                ? {
                    ...prev,
                    legs: updated.defaultLegs ?? prev.legs,
                    accountReductionUsd:
                      updated.accountReductionUsd ?? prev.accountReductionUsd,
                    accountReductionLbp:
                      updated.accountReductionLbp ?? prev.accountReductionLbp,
                    ...(updated.accountClientName
                      ? { accountClientName: updated.accountClientName }
                      : {}),
                    bookedRate: rate,
                    ...(updated.bookedRateSource
                      ? { bookedRateSource: updated.bookedRateSource }
                      : {}),
                  }
                : prev,
            );
          } catch {
            // silent — the shown preview stays as-is, same as `open`'s own
            // "don't crash the modal over a re-preview failure" posture.
          }
        })();
      }, RATE_CHANGE_DEBOUNCE_MS);
      // eslint-disable-next-line react-hooks/exhaustive-deps -- apiRef.current is read at call time, not captured; no dep needed
    },
    [],
  );

  const confirm = useCallback(
    async (
      refundLegsInput: RefundLegOverride[] | undefined,
      unitExtras?: RefundUnitExtraOverride[],
      exchangeRate?: number,
    ) => {
      if (!preview) return;
      setSubmitting(true);
      try {
        const payload: SessionItemRefundInput = {
          sessionId: preview.target.sessionId,
          transactionId: preview.target.transactionId,
          saleItemId: preview.target.saleItemId,
          quantity: preview.target.quantity,
          clientDay: localDay(),
        };
        if (refundLegsInput) {
          // Typing follow-up (rule 21/24) — `RefundLegOverride` (audit's own
          // DTO) is now a type alias for the SAME core schema type
          // `SessionItemRefundInput["refundLegs"]` is derived from
          // (`refundLegsSchema`, rule 21), so no per-item narrowing
          // conversion is needed here anymore — the old `currencyCode ===
          // "LBP" ? "LBP" : "USD"` ternary silently mapped any OTHER
          // currency (e.g. USDT) to "USD"; the real narrow now happens once,
          // where a `PaymentLine` becomes a `RefundLegOverride`
          // (`toRefundLegs`, refundLegOverride.ts).
          payload.refundLegs = refundLegsInput;
        }
        if (unitExtras) {
          payload.unitExtras = unitExtras;
        }
        if (exchangeRate !== undefined) {
          payload.exchangeRate = exchangeRate;
        }
        const res = await apiRef.current.refundSessionBasketItem(payload);
        if (res.success) {
          onRefunded();
        } else {
          appEvents.emit(
            "notification:show",
            res.error || "Refund failed",
            "error",
          );
        }
      } catch (_err) {
        appEvents.emit(
          "notification:show",
          "Refund failed unexpectedly",
          "error",
        );
      } finally {
        setSubmitting(false);
        if (rateChangeTimerRef.current) {
          clearTimeout(rateChangeTimerRef.current);
        }
        setPreview(null);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps -- apiRef.current is read at call time, not captured; no dep needed
    },
    [preview, onRefunded],
  );

  return {
    preview,
    loadingPreview,
    submitting,
    open,
    cancel,
    confirm,
    changeRate,
  };
}
