/**
 * Unwrap the standard IPC response envelope `{ success, error?, ...payload }`
 * into the actual payload value, throwing if `success` is false.
 *
 * Usage with TanStack Query:
 *   queryFn: () => unwrapIpc(
 *     window.api.suppliers.getAll(),
 *     r => r.suppliers ?? [],
 *   )
 *
 * The generic `E` must extend the envelope shape; `pick` selects the payload
 * you care about so the query's data type is inferred automatically.
 */
export async function unwrapIpc<
  E extends { success: boolean; error?: string },
  T,
>(call: Promise<E>, pick: (envelope: E) => T): Promise<T> {
  const res = await call;
  if (!res.success) throw new Error(res.error ?? "Request failed");
  return pick(res);
}
