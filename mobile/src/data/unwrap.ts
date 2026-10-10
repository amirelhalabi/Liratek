import type { ApiResult } from "@/api/client";

/** A failed read, carrying the code the screens already show (NO_CONNECTION, UNAUTHORIZED, or the server's). */
export class ApiError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ApiError";
  }
}

/** Query functions must throw on failure so the cache keeps the last good data and reports the error. */
export function unwrap<T>(result: ApiResult<T>): T {
  if (result.success) return result.data;
  throw new ApiError(result.error);
}

export function errorCodeOf(error: unknown): string {
  if (error instanceof ApiError) return error.code;
  return error instanceof Error ? error.message : String(error);
}
