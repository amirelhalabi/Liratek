/**
 * LIRA-333 — "Send on WhatsApp" for a saved POS sale (post-sale strip and
 * sale details window share it, so both send the same text, SC-003).
 *
 * The saved sale is PREFETCHED when the strip appears or the details window
 * opens, because a browser only lets a click open a new tab inside the
 * click's synchronous call stack: `send()` builds the link and calls
 * `openExternalUrl` with no `await` in between (research R5).
 *
 * Reads only (`getSale`, `getSaleItems`) and opens a link — it never writes
 * to the sale, the client or any ledger (FR-023). A number typed for one
 * send lives in the caller's state and is never saved (FR-013).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useApi } from "@liratek/ui";
import { useTranslation } from "react-i18next";
import { toWhatsAppNumber } from "@liratek/core";
import logger from "@/utils/logger";
import { useShopInfo } from "@/hooks/useShopName";
import type {
  SaleDetail,
  SaleDetailItem,
} from "@/features/sales/types/saleDetail";
import {
  buildSaleReceiptData,
  recipientPhoneFor,
} from "@/features/sales/utils/saleReceipt";
import {
  buildWhatsAppLink,
  formatReceiptWhatsApp,
  type ReceiptData,
} from "@/features/sales/utils/receiptFormatter";

export type SendReceiptStatus = "idle" | "loading" | "ready" | "error";

interface Loaded {
  saleId: number;
  sale: SaleDetail;
  items: SaleDetailItem[];
}

export function useSendReceiptOnWhatsApp(
  saleId: number | null,
  /** Bump to re-read the sale (e.g. after its customer phone was edited). */
  refreshKey: number = 0,
) {
  const api = useApi();
  // rule 25: read api through a ref, never as an effect dependency (the
  // ref is refreshed in an effect, as in Profits.tsx, so render stays pure).
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  }, [api]);
  const shop = useShopInfo();
  // LIRA-331: the cashier-facing errors follow the screen language; the
  // WhatsApp message itself stays English (owner decision).
  const { t } = useTranslation("sales");

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [status, setStatus] = useState<SendReceiptStatus>(
    saleId == null ? "idle" : "loading",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (saleId == null) {
      setLoaded(null);
      setStatus("idle");
      setError(null);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setError(null);
    Promise.all([
      apiRef.current.getSale(saleId),
      apiRef.current.getSaleItems(saleId),
    ])
      .then(([sale, items]) => {
        if (cancelled) return;
        if (!sale) {
          setLoaded(null);
          setStatus("error");
          return;
        }
        setLoaded({
          saleId,
          sale: sale as SaleDetail,
          items: (items ?? []) as SaleDetailItem[],
        });
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        logger.error("Failed to load the sale for its receipt", { err });
        setLoaded(null);
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, [saleId, refreshKey]);

  const receipt: ReceiptData | null = useMemo(
    () =>
      loaded && loaded.saleId === saleId
        ? buildSaleReceiptData(loaded.sale, loaded.items, shop)
        : null,
    [loaded, saleId, shop],
  );

  const savedPhone = loaded ? recipientPhoneFor(loaded.sale) : null;
  const needsNumber = status === "ready" && savedPhone == null;

  /** Open WhatsApp on the sale's number (or `typedNumber`, for this send
   *  only). Synchronous up to `openExternalUrl` — call it straight from the
   *  click handler. */
  const send = useCallback(
    (typedNumber?: string) => {
      if (status !== "ready" || !receipt) return;
      const raw = typedNumber ?? savedPhone;
      const phone = toWhatsAppNumber(raw);
      if (!phone.ok) {
        setError(
          phone.reason === "empty"
            ? t("whatsapp.numberEmpty")
            : t("whatsapp.numberInvalid"),
        );
        return;
      }
      const url = buildWhatsAppLink(
        phone.digits,
        formatReceiptWhatsApp(receipt),
      );
      const pending = apiRef.current.openExternalUrl({ url });
      setError(null);
      pending
        .then((result) => {
          if (result.success) return;
          setError(
            result.error === "blocked"
              ? t("whatsapp.blocked")
              : t("whatsapp.openFailed", {
                  error: result.error ?? t("whatsapp.unknownError"),
                }),
          );
        })
        .catch((err: unknown) => {
          logger.error("Opening WhatsApp failed", { err });
          setError(t("whatsapp.blocked"));
        });
    },
    [status, receipt, savedPhone, t],
  );

  const clearError = useCallback(() => setError(null), []);

  return { status, needsNumber, send, error, clearError, receipt };
}
