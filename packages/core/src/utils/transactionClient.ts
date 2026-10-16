/**
 * LIRA-329 — the ONE rule for filling a transaction's own `client_name` /
 * `client_phone` from the picked client (rule 14, FR-003). Pure: the
 * repository reads the client row and hands it in.
 *
 *  - A name or phone the caller sent is never replaced.
 *  - No name → the client's name, and the client's phone when no phone was
 *    sent either. Filling the name first is what keeps the existing guard
 *    "client_phone requires client_name" satisfied for a phone-only caller.
 *  - A name was sent but no phone → the client's phone ONLY when the sent
 *    name is that client's own name. A row labelled with someone else (a
 *    For-Partner "<partner> [partner]" row whose `client_id` is the walk-in)
 *    must not carry the walk-in's phone under the partner's name.
 */
export interface TransactionClientFields {
  client_name?: string | null;
  client_phone?: string | null;
}

export interface ClientRecordForTransaction {
  full_name: string | null;
  phone_number: string | null;
}

function blank(v: string | null | undefined): boolean {
  return v == null || v.trim() === "";
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export function resolveTransactionClient(
  sent: TransactionClientFields,
  client: ClientRecordForTransaction | null | undefined,
): { client_name: string | null; client_phone: string | null } {
  const name = blank(sent.client_name) ? null : sent.client_name!;
  const phone = blank(sent.client_phone) ? null : sent.client_phone!;
  if (!client || blank(client.full_name)) {
    return { client_name: name, client_phone: phone };
  }
  if (name === null) {
    return {
      client_name: client.full_name,
      client_phone:
        phone ?? (blank(client.phone_number) ? null : client.phone_number),
    };
  }
  if (phone === null && sameName(name, client.full_name!)) {
    return {
      client_name: name,
      client_phone: blank(client.phone_number) ? null : client.phone_number,
    };
  }
  return { client_name: name, client_phone: phone };
}
