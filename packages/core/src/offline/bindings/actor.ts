/**
 * Actor helpers for offline bindings (LIRA-306). The actor is ALWAYS the
 * event's `actorUserId` (O-new-7) — never a payload field.
 */
import { getUserRepository } from "../../repositories/UserRepository.js";

/**
 * The `editedBy` label the metadata-edit services take. Same rule as the IPC
 * handlers (`user.username`, falling back to `user-<id>`); the REST routes
 * read the same username from the JWT.
 */
export function actorUsername(actorUserId: number): string {
  try {
    const user = getUserRepository().findById(actorUserId) as { username?: string } | null;
    if (user?.username) return user.username;
  } catch {
    // fall through to the handler's fallback label
  }
  return `user-${actorUserId}`;
}
