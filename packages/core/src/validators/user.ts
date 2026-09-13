/**
 * User-management validation schemas — shared by the desktop IPC handlers
 * (`electron-app/handlers/authHandlers.ts`, via `electron-app/schemas/index.ts`
 * re-exports) and the web REST routes (`backend/src/api/users.ts`).
 *
 * Why this lives in its own file instead of `validators/auth.ts`:
 * `auth.ts` used to carry `createUserSchema`/`updateUserSchema` too, but both
 * required a `full_name` field the `users` table has never had
 * (`UserRepository.getColumns()` returns
 * `id, username, password_hash, role, is_active, tenant_id` — no
 * `full_name`). Nothing in the tree imported them; they were dead fiction
 * that would 400 every request the moment someone wired REST validation up
 * by reaching for the name that sounded right. They were deleted rather than
 * fixed in place so the correct, currently-enforced desktop rules below —
 * lifted verbatim from `electron-app/schemas/index.ts`'s
 * `CreateUserSchema`/`SetPasswordSchema`/`SetUserActiveSchema`/
 * `SetUserRoleSchema` — become the ONE definition (CLAUDE.md rule 14), not a
 * second one competing with the stale one.
 *
 * Why each schema below has a "Body" variant and a full variant: REST takes
 * the target user's `id` from the URL path param (`PATCH /users/:id/...`),
 * while IPC takes it from the payload object (`{ id, ... }` in one call).
 * The Body schema is the two transports' actual common ground — the fields
 * that travel in the request BODY on both — and the full schema extends it
 * with `id` for IPC's single flat payload. This also lets the REST route
 * validate the body and the path param separately without duplicating the
 * password/role rules a second time.
 */

import { z } from "zod";

export const createUserSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(4, "Password must be at least 4 characters"),
  role: z.enum(["admin", "staff"]),
});
export type CreateUserInput = z.infer<typeof createUserSchema>;

export const setUserPasswordBodySchema = z.object({
  password: z.string().min(4, "Password must be at least 4 characters"),
});
export type SetUserPasswordBodyInput = z.infer<
  typeof setUserPasswordBodySchema
>;

export const setUserPasswordSchema = setUserPasswordBodySchema.extend({
  id: z.number().int().positive(),
});
export type SetUserPasswordInput = z.infer<typeof setUserPasswordSchema>;

export const setUserActiveBodySchema = z.object({
  is_active: z.union([z.literal(0), z.literal(1)]),
});
export type SetUserActiveBodyInput = z.infer<typeof setUserActiveBodySchema>;

export const setUserActiveSchema = setUserActiveBodySchema.extend({
  id: z.number().int().positive(),
});
export type SetUserActiveInput = z.infer<typeof setUserActiveSchema>;

export const setUserRoleBodySchema = z.object({
  role: z.enum(["admin", "staff"]),
});
export type SetUserRoleBodyInput = z.infer<typeof setUserRoleBodySchema>;

export const setUserRoleSchema = setUserRoleBodySchema.extend({
  id: z.number().int().positive(),
});
export type SetUserRoleInput = z.infer<typeof setUserRoleSchema>;
