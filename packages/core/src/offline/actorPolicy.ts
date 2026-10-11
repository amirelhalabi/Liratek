/**
 * Who replayed work is credited to (LIRA-306, O-new-7, FR-023 — approved by
 * the owner at gate G0, 2026-10-11). Server-only.
 *
 * The actor is the user recorded on the PC. They must belong to the shop
 * (tenant-scoped lookup) and hold a role the channel allows — the same roles
 * as the IPC handler's `requireRole`. Someone switched off since is still
 * booked (the money moved), with a `user_switched_off` note.
 */
import { getUserRepository, type UserRepository } from "../repositories/UserRepository.js";
import { policyEntry } from "./channelPolicy.js";
import type { ActorCheck } from "./ReplayEngine.js";

export function offlineActorPolicy(users: UserRepository = getUserRepository()) {
  return (actorUserId: number, channel: string): ActorCheck => {
    const user = users.findByIdInShopAnyStatus(actorUserId) as
      | { id: number; username?: string; role?: string; is_active?: number }
      | null;
    if (!user) return { ok: false, error: "The person who did this is not a user of this shop" };
    const roles = policyEntry(channel)?.roles ?? [];
    if (!user.role || !(roles as readonly string[]).includes(user.role)) {
      return { ok: false, error: `${user.username ?? "This user"} is not allowed to do this (needs ${roles.join(" or ")})` };
    }
    const base = { ok: true as const, username: user.username, role: user.role };
    if (user.is_active === 0) {
      return {
        ...base,
        note: { kind: "user_switched_off", details: { userId: user.id, username: user.username } },
      };
    }
    return base;
  };
}
