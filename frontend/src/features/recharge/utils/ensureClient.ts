import type { PaymentLine } from "@liratek/ui";
import { createClient } from "@/api/backendApi";

interface EnsureClientArgs {
  /** Existing client ID if one was picked from search; null otherwise. */
  clientId: number | null;
  /**
   * True when this submit goes into the active customer session's basket.
   * Required (not optional) so every caller has to decide — a new form that
   * forgets cannot silently fall back to creating a client.
   */
  inSession: boolean;
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
 *
 * Inside a customer session it never creates a client: the session owns the
 * customer (it was registered when the session started, and the server stamps
 * the session's client on every basket item at checkout), and the basket
 * collects payment at checkout, so the form's payment lines don't apply here.
 * Before this, every add-to-cart sent a client create for the session
 * customer and got a 409 "Phone number already registered" (shop day
 * 2026-10-16).
 */
export async function ensureRechargeClient({
  clientId,
  inSession,
  name,
  phone,
  paymentLines,
}: EnsureClientArgs): Promise<EnsureClientResult> {
  if (clientId) return { ok: true, id: clientId };
  if (inSession) return { ok: true, id: null };

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
    // Migrated off raw window.api (rule 19) onto the dual-transport
    // createClient adapter fn — this util runs on the path of every recharge
    // sale that names a new client, so it must work on both transports too
    // (rule 11 client propagation).
    const result = await createClient({
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
