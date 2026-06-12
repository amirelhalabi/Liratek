import type { PaymentLine } from "@liratek/ui";

interface EnsureClientArgs {
  /** Existing client ID if one was picked from search; null otherwise. */
  clientId: number | null;
  name: string;
  phone: string;
  /** Payment lines so we know whether CUSTOMER_ACCOUNT is in use. */
  paymentLines: PaymentLine[];
}

export type EnsureClientResult =
  | { ok: true; id: number | null }
  | { ok: false; error: string };

const usesCustomerAccount = (lines: PaymentLine[]): boolean =>
  lines.some((l) => l.method === "CUSTOMER_ACCOUNT");

/**
 * Resolve which client_id to attach to a recharge transaction. When a brand-new
 * client (no `clientId`) has both a name and phone filled in, creates the
 * client on the fly so CUSTOMER_ACCOUNT becomes valid. Returns a typed result
 * the caller uses to either proceed, abort, or fall back to no-client.
 */
export async function ensureRechargeClient({
  clientId,
  name,
  phone,
  paymentLines,
}: EnsureClientArgs): Promise<EnsureClientResult> {
  if (clientId) return { ok: true, id: clientId };

  const trimmedName = name.trim();
  const trimmedPhone = phone.trim();
  const needsCustomerAccount = usesCustomerAccount(paymentLines);

  if (!trimmedName || !trimmedPhone) {
    if (needsCustomerAccount) {
      return {
        ok: false,
        error: "A registered client is required to use Customer Account.",
      };
    }
    return { ok: true, id: null };
  }

  try {
    const result = await window.api.clients.create({
      full_name: trimmedName,
      phone_number: trimmedPhone,
      whatsapp_opt_in: 0,
    });
    if (result?.success && result.id) {
      return { ok: true, id: result.id };
    }
    if (needsCustomerAccount) {
      return {
        ok: false,
        error:
          result?.error ||
          "Failed to register client. Cannot use customer account.",
      };
    }
    return { ok: true, id: null };
  } catch (err) {
    if (needsCustomerAccount) {
      return {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : "Failed to register client. Cannot use customer account.",
      };
    }
    return { ok: true, id: null };
  }
}
